import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("function statusAwareEntryPatch");
const end = source.indexOf("function updateEntry");
assert.ok(start >= 0 && end > start, "status-aware progress helper must remain available for testing");

const context = vm.createContext({ Number });
vm.runInContext(source.slice(start, end), context);

assert.deepEqual({ ...context.statusAwareEntryPatch({ status: "completed" }, { episodes: 24 }) }, { status: "completed", progress: 24 });
assert.deepEqual({ ...context.statusAwareEntryPatch({ status: "planned" }, { episodes: 24 }) }, { status: "planned", progress: 0 });
assert.deepEqual({ ...context.statusAwareEntryPatch({ status: "planned", progress: 9 }, { episodes: 24 }) }, { status: "planned", progress: 0 });
assert.deepEqual({ ...context.statusAwareEntryPatch({ status: "watching", progress: 3 }, { episodes: 24 }) }, { status: "watching", progress: 3 });
assert.deepEqual({ ...context.statusAwareEntryPatch({ status: "completed" }, { episodes: "?" }) }, { status: "completed" });
assert.deepEqual({ ...context.statusAwareEntryPatch({ status: "completed" }, { episodes: 0 }) }, { status: "completed" });

console.log("Status-aware episode progress checks passed");
