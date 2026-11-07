"""Fetch and cache a routable Hanoi road graph from the Overpass API."""
import json
import logging
import math
import os
from pathlib import Path
import tempfile
import time
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from src.scenarios import SOURCE_TEST_CASES


OVERPASS_URL = "https://overpass-api.de/api/interpreter"
GRAPH_CACHE_NAME = "hanoi-overpass-graph.json"
GRAPH_CACHE_TTL_SECONDS = 24 * 60 * 60
HIGHWAY_TYPES = (
    "motorway", "motorway_link", "trunk", "trunk_link", "primary",
    "primary_link", "secondary", "secondary_link", "tertiary",
    "tertiary_link", "unclassified", "residential", "living_street",
    "service", "road",
)


def _query_bbox():
    points = [
        point
        for case in SOURCE_TEST_CASES["cases"]
        for point in (case["hospital"]["coords"], case["emergency_target"]["coords"])
    ]
    margin = 0.015
    return (
        min(point[0] for point in points) - margin,
        min(point[1] for point in points) - margin,
        max(point[0] for point in points) + margin,
        max(point[1] for point in points) + margin,
    )


def _overpass_query():
    south, west, north, east = _query_bbox()
    bbox = f"{south},{west},{north},{east}"
    highway_filter = "|".join(HIGHWAY_TYPES)
    return (
        f'[out:json][timeout:100];way["highway"~"^({highway_filter})$"]'
        f'["access"!~"^(no|private)$"]({bbox});out body;>;out skel qt;'
    )


def _distance_km(first, second):
    lat1, lon1 = map(math.radians, first)
    lat2, lon2 = map(math.radians, second)
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    return 6371.0088 * 2 * math.asin(math.sqrt(haversine))


def build_graph(overpass_data):
    """Convert Overpass nodes and car-road ways to the routing graph schema."""
    nodes = {
        element["id"]: (float(element["lat"]), float(element["lon"]))
        for element in overpass_data.get("elements", ())
        if element.get("type") == "node"
    }
    graph_nodes = set()
    roads = []
    for way in overpass_data.get("elements", ()):
        if way.get("type") != "way":
            continue
        tags = way.get("tags", {})
        if tags.get("highway") not in HIGHWAY_TYPES:
            continue
        refs = way.get("nodes", ())
        if tags.get("oneway") == "-1":
            refs = list(reversed(refs))
        one_way = (
            tags.get("oneway") in {"yes", "1", "true", "-1"}
            or tags.get("junction") == "roundabout"
        )
        # Iterate through each road segment between consecutive OSM nodes.
        for segment_index, (source, target) in enumerate(
            zip(refs, refs[1:])
        ):

            # Skip the road segment if either node is missing its coordinates.
            if source not in nodes or target not in nodes:
                continue

            # Calculate the distance between two nodes (in kilometers).
            distance = _distance_km(nodes[source], nodes[target])

            # Check whether the distance is valid.
            if not math.isfinite(distance) or distance <= 0:
                continue

            # Add both nodes to the graph's node collection.
            graph_nodes.update((source, target))

            # Generate a unique ID for each road segment.
            # Combine the OSM way ID with the segment's position in the way.
            edge_id = f"osm_way_{way['id']}_segment_{segment_index}"

            # Store the metadata of the road segment.
            edge_metadata = {
                "way_id": way["id"],
                "segment_index": segment_index,
                "name": tags.get("name"),
                "highway": tags.get("highway"),
                "maxspeed": tags.get("maxspeed"),
                "oneway": one_way
            }

            # Add the road segment to the map data.
            roads.append({
                "id": edge_id,
                "from": f"node_{source}",
                "to": f"node_{target}",
                "distance_km": distance,
                "bidirectional": not one_way,
                "metadata": edge_metadata
            })
    if not roads:
        raise ValueError("Overpass response contains no routable roads")
    return {
        "nodes": [
            {"id": f"node_{node_id}", "lat": nodes[node_id][0], "lng": nodes[node_id][1]}
            for node_id in sorted(graph_nodes)
        ],
        "roads": roads,
    }


def fetch_graph():
    payload = urlencode({"data": _overpass_query()}).encode("utf-8")
    request = Request(
        OVERPASS_URL,
        data=payload,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "AmbulanceRoutePlanner/1.0 (OSM Overpass graph)",
        },
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        data = json.loads(response.read())
    return build_graph(data)


def _write_graph(cache_path, graph):
    temporary_path = None
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=cache_path.parent,
            suffix=".json", delete=False,
        ) as output:
            temporary_path = Path(output.name)
            json.dump(graph, output, separators=(",", ":"))
        os.replace(temporary_path, cache_path)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def resolve_graph_path(cache_dir, fallback_path):
    """Refresh the cached Overpass graph daily, with an explicit local fallback."""
    cache_path = Path(cache_dir) / GRAPH_CACHE_NAME
    fallback_path = Path(fallback_path)
    if cache_path.exists() and time.time() - cache_path.stat().st_mtime < GRAPH_CACHE_TTL_SECONDS:
        return cache_path
    try:
        _write_graph(cache_path, fetch_graph())
        logging.info("Loaded Hanoi road graph from the Overpass API")
        return cache_path
    except (OSError, URLError, TimeoutError, ValueError) as error:
        if cache_path.exists():
            logging.warning(
                "Overpass refresh failed; using cached OSM graph: %s", error
            )
            return cache_path
        if fallback_path.exists():
            logging.warning(
                "Overpass is unavailable; using bundled OSM graph: %s", error
            )
            return fallback_path
        raise RuntimeError("Overpass failed and no local OSM graph is available") from error
