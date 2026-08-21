import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, html, css] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);

assert.doesNotMatch(`${app}${html}`, /data-quick-add/);
assert.match(html, /class="hero-list-toggle" id="heroAddButton"/);
assert.doesNotMatch(html, /class="primary-button" id="heroAddButton"/);
assert.match(app, /data-list-toggle=/);
assert.match(app, /aria-pressed=/);
assert.match(app, /"detail-list-toggle"/);
assert.match(app, /function toggleAnimeInList/);
assert.match(css, /\.anime-card:focus-within \.card-add/);
assert.match(css, /@media \(hover: none\)/);

console.log("Accessible list-toggle UI checks passed");
