let sessions = loadSessions();

const FALLBACK_TEST_CASES = {
  cases: [
    {
      case_id: "TC01",
      description: "Normal route",
      hospital: { id: 8502010001, name: "Bach Mai Hospital", coords: [21.0058, 105.8501], verified: true },
      emergency_target: { id: 8502010002, coords: [21.0126, 105.8678] },
    },
    {
      case_id: "TC02",
      description: "One-way detour",
      hospital: { id: 8502010008, name: "Vietnam-Germany Hospital", coords: [21.0175, 105.8472], verified: true },
      emergency_target: { id: 8502010009, coords: [21.0241, 105.8604] },
    },
    {
      case_id: "TC03",
      description: "Obstacle bypass",
      hospital: { id: 8502010012, name: "Saint Paul General Hospital", coords: [21.0308, 105.8445], verified: true },
      emergency_target: { id: 8502010013, coords: [21.0383, 105.8597] },
    },
  ],
};

const byId = (id) => document.getElementById(id);
const testCaseSelect = byId("test-case");
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

if (closeResultsButton) {
  closeResultsButton.addEventListener("click", () => {
    resultsPanel.hidden = true;
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
let availableTestCases = FALLBACK_TEST_CASES.cases;

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

function cancelDavidRun() {
  if (davidAnimId) {
    cancelAnimationFrame(davidAnimId);
    davidAnimId = null;
  }
  isDavidRunning = false;
  setDavidSprite(false);
}

function resetDavidToStart() {
  cancelDavidRun();
  hideStartBase();
  hideDavidSpeech();
  const startPos = davidMarker.startLatLng || initialPoints[0];
  davidMarker.setLatLng(startPos);
  setDavidSprite(false, "right");
  renderMarkerPosition(davidMarker);
  updateAddressBar("dispatch", startPos.lat, startPos.lng);
  setStatus("", "DAVID ĐÃ VỀ ĐIỂM XUẤT PHÁT — SẴN SÀNG");
}

function runDavidAlongRoute(coords) {
  if (!coords || coords.length < 2) return;
  cancelDavidRun();
  isDavidRunning = true;

  // Show Start base marker at origin
  showStartBase(coords[0]);
  davidMarker.setLatLng(coords[0]);
  setDavidSprite(true);
  showDavidSpeech("Đang chạy tới đích! 🏃💨");
  setStatus("running", "DAVID ĐANG CHẠY ĐẾN ĐIỂM ĐÍCH...");

  // Compute cumulative distances
  const cumDistances = [0];
  let totalDist = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = L.latLng(coords[i]);
    const p2 = L.latLng(coords[i + 1]);
    const d = p1.distanceTo(p2);
    totalDist += d;
    cumDistances.push(totalDist);
  }

  // Duration scales dynamically between 3.2s and 6.5s
  const duration = Math.min(6500, Math.max(3200, totalDist * 0.65));
  let startTime = null;

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1.0);
    const targetDist = progress * totalDist;

    // Find current line segment
    let idx = 0;
    while (idx < cumDistances.length - 1 && cumDistances[idx + 1] < targetDist) {
      idx++;
    }

    const segStartDist = cumDistances[idx];
    const segEndDist = cumDistances[idx + 1] || (segStartDist + 0.0001);
    const segProgress = (targetDist - segStartDist) / (segEndDist - segStartDist || 1);

    const p1 = coords[idx];
    const p2 = coords[Math.min(idx + 1, coords.length - 1)];

    const curLat = p1[0] + (p2[0] - p1[0]) * segProgress;
    const curLng = p1[1] + (p2[1] - p1[1]) * segProgress;

    davidMarker.setLatLng([curLat, curLng]);

    // Face direction of movement
    const dlng = p2[1] - p1[1];
    if (dlng > 0.00003) {
      setDavidSprite(true, "right");
    } else if (dlng < -0.00003) {
      setDavidSprite(true, "left");
    }

    if (progress < 1.0) {
      davidAnimId = requestAnimationFrame(step);
    } else {
      // Arrived at destination!
      isDavidRunning = false;
      davidAnimId = null;
      davidMarker.setLatLng(coords[coords.length - 1]);
      setDavidSprite(false);
      showDavidSpeech("Đã đến nơi! 🏁✨", 6000);
      setStatus("complete", "DAVID ĐÃ ĐẾN ĐIỂM ĐÍCH! (HOÀN THÀNH)");
    }
  }

  davidAnimId = requestAnimationFrame(step);
}

