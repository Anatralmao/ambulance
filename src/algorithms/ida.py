import math
from itertools import count


# ==========================================================
# Utility 
# ==========================================================

def euclidean_distance(node_a, node_b):

    dx = node_a["lat"] - node_b["lat"]
    dy = node_a["lng"] - node_b["lng"]

    return math.sqrt(dx * dx + dy * dy)


def haversine_km(node_a, node_b):
    """Khoảng cách đường chim bay (km) - đơn vị cùng với distance_km của road."""

    r = 6371.0088

    lat1 = math.radians(node_a["lat"])
    lat2 = math.radians(node_b["lat"])
    dlat = lat2 - lat1
    dlng = math.radians(node_b["lng"] - node_a["lng"])

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    )

    return 2 * r * math.asin(math.sqrt(a))


def build_graph(map_data):

    graph = {}

    for node in map_data["nodes"]:
        graph[node["id"]] = []

    for road in map_data["roads"]:

        source = road["from"]
        destination = road["to"]
        distance_km = road["distance_km"]

        graph[source].append((destination, distance_km))

        if road.get("bidirectional", True):
            graph[destination].append((source, distance_km))

    return graph


def _fail(error):

    return {
        "success": False,
        "path": [],
        "distance_km": None,
        "estimated_time_sec": None,
        "destination_hospital": None,
        "error": error
    }


DEFAULT_SPEED_KMH = 40.0   # tốc độ TB giả định của xe cứu thương


def _estimate_time_sec(distance_km, speed_kmh):
    """Thời gian (giây) = quãng đường / tốc độ. Kiểu float theo quy ước."""

    if speed_kmh is None or speed_kmh <= 0:
        return None

    return distance_km / speed_kmh * 3600.0


def _prepare(map_data, start_node_id, goal_node_id, heuristic):
    """
    Dùng chung cho IDA* và SMA*:
    validate + dựng graph + heuristic h(n) có CACHE.
    Trả về (graph, h, error).
    """

    graph = build_graph(map_data)

    node_lookup = {node["id"]: node for node in map_data["nodes"]}

    if start_node_id not in node_lookup:
        return None, None, "Start node not found"

    if goal_node_id not in node_lookup:
        return None, None, "Goal node not found"

    dist_fn = haversine_km if heuristic == "haversine" else euclidean_distance

    h_cache = {}

    def h(node_id):

        if node_id not in h_cache:
            h_cache[node_id] = dist_fn(
                node_lookup[node_id],
                node_lookup[goal_node_id]
            )

        return h_cache[node_id]

    return graph, h, None


# ==========================================================
# IDA* (Iterative Deepening A*)
# ==========================================================
#
# - Mỗi vòng lặp là 1 lần DFS bị chặn bởi ngưỡng f = g + h.
# - Nếu chưa thấy đích: ngưỡng mới = f nhỏ nhất đã bị cắt ở vòng trước.
# - Bộ nhớ O(độ sâu lời giải) (chỉ giữ đường đi hiện tại).
# - DFS viết bằng stack tường minh -> không lo vượt recursion limit.
# - best_g (theo từng vòng): bỏ qua node đã tới được với g tốt hơn
#   trong cùng vòng -> giảm mạnh việc duyệt lại trên đồ thị đường phố.
#   (đặt use_transposition=False để về IDA* "thuần" khi benchmark)
# ==========================================================

def ida_search(
    map_data,
    start_node_id,
    goal_node_id,
    heuristic="euclidean",
    use_transposition=True,
    max_iterations=10000,
    speed_kmh=DEFAULT_SPEED_KMH
):

    graph, h, error = _prepare(
        map_data, start_node_id, goal_node_id, heuristic
    )

    if error:
        return _fail(error)

    if start_node_id == goal_node_id:

        return {
            "success": True,
            "path": [start_node_id],
            "distance_km": 0.0,
            "estimated_time_sec": 0.0,
            "destination_hospital": None,
            "error": None,
            "stats": {"iterations": 0, "nodes_expanded": 0}
        }

    EPS = 1e-12

    stats = {"iterations": 0, "nodes_expanded": 0}

    def bounded_dfs(threshold):
        """
        Trả về (path, g, next_threshold).
        path != None nếu tìm thấy đích trong ngưỡng.
        """

        next_threshold = float("inf")

        path = [start_node_id]
        g_list = [0.0]
        on_path = {start_node_id}

        stack = [iter(graph.get(start_node_id, []))]

        best_g = {start_node_id: 0.0}

        while stack:

            try:
                neighbor_id, edge_cost = next(stack[-1])

            except StopIteration:

                stack.pop()
                on_path.discard(path.pop())
                g_list.pop()
                continue

            # tránh chu trình trên đường đi hiện tại
            if neighbor_id in on_path:
                continue

            tentative_g = g_list[-1] + edge_cost

            if use_transposition and (
                tentative_g >= best_g.get(neighbor_id, float("inf"))
            ):
                continue

            f = tentative_g + h(neighbor_id)

            if f > threshold + EPS:

                if f < next_threshold:
                    next_threshold = f

                continue

            if use_transposition:
                best_g[neighbor_id] = tentative_g

            if neighbor_id == goal_node_id:
                return path + [neighbor_id], tentative_g, next_threshold

            stats["nodes_expanded"] += 1

            path.append(neighbor_id)
            g_list.append(tentative_g)
            on_path.add(neighbor_id)
            stack.append(iter(graph.get(neighbor_id, [])))

        return None, None, next_threshold

    threshold = h(start_node_id)

    while stats["iterations"] < max_iterations:

        stats["iterations"] += 1

        path, distance, next_threshold = bounded_dfs(threshold)

        if path is not None:

            return {
                "success": True,
                "path": path,
                "distance_km": distance,
                "estimated_time_sec": _estimate_time_sec(
                    distance, speed_kmh
                ),
                "destination_hospital": None,
                "error": None,
                "stats": stats
            }

        if next_threshold == float("inf"):
            return _fail("No route available")

        threshold = next_threshold

    return _fail("IDA* exceeded max_iterations")
