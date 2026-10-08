import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

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
            self.assertAlmostEqual(network.route(self.point(0), self.point(2), algorithm)["distance_km"], 0.1)


if __name__ == "__main__":
    unittest.main()
