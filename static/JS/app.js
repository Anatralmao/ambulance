let sessions = loadSessions();

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

closeResultsButton.addEventListener("click", () => {
  resultsPanel.hidden = true;
});
const resultBody = byId("results-body");
const map = L.map("hanoi-map", { zoomControl: false }).setView([21.0285, 105.8542], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const initialPoints = [[21.0435, 105.8231], [21.0069, 105.8434]];
let routeLayer;

const routeMarkers = [
  { point: initialPoints[0], label: "DISPATCH", color: "#26845f" },
  {
    point: initialPoints[initialPoints.length - 1],
    label: "HOSPITAL",
    color: "#d84942"
  },
];

const checkpointLayers = [];

routeMarkers.forEach(({ point, label, color }, index) => {
  const marker = L.circleMarker(point, {
    positionKey: index === 0 ? "dispatch" : "hospital",
    radius: 10,
    color: "#000000",
    weight: 2,
    fillColor: color,
    fillOpacity: 1,

    // Allow this marker to receive mouse/touch interactions.
    interactive: true
  }).addTo(map);

  marker
    .bindTooltip(label, {
      permanent: true,
      direction: "top",
      offset: [0, -8],
      className: "route-label"
    })
    .openTooltip();

  // Make the checkpoint movable.
  marker.on("mousedown", startMarkerDrag);
  marker.on("touchstart", startMarkerDrag);

  checkpointLayers.push(marker);
  renderMarkerPosition(marker, "Waiting for network");
});

function renderMarkerPosition(marker, nodeStatus) {
  const key = marker.options.positionKey;
  const point = marker.getLatLng();
  byId(`${key}-lat`).textContent = point.lat.toFixed(7);
  byId(`${key}-lng`).textContent = point.lng.toFixed(7);
  byId(`${key}-node`).textContent = marker.options.graphNodeId || nodeStatus || "Not snapped";
}

// Drag handling for Leaflet circle markers.
let activeMarker = null;

function startMarkerDrag(event) {
  if (routingBusy) return;
  activeMarker = event.target;
  activeMarker.snapVersion = (activeMarker.snapVersion || 0) + 1;
  delete activeMarker.options.graphNodeId;
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
    renderMarkerPosition(activeMarker, "Dragging — release to snap");
  }
}

let networkReady = false;
let routingBusy = false;
let pendingSnaps = 0;
findButton.disabled = true;

function updateFindButton() {
  findButton.disabled = !networkReady || routingBusy || pendingSnaps > 0;
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
    marker.options.graphNodeId = nearest.id;
    renderMarkerPosition(marker);
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
      setStatus("", "READY — DRAG MARKERS TO CHOOSE YOUR ROUTE");
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

// Make a panel draggable using its header as the handle.
function makeDraggable(panel, handle) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener("pointerdown", (event) => {
    // Only start dragging with the primary mouse button.
    if (event.button !== 0) return;

    // Don't start dragging when clicking a button.
    if (event.target.closest("button")) return;

    const panelRect = panel.getBoundingClientRect();
    const shellRect = document
      .querySelector(".app-shell")
      .getBoundingClientRect();

    // Convert the panel's position to top/left coordinates.
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

    // Keep the entire panel inside the application viewport.
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

// Enable dragging for both windows.
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
  if (!networkReady || routingBusy || pendingSnaps || activeMarker) return;
  routingBusy = true;
  updateFindButton();
  byId("button-text").textContent = "Computing route...";
  setStatus("running", "COMPUTING ROUTE");
  historyMenu.hidden = true;
  historyButton.setAttribute("aria-expanded", "false");
  resultsPanel.hidden = true;
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  try {
    const [start, goal] = checkpointLayers.map(marker => {
      const point = marker.getLatLng();
      return { lat: point.lat, lng: point.lng };
    });
    const result = await apiJson("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start, goal, algorithm: algorithmSelect.value }),
    });
    checkpointLayers[0].setLatLng([result.start.lat, result.start.lng]);
    checkpointLayers[1].setLatLng([result.goal.lat, result.goal.lng]);
    checkpointLayers[0].options.graphNodeId = result.start.id;
    checkpointLayers[1].options.graphNodeId = result.goal.id;
    checkpointLayers.forEach(marker => renderMarkerPosition(marker));
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
    setStatus("complete", "ROUTE READY");
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

testCaseSelect.addEventListener("change", () => {
  if (networkReady && !routingBusy) setStatus("", "READY TO FIND ROUTE");
});
algorithmSelect.addEventListener("change", () => {
  if (networkReady && !routingBusy) setStatus("", "READY TO FIND ROUTE");
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
renderHistory();
