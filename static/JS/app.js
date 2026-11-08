let sessions = loadSessions();

const byId = (id) => document.getElementById(id);
const testCaseSelect = byId("test-case");
const trafficScenarioSelect = byId("traffic-scenario");
const algorithmSelect = byId("algorithm");
const findButton = byId("find-route");
const status = byId("route-status");
const statusText = byId("status-text");
const historyMenu = byId("history-menu");
const historyButton = byId("history-toggle");
const resultsPanel = byId("results-panel");
const closeResultsButton = byId("close-results");
const replayRouteButton = byId("replay-route");
const resetDavidButton = byId("reset-david");
const objectiveSelect = byId("objective");
// ?mock=1 replaces the API with mock data from traffic.js (UI testing without the road network).
const MOCK_MODE = new URLSearchParams(location.search).get("mock") === "1";
trafficScenarioSelect.innerHTML = Traffic.EVENTS.map(item => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join("");
objectiveSelect.innerHTML = Traffic.OBJECTIVES.map(item => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join("");
objectiveSelect.value = "time";

if (closeResultsButton) {
  closeResultsButton.addEventListener("click", () => {
    resultsPanel.hidden = true;
  });
}

// Collapse a panel to its header so the map and the moving vehicle stay visible.
for (const button of document.querySelectorAll(".collapse-button")) {
  button.addEventListener("click", () => {
    const panel = button.closest(".control-panel, .results-panel");
    // Pin the header where it is: the results panel is anchored to the bottom by default.
    const { rect: shellRect, scale } = shellGeometry();
    panel.style.top = `${(panel.getBoundingClientRect().top - shellRect.top) / scale}px`;
    panel.style.bottom = "auto";
    const collapsed = panel.classList.toggle("is-collapsed");
    const name = button.dataset.collapse === "control" ? "route planner" : "route results";
    button.innerHTML = collapsed ? "&plus;" : "&minus;";
    button.title = collapsed ? "Expand" : "Collapse";
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${name}`);
  });
}

const resultBody = byId("results-body");
const map = L.map("hanoi-map", { zoomControl: false }).setView([21.0285, 105.8542], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const initialPoints = [[21.0435, 105.8231], [21.0069, 105.8434]];
let routeLayer = null;
let alternativeLayer = null;
let eventLayer = null;
let availableTestCases = [];
let availableTrafficScenarios = [];

// =========================================================
// David Avatar & Marker Configuration
// =========================================================
const DAVID_IDLE_IMG = "/david/david_run_frame_0.png";
const DAVID_RUN_GIF = "/david/david_run.gif";

const davidIcon = L.divIcon({
  className: "david-marker-wrapper",
  html: `
    <div class="david-character" id="david-avatar-root">
      <div class="david-speech" id="david-speech-bubble" style="display: none;"></div>
      <img src="${DAVID_IDLE_IMG}" class="david-sprite facing-right" id="david-sprite" alt="David" draggable="false" />
      <div class="david-shadow"></div>
    </div>
  `,
  iconSize: [52, 78],
  iconAnchor: [26, 72], // Character's feet touch coordinate point
  tooltipAnchor: [0, -74]
});

// Create David marker for START (index 0)
const davidMarker = L.marker(initialPoints[0], {
  icon: davidIcon,
  positionKey: "dispatch",
  interactive: true,
  zIndexOffset: 1000
}).addTo(map);

davidMarker.startLatLng = L.latLng(initialPoints[0]);

davidMarker
  .bindTooltip("DAVID (START)", {
    permanent: true,
    direction: "top",
    offset: [0, -74],
    className: "route-label david-tooltip"
  })
  .openTooltip();

davidMarker.on("mousedown", startMarkerDrag);
davidMarker.on("touchstart", startMarkerDrag);

// Create Destination Marker for END (index 1)
const endMarker = L.circleMarker(initialPoints[1], {
  positionKey: "hospital",
  radius: 10,
  color: "#000000",
  weight: 2,
  fillColor: "#d84942",
  fillOpacity: 1,
  interactive: true,
  zIndexOffset: 500
}).addTo(map);

endMarker
  .bindTooltip("END", {
    permanent: true,
    direction: "top",
    offset: [0, -8],
    className: "route-label"
  })
  .openTooltip();

endMarker.on("mousedown", startMarkerDrag);
endMarker.on("touchstart", startMarkerDrag);

const checkpointLayers = [davidMarker, endMarker];

checkpointLayers.forEach(marker => {
  renderMarkerPosition(marker, "Waiting for network");
});

// Helper for David Speech bubble
let speechTimeoutId = null;
function showDavidSpeech(text, autoHideMs = 0) {
  const bubble = byId("david-speech-bubble");
  if (!bubble) return;
  bubble.textContent = text;
  bubble.style.display = "block";
  if (speechTimeoutId) {
    clearTimeout(speechTimeoutId);
    speechTimeoutId = null;
  }
  if (autoHideMs > 0) {
    speechTimeoutId = setTimeout(() => {
      bubble.style.display = "none";
    }, autoHideMs);
  }
}

function hideDavidSpeech() {
  const bubble = byId("david-speech-bubble");
  if (bubble) bubble.style.display = "none";
  if (speechTimeoutId) {
    clearTimeout(speechTimeoutId);
    speechTimeoutId = null;
  }
}

function setDavidSprite(isRunning, facing = null) {
  const sprite = byId("david-sprite");
  if (!sprite) return;
  const targetSrc = isRunning ? DAVID_RUN_GIF : DAVID_IDLE_IMG;
  if (!sprite.src.endsWith(targetSrc)) {
    sprite.src = targetSrc;
  }
  if (facing === "left") {
    sprite.classList.remove("facing-right");
    sprite.classList.add("facing-left");
  } else if (facing === "right") {
    sprite.classList.remove("facing-left");
    sprite.classList.add("facing-right");
  }
}

// Start base checkpoint marker when David leaves start point
let startBaseMarker = null;
function showStartBase(latlng) {
  if (!startBaseMarker) {
    const icon = L.divIcon({
      className: "start-base-wrapper",
      html: `<div class="start-base-marker" title="Điểm xuất phát (Click để gọi David về)">START</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    startBaseMarker = L.marker(latlng, { icon, interactive: true, zIndexOffset: 300 }).addTo(map);
    startBaseMarker.on("click", resetDavidToStart);
  } else {
    startBaseMarker.setLatLng(latlng);
    if (!map.hasLayer(startBaseMarker)) {
      startBaseMarker.addTo(map);
    }
  }
}

function hideStartBase() {
  if (startBaseMarker && map.hasLayer(startBaseMarker)) {
    map.removeLayer(startBaseMarker);
  }
}

// Running Animation State
let isDavidRunning = false;
let davidAnimId = null;
let lastCalculatedRoute = null;
let routeVersion = 0;
let simulationSeconds = 0;
let simulationPaused = false;
let previousFrame = null;
const pauseButton = byId("pause-route");
const vehicleSpeed = byId("vehicle-speed");

function updateSimulationControls() {
  byId("simulation-clock").textContent = simulationSeconds.toFixed(1);
  pauseButton.textContent = simulationPaused ? "Resume" : "Pause";
  pauseButton.disabled = !lastCalculatedRoute || (!isDavidRunning && !simulationPaused);
  replayRouteButton.disabled = !lastCalculatedRoute;
}

function invalidateRoute() {
  routeVersion++;
  routingBusy = false;
  byId("button-text").textContent = "Find route";
  cancelDavidRun();
  lastCalculatedRoute = null;
  simulationSeconds = 0;
  checkpointLayers.forEach(marker => {
    marker.snapVersion = (marker.snapVersion || 0) + 1;
    const key = marker.options.positionKey;
    addressVersions[key] = (addressVersions[key] || 0) + 1;
    delete marker.options.graphNodeId;
  });
  if (davidMarker.startLatLng) davidMarker.setLatLng(davidMarker.startLatLng);
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  if (alternativeLayer) { map.removeLayer(alternativeLayer); alternativeLayer = null; }
  if (eventLayer) { map.removeLayer(eventLayer); eventLayer = null; }
  resultsPanel.hidden = true;
  byId("traffic-comparison").hidden = true;
  hideStartBase();
  hideDavidSpeech();
  updateSimulationControls();
  updateFindButton();
}

function cancelDavidRun() {
  if (davidAnimId) {
    cancelAnimationFrame(davidAnimId);
    davidAnimId = null;
  }
  isDavidRunning = false;
  simulationPaused = false;
  previousFrame = null;
  setDavidSprite(false);
}

function resetDavidToStart() {
  routeVersion++;
  routingBusy = false;
  byId("button-text").textContent = "Find route";
  cancelDavidRun();
  simulationSeconds = 0;
  updateSimulationControls();
  updateFindButton();
  hideStartBase();
  hideDavidSpeech();
  const startPos = davidMarker.startLatLng || initialPoints[0];
  davidMarker.setLatLng(startPos);
  setDavidSprite(false, "right");
  renderMarkerPosition(davidMarker);
  updateAddressBar("dispatch", startPos.lat, startPos.lng);
  setStatus("", "DAVID ĐÃ VỀ ĐIỂM XUẤT PHÁT — SẴN SÀNG");
}

function runDavidAlongRoute(route) {
  if (!route || !route.coordinates.length) return;
  cancelDavidRun();
  simulationSeconds = 0;
  byId("current-segment").textContent = "—";
  isDavidRunning = true;
  showStartBase(route.coordinates[0]);
  davidMarker.setLatLng(route.coordinates[0]);
  setDavidSprite(true);
  setStatus("running", "SIMULATION RUNNING");
  updateSimulationControls();
  updateFindButton();
  // The backend's segment times are authoritative, including zero-length edges.
  advanceSimulation(0);
  if (isDavidRunning) davidAnimId = requestAnimationFrame(simulationStep);
}

function advanceSimulation(deltaSeconds) {
  const route = lastCalculatedRoute;
  if (!route) return;
  simulationSeconds = Math.min(route.estimated_time_sec, simulationSeconds + deltaSeconds);
  const coords = route.coordinates;
  let remaining = simulationSeconds;
  let index = 0;
  while (index < route.segment_durations_sec.length && remaining >= route.segment_durations_sec[index]) {
    remaining -= route.segment_durations_sec[index++];
  }
  if (index >= coords.length - 1 || simulationSeconds >= route.estimated_time_sec) {
    davidMarker.setLatLng(coords[coords.length - 1]);
    isDavidRunning = false;
    simulationPaused = false;
    davidAnimId = null;
    setDavidSprite(false);
    showDavidSpeech("Đã đến nơi!", 6000);
    setStatus("complete", "ARRIVED AT DESTINATION");
    // Short final segments can be crossed within one frame, so report the end explicitly.
    const total = route.segment_durations_sec.length;
    byId("current-segment").textContent = `segment ${total}/${total} · arrived`;
  } else {
    const fraction = remaining / route.segment_durations_sec[index];
    const a = coords[index], b = coords[index + 1];
    davidMarker.setLatLng([a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]);
    setDavidSprite(true, b[1] < a[1] ? "left" : "right");
    const state = route.segment_status[index];
    // Road name from the N3 edge metadata (OSM name, else road type), when the backend has it.
    const road = Traffic.roadName(route, index);
    byId("current-segment").textContent =
      `segment ${index + 1}/${route.segment_durations_sec.length}${road ? ` · ${road}` : ""} · ${route.segment_speeds_kmh[index].toFixed(1)} km/h · ${Traffic.STATUS[state].label}`;
  }
  updateSimulationControls();
  updateFindButton();
}

function simulationStep(timestamp) {
  if (!isDavidRunning) return;
  const elapsed = previousFrame === null ? 0 : (timestamp - previousFrame) / 1000;
  previousFrame = timestamp;
  advanceSimulation(elapsed * Number(byId("playback-speed").value));
  if (isDavidRunning) davidAnimId = requestAnimationFrame(simulationStep);
}

pauseButton.addEventListener("click", () => {
  if (isDavidRunning) {
    cancelDavidRun();
    simulationPaused = true;
    setStatus("", "SIMULATION PAUSED");
  } else if (simulationPaused && lastCalculatedRoute) {
    simulationPaused = false;
    isDavidRunning = true;
    previousFrame = null;
    setDavidSprite(true);
    setStatus("running", "SIMULATION RUNNING");
    davidAnimId = requestAnimationFrame(simulationStep);
  }
  updateSimulationControls();
  updateFindButton();
});

function replayDavidRun() {
  if (lastCalculatedRoute && lastCalculatedRoute.coordinates) {
    runDavidAlongRoute(lastCalculatedRoute);
  }
}

if (replayRouteButton) {
  replayRouteButton.addEventListener("click", replayDavidRun);
}

if (resetDavidButton) {
  resetDavidButton.addEventListener("click", resetDavidToStart);
}

function renderMarkerPosition(marker, nodeStatus) {
  const key = marker.options.positionKey;
  const point = marker.getLatLng();
  const lat = point.lat.toFixed(7);
  const lng = point.lng.toFixed(7);

  const latBar = byId(`${key}-lat-bar`);
  const lngBar = byId(`${key}-lng-bar`);

  if (latBar) latBar.textContent = lat;
  if (lngBar) lngBar.textContent = lng;
}

const addressVersions = {};
async function updateAddressBar(key, lat, lng) {
  const version = addressVersions[key] = (addressVersions[key] || 0) + 1;
  try {
    const data = await apiJson(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=vi`
    );

    if (addressVersions[key] !== version) return;
    byId(`${key}-address-bar`).textContent =
      data.display_name || "Address unavailable";
  } catch {
    if (addressVersions[key] !== version) return;
    byId(`${key}-address-bar`).textContent = "Address unavailable";
  }
}

// Drag handling for Leaflet markers
let activeMarker = null;

function startMarkerDrag(event) {
  if (routingBusy || isDavidRunning) return;
  invalidateRoute();
  testCaseSelect.value = "custom";
  trafficScenarioSelect.value = "";
  syncClosureSpeedControl();
  updateTrafficScenarioNote();
  activeMarker = event.target;
  activeMarker.snapVersion = (activeMarker.snapVersion || 0) + 1;
  delete activeMarker.options.graphNodeId;

  if (activeMarker === davidMarker) {
    const avatar = byId("david-avatar-root");
    if (avatar) avatar.classList.add("is-dragging");
    hideDavidSpeech();
    hideStartBase();
  }

  renderMarkerPosition(activeMarker, "Dragging — release to snap");
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  resultsPanel.hidden = true;

  map.dragging.disable();

  map.on("mousemove", moveMarker);
  map.on("touchmove", moveMarker);

  map.once("mouseup", stopMarkerDrag);
  map.once("touchend", stopMarkerDrag);
}

function moveMarker(event) {
  if (!activeMarker) return;

  const position = event.latlng;

  if (position) {
    activeMarker.setLatLng(position);
    if (activeMarker === davidMarker) {
      davidMarker.startLatLng = position;
    }
    renderMarkerPosition(activeMarker, "Dragging — release to snap");
  }
}

let networkReady = false;
let routingBusy = false;
let pendingSnaps = 0;
findButton.disabled = true;

function updateFindButton() {
  findButton.disabled = !networkReady || routingBusy || isDavidRunning || pendingSnaps > 0;
}

async function apiJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail :
    Array.isArray(data.detail) ? data.detail.map(error => `${error.loc.join(".")}: ${error.msg}`).join("; ") : "Invalid request");
  return data;
}

async function stopMarkerDrag() {
  const marker = activeMarker;
  activeMarker = null;
  map.dragging.enable();
  map.off("mousemove", moveMarker);
  map.off("touchmove", moveMarker);

  if (marker === davidMarker) {
    const avatar = byId("david-avatar-root");
    if (avatar) avatar.classList.remove("is-dragging");
  }

  if (!marker) return;
  if (!networkReady) {
    renderMarkerPosition(marker, "Waiting for network");
    return;
  }
  await snapMarker(marker);
}

async function snapMarker(marker) {
  if (MOCK_MODE) return;
  const version = marker.snapVersion;
  const position = marker.getLatLng();
  renderMarkerPosition(marker, "Finding nearest node…");
  pendingSnaps += 1;
  updateFindButton();
  try {
    const nearest = await apiJson("/api/nearest?" + new URLSearchParams({
      lat: position.lat, lng: position.lng,
    }));
    if (marker.snapVersion !== version) return;
    marker.setLatLng([nearest.lat, nearest.lng]);
    if (marker === davidMarker) {
      davidMarker.startLatLng = L.latLng(nearest.lat, nearest.lng);
    }
    marker.options.graphNodeId = nearest.id;
    renderMarkerPosition(marker);
    updateAddressBar(
      marker.options.positionKey,
      nearest.lat,
      nearest.lng
    );    
  } catch (error) {
    if (marker.snapVersion === version) {
      renderMarkerPosition(marker, "Node unavailable — move to retry");
      setStatus("error", error.message);
    }
  } finally {
    pendingSnaps -= 1;
    updateFindButton();
  }
}

async function checkNetwork() {
  if (MOCK_MODE) {
    // Mock data needs no road graph: skip the network check and node snapping.
    networkReady = true;
    updateFindButton();
    setStatus("", "MOCK MODE — SIMULATED TRAFFIC, NOT REAL RESULTS");
    return;
  }
  try {
    const data = await apiJson("/api/network/status");
    networkReady = data.status === "ready";
    updateFindButton();
    if (networkReady) {
      setStatus("", "READY — DRAG DAVID & END MARKER TO CHOOSE YOUR ROUTE");
      await Promise.all(checkpointLayers.filter(marker => marker !== activeMarker).map(snapMarker));
      return;
    }
    if (data.status === "error") {
      setStatus("error", "ROAD NETWORK COULD NOT BE LOADED");
      checkpointLayers.forEach(marker => renderMarkerPosition(marker, "Network unavailable"));
      return;
    }
    setStatus("running", "PREPARING ROUTING — MAP IS READY TO EXPLORE");
  } catch (error) {
    setStatus("error", "CONNECTING TO ROUTING SERVER...");
  }
  window.setTimeout(checkNetwork, 2000);
}
checkNetwork();

function loadSessions() {
  try {
    const saved = sessionStorage.getItem("ambufind-sessions");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveSessions() {
  try {
    sessionStorage.setItem(
      "ambufind-sessions",
      JSON.stringify(sessions.slice(-30))
    );
  } catch {
    // Session history still works for the current tab.
  }
}

function renderHistory() {
  const count = sessions.length;
  byId("history-count").textContent = count;
  byId("history-menu-count").textContent = count;
  const list = byId("history-list");
  if (!count) {
    list.innerHTML = '<div class="history-empty">No sessions recorded yet</div>';
    return;
  }
  list.innerHTML = [...sessions].reverse().map((session, index) => `
    <article class="history-entry">
      <span class="history-entry-index">${count - index}</span>
      <div class="history-entry-main">
        <div class="history-entry-case" title="${escapeHtml(session.testCase)}">${escapeHtml(session.testCase)}</div>
        <div class="history-entry-meta">${escapeHtml(session.algorithm)}${session.objective ? ` &middot; ${escapeHtml(Traffic.labelOf(Traffic.EVENTS, Traffic.eventOfScenario(session.scenario)))} / ${escapeHtml(Traffic.labelOf(Traffic.OBJECTIVES, session.objective))}` : ""} &middot; ${escapeHtml(session.timestamp)}</div>
      </div>
      <span class="history-entry-meta">${session.routes}R</span>
    </article>`).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function formatDuration(sec) {
  const minutes = Math.floor(sec / 60);
  return minutes ? `${minutes} min ${(sec % 60).toFixed(0)} s` : `${sec.toFixed(1)} s`;
}

function speedSummary(route) {
  const speeds = [...new Set(route.segment_speeds_kmh.map(speed => Number(speed.toFixed(1))))].sort((x, y) => x - y);
  return speeds.length ? `${speeds.join(" / ")} km/h` : `${route.speed_kmh} km/h`;
}

// routes = { distance, time }; selected = the chosen objective (the route David runs);
// baseline = the same objective with no traffic event, when an event is selected.
function renderResults(routes, selected, baseline = null) {
  resultBody.innerHTML = Traffic.OBJECTIVES.map(({ id }) => {
    const route = routes[id];
    if (!route) return `<tr><td>${escapeHtml(Traffic.labelOf(Traffic.OBJECTIVES, id))}</td><td colspan="5">Route unavailable</td></tr>`;
    const jam = route.segment_status.filter(state => state === "jam").length;
    const slow = route.segment_status.filter(state => state === "slow").length;
    return `<tr class="${id === selected ? "is-selected" : ""}">
      <td>${id === selected ? "▶ " : ""}${escapeHtml(Traffic.labelOf(Traffic.OBJECTIVES, id))}</td>
      <td>${route.distance_km.toFixed(2)} km</td><td>${escapeHtml(route.algorithm)}</td>
      <td>${formatDuration(route.estimated_time_sec)}</td><td>${escapeHtml(speedSummary(route))}</td>
      <td>${jam} / ${slow}</td></tr>`;
  }).join("");

  const main = routes[selected];
  const event = Traffic.eventOfScenario(main.traffic_scenario_id);
  const isClosure = main.traffic_event_type === "road_closure";
  const eventDetail = !main.traffic_scenario_id ? "" : isClosure
    ? ` · ${main.traffic_event_count} roads closed, seed ${escapeHtml(main.traffic_event_seed)}`
    : ` · ${main.traffic_event_speed_kmh} km/h on ${main.traffic_event_count} segments`;
  const source = main.mock ? '<span class="mock-badge">MOCK DATA</span>' :
    main.traffic_applied ? "API, simulated traffic" : "API, fixed speed (no event)";
  byId("route-inputs").innerHTML =
    `Inputs: <b>${escapeHtml(testCaseSelect.value === "custom" ? "Custom route" : testCaseSelect.value)}</b>` +
    ` · traffic <b>${escapeHtml(Traffic.labelOf(Traffic.EVENTS, event))}</b>${eventDetail}` +
    ` · objective <b>${escapeHtml(Traffic.labelOf(Traffic.OBJECTIVES, selected))}</b> · source ${source}`;

  const diff = Traffic.compare(routes.distance, routes.time);
  byId("route-compare").textContent = !diff ? "" :
    Traffic.sameRoute(routes.distance, routes.time) || (Math.abs(diff.extra_km) < 0.005 && Math.abs(diff.saved_sec) < 0.5)
      ? "Both objectives give the same route in this scenario." :
    diff.saved_sec > 0 && Math.abs(diff.extra_km) < 0.005 ? `The fastest route takes other roads of the same length and arrives ${formatDuration(diff.saved_sec)} earlier.` :
    diff.saved_sec > 0 && diff.extra_km < 0 ? `The fastest route is ${(-diff.extra_km).toFixed(2)} km shorter and arrives ${formatDuration(diff.saved_sec)} earlier.` :
    diff.saved_sec > 0 ? `The fastest route is ${diff.extra_km.toFixed(2)} km longer but arrives ${formatDuration(diff.saved_sec)} earlier.` :
    `The shortest route is also the fastest (by ${formatDuration(-diff.saved_sec)}).`;

  const comparison = byId("traffic-comparison");
  comparison.hidden = !baseline;
  if (baseline) {
    const etaDelta = main.estimated_time_sec - baseline.estimated_time_sec;
    const distanceDelta = main.distance_km - baseline.distance_km;
    comparison.textContent =
      `Without the event: ${formatDuration(baseline.estimated_time_sec)}, ${baseline.distance_km.toFixed(2)} km. ` +
      `With it: ${formatDuration(main.estimated_time_sec)}, ${main.distance_km.toFixed(2)} km ` +
      `(${etaDelta >= 0 ? "+" : "−"}${formatDuration(Math.abs(etaDelta))}; ${distanceDelta >= 0 ? "+" : "−"}${Math.abs(distanceDelta).toFixed(2)} km). ` +
      `Route changed: ${Traffic.sameRoute(main, baseline) ? "no" : "yes"}.`;
  }
  const closedEdges = isClosure && main.traffic_event_edges.length
    ? ` Closed directed edges: ${main.traffic_event_edges.map((edge) => edge.join(" → ")).join(", ")}.`
    : "";
  byId("traffic-result-note").textContent = (main.traffic_note || "") + closedEdges;
  resultsPanel.hidden = false;
}

async function requestRoute(body) {
  const raw = MOCK_MODE ? Traffic.mockRoute(body) : await apiJson("/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return Traffic.normalize(raw);
}

// Roads affected by the traffic event, drawn even where the route avoids them:
// closed roads in black with a ✕, peak-hour segments as a thin red outline.
function drawTrafficEvent(route) {
  const edges = Traffic.eventEdges(route);
  if (!edges.length) return null;
  const closed = route.traffic_event_type === "road_closure";
  const group = L.featureGroup();
  for (const [a, b] of edges) {
    if (closed) {
      L.polyline([a, b], { color: "#111418", weight: 9, opacity: 0.9, lineCap: "butt" }).addTo(group);
      L.polyline([a, b], { color: "#ffffff", weight: 2, opacity: 0.9, dashArray: "4 6" }).addTo(group);
    } else {
      L.polyline([a, b], { color: Traffic.STATUS.jam.color, weight: 3, opacity: 0.85, dashArray: "2 6" }).addTo(group);
    }
  }
  if (closed) {
    for (const point of Traffic.closedRoadMarks(edges)) {
      L.marker(point, {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: "closed-road-mark", html: "✕", iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).addTo(group);
    }
  }
  return group.addTo(map);
}

// Selected route: solid, coloured by segment status. Alternative: thinner dashed line in the
// same colours, so a jam the fastest route avoids is still visible on the map.
function drawColoredRoute(route, alternative = false) {
  const group = L.featureGroup();
  for (const run of Traffic.colorRuns(route)) {
    L.polyline(run.coords, alternative
      ? { color: Traffic.STATUS[run.status].color, weight: 4, opacity: 0.7, dashArray: "8 8" }
      : { color: Traffic.STATUS[run.status].color, weight: 6, opacity: 0.95, lineCap: "round", lineJoin: "round" },
    ).addTo(group);
  }
  return group.addTo(map);
}

function setStatus(kind, message) {
  status.className = `route-status ${kind}`.trim();
  statusText.textContent = message;
}

function setTheme(theme) {
  document.body.dataset.theme = theme;
  const light = theme === "light";
  byId("theme-toggle").textContent = light ? "☾" : "☼";
  byId("theme-toggle").setAttribute("aria-label", `Switch to ${light ? "dark" : "light"} mode`);
  try { localStorage.setItem("ambufind-theme", theme); } catch { /* Theme applies for this page. */ }
}

// Make a panel draggable using its header as the handle
// The app shell may be scaled with CSS (--ui-scale); convert screen pixels to layout pixels.
function shellGeometry() {
  const shell = document.querySelector(".app-shell");
  const rect = shell.getBoundingClientRect();
  return { rect, scale: rect.width / shell.offsetWidth || 1, width: shell.offsetWidth, height: shell.offsetHeight };
}

function makeDraggable(panel, handle) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest("button")) return;

    const { rect: shellRect, scale } = shellGeometry();
    const panelRect = panel.getBoundingClientRect();

    panel.style.left = `${(panelRect.left - shellRect.left) / scale}px`;
    panel.style.top = `${(panelRect.top - shellRect.top) / scale}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";

    offsetX = (event.clientX - panelRect.left) / scale;
    offsetY = (event.clientY - panelRect.top) / scale;

    dragging = true;
    panel.classList.add("is-dragging");

    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;

    const { rect: shellRect, scale, width, height } = shellGeometry();
    const maxX = width - panel.offsetWidth;
    const maxY = height - panel.offsetHeight;
    const x = Math.max(0, Math.min((event.clientX - shellRect.left) / scale - offsetX, maxX));
    const y = Math.max(0, Math.min((event.clientY - shellRect.top) / scale - offsetY, maxY));

    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  });

  function stopDragging() {
    dragging = false;
    panel.classList.remove("is-dragging");
  }

  handle.addEventListener("pointerup", stopDragging);
  handle.addEventListener("pointercancel", stopDragging);
  handle.addEventListener("lostpointercapture", stopDragging);
}

makeDraggable(
  document.querySelector(".control-panel"),
  document.querySelector(".panel-heading")
);

makeDraggable(
  historyMenu,
  document.querySelector(".history-window-head")
);

makeDraggable(
  document.querySelector(".results-panel"),
  document.querySelector(".results-head")
);

async function findRoute() {
  if (!networkReady || routingBusy || isDavidRunning || pendingSnaps || activeMarker) return;
  vehicleSpeed.setCustomValidity(Number(vehicleSpeed.value) > 0 && Number.isFinite(Number(vehicleSpeed.value)) ? "" : "Speed must be finite and greater than zero.");
  if (!vehicleSpeed.reportValidity()) return;
  invalidateRoute();
  const version = routeVersion;
  const selectedCase = testCaseSelect.value;
  const selectedTrafficScenario = getSelectedTrafficScenario();
  routingBusy = true;
  updateFindButton();
  byId("button-text").textContent = "Computing route...";
  setStatus("running", "COMPUTING ROUTE");
  historyMenu.hidden = true;
  historyButton.setAttribute("aria-expanded", "false");
  resultsPanel.hidden = true;
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  hideStartBase();
  hideDavidSpeech();

  try {
    // Make sure we use the origin start position if David was at the end
    const startPoint = davidMarker.startLatLng || davidMarker.getLatLng();
    const goalPoint = endMarker.getLatLng();

    const start = { lat: startPoint.lat, lng: startPoint.lng };
    const goal = { lat: goalPoint.lat, lng: goalPoint.lng };

    const selected = objectiveSelect.value;
    const requestBody = {
      start, goal, algorithm: algorithmSelect.value,
      speed_kmh: Number(vehicleSpeed.value),
      traffic_scenario_id: selectedTrafficScenario?.id || null,
    };
    // Both objectives for the comparison table, plus the selected objective without the
    // event (baseline) so the effect of the traffic event is visible.
    const requests = Traffic.OBJECTIVES.map(({ id }) => requestRoute({ ...requestBody, objective: id }));
    if (selectedTrafficScenario) {
      requests.push(requestRoute({ ...requestBody, traffic_scenario_id: null, objective: selected }));
    }
    const settled = await Promise.allSettled(requests);
    if (version !== routeVersion) return;
    const routes = {};
    Traffic.OBJECTIVES.forEach(({ id }, i) => {
      if (settled[i].status === "fulfilled") routes[id] = settled[i].value;
    });
    const result = routes[selected];
    if (!result) throw settled[Traffic.OBJECTIVES.findIndex(({ id }) => id === selected)].reason;
    const other = routes[selected === "time" ? "distance" : "time"];
    const baselineResult = selectedTrafficScenario && settled[2].status === "fulfilled" ? settled[2].value : null;

    // Update markers to snap locations
    davidMarker.setLatLng([result.start.lat, result.start.lng]);
    davidMarker.startLatLng = L.latLng(result.start.lat, result.start.lng);
    endMarker.setLatLng([result.goal.lat, result.goal.lng]);

    davidMarker.options.graphNodeId = result.start.id;
    endMarker.options.graphNodeId = result.goal.id;
    checkpointLayers.forEach(marker => {
      renderMarkerPosition(marker);
      const position = marker.getLatLng();
      updateAddressBar(marker.options.positionKey, position.lat, position.lng);
    });

    // Alternative objective: faint dashed line; selected route: coloured by segment status.
    if (other && !Traffic.sameRoute(other, result)) {
      alternativeLayer = drawColoredRoute(other, true);
    }
    routeLayer = drawColoredRoute(result);
    eventLayer = drawTrafficEvent(result);

    const bounds = routeLayer.getBounds();
    if (alternativeLayer) bounds.extend(alternativeLayer.getBounds());
    map.fitBounds(bounds, { padding: [90, 90], maxZoom: 14 });
    renderResults(routes, selected, baselineResult);

    sessions.push({
      testCase: selectedTrafficScenario
        ? `${selectedCase} - ${result.traffic_event_type === "road_closure" ? "Road closure" : "Peak-hour traffic 12 km/h"}`
        : selectedCase || "Custom marker route",
      scenario: result.traffic_scenario_id,
      objective: selected,
      algorithm: result.algorithm,
      speed_kmh: result.speed_kmh,
      estimated_time_sec: result.estimated_time_sec,
      timestamp: new Date().toLocaleString(),
      routes: Object.keys(routes).length + (baselineResult ? 1 : 0),
    });
    sessions = sessions.slice(-30);
    saveSessions();
    renderHistory();

    lastCalculatedRoute = result;

    // Trigger David running animation!
    runDavidAlongRoute(result);

  } catch (error) {
    if (version === routeVersion) setStatus("error", error.message);
  } finally {
    if (version !== routeVersion) return;
    routingBusy = false;
    byId("button-text").textContent = "Find route";
    updateFindButton();
  }
}

byId("close-history").addEventListener("click", () => {
  historyMenu.hidden = true;
  historyButton.setAttribute("aria-expanded", "false");
});

historyButton.addEventListener("click", () => {
  const open = historyMenu.hidden;
  historyMenu.hidden = !open;
  historyButton.setAttribute("aria-expanded", String(open));
});

byId("theme-toggle").addEventListener("click", () => {
  setTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
});

findButton.addEventListener("click", findRoute);

function setMarkerPosition(marker, coords, label) {
  marker.snapVersion = (marker.snapVersion || 0) + 1;
  const [lat, lng] = coords;
  marker.setLatLng([lat, lng]);
  if (marker === davidMarker) {
    davidMarker.startLatLng = L.latLng(lat, lng);
  }
  if (label) {
    marker.bindTooltip(label, {
      permanent: true,
      direction: "top",
      offset: marker === davidMarker ? [0, -74] : [0, -8],
      className: marker === davidMarker ? "route-label david-tooltip" : "route-label"
    }).openTooltip();
  }
  renderMarkerPosition(marker);
  updateAddressBar(marker.options.positionKey, lat, lng);
}

function applyTestCaseSelection() {
  invalidateRoute();
  hideStartBase();
  hideDavidSpeech();

  const selected = testCaseSelect.value;
  if (!selected || selected === "custom") return;

  const match = availableTestCases.find(
    (caseItem) => caseItem.case_id === selected || caseItem.id === selected
  );

  if (!match) return;

  // START = emergency target
  // END = hospital
  const targetCoords = match.emergency_target.coords;
  const hospitalCoords = match.hospital.coords;

  setMarkerPosition(
    checkpointLayers[0],
    targetCoords,
    `DAVID (START)\nTARGET — ${match.case_id}`
  );

  setMarkerPosition(
    checkpointLayers[1],
    hospitalCoords,
    `END\n${match.hospital.name || "Hospital"}`
  );

  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }

  resultsPanel.hidden = true;

  map.fitBounds(
    L.latLngBounds(targetCoords, hospitalCoords),
    { padding: [60, 60], maxZoom: 15 }
  );

  setStatus("", `SCENARIO ${match.case_id} LOADED — READY TO FIND ROUTE`);
}

async function loadTestCases() {
  try {
    const data = await apiJson("/api/test-cases");
    if (data && Array.isArray(data.cases)) {
      availableTestCases = data.cases;
    } else if (Array.isArray(data)) {
      availableTestCases = data;
    }
  } catch (error) {
    availableTestCases = [];
  }

  testCaseSelect.innerHTML =
    '<option value="custom">Custom marker route</option>' +
    availableTestCases.map((caseItem) => {
      const id = caseItem.case_id || caseItem.id || "case";
      const label = `${id} - ${caseItem.description || caseItem.name || "Scenario"}`;
      return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
    }).join("");

  testCaseSelect.value = "custom";
}

function updateTrafficScenarioNote() {
  if (MOCK_MODE) {
    byId("scenario-note").textContent = "MOCK MODE: straight-line routes and simulated speeds for UI testing.";
    return;
  }
  const caseId = testCaseSelect.value;
  const scenario = getSelectedTrafficScenario();
  if (!trafficScenarioSelect.value) {
    byId("scenario-note").textContent = "No live traffic speeds; the assumed speed is used on every segment.";
  } else if (!scenario) {
    byId("scenario-note").textContent = "Select TC01, TC02, or TC03 to run this traffic case.";
  } else if (scenario.kind === "road_closure") {
    byId("scenario-note").textContent = `${caseId}: closes ${scenario.closed_road_count} randomly selected roads using fixed seed ${scenario.random_seed}; remaining roads are fixed at 40 km/h.`;
  } else {
    byId("scenario-note").textContent = `${caseId}: simulated 12 km/h on ${scenario.event_edges.length} directed peak-hour segments; remaining roads use the assumed speed.`;
  }
}

function getSelectedTrafficScenario() {
  if (!trafficScenarioSelect.value || testCaseSelect.value === "custom") {
    return null;
  }
  const id = Traffic.scenarioId(trafficScenarioSelect.value, testCaseSelect.value);
  // Mock mode has no scenario catalogue; the ID alone drives the mock data.
  if (MOCK_MODE) return id ? { id } : null;
  return availableTrafficScenarios.find((item) => item.id === id) || null;
}

async function loadTrafficScenarios() {
  if (MOCK_MODE) return;
  try {
    availableTrafficScenarios = await apiJson("/api/traffic-scenarios");
    if (!Array.isArray(availableTrafficScenarios) || availableTrafficScenarios.length !== 6) {
      throw new Error("Expected traffic scenarios for TC01-TC03");
    }
  } catch (error) {
    availableTrafficScenarios = [];
    trafficScenarioSelect.disabled = true;
    // Usually an old server process that predates /api/traffic-scenarios: restart it.
    byId("scenario-note").textContent = "Traffic events unavailable (restart the server if the code was just updated); fixed-speed routing still works.";
    return;
  }
  updateTrafficScenarioNote();
}

function syncClosureSpeedControl() {
  const closureSelected = trafficScenarioSelect.value === "road_closure";
  if (closureSelected) vehicleSpeed.value = "40";
  vehicleSpeed.disabled = closureSelected;
}

testCaseSelect.addEventListener("change", () => {
  if (testCaseSelect.value === "custom" && trafficScenarioSelect.value) {
    trafficScenarioSelect.value = "";
  }
  applyTestCaseSelection();
  syncClosureSpeedControl();
  updateTrafficScenarioNote();
  if (testCaseSelect.value === "custom") setStatus("", "READY TO FIND ROUTE");
});

trafficScenarioSelect.addEventListener("change", () => {
  if (trafficScenarioSelect.value && testCaseSelect.value === "custom") {
    testCaseSelect.value = "TC01";
  }
  applyTestCaseSelection();
  syncClosureSpeedControl();
  updateTrafficScenarioNote();
  setStatus("", "READY TO FIND ROUTE");
});

for (const input of [algorithmSelect, vehicleSpeed, objectiveSelect]) {
  input.addEventListener("change", () => {
    invalidateRoute();
    updateTrafficScenarioNote();
    setStatus("", "READY TO FIND ROUTE");
  });
}

byId("zoom-in").addEventListener("click", () => {
  map.zoomIn();
});
byId("zoom-out").addEventListener("click", () => {
  map.zoomOut();
});

try {
  setTheme(localStorage.getItem("ambufind-theme") || "dark");
} catch {
  setTheme("dark");
}
loadTestCases();
loadTrafficScenarios();
syncClosureSpeedControl();
renderHistory();

updateSimulationControls();
