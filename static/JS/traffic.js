// Session 2 (N4): traffic scenarios, routing objectives, segment colours and mock data.
// Pure module (no DOM access) so it runs in the browser and in Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Traffic = api;
})(typeof self !== "undefined" ? self : this, function () {
  // Proposed traffic scenario IDs, pending N1 confirmation; change only this list if they differ.
  // scenario_id is a traffic condition, not a route case (case_id TC01-TC03).
  const SCENARIOS = [
    { id: "free_flow", label: "Free flow" },
    { id: "main_road_jam", label: "Main road jam" },
    { id: "multi_jam", label: "Multiple jams" },
  ];

  const OBJECTIVES = [
    { id: "distance", label: "Shortest distance" },
    { id: "time", label: "Fastest time" },
  ];

  // Segment status compares segment speed with the assumed vehicle speed (speed_kmh).
  const STATUS = {
    free: { label: "Free flow", color: "#3fbf6e" },
    slow: { label: "Slow", color: "#f2b33d" },
    jam: { label: "Jam", color: "#e34b45" },
  };

  function labelOf(list, id) {
    const item = list.find((entry) => entry.id === id);
    return item ? item.label : id || "—";
  }

  function statusFor(speedKmh, baseKmh) {
    const ratio = speedKmh / baseKmh;
    if (ratio >= 0.75) return "free";
    if (ratio >= 0.4) return "slow";
    return "jam";
  }

  // Fill in session 2 fields when the backend does not return them yet, so the UI always
  // gets one shape. Speeds are derived from km and seconds; status is derived from speed.
  function normalize(route) {
    const n = route.segment_durations_sec.length;
    const base = route.speed_kmh;
    const backendSpeeds = Array.isArray(route.segment_speeds_kmh) && route.segment_speeds_kmh.length === n;
    const speeds = backendSpeeds ? route.segment_speeds_kmh.slice() :
      route.segment_durations_sec.map((sec, i) => sec > 0 ? route.segment_distances_km[i] / sec * 3600 : base);
    const statuses = Array.isArray(route.segment_status) && route.segment_status.length === n ?
      route.segment_status.slice() : speeds.map((speed) => statusFor(speed, base));
    return Object.assign({}, route, {
      segment_speeds_kmh: speeds,
      segment_status: statuses,
      segment_ids: Array.isArray(route.segment_ids) && route.segment_ids.length === n ?
        route.segment_ids : speeds.map((_, i) => `seg-${i}`),
      traffic_applied: backendSpeeds,
    });
  }

  // Merge consecutive segments with the same status into one polyline to keep drawing light.
  function colorRuns(route) {
    const runs = [];
    route.segment_status.forEach((state, i) => {
      const last = runs[runs.length - 1];
      if (last && last.status === state) last.coords.push(route.coordinates[i + 1]);
      else runs.push({ status: state, coords: [route.coordinates[i], route.coordinates[i + 1]] });
    });
    return runs;
  }

  function compare(distanceRoute, timeRoute) {
    if (!distanceRoute || !timeRoute) return null;
    return {
      extra_km: timeRoute.distance_km - distanceRoute.distance_km,
      saved_sec: distanceRoute.estimated_time_sec - timeRoute.estimated_time_sec,
    };
  }

  // ---------- Mock data (?mock=1): UI development only, until the session 2 API exists ----------
  const R = 6371.0088;
  function haversineKm(a, b) {
    const toRad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toRad, dLng = (b[1] - a[1]) * toRad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function line(a, b, parts) {
    const pts = [];
    for (let i = 0; i <= parts; i++) pts.push([a[0] + (b[0] - a[0]) * i / parts, a[1] + (b[1] - a[1]) * i / parts]);
    return pts;
  }

  // Straight line = "main road" (shortest). Detour bends to one side (longer).
  function mockGeometry(start, goal, detour) {
    const a = [start.lat, start.lng], b = [goal.lat, goal.lng];
    if (!detour) return line(a, b, 12);
    const mid = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * 0.35, (a[1] + b[1]) / 2 + (b[0] - a[0]) * 0.35];
    return line(a, mid, 6).concat(line(mid, b, 6).slice(1));
  }

  // Speed factor per scenario: the main road jams in the middle; the detour is mostly clear.
  function mockFactor(scenario, detour, i, n) {
    const middle = i >= Math.floor(n / 3) && i < Math.ceil(2 * n / 3);
    if (scenario === "main_road_jam") return detour ? 1 : (middle ? 0.15 : 0.9);
    if (scenario === "multi_jam") return detour ? (i % 4 === 1 ? 0.5 : 0.95) : (i % 3 === 0 ? 0.2 : 0.6);
    return 1;
  }

  function buildMock(start, goal, scenario, detour, speed, algorithm, objective) {
    const coords = mockGeometry(start, goal, detour);
    const n = coords.length - 1;
    const dist = [], speeds = [], durs = [];
    for (let i = 0; i < n; i++) {
      dist.push(haversineKm(coords[i], coords[i + 1]));
      speeds.push(speed * mockFactor(scenario, detour, i, n));
      durs.push(dist[i] / speeds[i] * 3600);
    }
    return {
      coordinates: coords,
      distance_km: dist.reduce((s, x) => s + x, 0),
      start: { id: "mock-start", lat: start.lat, lng: start.lng, distance_meters: 0 },
      goal: { id: "mock-goal", lat: goal.lat, lng: goal.lng, distance_meters: 0 },
      algorithm, speed_kmh: speed,
      segment_distances_km: dist,
      segment_durations_sec: durs,
      estimated_time_sec: durs.reduce((s, x) => s + x, 0),
      scenario_id: scenario, objective,
      snapshot_id: `mock-${scenario}`,
      segment_ids: coords.slice(1).map((_, i) => `${detour ? "detour" : "main"}-${i}`),
      segment_speeds_kmh: speeds,
      segment_status: speeds.map((v) => statusFor(v, speed)),
      mock: true,
    };
  }

  // Mirrors the expected backend: objective=distance returns the shortest route,
  // objective=time returns the candidate with the smallest total time.
  function mockRoute(body) {
    const args = [body.start, body.goal, body.scenario_id, null, body.speed_kmh, body.algorithm, body.objective];
    const main = buildMock(...args.map((v, i) => i === 3 ? false : v));
    if (body.objective !== "time") return main;
    const detour = buildMock(...args.map((v, i) => i === 3 ? true : v));
    return detour.estimated_time_sec < main.estimated_time_sec ? detour : main;
  }

  return { SCENARIOS, OBJECTIVES, STATUS, labelOf, statusFor, normalize, colorRuns, compare, mockRoute };
});
