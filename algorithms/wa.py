import math
import heapq
from itertools import count


# ==========================================================
# Utility
# ==========================================================

def euclidean_distance(node_a, node_b):
    """
    Heuristic:
    Khoảng cách thẳng giữa 2 node.
    """

    dx = node_a["lat"] - node_b["lat"]
    dy = node_a["lng"] - node_b["lng"]

    return math.sqrt(dx * dx + dy * dy)


def build_graph(map_data):
    """
    Convert roads -> adjacency list
    """

    graph = {}

    for node in map_data["nodes"]:
        graph[node["id"]] = []

    for road in map_data["roads"]:

        source = road["from"]
        destination = road["to"]
        distance_km = road["distance_km"]

        graph[source].append(
            (destination, distance_km)
        )

        if road.get("bidirectional", True):

            graph[destination].append(
                (source, distance_km)
            )

    return graph


# ==========================================================
# Weighted A*
# ==========================================================

def weighted_astar_search(
    map_data,
    start_node_id,
    goal_node_id,
    weight=1.0
):
    """
    weight = 1.0  -> A*
    weight > 1.0  -> Weighted A*
    """

    graph = build_graph(map_data)

    node_lookup = {
        node["id"]: node
        for node in map_data["nodes"]
    }

    # ------------------------------------------------------
    # Validation
    # ------------------------------------------------------

    if start_node_id not in node_lookup:
        return {
            "success": False,
            "path": [],
            "distance_km": None,
            "estimated_time_sec": None,
            "destination_hospital": None,
            "error": "Start node not found"
        }

    if goal_node_id not in node_lookup:
        return {
            "success": False,
            "path": [],
            "distance_km": None,
            "estimated_time_sec": None,
            "destination_hospital": None,
            "error": "Goal node not found"
        }

    # ------------------------------------------------------
    # Heuristic Cache
    # ------------------------------------------------------

    h_cache = {}

    def h(node_id):

        if node_id not in h_cache:

            h_cache[node_id] = euclidean_distance(
                node_lookup[node_id],
                node_lookup[goal_node_id]
            )

        return h_cache[node_id]

    # ------------------------------------------------------
    # Frontier
    # (f, insertion_order, node_id)
    # ------------------------------------------------------

    frontier = []
    counter = count()

    start_f = weight * h(start_node_id)

    heapq.heappush(
        frontier,
        (
            start_f,
            next(counter),
            start_node_id
        )
    )

    # Best known cost
    best_g = {
        start_node_id: 0.0
    }

    # Parent tracking
    parent = {
        start_node_id: None
    }

    while frontier:

        f, _, current_node_id = heapq.heappop(frontier)

        current_g = best_g[current_node_id]

        # --------------------------------------------------
        # Goal reached
        # --------------------------------------------------

        if current_node_id == goal_node_id:

            path = []

            node_id = goal_node_id

            while node_id is not None:
                path.append(node_id)
                node_id = parent[node_id]

            path.reverse()

            return {
                "success": True,
                "path": path,
                "distance_km": float(current_g),
                "estimated_time_sec": None,
                "destination_hospital": None,
                "error": None
            }

        # --------------------------------------------------
        # Expand neighbors
        # --------------------------------------------------

        for neighbor_id, edge_cost in graph.get(
            current_node_id,
            []
        ):

            new_g = current_g + edge_cost

            if new_g < best_g.get(
                neighbor_id,
                float("inf")
            ):

                best_g[neighbor_id] = new_g

                parent[neighbor_id] = current_node_id

                h_value = h(neighbor_id)

                new_f = (
                    new_g +
                    weight * h_value
                )

                heapq.heappush(
                    frontier,
                    (
                        new_f,
                        next(counter),
                        neighbor_id
                    )
                )

    # ------------------------------------------------------
    # No route found
    # ------------------------------------------------------

    return {
        "success": False,
        "path": [],
        "distance_km": None,
        "estimated_time_sec": None,
        "destination_hospital": None,
        "error": "No route available"
    }


# ==========================================================
# Find Hospital
# ==========================================================

def weighted_astar_to_hospital(
    map_data,
    start_node_id,
    weight=1.0
):
    """
    Tìm bệnh viện gần nhất theo distance_km
    """

    hospitals = map_data.get(
        "hospitals",
        []
    )

    if not hospitals:

        return {
            "success": False,
            "path": [],
            "distance_km": None,
            "estimated_time_sec": None,
            "destination_hospital": None,
            "error": "No hospital available"
        }

    best_result = None
    best_distance = float("inf")
    best_hospital = None

    for hospital in hospitals:

        result = weighted_astar_search(
            map_data=map_data,
            start_node_id=start_node_id,
            goal_node_id=hospital["node_id"],
            weight=weight
        )

        if not result["success"]:
            continue

        if result["distance_km"] < best_distance:

            best_distance = result["distance_km"]
            best_result = result
            best_hospital = hospital

    if best_result is None:

        return {
            "success": False,
            "path": [],
            "distance_km": None,
            "estimated_time_sec": None,
            "destination_hospital": None,
            "error": "No reachable hospital"
        }

    best_result["destination_hospital"] = {
        "hospital_id": best_hospital["hospital_id"],
        "node_id": best_hospital["node_id"],
        "name": best_hospital["name"]
    }

    return best_result