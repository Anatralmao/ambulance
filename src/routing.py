"""Load the road network once; send only snapped points and routes to clients."""
from array import array
import json
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
            cache = Path(cache_dir) / f"network-v3-{stamp.st_size}-{stamp.st_mtime_ns}.npz"
            if cache.exists():
                try:
                    with np.load(cache, allow_pickle=False) as saved:
                        self.ids = saved["ids"]
                        self.coordinates = saved["coordinates"]
                        self.graph = csr_matrix((saved["costs"], saved["indices"], saved["indptr"]),
                                                shape=(len(self.ids), len(self.ids)))
                        self.time_graph = csr_matrix((saved["time_costs"], saved["time_indices"], saved["time_indptr"]),
                                                     shape=(len(self.ids), len(self.ids)))
                        self.active = saved["active"]
                        self.heuristic_scale = float(saved["heuristic_scale"])
                        self.time_heuristic_scale = float(saved["time_heuristic_scale"])
                        records = json.loads(saved["edge_options_json"].tobytes().decode("utf-8"))
                        self.edge_options = {
                            (int(a), int(b)): options for a, b, options in records
                        }
                        self.edge_selection = {"distance": {}, "time": {}}
                        for key, options in self.edge_options.items():
                            self.edge_selection["distance"][key] = min(
                                options, key=lambda edge: edge["distance_km"])
                            self.edge_selection["time"][key] = min(
                                options, key=lambda edge: edge["distance_km"] / edge["speed_kmh"])
                    self.xyz = sphere_points(self.coordinates)
                    self.tree = cKDTree(self.xyz[self.active])
                    self._prepare_time_weights()
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
        # Initialize arrays to store information about each edge.
        starts, ends, costs = array("q"), array("q"), array("d")

        # Store the ID, metadata, and individual speed of each edge.
        edge_ids = []
        edge_metadata = []
        edge_speeds = array("d")
        edge_has_explicit_speed = []

        # Read each road segment from the JSON file.
        with open(path, "rb") as source:
            for road_index, road in enumerate(
                ijson.items(source, "roads.item", use_float=True)
            ):

                # Determine the index of the start and end nodes.
                start = lookup[road["from"]]
                end = lookup[road["to"]]

                # Get the distance of the road segment.
                cost = float(road["distance_km"])

                if not math.isfinite(cost) or cost < 0:
                    raise ValueError("Road distances must be finite and nonnegative")

                # Get the edge ID, or generate a temporary ID if it is missing.
                edge_id = str(road.get("id") or f"road_{road_index}")

                # Get the metadata of the edge.
                metadata = road.get("metadata") or {}

                # Get the speed of the edge.
                edge_speed = float(road.get("speed_kmh", DEFAULT_SPEED_KMH))

                if not math.isfinite(edge_speed) or edge_speed <= 0:
                    raise ValueError("Road speed must be finite and positive")

                # Store information for the forward direction.
                starts.append(start)
                ends.append(end)
                costs.append(cost)
                edge_ids.append(edge_id)
                edge_metadata.append(metadata)
                edge_speeds.append(edge_speed)
                edge_has_explicit_speed.append("speed_kmh" in road)

                # If the road is bidirectional, add an edge in the reverse direction.
                if road.get("bidirectional", True):
                    starts.append(end)
                    ends.append(start)
                    costs.append(cost)
                    edge_ids.append(edge_id)
                    edge_metadata.append(metadata)
                    edge_speeds.append(edge_speed)
                    edge_has_explicit_speed.append("speed_kmh" in road)
        # Convert the data to NumPy arrays for processing.
        starts = np.frombuffer(starts, dtype=np.int64)
        ends = np.frombuffer(ends, dtype=np.int64)
        costs = np.frombuffer(costs, dtype=np.float64)
        edge_speeds = np.frombuffer(edge_speeds, dtype=np.float64)

        if not len(costs):
            raise ValueError("The road network has no roads")

        # Sort the edges by their start and end nodes.
        order = np.lexsort((ends, starts))

        # Important: Sort ALL related information using the same order.
        starts, ends, costs = starts[order], ends[order], costs[order]
        edge_speeds = edge_speeds[order]
        edge_has_explicit_speed = [edge_has_explicit_speed[i] for i in order]
        edge_ids = [edge_ids[i] for i in order]
        edge_metadata = [edge_metadata[i] for i in order]

        # Create a dictionary to store all parallel edges.
        self.edge_options = {}

        for i, (start, end) in enumerate(zip(starts, ends)):

            # Identify the pair of start and end nodes.
            key = (int(start), int(end))

            # Store all information for each individual edge.
            self.edge_options.setdefault(key, []).append({
                "id": edge_ids[i],
                "metadata": edge_metadata[i],
                "distance_km": float(costs[i]),
                "speed_kmh": float(edge_speeds[i]),
                "has_explicit_speed": bool(edge_has_explicit_speed[i])
            })

         # Create two dictionaries to store the selected edges for each objective.
        self.edge_selection = {
            "distance": {},
            "time": {}
        }

        distance_edges = []
        time_edges = []

        # Process each pair of nodes that may have multiple connecting road segments.
        for (start, end), options in self.edge_options.items():

            # Select the edge with the shortest distance.
            distance_edge = min(
                options,
                key=lambda edge: edge["distance_km"]
            )

            # Select the edge with the shortest travel time.
            time_edge = min(
                options,
                key=lambda edge: edge["distance_km"] / edge["speed_kmh"]
            )

            # Store the selected edge information for later route reconstruction.
            self.edge_selection["distance"][(start, end)] = distance_edge
            self.edge_selection["time"][(start, end)] = time_edge

            distance_edges.append((start, end, distance_edge))
            time_edges.append((start, end, time_edge))


        # Prepare data for the distance graph.
        graph_starts = np.array(
            [edge[0] for edge in distance_edges], dtype=np.int64
        )
        graph_ends = np.array(
            [edge[1] for edge in distance_edges], dtype=np.int64
        )
        graph_costs = np.array(
            [edge[2]["distance_km"] for edge in distance_edges],
            dtype=np.float64
        )

        # Prepare data for the time graph.
        time_starts = np.array(
            [edge[0] for edge in time_edges], dtype=np.int64
        )
        time_ends = np.array(
            [edge[1] for edge in time_edges], dtype=np.int64
        )
        time_costs = np.array(
            [
                edge[2]["distance_km"] / edge[2]["speed_kmh"] * 3600
                for edge in time_edges
            ],
            dtype=np.float64
        )

        # Build the graph for distance-based route finding.
        self.graph = csr_matrix(
            (graph_costs, (graph_starts, graph_ends)),
            shape=(len(ids), len(ids))
        )

        # Build the graph for time-based route finding.
        self.time_graph = csr_matrix(
            (time_costs, (time_starts, time_ends)),
            shape=(len(ids), len(ids))
        )

        # Use the distance graph by default for current calculations.
        starts, ends, costs = graph_starts, graph_ends, graph_costs
        self.xyz = sphere_points(self.coordinates)
        # A spherical chord metric avoids latitude/longitude distortion.
        self.active = np.unique(np.concatenate((starts, ends)))
        self.tree = cKDTree(self.xyz[self.active])
        # Scale the A* lower bound to the actual dataset, including rounded costs.
        lengths = np.linalg.norm(self.xyz[starts] - self.xyz[ends], axis=1)
        nonzero = lengths > 0
        self.heuristic_scale = (float(np.min(costs[nonzero] / lengths[nonzero]))
                                * (1 - 1e-12) if nonzero.any() else 0.0)
        # Calculate the heuristic scale specifically for the time graph.
        time_lengths = np.linalg.norm(
            self.xyz[time_starts] - self.xyz[time_ends],
            axis=1
        )

        time_nonzero = time_lengths > 0

        # Admissible A* heuristic: never overestimate the remaining travel time.
        self.time_heuristic_scale = (
            float(np.min(time_costs[time_nonzero] / time_lengths[time_nonzero]))
            * (1 - 1e-12)
            if time_nonzero.any() else 0.0
        )
        self._prepare_time_weights()
        self._resolved_traffic_scenarios = self._resolve_traffic_scenarios(lookup)
        del lookup
        if cache is not None:
            self._save_cache(cache)

    def _prepare_time_weights(self):
        """Per-entry data for time_graph, so each request can apply its assumed speed.

        Roads without an explicit speed_kmh use the request's assumed speed, not
        DEFAULT_SPEED_KMH; roads with one keep it. Parallel edges are chosen once at
        DEFAULT_SPEED_KMH, which only matters when explicit and implicit speeds mix.
        """
        graph = self.time_graph
        sources = np.repeat(np.arange(graph.shape[0]), np.diff(graph.indptr))
        selection = self.edge_selection["time"]
        km = np.empty(len(graph.data))
        explicit = np.full(len(graph.data), np.nan)
        for offset, (source, target) in enumerate(zip(sources.tolist(), graph.indices.tolist())):
            edge = selection[(source, target)]
            km[offset] = edge["distance_km"]
            if edge.get("has_explicit_speed"):
                explicit[offset] = edge["speed_kmh"]
        self.time_edge_km = km
        self.time_edge_explicit_speed = explicit
        self.max_explicit_speed = float(np.nanmax(explicit)) if np.isfinite(explicit).any() else 0.0
        lengths = np.linalg.norm(self.xyz[sources] - self.xyz[graph.indices], axis=1)
        nonzero = lengths > 0
        # km per unit chord; divided by the fastest speed it gives an admissible heuristic.
        self.time_heuristic_km = (float(np.min(km[nonzero] / lengths[nonzero])) * (1 - 1e-12)
                                  if nonzero.any() else 0.0)

    def _time_graph_for(self, route_speed_kmh, scenario_speed=None):
        speeds = np.where(np.isnan(self.time_edge_explicit_speed), route_speed_kmh,
                          self.time_edge_explicit_speed)
        graph = csr_matrix((self.time_edge_km / speeds * 3600, self.time_graph.indices.copy(),
                            self.time_graph.indptr.copy()), shape=self.time_graph.shape)
        fastest = max(route_speed_kmh, self.max_explicit_speed, scenario_speed or 0.0)
        return graph, self.time_heuristic_km * 3600 / fastest

    def _save_cache(self, cache):
        temporary = None
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=cache.parent, suffix=".npz", delete=False) as output:
                temporary = Path(output.name)
                # Keep metadata in a numeric byte array: no pickle loading required.
                serialized_edges = json.dumps(
                    [[source, target, options] for (source, target), options
                     in self.edge_options.items()], ensure_ascii=False
                ).encode("utf-8")
                np.savez(
                    output, ids=np.asarray(self.ids), coordinates=self.coordinates,
                    costs=self.graph.data, indices=self.graph.indices, indptr=self.graph.indptr,
                    time_costs=self.time_graph.data, time_indices=self.time_graph.indices,
                    time_indptr=self.time_graph.indptr,
                    active=self.active, heuristic_scale=self.heuristic_scale,
                    time_heuristic_scale=self.time_heuristic_scale,
                    edge_options_json=np.frombuffer(serialized_edges, dtype=np.uint8),
                )
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
            indexes = []
            for edge in scenario[edge_key]:
                source, target = (node_index(node_id) for node_id in edge)
                if (source is not None and target is not None
                        and self._edge_offset(self.graph, source, target) is not None):
                    indexes.append((source, target))
            if scenario.get("kind") == "road_closure":
                available = len(indexes) >= scenario["closed_road_count"]
            else:
                available = bool(indexes)
            indexes = tuple(indexes)
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
        # Select the graph matching the requested objective.
        if resolved_objective == "time":
            # Built per request: implicit-speed roads follow the assumed speed.
            search_graph, heuristic_scale = self._time_graph_for(route_speed_kmh, scenario_speed)
        else:
            search_graph = self.graph
            heuristic_scale = self.heuristic_scale

        # Store the selected edges for later route reconstruction.
        route_edge_selection = self.edge_selection[resolved_objective].copy()

        # Copy the graph if a traffic scenario requires weight adjustments.
        if scenario is not None:
            search_graph = search_graph.copy()

        # If a road segment is congested, update its travel time.
        if (
            resolved_objective == "time"
            and scenario is not None
            and scenario_speed is not None
        ):
            for source, target in resolved_scenario["event_edges"]:

                # Get all edges connecting the same pair of nodes.
                options = self.edge_options.get((source, target), [])

                if not options:
                    continue

                # When multiple edges are affected by congestion, select the shortest one.
                selected_edge = min(
                    options,
                    key=lambda edge: edge["distance_km"]
                )

                route_edge_selection[(source, target)] = selected_edge

                # Update the travel time weight using the simulated speed.
                offset = self._edge_offset(search_graph, source, target)

                if offset is not None:
                    search_graph.data[offset] = (
                        selected_edge["distance_km"] / scenario_speed * 3600
                    )

            # Use a zero heuristic to ensure A* still finds the optimal result
            # when edge speeds are modified by the traffic scenario.
            heuristic_scale = 0.0
        # Closed roads are removed for both objectives.
        blocked_edges = set()
        if scenario is not None and scenario.get("kind") == "road_closure":
            blocked_edges.update(resolved_scenario["closed_edges"])
        if blocked_edges:
            sources = np.repeat(np.arange(len(self.ids)), np.diff(search_graph.indptr))
            keep = np.ones(len(search_graph.data), dtype=bool)
            for source, target in blocked_edges:
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
        # Store the start and end node IDs of each edge.
        segment_edges = [
            (str(self.ids[source]), str(self.ids[target]))
            for source, target in zip(path, path[1:])
        ]

        # Retrieve the exact information of each selected edge.
        segment_edge_records = [
            route_edge_selection[(source, target)]
            for source, target in zip(path, path[1:])
        ]

        # Store the unique ID of each road segment.
        segment_edge_ids = [
            str(edge["id"])
            for edge in segment_edge_records
        ]

        # Store the corresponding metadata for each road segment.
        segment_edge_metadata = [
            dict(edge.get("metadata") or {})
            for edge in segment_edge_records
        ]

        # Store the distance of each road segment.
        segment_distances_km = [
            float(edge["distance_km"])
            for edge in segment_edge_records
        ]

        # Use the selected edge, not the distance graph's representative edge.
        segment_distances = segment_distances_km
        event_edges = (set(resolved_scenario["event_edges"])
                       if scenario is not None else set())
        segment_speed_sources = [
            "simulated" if (source, target) in event_edges else "no_live_data_assumed"
            for source, target in zip(path, path[1:])
        ]

        # A road's own speed applies to both objectives, so their ETAs are comparable;
        # roads without one use the assumed speed.
        segment_speeds = [
            float(edge["speed_kmh"]) if edge.get("has_explicit_speed") else float(route_speed_kmh)
            for edge in segment_edge_records
        ]
        if scenario is not None and scenario_speed is not None and scenario.get("kind") != "road_closure":
            for i, (source, target) in enumerate(zip(path, path[1:])):
                if (source, target) in event_edges:
                    segment_speeds[i] = float(scenario_speed)

        # Avoid a ZeroDivisionError for tiny yet valid speeds; report ETA overflow.
        with np.errstate(over="ignore", divide="ignore", invalid="ignore"):
            segment_durations = [
                float(np.divide(length * 3600.0, speed))
                for length, speed in zip(segment_distances, segment_speeds)
            ]
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
        # Return the route-finding results along with detailed information about each edge.
        return {
            "coordinates": self.coordinates[path].tolist(),
            # Start and end node IDs of each edge.
            "segment_edges": segment_edges,
            # Unique IDs of the selected road segments.
            "segment_edge_ids": segment_edge_ids,
            # Corresponding metadata for each road segment.
            "segment_edge_metadata": segment_edge_metadata,
            "distance_km": distance,
            "start": start_point,
            "goal": goal_point,
            "algorithm": algorithm,
            "objective": resolved_objective,
            "speed_kmh": float(route_speed_kmh),
            # Distance and speed information for each road segment.
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
            "traffic_note": traffic_note
        }

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
