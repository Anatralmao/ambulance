// Session 2 (N4): traffic events, routing objectives, segment colours and mock data.
// Pure module (no DOM access) so it runs in the browser and in Node tests.
// Contract: docs/INTERFACE.md, POST /api/route with traffic_scenario_id and objective.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Traffic = api;
})(typeof self !== "undefined" ? self : this, function () {
  // UI traffic events. The backend scenario ID is "<prefix>_<case>", e.g. traffic_jam_tc01;
  // a traffic event needs TC01-TC03 because each scenario belongs to one hospital corridor.
  const EVENTS = [
    { id: "", label: "No event", prefix: null },
    { id: "peak_hour", label: "Peak-hour traffic (12 km/h)", prefix: "traffic_jam" },
    { id: "road_closure", label: "Random road closure (2 roads; 40 km/h)", prefix: "road_closure" },
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

  function scenarioId(eventId, caseId) {
    const event = EVENTS.find((entry) => entry.id === eventId);
    if (!event || !event.prefix || !/^TC0[1-3]$/.test(caseId || "")) return null;
    return `${event.prefix}_${caseId.toLowerCase()}`;
  }

  function eventOfScenario(scenario) {
    if (!scenario) return "";
    const event = EVENTS.find((entry) => entry.prefix && scenario.startsWith(entry.prefix + "_"));
    return event ? event.id : "";
  }

  function statusFor(speedKmh, baseKmh) {
    const ratio = speedKmh / baseKmh;
    if (ratio >= 0.75) return "free";
    if (ratio >= 0.4) return "slow";
    return "jam";
  }

  // Give every response one shape: speeds come from segment_speeds_kmh when the backend
  // returns them, otherwise from km and seconds; status is derived from speed.
  function normalize(route) {
    const n = route.segment_durations_sec.length;
    const base = route.speed_kmh;
    const backendSpeeds = Array.isArray(route.segment_speeds_kmh) && route.segment_speeds_kmh.length === n;
    const speeds = backendSpeeds ? route.segment_speeds_kmh.slice() :
      route.segment_durations_sec.map((sec, i) => sec > 0 ? route.segment_distances_km[i] / sec * 3600 : base);
    // A simulated traffic event slower than the assumed speed is always a jam, even when the
    // assumed speed is low (12 of 15 km/h would otherwise count as free flow).
    const sources = Array.isArray(route.segment_speed_sources) ? route.segment_speed_sources : [];
    return Object.assign({}, route, {
      segment_speeds_kmh: speeds,
      segment_status: speeds.map((speed, i) =>
        sources[i] === "simulated" && speed < base ? "jam" : statusFor(speed, base)),
      traffic_applied: Boolean(route.traffic_scenario_id),
    });
  }

  // Display name of segment i from segment_edge_metadata: the road name, else its OSM type.
  function roadName(route, i) {
    const meta = Array.isArray(route.segment_edge_metadata) ? route.segment_edge_metadata[i] : null;
    if (!meta) return "";
    return meta.name || (meta.highway ? String(meta.highway).replace(/_/g, " ") : "");
  }

  // [[lat, lng], [lat, lng]] per affected edge; empty when the backend has no coordinates.
  function eventEdges(route) {
    const edges = route.traffic_event_edge_coordinates;
    return Array.isArray(edges) ? edges.filter((edge) => Array.isArray(edge) && edge.length === 2) : [];
  }

  // One ✕ per closed road: both directions of a road share a midpoint, so marks closer
  // than ~25 m are merged.
  function closedRoadMarks(edges) {
    const marks = [];
    for (const [a, b] of edges) {
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (!marks.some((m) => Math.abs(m[0] - mid[0]) < 2.5e-4 && Math.abs(m[1] - mid[1]) < 2.5e-4)) marks.push(mid);
    }
    return marks;
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

  function compare(first, second) {
    if (!first || !second) return null;
    return {
      extra_km: second.distance_km - first.distance_km,
      saved_sec: first.estimated_time_sec - second.estimated_time_sec,
    };
  }

  function sameRoute(first, second) {
    return Boolean(first && second) && JSON.stringify(first.coordinates) === JSON.stringify(second.coordinates);
  }

  // ---------- Mock data (?mock=1): UI testing without the road network ----------
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

  // Mock speed per segment, mirroring the backend events: peak hour slows the middle of the
  // main road to 12 km/h; a closure blocks the main road so only the detour remains.
  function mockSpeed(event, detour, i, n, speed) {
    const middle = i >= Math.floor(n / 3) && i < Math.ceil(2 * n / 3);
    if (event === "peak_hour" && !detour && middle) return 12;
    if (event === "road_closure") return 40;
    return speed;
  }

  function buildMock(body, event, detour) {
    const coords = mockGeometry(body.start, body.goal, detour);
    const n = coords.length - 1;
    const speed = event === "road_closure" ? 40 : body.speed_kmh;
    const dist = [], speeds = [], durs = [];
    for (let i = 0; i < n; i++) {
      dist.push(haversineKm(coords[i], coords[i + 1]));
      speeds.push(mockSpeed(event, detour, i, n, speed));
      durs.push(dist[i] / speeds[i] * 3600);
    }
    return {
      coordinates: coords,
      segment_edges: coords.slice(1).map((_, i) => [`${detour ? "detour" : "main"}-${i}`, `${detour ? "detour" : "main"}-${i + 1}`]),
      segment_edge_ids: coords.slice(1).map((_, i) => `mock_${detour ? "detour" : "main"}_${i}`),
      segment_edge_metadata: coords.slice(1).map(() => ({ name: detour ? "Mock detour" : "Mock main road", highway: detour ? "secondary" : "primary" })),
      distance_km: dist.reduce((s, x) => s + x, 0),
      start: { id: "mock-start", lat: body.start.lat, lng: body.start.lng, distance_meters: 0 },
      goal: { id: "mock-goal", lat: body.goal.lat, lng: body.goal.lng, distance_meters: 0 },
      algorithm: body.algorithm, objective: body.objective || "distance", speed_kmh: speed,
      segment_distances_km: dist,
      segment_speeds_kmh: speeds,
      segment_speed_sources: speeds.map((v) => v < speed ? "simulated" : "no_live_data_assumed"),
      segment_durations_sec: durs,
      estimated_time_sec: durs.reduce((s, x) => s + x, 0),
      traffic_scenario_id: body.traffic_scenario_id || null,
      traffic_event_type: event === "road_closure" ? "road_closure" : event ? "peak_congestion" : null,
      traffic_event_speed_kmh: event === "peak_hour" ? 12 : null,
      traffic_event_count: event === "road_closure" ? 2 : event ? 4 : 0,
      traffic_event_seed: event === "road_closure" ? 0 : null,
      traffic_event_edges: [],
      traffic_note: "Mock data for UI testing; the road network is not used.",
      mock: true,
    };
  }

  // Mirrors the backend: distance returns the shortest route, time the fastest candidate;
  // a closure removes the main road for both objectives.
  function mockRoute(body) {
    const event = eventOfScenario(body.traffic_scenario_id);
    const main = buildMock(body, event, false);
    const detour = buildMock(body, event, true);
    // Affected part of the main road: its middle third (closed, or slowed at peak hour).
    const n = main.coordinates.length - 1;
    const affected = [];
    for (let i = Math.floor(n / 3); i < Math.ceil(2 * n / 3); i++) affected.push([main.coordinates[i], main.coordinates[i + 1]]);
    const pick = event === "road_closure" ? detour
      : body.objective !== "time" ? main
      : detour.estimated_time_sec < main.estimated_time_sec ? detour : main;
    return Object.assign(pick, { traffic_event_edge_coordinates: event ? affected : [] });
  }

  return {
    EVENTS, OBJECTIVES, STATUS, labelOf, scenarioId, eventOfScenario, statusFor,
    normalize, roadName, eventEdges, closedRoadMarks, colorRuns, compare, sameRoute, mockRoute,
  };
});
