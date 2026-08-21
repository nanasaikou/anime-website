import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, html, css] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);

assert.match(html, /class="nav-item" data-view="settings"/);
assert.match(html, /id="settingsView" data-view-panel="settings"/);
for (const id of [
  "settingsTheme",
  "settingsDensity",
  "settingsAlwaysShowControls",
  "settingsReduceMotion",
  "settingsRegion",
  "settingsRefreshButton",
  "settingsProfileButton"
]) assert.match(html, new RegExp(`id="${id}"`));

assert.match(app, /function renderSettings\(/);
assert.match(app, /if \(view === "settings"\) loadSettingsRegions\(\)/);
assert.match(app, /classList\.toggle\("compact-density"/);
assert.match(app, /classList\.toggle\("reduce-motion"/);
assert.match(app, /classList\.toggle\("always-show-list-controls"/);
assert.match(app, /event\.target\.id === "settingsRegion"/);
assert.match(html, /data-settings-theme="light"/);
assert.match(html, /data-settings-density="compact"/);
assert.doesNotMatch(html, /<select id="settings(?:Theme|Density)"/);
assert.match(html, /<select id="settingsRegion"/);
assert.match(css, /\.settings-grid/);
assert.match(css, /\.settings-choice-group/);
assert.match(css, /body\.reduce-motion/);
assert.match(css, /body\.always-show-list-controls/);

console.log("Settings-page checks passed");
