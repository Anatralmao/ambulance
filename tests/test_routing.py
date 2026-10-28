import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from fastapi import HTTPException
from src.api.routes import RouteRequest, route as api_route
from src.routing import RoadNetwork


class RoutingTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "map.json"
        self.data = {
            "nodes": [
                {"id": "a", "lat": 21, "lng": 105},
                {"id": "b", "lat": 21, "lng": 105.001},
                {"id": "c", "lat": 21, "lng": 105.002},
                {"id": "unused", "lat": 21, "lng": 105.0001},
            ],
            "roads": [
                {"from": "a", "to": "b", "distance_km": 0.2, "bidirectional": False},
                {"from": "a", "to": "b", "distance_km": 0.1, "bidirectional": False},
                {"from": "b", "to": "c", "distance_km": 0.1, "bidirectional": True},
            ],
        }
        self.path.write_text(json.dumps(self.data))
        self.network = RoadNetwork(self.path)

    def point(self, index):
        node = self.data["nodes"][index]
        return SimpleNamespace(lat=node["lat"], lng=node["lng"])

    def test_parallel_edges_and_algorithms_agree(self):
        for algorithm in ("astar", "dijkstra"):
            with self.subTest(algorithm=algorithm):
                result = self.network.route(self.point(0), self.point(2), algorithm)
                self.assertAlmostEqual(result["distance_km"], 0.2)
                self.assertEqual(len(result["coordinates"]), 3)

    def test_direction_and_unreachable_route(self):
        for algorithm in ("astar", "dijkstra"):
            self.assertIsNone(self.network.route(self.point(2), self.point(0), algorithm))
            self.assertAlmostEqual(self.network.route(self.point(2), self.point(1), algorithm)["distance_km"], 0.1)

    def test_same_node(self):
        for algorithm in ("astar", "dijkstra"):
            result = self.network.route(self.point(0), self.point(0), algorithm)
            self.assertEqual(result["distance_km"], 0)
            self.assertEqual(len(result["coordinates"]), 1)
            self.assertEqual(result["estimated_time_sec"], 0)
            self.assertEqual(result["segment_distances_km"], [])
            self.assertEqual(result["segment_durations_sec"], [])

    def test_snap_excludes_nodes_without_roads(self):
        index, result = self.network.nearest(21, 105.0001)
        self.assertEqual(result["id"], "a")
        self.assertEqual(index, 0)
        self.assertGreater(result["distance_meters"], 0)

    def test_cache_round_trip_and_invalidation(self):
        cache = Path(self.directory.name) / "cache"
        RoadNetwork(self.path, cache)
        restored = RoadNetwork(self.path, cache)
        self.assertEqual(restored.route(self.point(0), self.point(2), "astar"),
                         self.network.route(self.point(0), self.point(2), "astar"))
        self.data["roads"][1]["distance_km"] = 0.05
        self.path.write_text(json.dumps(self.data))
        refreshed = RoadNetwork(self.path, cache)
        self.assertAlmostEqual(refreshed.route(self.point(0), self.point(2), "astar")["distance_km"], 0.15)

    def test_zero_cost_edge(self):
        self.data["roads"][1]["distance_km"] = 0
        self.path.write_text(json.dumps(self.data))
        network = RoadNetwork(self.path)
        for algorithm in ("astar", "dijkstra"):
            result = network.route(self.point(0), self.point(2), algorithm)
            self.assertAlmostEqual(result["distance_km"], 0.1)
            self.assertEqual(result["segment_durations_sec"], [0, 9])
            self.assertEqual(result["estimated_time_sec"], 9)

    def test_eta_uses_graph_edges_at_fixed_speed(self):
        # Unequal edge lengths, deliberately different from coordinate distances.
        self.data["roads"][2]["distance_km"] = 0.3
        self.path.write_text(json.dumps(self.data))
        network = RoadNetwork(self.path)
        for algorithm in ("astar", "dijkstra"):
            for speed in (40, 60):
                with self.subTest(algorithm=algorithm, speed=speed):
                    result = network.route(self.point(0), self.point(2), algorithm, speed)
                    self.assertEqual(result["speed_kmh"], speed)
                    self.assertEqual(result["algorithm"], algorithm)
                    self.assertEqual(result["coordinates"], [[21, 105], [21, 105.001], [21, 105.002]])
                    self.assertEqual(result["segment_distances_km"], [0.1, 0.3])
                    self.assertAlmostEqual(result["distance_km"], 0.4)
                    self.assertEqual(len(result["segment_durations_sec"]), len(result["coordinates"]) - 1)
                    for actual, length in zip(result["segment_durations_sec"], [0.1, 0.3]):
                        self.assertAlmostEqual(actual, length / speed * 3600)
                    self.assertEqual(result["estimated_time_sec"], sum(result["segment_durations_sec"]))
                    self.assertAlmostEqual(result["estimated_time_sec"], 0.4 / speed * 3600)

    def test_speed_changes_time_without_changing_route(self):
        for algorithm in ("astar", "dijkstra"):
            normal = self.network.route(self.point(0), self.point(2), algorithm)
            faster = self.network.route(self.point(0), self.point(2), algorithm, speed_kmh=80)
            self.assertEqual(normal["speed_kmh"], 40)
            self.assertEqual(normal["coordinates"], faster["coordinates"])
            self.assertEqual(normal["distance_km"], faster["distance_km"])
            self.assertAlmostEqual(normal["estimated_time_sec"], 2 * faster["estimated_time_sec"])

    def test_invalid_speed(self):
        for algorithm in ("astar", "dijkstra"):
            for speed in (0, -1, float("nan"), float("inf"), -float("inf")):
                for goal in (0, 2):
                    with self.subTest(algorithm=algorithm, speed=speed, goal=goal):
                        with self.assertRaises(ValueError):
                            self.network.route(self.point(0), self.point(goal), algorithm, speed)

    def test_disconnected_components_have_no_route(self):
        self.data["nodes"].append({"id": "other", "lat": 22, "lng": 106})
        self.data["roads"].append({"from": "unused", "to": "other", "distance_km": 1})
        self.path.write_text(json.dumps(self.data))
        network = RoadNetwork(self.path)
        for algorithm in ("astar", "dijkstra"):
            self.assertIsNone(network.route(self.point(0), self.point(4), algorithm, speed_kmh=60))

    def test_eta_overflow_is_rejected(self):
        for algorithm in ("astar", "dijkstra"):
            with self.assertRaises(ValueError):
                self.network.route(self.point(0), self.point(2), algorithm, speed_kmh=1e-320)

    def test_existing_api_handler_returns_eta(self):
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
            network=self.network, network_error=None)))
        for algorithm in ("astar", "dijkstra"):
            body = RouteRequest(start=vars(self.point(0)), goal=vars(self.point(2)), algorithm=algorithm)
            result = api_route(body, request)
            self.assertEqual(result["estimated_time_sec"], 18)
            self.assertEqual(result["segment_durations_sec"], [9, 9])

    def test_existing_api_handler_reports_no_route(self):
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
            network=self.network, network_error=None)))
        for algorithm in ("astar", "dijkstra"):
            body = RouteRequest(start=vars(self.point(2)), goal=vars(self.point(0)), algorithm=algorithm)
            with self.assertRaises(HTTPException) as error:
                api_route(body, request)
            self.assertEqual(error.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
