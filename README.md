# Ambulance route planner

Requires Python 3.10 or newer. Install dependencies and start the server:

```sh
python -m pip install -r requirements.txt
python main.py
```

Open http://127.0.0.1:8000. The map can be explored immediately while the
server prepares routing in the background. Drag the two markers, select
A* or Dijkstra, then choose **Find route**. Results respect the directed
edges in the supplied dataset. A missing connection is reported rather
than replaced by a demonstration route. Travel time is not calculated.

The browser no longer downloads the full road graph or draws every edge.
The backend streams [the source graph](static/data/hanoi_map.json), builds
a compact sparse graph, and indexes connected nodes on a sphere for nearest
node queries. Parallel edges retain their minimum cost. A* uses a chord
distance lower bound scaled to the dataset's edge weights.

The first startup builds a binary cache under `.cache/routing`. Subsequent
startups reuse it and rebuild the spatial index. Changing the JSON's size
or modification time invalidates the cache. Cache files can be deleted
while the server is stopped to force a rebuild. Use a single server worker
to avoid keeping multiple copies of the graph in memory. Automatic Python
reload is disabled; restart the server after editing backend code.

API endpoints:

- `GET /api/network/status`: `loading`, `ready`, or `error`.
- `GET /api/nearest?lat=21.03&lng=105.85`: nearest node belonging to a road.
- `POST /api/route`: JSON with `start` and `goal` objects containing `lat`
  and `lng`, plus `algorithm` (`astar` or `dijkstra`). Returns route
  coordinates, distance, and snapped endpoints. Returns 503 while loading
  and 404 when no directed route exists.

Leaflet and OpenStreetMap background tiles still require internet access.
The input dataset determines which roads are usable; nearest-node snapping
does not guarantee reachability or vehicle access. The existing research
algorithms in [src/algorithms](src/algorithms) are retained independently;
the live API uses the prepared sparse graph to avoid rebuilding adjacency
lists per request.

Run backend regression tests:

```sh
python -m unittest discover -s tests -v
```

To verify the loading improvement, open browser DevTools Network and reload
the page: there should be no request for `hanoi_map.json`. Routing readiness
is polled separately; route requests return only the selected path.
