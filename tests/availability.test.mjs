import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("function deriveEpisodeCounts");
const end = source.indexOf("function normalizeAniListAvailability");
assert.ok(start >= 0 && end > start, "availability helpers must remain available for testing");

const context = vm.createContext({ Number, Math, Set, URL });
vm.runInContext(source.slice(start, end), context);

assert.deepEqual(
  { ...context.deriveEpisodeCounts("FINISHED", 25, null) },
  { total: 25, aired: 25, remaining: 0 }
);
assert.deepEqual(
  { ...context.deriveEpisodeCounts("RELEASING", 12, 5) },
  { total: 12, aired: 4, remaining: 8 }
);
assert.deepEqual(
  { ...context.deriveEpisodeCounts("RELEASING", null, 1175) },
  { total: null, aired: 1174, remaining: null }
);
assert.deepEqual(
  { ...context.deriveEpisodeCounts("NOT_YET_RELEASED", 24, null) },
  { total: 24, aired: 0, remaining: 24 }
);
assert.deepEqual(
  { ...context.deriveEpisodeCounts("RELEASING", null, null) },
  { total: null, aired: null, remaining: null }
);

assert.doesNotMatch(source, /<h4>Where to stream<\/h4>/);
assert.match(source, /STREAMING IN YOUR REGION/);

console.log("Episode schedule regression checks passed");