function replayDavidRun() {
  if (lastCalculatedRoute && lastCalculatedRoute.coordinates) {
    runDavidAlongRoute(lastCalculatedRoute.coordinates);
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

async function updateAddressBar(key, lat, lng) {
  try {
    const data = await apiJson(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=vi`
    );

    byId(`${key}-address-bar`).textContent =
      data.display_name || "Address unavailable";
  } catch {
    byId(`${key}-address-bar`).textContent = "Address unavailable";
  }
}

// Drag handling for Leaflet markers
let activeMarker = null;

function startMarkerDrag(event) {
  if (routingBusy || isDavidRunning) return;
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
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Invalid request");
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
        <div class="history-entry-meta">${escapeHtml(session.algorithm)} &middot; ${escapeHtml(session.timestamp)}</div>
      </div>
      <span class="history-entry-meta">${session.routes}R</span>
    </article>`).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function renderResults(route) {
  const distance = route.distance_km.toFixed(2) + " km";
  resultBody.innerHTML = `<tr><td>1</td><td>${distance}</td><td>${escapeHtml(algorithmSelect.selectedOptions[0].textContent)}</td><td>${route.coordinates.length}</td></tr>`;
  resultsPanel.hidden = false;
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
function makeDraggable(panel, handle) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest("button")) return;

    const panelRect = panel.getBoundingClientRect();
    const shellRect = document
      .querySelector(".app-shell")
      .getBoundingClientRect();

    panel.style.left = `${panelRect.left - shellRect.left}px`;
    panel.style.top = `${panelRect.top - shellRect.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";

    offsetX = event.clientX - panelRect.left;
    offsetY = event.clientY - panelRect.top;

    dragging = true;
    panel.classList.add("is-dragging");

    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;

    const shellRect = document
      .querySelector(".app-shell")
      .getBoundingClientRect();

    const panelRect = panel.getBoundingClientRect();

    const maxX = shellRect.width - panelRect.width;
    const maxY = shellRect.height - panelRect.height;

    const x = Math.max(
      0,
      Math.min(
        event.clientX - shellRect.left - offsetX,
        maxX
      )
    );

    const y = Math.max(
      0,
      Math.min(
        event.clientY - shellRect.top - offsetY,
        maxY
      )
    );

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

// Enable dragging for panels
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
  cancelDavidRun();
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

    const result = await apiJson("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start, goal, algorithm: algorithmSelect.value }),
    });

    // Update markers to snap locations
    davidMarker.setLatLng([result.start.lat, result.start.lng]);
    davidMarker.startLatLng = L.latLng(result.start.lat, result.start.lng);
    endMarker.setLatLng([result.goal.lat, result.goal.lng]);

    davidMarker.options.graphNodeId = result.start.id;
    endMarker.options.graphNodeId = result.goal.id;
    checkpointLayers.forEach(marker => renderMarkerPosition(marker));

    // Draw route polyline
    routeLayer = L.polyline(result.coordinates, {
      color: "#e34b45", weight: 5, opacity: 0.92, lineCap: "round", lineJoin: "round",
    }).addTo(map);

    map.fitBounds(routeLayer.getBounds(), { padding: [90, 90], maxZoom: 14 });
    renderResults(result);

    sessions.push({
      testCase: testCaseSelect.value || "Custom marker route",
      algorithm: algorithmSelect.selectedOptions[0].textContent,
      timestamp: new Date().toLocaleString(),
      routes: 1,
    });
    sessions = sessions.slice(-30);
    saveSessions();
    renderHistory();

    lastCalculatedRoute = result;

    // Trigger David running animation!
    runDavidAlongRoute(result.coordinates);

  } catch (error) {
    setStatus("error", error.message);
  } finally {
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
  cancelDavidRun();
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
    availableTestCases = FALLBACK_TEST_CASES.cases;
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

testCaseSelect.addEventListener("change", () => {
  if (testCaseSelect.value === "custom") {
    if (networkReady && !routingBusy && !isDavidRunning) setStatus("", "READY TO FIND ROUTE");
    return;
  }
  applyTestCaseSelection();
});

algorithmSelect.addEventListener("change", () => {
  if (networkReady && !routingBusy && !isDavidRunning) setStatus("", "READY TO FIND ROUTE");
});

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
renderHistory();
