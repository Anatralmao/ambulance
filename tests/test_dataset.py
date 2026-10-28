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
