"""Load the road network once; send only snapped points and routes to clients."""
from array import array
import heapq
import math
import logging
import os
from pathlib import Path
import random
import tempfile
from zipfile import BadZipFile

import ijson
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

from src.scenarios import TRAFFIC_SCENARIOS


DEFAULT_SPEED_KMH = 40.0


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
                    self._resolved_traffic_scenarios = self._resolve_traffic_scenarios()
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
        self._resolved_traffic_scenarios = self._resolve_traffic_scenarios(lookup)
        del lookup
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

    def _edge_offset(self, graph, source, target):
        for offset in range(graph.indptr[source], graph.indptr[source + 1]):
            if int(graph.indices[offset]) == target:
                return offset
        return None

    def _resolve_traffic_scenarios(self, lookup=None):
        resolved = {}

        def node_index(node_id):
            if lookup is not None:
                return lookup.get(node_id)
            matches = np.flatnonzero(self.ids == node_id)
            return int(matches[0]) if len(matches) == 1 else None

        for scenario_id, scenario in TRAFFIC_SCENARIOS.items():
            edge_key = "candidate_edges" if scenario.get("kind") == "road_closure" else "event_edges"
            indexes = tuple(tuple(node_index(node_id) for node_id in edge)
                            for edge in scenario[edge_key])
            available = all(
                source is not None and target is not None
                and self._edge_offset(self.graph, source, target) is not None
                for source, target in indexes
            )
            if available and scenario.get("kind") == "road_closure":
                selected = random.Random(scenario["random_seed"]).sample(
                    indexes, scenario["closed_road_count"]
                )
                blocked_edges = set(selected)
                blocked_edges.update((target, source) for source, target in selected
                                     if self._edge_offset(self.graph, target, source) is not None)
                indexes = tuple(sorted(blocked_edges))
            resolved[scenario_id] = {
                "available": available,
                "event_edges": indexes if available and scenario.get("kind") != "road_closure" else (),
                "closed_edges": indexes if available and scenario.get("kind") == "road_closure" else (),
            }
        return resolved

    def route(self, start, goal, algorithm, speed_kmh=DEFAULT_SPEED_KMH,
              traffic_scenario_id=None, objective=None):
        """Find a route by distance or travel time, with legacy defaults.

        Segment i connects coordinates[i] to coordinates[i + 1]. Distances
        come from graph edges, not straight lines between their endpoints.
        No directed route returns None; invalid inputs raise ValueError.
        """
        if not math.isfinite(speed_kmh) or speed_kmh <= 0:
            raise ValueError("Speed must be finite and greater than zero (km/h)")
        if objective not in (None, "distance", "time"):
            raise ValueError("Objective must be 'distance' or 'time'")
        scenario = None
        resolved_scenario = None
        if traffic_scenario_id is not None:
            scenario = TRAFFIC_SCENARIOS.get(traffic_scenario_id)
            resolved_scenario = self._resolved_traffic_scenarios.get(traffic_scenario_id)
            if scenario is None:
                raise ValueError("Unknown traffic scenario")
            if not resolved_scenario or not resolved_scenario["available"]:
                raise ValueError("Traffic scenario edges are not present in the road network")
        resolved_objective = objective or ("time" if scenario is not None else "distance")
        route_speed_kmh = (40.0 if scenario and scenario.get("kind") == "road_closure"
                           else speed_kmh)
        scenario_speed = scenario.get("speed_kmh") if scenario is not None else None
        start_index, start_point = self.nearest(start.lat, start.lng)
        goal_index, goal_point = self.nearest(goal.lat, goal.lng)
        search_graph = self.graph
        heuristic_scale = self.heuristic_scale
        if scenario is not None or resolved_objective == "time":
            search_graph = self.graph.copy()
        if resolved_objective == "time":
            search_graph.data *= 3600 / route_speed_kmh
            maximum_edge_speed = max(route_speed_kmh, scenario_speed or route_speed_kmh)
            heuristic_scale *= 3600 / maximum_edge_speed
            if scenario is not None and scenario_speed is not None:
                for source, target in resolved_scenario["event_edges"]:
                    offset = self._edge_offset(search_graph, source, target)
                    search_graph.data[offset] = (
                        float(self.graph[source, target]) / scenario_speed * 3600
                    )
        if scenario is not None and scenario.get("kind") == "road_closure":
            sources = np.repeat(np.arange(len(self.ids)), np.diff(search_graph.indptr))
            keep = np.ones(len(search_graph.data), dtype=bool)
            for source, target in resolved_scenario["closed_edges"]:
                keep &= ~((sources == source) & (search_graph.indices == target))
            search_graph = csr_matrix(
                (search_graph.data[keep], (sources[keep], search_graph.indices[keep])),
                shape=search_graph.shape,
            )
        if algorithm == "dijkstra":
            distances, parents = dijkstra(search_graph, directed=True,
                                          indices=start_index, return_predecessors=True)
            route_cost = float(distances[goal_index])
        else:
            route_cost, parents = self._astar(start_index, goal_index, search_graph,
                                              heuristic_scale)
        if not math.isfinite(route_cost):
            return None
        path, current = [goal_index], goal_index
        while current != start_index:
            current = int(parents[current])
            path.append(current)
        path.reverse()
        segment_distances = [float(self.graph[source, target])
                             for source, target in zip(path, path[1:])]
        segment_edges = [(str(self.ids[source]), str(self.ids[target]))
                         for source, target in zip(path, path[1:])]
        event_edges = set(resolved_scenario["event_edges"]) if scenario is not None else set()
        segment_speeds = [
            scenario["speed_kmh"] if (source, target) in event_edges else route_speed_kmh
            for source, target in zip(path, path[1:])
        ]
        segment_speed_sources = [
            "simulated" if (source, target) in event_edges else "no_live_data_assumed"
            for source, target in zip(path, path[1:])
        ]
        segment_durations = [length / speed * 3600
                             for length, speed in zip(segment_distances, segment_speeds)]
        distance = sum(segment_distances)
        estimated_time = sum(segment_durations)
        if not math.isfinite(estimated_time):
            raise ValueError("Estimated travel time must be finite; increase speed_kmh")
        if scenario is None:
            traffic_note = f"No live segment speeds; {route_speed_kmh:g} km/h is assumed on every road."
            traffic_event_edges = []
            traffic_event_count = 0
        else:
            affected_edges = (resolved_scenario["closed_edges"]
                              if scenario.get("kind") == "road_closure"
                              else resolved_scenario["event_edges"])
            traffic_event_edges = [
                (str(self.ids[source]), str(self.ids[target]))
                for source, target in affected_edges
            ]
            if scenario.get("kind") == "road_closure":
                traffic_event_count = scenario["closed_road_count"]
                traffic_note = (
                    f"Randomly closed {traffic_event_count} roads for {scenario['route_case_id']} "
                    f"using fixed seed {scenario['random_seed']}; the route may detour. "
                    f"Remaining roads use the fixed {route_speed_kmh:g} km/h."
                )
            else:
                traffic_event_count = len(traffic_event_edges)
                traffic_note = (
                    f"Simulated {scenario_speed:g} km/h on "
                    f"{len(traffic_event_edges)} directed segments for {scenario['route_case_id']}; "
                    "the selected route may detour around them. "
                    f"Other roads have no live speed data; {route_speed_kmh:g} km/h is assumed."
                )
        return {"coordinates": self.coordinates[path].tolist(),
                "segment_edges": segment_edges,
                "distance_km": distance, "start": start_point,
                "goal": goal_point, "algorithm": algorithm,
                "objective": resolved_objective,
                "speed_kmh": float(route_speed_kmh),
                "segment_distances_km": segment_distances,
                "segment_speeds_kmh": segment_speeds,
                "segment_speed_sources": segment_speed_sources,
                "segment_durations_sec": segment_durations,
                "estimated_time_sec": estimated_time,
                "traffic_scenario_id": traffic_scenario_id,
                "traffic_event_type": scenario["kind"] if scenario else None,
                "traffic_event_speed_kmh": scenario.get("speed_kmh") if scenario else None,
                "traffic_event_count": traffic_event_count,
                "traffic_event_seed": scenario.get("random_seed") if scenario else None,
                "traffic_event_edges": traffic_event_edges,
                "traffic_note": traffic_note}

    def _astar(self, start, goal, graph=None, heuristic_scale=None):
        graph = self.graph if graph is None else graph
        heuristic_scale = self.heuristic_scale if heuristic_scale is None else heuristic_scale
        target = self.xyz[goal]

        def heuristic(node):
            return float(np.linalg.norm(self.xyz[node] - target)) * heuristic_scale

        best, parents = {start: 0.0}, {}
        frontier = [(heuristic(start), 0.0, start)]
        while frontier:
            _, cost, node = heapq.heappop(frontier)
            if cost != best[node]:
                continue
            if node == goal:
                return cost, parents
            for offset in range(graph.indptr[node], graph.indptr[node + 1]):
                neighbor = int(graph.indices[offset])
                candidate = cost + float(graph.data[offset])
                if candidate < best.get(neighbor, math.inf):
                    best[neighbor], parents[neighbor] = candidate, node
                    heapq.heappush(frontier, (candidate + heuristic(neighbor), candidate, neighbor))
        return math.inf, parents
