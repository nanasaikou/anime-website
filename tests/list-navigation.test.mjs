import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, css, html] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8")
]);

assert.match(app, /<article class="list-row" data-open-anime="\$\{anime\.id\}"/);
assert.match(app, /class="list-anime" data-open-anime="\$\{anime\.id\}" tabindex="0" role="button"/);
assert.match(app, /interactiveOpenChild = event\.target\.closest\("button, select, input, textarea, a"\)/);
assert.match(app, /interactiveOpenChild === open/);
assert.match(app, /event\.target\.matches\('\[data-open-anime\]\[role="button"\]'\)/);
assert.match(app, /for \(const profile of store\.users\)/);
assert.match(app, /\?\.snapshot/);
assert.match(css, /\.list-row:hover/);
assert.match(css, /\.list-anime:focus-visible/);
assert.doesNotMatch(html, /data-status="shared"/);
assert.doesNotMatch(app, /listFilter === "shared"/);

console.log("List-to-detail navigation checks passed");
