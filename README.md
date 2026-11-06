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
than replaced by a demonstration route. The routing result includes estimated
travel time at a configurable fixed speed (default 40 km/h, not live traffic).
Choose a hospital case or drag endpoints, set vehicle speed, and optionally select
one simulated peak-traffic case for the selected hospital route. Event speeds are
test assumptions; all other roads have no live speed data and use the assumed speed.
The peak-hour option applies 12 km/h to a five-edge corridor matching the selected
hospital case (TC01, TC02, or TC03). Random closure selects two candidate roads with a
fixed per-case seed and fixes every remaining road at 40 km/h. Both modes
compare ETA and distance with baseline.
Use Pause/Resume, Replay, Reset and playback 1×/10×/60×; playback does not change ETA.

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

- `GET /api/test-cases`: three N1 hospital cases; N1 obstacle samples are not applied.
- `GET /api/traffic-scenarios`: TC01-TC03 peak-traffic and seeded road-closure cases.
- `GET /api/network/status`: `loading`, `ready`, or `error`.
- `GET /api/nearest?lat=21.03&lng=105.85`: nearest node belonging to a road.
- `POST /api/route`: JSON with `start` and `goal` objects containing `lat`
  and `lng`, plus `algorithm` (`astar` or `dijkstra`) and optional positive,
  finite `speed_kmh` (default 40). Returns route
  coordinates, distance, snapped endpoints, assumed speed, segment distances,
  speeds and durations, per-segment speed sources, and total ETA in seconds. With an
  event selected, route search minimizes ETA; without one it minimizes distance.
  Returns 422 for invalid input, 503 while loading
  and 404 when no directed route exists.

Leaflet and OpenStreetMap background tiles still require internet access.
The input dataset determines which roads are usable; nearest-node snapping
does not guarantee reachability or vehicle access. The existing research
algorithms in [src/algorithms](src/algorithms) are retained independently;
the live API uses the prepared sparse graph to avoid rebuilding adjacency
lists per request.

Run backend regression tests:

```sh
python -m pip install -r requirements-dev.txt
python -B -m unittest discover -s tests -v
```

To include all three Hanoi scenarios through the API (PowerShell):

```powershell
$env:RUN_DATASET_TESTS='1'
python -B -m unittest discover -s tests -v
```

This opt-in suite verifies the simulated 12 km/h corridors and seeded two-road
closures against the real TC01-TC03 routes and directed OSM edges. These are repeatable
test scenarios, not live or predicted traffic data.

To verify the loading improvement, open browser DevTools Network and reload
the page: there should be no request for `hanoi_map.json`. Routing readiness
is polled separately; route requests return only the selected path.

See [the live API contract](docs/INTERFACE.md) and [integration verification](docs/n2buoi1.md).
N1 hospital verification sources are still pending. Scenario TC03 snaps its
start about 385 m; snapping does not establish ambulance access to a hospital.
