"""Opt-in integration test on the supplied Hanoi graph (uses its binary cache)."""
import os
from pathlib import Path
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.routes import router
from src.routing import RoadNetwork
from src.scenarios import TEST_CASES


@unittest.skipUnless(os.environ.get("RUN_DATASET_TESTS") == "1", "Set RUN_DATASET_TESTS=1 for the Hanoi graph")
class DatasetTests(unittest.TestCase):
    def test_three_scenarios_through_api(self):
        root = Path(__file__).resolve().parents[1]
        app = FastAPI()
        app.include_router(router)
        app.state.network = RoadNetwork(root / "static/data/hanoi_map.json", root / ".cache/routing")
        app.state.network_error = False
        with TestClient(app) as client:
            for case in TEST_CASES["cases"]:
                with self.subTest(case=case["case_id"]):
                    start = case["emergency_target"]["coords"]
                    goal = case["hospital"]["coords"]
                    body = {"start": dict(zip(("lat", "lng"), start)),
                            "goal": dict(zip(("lat", "lng"), goal)), "speed_kmh": 40}
                    results = []
                    for algorithm in ("astar", "dijkstra"):
                        response = client.post("/api/route", json={**body, "algorithm": algorithm})
                        self.assertEqual(response.status_code, 200)
                        result = response.json()
                        self.assertEqual(len(result["segment_durations_sec"]), len(result["coordinates"]) - 1)
                        self.assertAlmostEqual(sum(result["segment_distances_km"]), result["distance_km"])
                        self.assertAlmostEqual(sum(result["segment_durations_sec"]), result["estimated_time_sec"])
                        self.assertAlmostEqual(result["estimated_time_sec"], result["distance_km"] / 40 * 3600)
                        results.append(result)
                    self.assertAlmostEqual(results[0]["distance_km"], results[1]["distance_km"])
                    self.assertAlmostEqual(results[0]["estimated_time_sec"], results[1]["estimated_time_sec"])

    def test_peak_traffic_events_on_all_hospital_routes(self):
        root = Path(__file__).resolve().parents[1]
        app = FastAPI()
        app.include_router(router)
        app.state.network = RoadNetwork(root / "static/data/hanoi_map.json", root / ".cache/routing")
        app.state.network_error = False
        with TestClient(app) as client:
            for case in TEST_CASES["cases"]:
                scenario_id = f"traffic_jam_{case['case_id'].lower()}"
                start = case["emergency_target"]["coords"]
                goal = case["hospital"]["coords"]
                body = {"start": dict(zip(("lat", "lng"), start)),
                        "goal": dict(zip(("lat", "lng"), goal)), "speed_kmh": 40}
                results = []
                for algorithm in ("astar", "dijkstra"):
                    with self.subTest(case=case["case_id"], algorithm=algorithm):
                        baseline_response = client.post("/api/route", json={
                            **body, "algorithm": algorithm,
                        })
                        self.assertEqual(baseline_response.status_code, 200)
                        response = client.post("/api/route", json={
                            **body, "algorithm": algorithm,
                            "traffic_scenario_id": scenario_id,
                        })
                        self.assertEqual(response.status_code, 200)
                        result = response.json()
                        self.assertEqual(result["traffic_scenario_id"], scenario_id)
                        self.assertEqual(result["traffic_event_speed_kmh"], 12.0)
                        self.assertEqual(len(result["traffic_event_edges"]), 5)
                        self.assertEqual(len(result["segment_speeds_kmh"]),
                                         len(result["coordinates"]) - 1)
                        self.assertGreater(result["estimated_time_sec"],
                                           baseline_response.json()["estimated_time_sec"])
                        self.assertIn("no live speed data", result["traffic_note"])
                        self.assertIn("may detour", result["traffic_note"])
                        results.append(result)
                self.assertEqual(results[0]["coordinates"], results[1]["coordinates"])
                self.assertAlmostEqual(results[0]["estimated_time_sec"],
                                       results[1]["estimated_time_sec"])

    def test_seeded_road_closures_on_all_hospital_routes(self):
        root = Path(__file__).resolve().parents[1]
        app = FastAPI()
        app.include_router(router)
        app.state.network = RoadNetwork(root / "static/data/hanoi_map.json", root / ".cache/routing")
        app.state.network_error = False
        with TestClient(app) as client:
            for case in TEST_CASES["cases"]:
                scenario_id = f"road_closure_{case['case_id'].lower()}"
                start = case["emergency_target"]["coords"]
                goal = case["hospital"]["coords"]
                body = {"start": dict(zip(("lat", "lng"), start)),
                        "goal": dict(zip(("lat", "lng"), goal)), "speed_kmh": 40}
                results = []
                for algorithm in ("astar", "dijkstra"):
                    with self.subTest(case=case["case_id"], algorithm=algorithm):
                        baseline = client.post("/api/route", json={
                            **body, "algorithm": algorithm,
                        })
                        response = client.post("/api/route", json={
                            **body, "algorithm": algorithm,
                            "traffic_scenario_id": scenario_id,
                        })
                        self.assertEqual(baseline.status_code, 200)
                        self.assertEqual(response.status_code, 200)
                        result = response.json()
                        self.assertEqual(result["traffic_event_type"], "road_closure")
                        self.assertEqual(result["traffic_event_count"], 2)
                        self.assertGreaterEqual(len(result["traffic_event_edges"]), 2)
                        self.assertEqual(set(result["segment_speeds_kmh"]), {40})
                        self.assertGreater(result["estimated_time_sec"],
                                           baseline.json()["estimated_time_sec"])
                        self.assertGreater(
                            result["distance_km"],
                            baseline.json()["distance_km"] + 0.15,
                        )
                        self.assertNotEqual(
                            result["coordinates"], baseline.json()["coordinates"],
                        )
                        self.assertIn("fixed seed", result["traffic_note"])
                        results.append(result)
                self.assertEqual(results[0]["traffic_event_edges"],
                                 results[1]["traffic_event_edges"])
                self.assertAlmostEqual(results[0]["estimated_time_sec"],
                                       results[1]["estimated_time_sec"])
