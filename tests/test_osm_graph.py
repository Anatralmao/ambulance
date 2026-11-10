import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.error import URLError

from src.osm_graph import build_graph, resolve_graph_path


class OsmGraphTests(unittest.TestCase):
    def test_build_graph_preserves_osm_directions_and_filters_nonroads(self):
        graph = build_graph({
            "elements": [
                {"type": "node", "id": 1, "lat": 21.0, "lon": 105.0},
                {"type": "node", "id": 2, "lat": 21.001, "lon": 105.001},
                {"type": "node", "id": 3, "lat": 21.002, "lon": 105.002},
                {"type": "node", "id": 4, "lat": 21.003, "lon": 105.003},
                {"type": "way", "id": 10, "nodes": [1, 2],
                 "tags": {"highway": "residential", "oneway": "-1"}},
                {"type": "way", "id": 11, "nodes": [2, 3],
                 "tags": {"highway": "primary", "oneway": "yes"}},
                {"type": "way", "id": 12, "nodes": [3, 4],
                 "tags": {"highway": "footway"}},
            ],
        })

        self.assertEqual(len(graph["nodes"]), 3)
        roads = {(road["from"], road["to"]): road for road in graph["roads"]}
        self.assertEqual(set(roads), {
            ("node_2", "node_1"),
            ("node_2", "node_3"),
        })
        self.assertTrue(all(not road["bidirectional"] for road in roads.values()))
        self.assertGreater(roads[("node_2", "node_1")]["distance_km"], 0)

    def test_resolve_graph_fetches_and_reuses_fresh_cache(self):
        graph = {"nodes": [{"id": "node_1", "lat": 21, "lng": 105}],
                 "roads": [{"from": "node_1", "to": "node_2", "distance_km": 0.1}]}
        with TemporaryDirectory() as directory:
            root = Path(directory)
            fallback = root / "bundled.json"
            fallback.write_text("{}")
            with patch("src.osm_graph.fetch_graph", return_value=graph) as fetch:
                cached_path = resolve_graph_path(root / "cache", fallback)
                self.assertEqual(json.loads(cached_path.read_text()), graph)
                self.assertEqual(resolve_graph_path(root / "cache", fallback), cached_path)
                fetch.assert_called_once()

    def test_resolve_graph_uses_bundled_graph_when_overpass_is_unavailable(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            fallback = root / "bundled.json"
            fallback.write_text("{}")
            with patch("src.osm_graph.fetch_graph", side_effect=URLError("offline")):
                self.assertEqual(resolve_graph_path(root / "cache", fallback), fallback)


if __name__ == "__main__":
    unittest.main()
