import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient
from main import app
from src.routing import RoadNetwork


class ApiTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "map.json"
        path.write_text(json.dumps({
            "nodes": [{"id": "a", "lat": 21, "lng": 105},
                      {"id": "b", "lat": 21, "lng": 105.001}],
            "roads": [{"from": "a", "to": "b", "distance_km": 0.2, "bidirectional": False}],
        }))
        app.state.network = RoadNetwork(path)
        app.state.network_error = False
        # No lifespan: use the tiny graph, never load the production dataset here.
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.body = {"start": {"lat": 21, "lng": 105}, "goal": {"lat": 21, "lng": 105.001}}

    def test_test_cases_endpoint_returns_data(self):
        response = self.client.get("/api/test-cases")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["cases"]), 3)
        self.assertEqual(len({case["case_id"] for case in data["cases"]}), 3)
        self.assertFalse(data["traffic_obstacles_applied"])
        for case in data["cases"]:
            self.assertIsInstance(case["hospital"]["id"], str)
            self.assertIsInstance(case["emergency_target"]["id"], str)
            self.assertEqual(len(case["hospital"]["coords"]), 2)
            self.assertFalse(case["reference_metrics"]["validated"])

    def test_route_speed_and_default(self):
        for algorithm in ("astar", "dijkstra"):
            for speed, expected in ((None, 18), (80, 9)):
                body = {**self.body, "algorithm": algorithm}
                if speed is not None:
                    body["speed_kmh"] = speed
                response = self.client.post("/api/route", json=body)
                self.assertEqual(response.status_code, 200)
                result = response.json()
                self.assertEqual(result["distance_km"], 0.2)
                self.assertEqual(result["estimated_time_sec"], expected)
                self.assertEqual(result["segment_durations_sec"], [expected])
                self.assertEqual(result["speed_kmh"], speed or 40)
                self.assertEqual(result["algorithm"], algorithm)
                self.assertEqual(result["start"]["id"], "a")

    def test_invalid_inputs_are_422(self):
        bodies = [{**self.body, "speed_kmh": value} for value in (0, -1, "NaN", "Infinity", None, "fast", 1e-320)]
        bodies += [{**self.body, "algorithm": "unknown"},
                   {**self.body, "start": {"lat": 91, "lng": 105}},
                   {**self.body, "goal": {"lat": 21, "lng": 181}},
                   {"start": self.body["start"]}]
        for body in bodies:
            with self.subTest(body=body):
                response = self.client.post("/api/route", json=body)
                self.assertEqual(response.status_code, 422)
                self.assertIn("detail", response.json())
        # Some clients send nonstandard JSON constants; still return a JSON error.
        for value in (float("nan"), float("inf")):
            response = self.client.post("/api/route", content=json.dumps({**self.body, "speed_kmh": value}), headers={"Content-Type": "application/json"})
            self.assertEqual(response.status_code, 422)

    def test_same_node_and_no_route(self):
        response = self.client.post("/api/route", json={**self.body, "goal": self.body["start"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["estimated_time_sec"], 0)
        self.assertEqual(response.json()["segment_durations_sec"], [])
        response = self.client.post("/api/route", json={"start": self.body["goal"], "goal": self.body["start"]})
        self.assertEqual(response.status_code, 404)
        self.assertNotIn("coordinates", response.json())

    def test_loading_error_and_nearest(self):
        self.assertEqual(self.client.get("/api/network/status").json()["status"], "ready")
        response = self.client.get("/api/nearest?lat=21&lng=105")
        self.assertEqual(response.json()["id"], "a")
        self.assertEqual(self.client.get("/api/nearest?lat=91&lng=105").status_code, 422)
        app.state.network = None
        response = self.client.post("/api/route", json=self.body)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["retry-after"], "2")
        self.assertEqual(self.client.get("/api/network/status").json()["status"], "loading")
        self.assertEqual(self.client.get("/api/nearest?lat=21&lng=105").status_code, 503)
        app.state.network_error = True
        self.assertEqual(self.client.get("/api/network/status").json()["status"], "error")
        self.assertEqual(self.client.post("/api/route", json=self.body).status_code, 503)

    def test_page_and_assets(self):
        for path in ("/", "/static/JS/app.js", "/static/CSS/app.css", "/david/david_run.gif"):
            self.assertEqual(self.client.get(path).status_code, 200)
        self.assertEqual(self.client.get("/static/data/hanoi_map.json").status_code, 404)


if __name__ == "__main__":
    unittest.main()
