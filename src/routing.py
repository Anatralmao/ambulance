"""Load the road network once; send only snapped points and routes to clients."""
from array import array
import heapq
import math
import logging
import os
from pathlib import Path
import tempfile
from zipfile import BadZipFile

import ijson
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree


def sphere_points(coordinates):
    radians = np.radians(coordinates)
    lat, lon = radians[..., 0], radians[..., 1]
    return np.stack((np.cos(lat) * np.cos(lon),
                     np.cos(lat) * np.sin(lon), np.sin(lat)), axis=-1)


class RoadNetwork:
    def __init__(self, path, cache_dir=None):
        path = Path(path)
        cache = None
        if cache_dir is not None:
            stamp = path.stat()
            cache = Path(cache_dir) / f"network-v1-{stamp.st_size}-{stamp.st_mtime_ns}.npz"
            if cache.exists():
                try:
                    with np.load(cache, allow_pickle=False) as saved:
                        self.ids = saved["ids"]
                        self.coordinates = saved["coordinates"]
                        self.graph = csr_matrix((saved["costs"], saved["indices"], saved["indptr"]),
                                                shape=(len(self.ids), len(self.ids)))
                        self.active = saved["active"]
                        self.heuristic_scale = float(saved["heuristic_scale"])
                    self.xyz = sphere_points(self.coordinates)
                    self.tree = cKDTree(self.xyz[self.active])
                    return
                except (OSError, ValueError, KeyError, EOFError, BadZipFile):
                    logging.warning("Rebuilding unreadable routing cache", exc_info=True)
        # Stream the JSON instead of retaining millions of Python dictionaries.
        ids, coordinates = [], array("d")
        with open(path, "rb") as source:
            for node in ijson.items(source, "nodes.item", use_float=True):
                ids.append(node["id"])
                coordinates.extend((node["lat"], node["lng"]))
        if not ids:
            raise ValueError("The road network has no nodes")
        self.ids = ids
        self.coordinates = np.frombuffer(coordinates, dtype=np.float64).reshape(-1, 2)
        lookup = {node_id: index for index, node_id in enumerate(ids)}
        starts, ends, costs = array("q"), array("q"), array("d")
        with open(path, "rb") as source:
            for road in ijson.items(source, "roads.item", use_float=True):
                start, end = lookup[road["from"]], lookup[road["to"]]
                cost = float(road["distance_km"])
                if not math.isfinite(cost) or cost < 0:
                    raise ValueError("Road distances must be finite and nonnegative")
                starts.append(start)
                ends.append(end)
                costs.append(cost)
                if road.get("bidirectional", True):
                    starts.append(end)
                    ends.append(start)
                    costs.append(cost)
        del lookup
        starts = np.frombuffer(starts, dtype=np.int64)
        ends = np.frombuffer(ends, dtype=np.int64)
        costs = np.frombuffer(costs, dtype=np.float64)
        if not len(costs):
            raise ValueError("The road network has no roads")
        # Parallel roads must use the cheapest edge, not CSR's default sum.
        order = np.lexsort((ends, starts))
        starts, ends, costs = starts[order], ends[order], costs[order]
        unique = np.r_[True, (starts[1:] != starts[:-1]) | (ends[1:] != ends[:-1])]
        offsets = np.flatnonzero(unique)
        costs = np.minimum.reduceat(costs, offsets)
        starts, ends = starts[unique], ends[unique]
        self.graph = csr_matrix((costs, (starts, ends)), shape=(len(ids), len(ids)))
        self.xyz = sphere_points(self.coordinates)
        # A spherical chord metric avoids latitude/longitude distortion.
        self.active = np.unique(np.concatenate((starts, ends)))
        self.tree = cKDTree(self.xyz[self.active])
        # Scale the A* lower bound to the actual dataset, including rounded costs.
        lengths = np.linalg.norm(self.xyz[starts] - self.xyz[ends], axis=1)
        nonzero = lengths > 0
        self.heuristic_scale = (float(np.min(costs[nonzero] / lengths[nonzero]))
                                * (1 - 1e-12) if nonzero.any() else 0.0)
        if cache is not None:
            self._save_cache(cache)

    def _save_cache(self, cache):
        temporary = None
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=cache.parent, suffix=".npz", delete=False) as output:
                temporary = Path(output.name)
                np.savez(output, ids=np.asarray(self.ids), coordinates=self.coordinates,
                         costs=self.graph.data, indices=self.graph.indices, indptr=self.graph.indptr,
                         active=self.active, heuristic_scale=self.heuristic_scale)
            os.replace(temporary, cache)
        except OSError:
            # Read-only deployments can still route without a persistent cache.
            logging.warning("Could not save routing cache", exc_info=True)
        finally:
            if temporary is not None and temporary.exists():
                try:
                    temporary.unlink()
                except OSError:
                    logging.warning("Could not remove incomplete routing cache")

    def nearest(self, lat, lng):
        distance, index = self.tree.query(sphere_points(np.array([lat, lng])))
        node = int(self.active[index])
        return node, {
            "id": str(self.ids[node]), "lat": float(self.coordinates[node, 0]),
            "lng": float(self.coordinates[node, 1]),
            "distance_meters": float(2 * 6371000 * np.arcsin(min(1, distance / 2))),
        }

    def route(self, start, goal, algorithm):
        start_index, start_point = self.nearest(start.lat, start.lng)
        goal_index, goal_point = self.nearest(goal.lat, goal.lng)
        if algorithm == "dijkstra":
            distances, parents = dijkstra(self.graph, directed=True,
                                          indices=start_index, return_predecessors=True)
            distance = float(distances[goal_index])
        else:
            distance, parents = self._astar(start_index, goal_index)
        if not math.isfinite(distance):
            return None
        path, current = [goal_index], goal_index
        while current != start_index:
            current = int(parents[current])
            path.append(current)
        path.reverse()
        return {"coordinates": self.coordinates[path].tolist(),
                "distance_km": distance, "start": start_point,
                "goal": goal_point, "algorithm": algorithm}

    def _astar(self, start, goal):
        target = self.xyz[goal]

        def heuristic(node):
            return float(np.linalg.norm(self.xyz[node] - target)) * self.heuristic_scale

        best, parents = {start: 0.0}, {}
        frontier = [(heuristic(start), 0.0, start)]
        while frontier:
            _, cost, node = heapq.heappop(frontier)
            if cost != best[node]:
                continue
            if node == goal:
                return cost, parents
            for offset in range(self.graph.indptr[node], self.graph.indptr[node + 1]):
                neighbor = int(self.graph.indices[offset])
                candidate = cost + float(self.graph.data[offset])
                if candidate < best.get(neighbor, math.inf):
                    best[neighbor], parents[neighbor] = candidate, node
                    heapq.heappush(frontier, (candidate + heuristic(neighbor), candidate, neighbor))
        return math.inf, parents
