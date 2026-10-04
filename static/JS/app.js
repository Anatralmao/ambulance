const cases = [
  "TC-01: Hospital A to Hospital B",
  "TC-02: Station 3 to Emergency Zone 7",
  "TC-03: Downtown HQ to Airport Triage",
  "TC-04: North Grid to South Grid",
  "TC-05: Rush Hour Cross-City",
  "TC-06: Night Shift Route Check",
];

const demoResults = [
  { time: "4m 22s", graph: "3.14 km", road: "3.88 km", via: "Sudirman Ave. / Semanggi" , total: "8.32 km" },
  { time: "5m 07s", graph: "3.60 km", road: "4.21 km", via: "Gatot Subroto Rd. / Halim", total: "9.41 km" },
  { time: "6m 51s", graph: "4.85 km", road: "5.30 km", via: "Rasuna Said Rd. / Kuningan", total: "11.75 km" },
];

const starterSessions = [
  { testCase: cases[0], algorithm: "Dijkstra's Algorithm", timestamp: "2026-09-30 08:14", routes: 2 },
  { testCase: cases[2], algorithm: "A* Search", timestamp: "2026-09-30 11:47", routes: 2 },
  { testCase: cases[4], algorithm: "Bellman-Ford", timestamp: "2026-09-30 14:02", routes: 1 },
];

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

const demoRoute = [
  [21.0435, 105.8231],
  [21.0381, 105.8314],
  [21.0322, 105.8406],
  [21.0285, 105.8542],
  [21.0201, 105.8581],
  [21.0069, 105.8434],
];
let routeLayer;
const routeMarkers = [
  { point: demoRoute[0], label: "DISPATCH", color: "#26845f" },
  { point: demoRoute[demoRoute.length - 1], label: "HOSPITAL", color: "#d84942" },
];
routeMarkers.forEach(({ point, label, color }) => {
  L.circleMarker(point, { radius: 8, color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 1 })
    .bindTooltip(label, { permanent: true, direction: "top", offset: [0, -8], className: "route-label" })
    .addTo(map);
});
let sessions = loadSessions();

function loadSessions() {
  try {
    const saved = localStorage.getItem("ambufind-sessions");
    return saved ? JSON.parse(saved) : starterSessions;
  } catch {
    return starterSessions;
  }
}

function saveSessions() {
  try {
    localStorage.setItem("ambufind-sessions", JSON.stringify(sessions.slice(-30)));
  } catch {
    // The history still works for the current page when storage is unavailable.
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

function renderResults() {
  resultBody.innerHTML = demoResults.map((route, index) => `
    <tr><td>${index + 1}</td><td>${route.time}</td><td>${route.graph}</td><td>${route.road}</td><td title="${route.via}">${route.via}</td><td>${route.total}</td></tr>`).join("");
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
  document.querySelector(".results-panel"),
  document.querySelector(".results-head")
);

async function findRoute() {
  if (!testCaseSelect.value || !algorithmSelect.value) {
    setStatus("error", "SELECT A TEST CASE AND ALGORITHM");
    (!testCaseSelect.value ? testCaseSelect : algorithmSelect).focus();
    return;
  }

  findButton.disabled = true;
  byId("button-text").textContent = "Computing route...";
  setStatus("running", "COMPUTING DEMONSTRATION ROUTE");
  historyMenu.hidden = true;
  historyButton.setAttribute("aria-expanded", "false");
  resultsPanel.hidden = true;
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = L.polyline(demoRoute, { color: "#e34b45", weight: 5, opacity: 0.92, lineCap: "round", lineJoin: "round" }).addTo(map);
  map.fitBounds(routeLayer.getBounds(), { padding: [90, 90], maxZoom: 14 });

  await new Promise((resolve) => window.setTimeout(resolve, 1100));

  renderResults();
  sessions.push({
    testCase: testCaseSelect.value,
    algorithm: algorithmSelect.value,
    timestamp: new Date().toLocaleString([], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }),
    routes: demoResults.length,
  });
  sessions = sessions.slice(-30);
  saveSessions();
  renderHistory();
  setStatus("complete", "DEMONSTRATION ROUTE READY");
  byId("button-text").textContent = "Find route";
  findButton.disabled = false;
}

historyButton.addEventListener("click", () => {
  const open = historyMenu.hidden;
  historyMenu.hidden = !open;
  historyButton.setAttribute("aria-expanded", String(open));
});

document.addEventListener("click", (event) => {
  if (!historyMenu.hidden && !historyMenu.contains(event.target) && !historyButton.contains(event.target)) {
    historyMenu.hidden = true;
    historyButton.setAttribute("aria-expanded", "false");
  }
});

byId("theme-toggle").addEventListener("click", () => {
  setTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
});
findButton.addEventListener("click", findRoute);

testCaseSelect.addEventListener("change", () => {
  if (testCaseSelect.value && algorithmSelect.value) setStatus("", "READY TO SIMULATE ROUTE");
});
algorithmSelect.addEventListener("change", () => {
  if (testCaseSelect.value && algorithmSelect.value) setStatus("", "READY TO SIMULATE ROUTE");
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
