import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("function orderFranchiseNodes");
const end = source.indexOf("async function fetchFranchiseSeasons");
assert.ok(start >= 0 && end > start, "franchise ordering must remain available for testing");

const context = vm.createContext({
  Map,
  Set,
  releaseTime: (anime) => anime.release
});
vm.runInContext(source.slice(start, end), context);

const shuffled = [
  { id: 30, title: "Third", release: 300 },
  { id: 10, title: "First", release: 100 },
  { id: 20, title: "Second", release: 200 }
];
const ordered = context.orderFranchiseNodes(shuffled, [[10, 20], [20, 30]]);
assert.deepEqual(Array.from(ordered, (anime) => anime.id), [10, 20, 30]);

const branch = context.orderFranchiseNodes(shuffled, [[10, 30], [10, 20]]);
assert.equal(branch[0].id, 10);
assert.deepEqual(Array.from(branch.slice(1), (anime) => anime.id), [20, 30]);

console.log("Franchise relation ordering checks passed");
