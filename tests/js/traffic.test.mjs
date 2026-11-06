// Run: node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const Traffic = createRequire(import.meta.url)("../../static/JS/traffic.js");

const body = (traffic_scenario_id, objective) => ({
  start: { lat: 21.0126, lng: 105.8678 }, goal: { lat: 21.0058, lng: 105.8501 },
  algorithm: "astar", speed_kmh: 40, traffic_scenario_id, objective,
});
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

test("UI events map to the backend scenario IDs for TC01-TC03 only", () => {
  assert.equal(Traffic.scenarioId("peak_hour", "TC01"), "traffic_jam_tc01");
  assert.equal(Traffic.scenarioId("road_closure", "TC03"), "road_closure_tc03");
  assert.equal(Traffic.scenarioId("", "TC02"), null);
  assert.equal(Traffic.scenarioId("peak_hour", "custom"), null);
  assert.equal(Traffic.eventOfScenario("traffic_jam_tc02"), "peak_hour");
  assert.equal(Traffic.eventOfScenario("road_closure_tc01"), "road_closure");
  assert.equal(Traffic.eventOfScenario(null), "");
});

test("A response without segment speeds still renders at the fixed speed", () => {
  const r = Traffic.normalize({ coordinates: [[0, 0], [0, 1], [0, 2]], distance_km: 2, speed_kmh: 40,
    segment_distances_km: [1, 1], segment_durations_sec: [90, 90], estimated_time_sec: 180 });
  assert.deepEqual(r.segment_speeds_kmh, [40, 40]);
  assert.deepEqual(r.segment_status, ["free", "free"]);
  assert.equal(r.traffic_applied, false);
});

test("Backend segment speeds drive the colours: 12 km/h of 40 is a jam", () => {
  const r = Traffic.normalize({ coordinates: [[0, 0], [0, 1], [0, 2]], distance_km: 2, speed_kmh: 40,
    segment_distances_km: [1, 1], segment_speeds_kmh: [12, 40], segment_durations_sec: [300, 90],
    estimated_time_sec: 390, traffic_scenario_id: "traffic_jam_tc01" });
  assert.deepEqual(r.segment_status, ["jam", "free"]);
  assert.equal(r.traffic_applied, true);
});

test("Segment status thresholds", () => {
  assert.equal(Traffic.statusFor(40, 40), "free");
  assert.equal(Traffic.statusFor(20, 40), "slow");
  assert.equal(Traffic.statusFor(5, 40), "jam");
});

for (const event of Traffic.EVENTS) for (const o of Traffic.OBJECTIVES) {
  test(`mock ${event.id || "no event"}/${o.id}: segment times sum to ETA`, () => {
    const id = Traffic.scenarioId(event.id, "TC01");
    const r = Traffic.normalize(Traffic.mockRoute(body(id, o.id)));
    const n = r.coordinates.length - 1;
    for (const k of ["segment_distances_km", "segment_durations_sec", "segment_speeds_kmh", "segment_status", "segment_edges"])
      assert.equal(r[k].length, n, k);
    assert.ok(Math.abs(sum(r.segment_durations_sec) - r.estimated_time_sec) < 1e-6);
    assert.equal(r.traffic_scenario_id, id);
  });
}

test("Mock peak hour: the fastest route is longer but faster than the shortest", () => {
  const d = Traffic.mockRoute(body("traffic_jam_tc01", "distance"));
  const t = Traffic.mockRoute(body("traffic_jam_tc01", "time"));
  const diff = Traffic.compare(d, t);
  assert.ok(diff.extra_km > 0 && diff.saved_sec > 0, JSON.stringify(diff));
});

test("Mock with no event: both objectives give the same route", () => {
  const d = Traffic.mockRoute(body(null, "distance"));
  const t = Traffic.mockRoute(body(null, "time"));
  assert.ok(Traffic.sameRoute(d, t));
});

test("Mock road closure detours for both objectives at a fixed 40 km/h", () => {
  const d = Traffic.mockRoute(body("road_closure_tc01", "distance"));
  const t = Traffic.mockRoute(body("road_closure_tc01", "time"));
  assert.ok(Traffic.sameRoute(d, t));
  assert.ok(!Traffic.sameRoute(d, Traffic.mockRoute(body(null, "distance"))));
  assert.equal(d.speed_kmh, 40);
});

test("colorRuns merges same-colour segments without losing points", () => {
  const r = Traffic.normalize(Traffic.mockRoute(body("traffic_jam_tc01", "distance")));
  const runs = Traffic.colorRuns(r);
  assert.ok(runs.length >= 3);
  assert.equal(sum(runs.map((x) => x.coords.length - 1)), r.coordinates.length - 1);
});
