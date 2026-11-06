import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import random
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.routes import router
from src.routing import RoadNetwork
from src.scenarios import TRAFFIC_SCENARIOS


class TrafficApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "map.json"
        self.nodes = []
        self.roads = []
        self.case_routes = {}
        self.coords = {}
        for case_index in range(1, 4):
            case_id = f"TC{case_index:02d}"
            scenario = TRAFFIC_SCENARIOS[f"traffic_jam_tc{case_index:02d}"]
            event_nodes = [scenario["event_edges"][0][0]] + [
                edge[1] for edge in scenario["event_edges"]
            ]
            base_lat = 20.0 + case_index
            base_lng = 105.0
            start = f"start_{case_id}"
            goal = f"goal_{case_id}"
            detour = f"detour_{case_id}"
            start_coord = (base_lat, base_lng)
            goal_coord = (base_lat + 0.007, base_lng)
            self.nodes.extend([
                {"id": start, "lat": start_coord[0], "lng": start_coord[1]},
                {"id": goal, "lat": goal_coord[0], "lng": goal_coord[1]},
                {"id": detour, "lat": base_lat + 0.0035, "lng": base_lng + 0.004},
            ])
            self.coords[start] = {"lat": start_coord[0], "lng": start_coord[1]}
            self.coords[goal] = {"lat": goal_coord[0], "lng": goal_coord[1]}
            self.coords[detour] = {
                "lat": base_lat + 0.0035, "lng": base_lng + 0.004,
            }
            for position, node_id in enumerate(event_nodes):
                coordinate = (base_lat + 0.001 * (position + 1), base_lng)
                self.nodes.append({"id": node_id, "lat": coordinate[0], "lng": coordinate[1]})
                self.coords[node_id] = {"lat": coordinate[0], "lng": coordinate[1]}
            self.roads.extend([
                {"from": start, "to": event_nodes[0], "distance_km": 0.1,
                 "bidirectional": False},
                *[{
                    "from": source, "to": target, "distance_km": 0.01,
                    "bidirectional": not (
                        case_id == "TC01"
                        and (source, target) == scenario["event_edges"][0]
                    ),
                } for source, target in scenario["event_edges"]],
                {"from": event_nodes[-1], "to": goal, "distance_km": 0.1,
                 "bidirectional": False},
                {"from": start, "to": detour, "distance_km": 0.15,
                 "bidirectional": False},
                {"from": detour, "to": goal, "distance_km": 0.15,
                 "bidirectional": False},
            ])
            self.case_routes[case_id] = (start, event_nodes, goal, detour)
        self.path.write_text(json.dumps({
            "nodes": self.nodes,
            "roads": self.roads,
        }))
        app = FastAPI()
        app.include_router(router)
        self.network = RoadNetwork(self.path)
        app.state.network = self.network
        # This fixture uses the congestion corridor as the closure path; the
        # production OSM cases use their own closure-candidate edges.
        node_indexes = {
            node_id: index for index, node_id in enumerate(self.network.ids)
        }
        for case_id, (_, event_nodes, _, _) in self.case_routes.items():
            scenario_id = f"road_closure_{case_id.lower()}"
            scenario = TRAFFIC_SCENARIOS[scenario_id]
            fixture_edges = list(zip(event_nodes, event_nodes[1:]))
            selected = random.Random(scenario["random_seed"]).sample(
                fixture_edges, scenario["closed_road_count"]
            )
            blocked = {
                (node_indexes[source], node_indexes[target])
                for source, target in selected
            }
            for source, target in selected:
                reverse = (node_indexes[target], node_indexes[source])
                if self.network._edge_offset(self.network.graph, *reverse) is not None:
                    blocked.add(reverse)
            self.network._resolved_traffic_scenarios[scenario_id] = {
                "available": True,
                "event_edges": (),
                "closed_edges": tuple(blocked),
            }
        app.state.network_error = False
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
    def post_route(self, start, goal, scenario, algorithm="astar", speed=40,
                   objective=None):
        body = {
            "start": self.coords[start],
            "goal": self.coords[goal],
            "algorithm": algorithm,
            "speed_kmh": speed,
            "traffic_scenario_id": scenario,
        }
        if objective is not None:
            body["objective"] = objective
        return self.client.post("/api/route", json=body)

    def route_node_ids(self, response):
        coords_to_ids = {
            (point["lat"], point["lng"]): node_id
            for node_id, point in self.coords.items()
        }
        return [coords_to_ids[tuple(point)] for point in response.json()["coordinates"]]

    def test_scenario_catalog_has_one_peak_jam_for_each_hospital_case(self):
        response = self.client.get("/api/traffic-scenarios")
        self.assertEqual(response.status_code, 200)
        scenarios = {item["id"]: item for item in response.json()}
        self.assertEqual(set(scenarios), set(TRAFFIC_SCENARIOS))
        for case_index, case_id in enumerate(("TC01", "TC02", "TC03"), start=1):
            congestion = scenarios[f"traffic_jam_{case_id.lower()}"]
            closure = scenarios[f"road_closure_{case_id.lower()}"]
            self.assertEqual(congestion["route_case_id"], case_id)
            self.assertEqual(congestion["speed_kmh"], 12.0)
            self.assertEqual(len(congestion["event_edges"]), 5)
            self.assertEqual(closure["kind"], "road_closure")
            self.assertEqual(closure["closed_road_count"], 2)
            self.assertEqual(closure["random_seed"], 7200 + case_index)

    def test_each_tc_uses_12_kmh_on_all_corridor_edges(self):
        for algorithm in ("astar", "dijkstra"):
            with self.subTest(algorithm=algorithm):
                for case_id, (start, event_nodes, goal, _) in self.case_routes.items():
                    scenario_id = f"traffic_jam_{case_id.lower()}"
                    with self.subTest(scenario=scenario_id):
                        baseline = self.post_route(start, goal, None, algorithm)
                        response = self.post_route(
                            start, goal, scenario_id, algorithm, objective="distance",
                        )
                        self.assertEqual(baseline.status_code, 200)
                        self.assertEqual(response.status_code, 200)
                        result = response.json()
                        expected_nodes = [start, *event_nodes, goal]
                        self.assertEqual(self.route_node_ids(response), expected_nodes)
                        self.assertEqual(result["segment_speeds_kmh"], [40, *([12] * 5), 40])
                        self.assertEqual(result["segment_speed_sources"], [
                            "no_live_data_assumed", *(["simulated"] * 5),
                            "no_live_data_assumed",
                        ])
                        self.assertEqual(
                            result["segment_edges"],
                            [list(edge) for edge in zip(expected_nodes, expected_nodes[1:])],
                        )
                        self.assertGreater(result["estimated_time_sec"],
                                           baseline.json()["estimated_time_sec"])
                        self.assertIn("12 km/h", result["traffic_note"])

    def test_time_objective_finds_minimum_time_for_astar_and_dijkstra(self):
        start, event_nodes, goal, detour = self.case_routes["TC01"]
        scenario_id = "traffic_jam_tc01"
        expected_distance_path = [start, *event_nodes, goal]

        for algorithm in ("astar", "dijkstra"):
            with self.subTest(algorithm=algorithm):
                shortest = self.post_route(
                    start, goal, scenario_id, algorithm, objective="distance",
                )
                fastest = self.post_route(
                    start, goal, scenario_id, algorithm, objective="time",
                )
                self.assertEqual(shortest.status_code, 200)
                self.assertEqual(fastest.status_code, 200)

                shortest_result = shortest.json()
                fastest_result = fastest.json()
                self.assertEqual(self.route_node_ids(shortest), expected_distance_path)
                self.assertEqual(self.route_node_ids(fastest), [start, detour, goal])
                self.assertGreater(fastest_result["distance_km"],
                                   shortest_result["distance_km"])

                corridor_time = (
                    2 * 0.1 / 40 * 3600
                    + 5 * 0.01 / 12 * 3600
                )
                detour_time = 2 * 0.15 / 40 * 3600
                self.assertAlmostEqual(fastest_result["estimated_time_sec"], detour_time)
                self.assertLess(fastest_result["estimated_time_sec"], corridor_time)

    def test_segment_durations_match_individual_speeds_and_sum_to_eta(self):
        start, _, goal, _ = self.case_routes["TC01"]
        response = self.post_route(
            start, goal, "traffic_jam_tc01", objective="distance",
        )
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertGreater(len(set(result["segment_speeds_kmh"])), 1)

        for distance, speed, duration in zip(
            result["segment_distances_km"],
            result["segment_speeds_kmh"],
            result["segment_durations_sec"],
        ):
            with self.subTest(distance=distance, speed=speed):
                self.assertAlmostEqual(duration, distance / speed * 3600)
        self.assertAlmostEqual(
            result["estimated_time_sec"],
            sum(result["segment_durations_sec"]),
        )

    def test_traffic_overlay_respects_one_way_event_edge(self):
        _, event_nodes, _, _ = self.case_routes["TC01"]
        source, target = event_nodes[:2]
        forward = self.client.post("/api/route", json={
            "start": self.coords[source],
            "goal": self.coords[target],
            "traffic_scenario_id": "traffic_jam_tc01",
            "objective": "time",
        })
        reverse = self.client.post("/api/route", json={
            "start": self.coords[target],
            "goal": self.coords[source],
            "traffic_scenario_id": "traffic_jam_tc01",
            "objective": "time",
        })

        self.assertEqual(forward.status_code, 200)
        self.assertEqual(forward.json()["segment_edges"], [[source, target]])
        self.assertEqual(forward.json()["segment_speeds_kmh"], [12])
        self.assertEqual(reverse.status_code, 404)

        node_index = {node_id: index for index, node_id in enumerate(self.network.ids)}
        self.assertIsNotNone(self.network._edge_offset(
            self.network.graph, node_index[source], node_index[target],
        ))
        self.assertIsNone(self.network._edge_offset(
            self.network.graph, node_index[target], node_index[source],
        ))

    def test_concurrent_scenarios_do_not_mutate_shared_graph(self):
        requests = [
            (
                "start_TC01", "goal_TC01", "traffic_jam_tc01", "distance",
            ),
            (
                "start_TC02", "goal_TC02", "road_closure_tc02", "time",
            ),
        ]
        original_data = self.network.graph.data.copy()
        original_indices = self.network.graph.indices.copy()
        original_indptr = self.network.graph.indptr.copy()

        def calculate(request):
            start, goal, scenario_id, objective = request
            return self.network.route(
                SimpleNamespace(**self.coords[start]),
                SimpleNamespace(**self.coords[goal]),
                "astar",
                40,
                scenario_id,
                objective,
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            jam_future = executor.submit(calculate, requests[0])
            closure_future = executor.submit(calculate, requests[1])
            jam_result = jam_future.result()
            closure_result = closure_future.result()

        self.assertEqual(jam_result["traffic_scenario_id"], "traffic_jam_tc01")
        self.assertEqual(jam_result["segment_speeds_kmh"], [40, *([12] * 5), 40])
        self.assertEqual(closure_result["traffic_scenario_id"], "road_closure_tc02")
        self.assertEqual(closure_result["traffic_event_type"], "road_closure")
        self.assertEqual(self.network.graph.data.tolist(), original_data.tolist())
        self.assertEqual(self.network.graph.indices.tolist(), original_indices.tolist())
        self.assertEqual(self.network.graph.indptr.tolist(), original_indptr.tolist())

    def test_distance_and_time_objectives_are_independent_and_legacy_defaults_to_time(self):
        start, event_nodes, goal, detour = self.case_routes["TC01"]
        scenario_id = "traffic_jam_tc01"
        distance = self.post_route(start, goal, scenario_id, objective="distance")
        fastest = self.post_route(start, goal, scenario_id, objective="time")
        legacy = self.post_route(start, goal, scenario_id)

        self.assertEqual(distance.status_code, 200)
        self.assertEqual(fastest.status_code, 200)
        self.assertEqual(legacy.status_code, 200)
        distance_result, fastest_result, legacy_result = (
            response.json() for response in (distance, fastest, legacy)
        )
        self.assertEqual(distance_result["objective"], "distance")
        self.assertEqual(fastest_result["objective"], "time")
        self.assertEqual(self.route_node_ids(distance), [start, *event_nodes, goal])
        self.assertEqual(self.route_node_ids(fastest), [start, detour, goal])
        self.assertEqual(legacy_result["objective"], "time")
        self.assertEqual(legacy_result["coordinates"], fastest_result["coordinates"])
        self.assertGreater(distance_result["estimated_time_sec"],
                           fastest_result["estimated_time_sec"])

    def test_consecutive_scenarios_do_not_mutate_shared_graph(self):
        start, _, goal, _ = self.case_routes["TC01"]
        network = self.network
        original_costs = network.graph.data.copy()

        first = self.post_route(start, goal, "traffic_jam_tc01", objective="distance")
        closed = self.post_route(start, goal, "road_closure_tc01", objective="time")
        repeated = self.post_route(start, goal, "traffic_jam_tc01", objective="distance")

        self.assertEqual([first.status_code, closed.status_code, repeated.status_code], [200] * 3)
        self.assertEqual(first.json()["segment_edges"], repeated.json()["segment_edges"])
        self.assertEqual(first.json()["segment_speeds_kmh"], repeated.json()["segment_speeds_kmh"])
        self.assertEqual(network.graph.data.tolist(), original_costs.tolist())

    def test_seeded_closures_block_two_roads_and_keep_other_speeds(self):
        for case_id, (start, _, goal, detour) in self.case_routes.items():
            scenario_id = f"road_closure_{case_id.lower()}"
            with self.subTest(case=case_id):
                response = self.post_route(start, goal, scenario_id)
                repeated = self.post_route(start, goal, scenario_id)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(repeated.status_code, 200)
                result = response.json()
                self.assertEqual(result["traffic_event_type"], "road_closure")
                self.assertIsNone(result["traffic_event_speed_kmh"])
                self.assertEqual(result["traffic_event_count"], 2)
                self.assertEqual(result["traffic_event_edges"], repeated.json()["traffic_event_edges"])
                self.assertEqual(result["traffic_event_seed"], repeated.json()["traffic_event_seed"])
                self.assertEqual(self.route_node_ids(response), [start, detour, goal])
                self.assertEqual(set(result["segment_speeds_kmh"]), {40})
                self.assertEqual(set(result["segment_speed_sources"]), {"no_live_data_assumed"})
                self.assertIn("fixed seed", result["traffic_note"])
                alternate_speed = self.post_route(start, goal, scenario_id, speed=25)
                self.assertEqual(alternate_speed.status_code, 200)
                self.assertEqual(alternate_speed.json()["speed_kmh"], 40)
                self.assertEqual(set(alternate_speed.json()["segment_speeds_kmh"]), {40})

    def test_unknown_traffic_event_id_is_rejected(self):
        start, _, goal, _ = next(iter(self.case_routes.values()))
        response = self.post_route(start, goal, "unknown_event")
        self.assertEqual(response.status_code, 422)

    def test_closure_uses_available_candidates_when_some_are_missing(self):
        scenario = TRAFFIC_SCENARIOS["road_closure_tc02"]
        available_candidates = scenario["candidate_edges"][1:]
        nodes = {}
        roads = []
        for index, (source, target) in enumerate(available_candidates):
            nodes[source] = {"id": source, "lat": 21 + index * 0.001, "lng": 105}
            nodes[target] = {"id": target, "lat": 21 + index * 0.001, "lng": 105.001}
            roads.append({
                "from": source,
                "to": target,
                "distance_km": 0.1,
                "bidirectional": False,
            })
        graph_path = Path(self.directory.name) / "partial-map.json"
        graph_path.write_text(json.dumps({
            "nodes": list(nodes.values()),
            "roads": roads,
        }))

        network = RoadNetwork(graph_path)
        resolved = network._resolved_traffic_scenarios["road_closure_tc02"]
        self.assertTrue(resolved["available"])
        self.assertEqual(len(resolved["closed_edges"]), 2)

    def test_unknown_objective_is_rejected(self):
        start, _, goal, _ = next(iter(self.case_routes.values()))
        response = self.client.post("/api/route", json={
            "start": self.coords[start],
            "goal": self.coords[goal],
            "objective": "distance_and_time",
        })
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()