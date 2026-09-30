import math
import heapq
from itertools import count


# ==========================================================
# Utility
# ==========================================================

def euclidean_distance(node_a, node_b):

    dx = node_a["lat"] - node_b["lat"]
    dy = node_a["lng"] - node_b["lng"]

    return math.sqrt(dx * dx + dy * dy)


def build_graph(map_data):

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
# ARA Star
# ==========================================================

def ara_search(
    map_data,
    start_node_id,
    goal_node_id,
    epsilon_start=2.5,
    epsilon_step=0.5
):

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
    # Cost structures
    # ------------------------------------------------------

    g = {
        start_node_id: 0.0
    }

    parent = {
        start_node_id: None
    }

    # ------------------------------------------------------
    # OPEN / CLOSED / INCONS
    # ------------------------------------------------------

    OPEN = []
    CLOSED = set()
    INCONS = set()

    counter = count()

    epsilon = epsilon_start

    heapq.heappush(
        OPEN,
        (
            g[start_node_id]
            + epsilon * h(start_node_id),

            next(counter),

            start_node_id
        )
    )

    # ------------------------------------------------------
    # ImprovePath
    # ------------------------------------------------------

    def improve_path(current_epsilon):

        while OPEN:

            goal_g = g.get(
                goal_node_id,
                float("inf")
            )

            best_open_key = OPEN[0][0]

            if goal_g <= best_open_key:
                break

            _, _, current_node_id = heapq.heappop(
                OPEN
            )

            CLOSED.add(current_node_id)

            current_g = g[current_node_id]

            for (
                neighbor_id,
                edge_cost
            ) in graph.get(
                current_node_id,
                []
            ):

                tentative_g = (
                    current_g
                    + edge_cost
                )

                if tentative_g < g.get(
                    neighbor_id,
                    float("inf")
                ):

                    g[neighbor_id] = tentative_g

                    parent[
                        neighbor_id
                    ] = current_node_id

                    if (
                        neighbor_id
                        not in CLOSED
                    ):

                        heapq.heappush(
                            OPEN,
                            (
                                tentative_g
                                + current_epsilon
                                * h(neighbor_id),

                                next(counter),

                                neighbor_id
                            )
                        )

                    else:

                        INCONS.add(
                            neighbor_id
                        )

    # ------------------------------------------------------
    # Main Loop
    # ------------------------------------------------------

    while True:

        improve_path(epsilon)

        if epsilon <= 1.0:
            break

        epsilon = max(
            1.0,
            epsilon - epsilon_step
        )

        # OPEN <- OPEN U INCONS

        for state in INCONS:

            heapq.heappush(
                OPEN,
                (
                    g[state]
                    + epsilon * h(state),

                    next(counter),

                    state
                )
            )

        INCONS.clear()
        CLOSED.clear()

        # rebuild priorities

        rebuilt_open = []

        while OPEN:

            _, _, state = heapq.heappop(
                OPEN
            )

            heapq.heappush(
                rebuilt_open,
                (
                    g[state]
                    + epsilon * h(state),

                    next(counter),

                    state
                )
            )

        OPEN = rebuilt_open

    # ------------------------------------------------------
    # No solution
    # ------------------------------------------------------

    if goal_node_id not in g:

        return {
            "success": False,
            "path": [],
            "distance_km": None,
            "estimated_time_sec": None,
            "destination_hospital": None,
            "error": "No route available"
        }

    # ------------------------------------------------------
    # Reconstruct Path
    # ------------------------------------------------------

    path = []

    current = goal_node_id

    while current is not None:

        path.append(current)

        current = parent[current]

    path.reverse()

    return {
        "success": True,
        "path": path,
        "distance_km": g[goal_node_id],
        "estimated_time_sec": None,
        "destination_hospital": None,
        "error": None
    }


# ==========================================================
# ARA Star Hospital Search
# ==========================================================

def ara_to_hospital(
    map_data,
    start_node_id,
    epsilon_start=2.5,
    epsilon_step=0.5
):

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

        result = ara_search(
            map_data=map_data,
            start_node_id=start_node_id,
            goal_node_id=hospital["node_id"],
            epsilon_start=epsilon_start,
            epsilon_step=epsilon_step
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

    best_result[
        "destination_hospital"
    ] = {
        "hospital_id":
            best_hospital["hospital_id"],

        "node_id":
            best_hospital["node_id"],

        "name":
            best_hospital["name"]
    }

    return best_result