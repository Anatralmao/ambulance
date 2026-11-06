// Chạy: node --test tests/js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const Traffic = createRequire(import.meta.url)("../../static/JS/traffic.js");

const body = (scenario_id, objective) => ({
  start: { lat: 21.0126, lng: 105.8678 }, goal: { lat: 21.0058, lng: 105.8501 },
  algorithm: "astar", speed_kmh: 40, scenario_id, objective,
});
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

test("API Buổi 1 (chưa có giao thông) vẫn hiển thị được, tốc độ = tốc độ cố định", () => {
  const r = Traffic.normalize({ coordinates: [[0, 0], [0, 1], [0, 2]], distance_km: 2, speed_kmh: 40,
    segment_distances_km: [1, 1], segment_durations_sec: [90, 90], estimated_time_sec: 180 });
  assert.deepEqual(r.segment_speeds_kmh, [40, 40]);
  assert.deepEqual(r.segment_status, ["free", "free"]);
  assert.equal(r.traffic_applied, false);
});

test("Trạng thái đoạn theo tỉ lệ tốc độ", () => {
  assert.equal(Traffic.statusFor(40, 40), "free");
  assert.equal(Traffic.statusFor(20, 40), "slow");
  assert.equal(Traffic.statusFor(5, 40), "jam");
});

for (const s of Traffic.SCENARIOS) for (const o of Traffic.OBJECTIVES) {
  test(`mock ${s.id}/${o.id}: tổng thời lượng đoạn = ETA, mảng đủ độ dài`, () => {
    const r = Traffic.normalize(Traffic.mockRoute(body(s.id, o.id)));
    const n = r.coordinates.length - 1;
    for (const k of ["segment_distances_km", "segment_durations_sec", "segment_speeds_kmh", "segment_status", "segment_ids"])
      assert.equal(r[k].length, n, k);
    assert.ok(Math.abs(sum(r.segment_durations_sec) - r.estimated_time_sec) < 1e-6);
    assert.equal(r.scenario_id, s.id);
  });
}

test("Tắc trục chính: tuyến nhanh nhất dài hơn nhưng nhanh hơn tuyến ngắn nhất", () => {
  const d = Traffic.mockRoute(body("main_road_jam", "distance"));
  const t = Traffic.mockRoute(body("main_road_jam", "time"));
  const diff = Traffic.compare(d, t);
  assert.ok(diff.extra_km > 0 && diff.saved_sec > 0, JSON.stringify(diff));
});

test("Thông thoáng: hai mục tiêu cho cùng tuyến", () => {
  const diff = Traffic.compare(Traffic.mockRoute(body("free_flow", "distance")), Traffic.mockRoute(body("free_flow", "time")));
  assert.equal(diff.extra_km, 0); assert.equal(diff.saved_sec, 0);
});

test("colorRuns gộp đoạn liền nhau cùng màu và không mất điểm", () => {
  const r = Traffic.normalize(Traffic.mockRoute(body("main_road_jam", "distance")));
  const runs = Traffic.colorRuns(r);
  assert.ok(runs.length >= 3);
  assert.equal(sum(runs.map((x) => x.coords.length - 1)), r.coordinates.length - 1);
});
