import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html = readFileSync(new URL("../../templates/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../../static/JS/app.js", import.meta.url), "utf8");

test("application script parses before it is loaded in the browser", () => {
  assert.doesNotThrow(() => new Script(app));
});

test("page IDs are unique so controls and results target the correct element", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const [, id] of app.matchAll(/byId\("([^"]+)"\)/g)) {
    // These elements are created inside the Leaflet marker icon.
    if (["david-avatar-root", "david-speech-bubble", "david-sprite"].includes(id)) continue;
    assert.ok(ids.includes(id), `Missing element: ${id}`);
  }
});

test("scripts load once, with Leaflet and Traffic before the application", () => {
  const sources = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)]
    .map(match => match[1].split("?")[0]);
  assert.deepEqual(sources, [
    "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    "/static/JS/traffic.js",
    "/static/JS/app.js",
  ]);
});
