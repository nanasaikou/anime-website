import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("function normalizeComparableTitle");
const end = source.indexOf("async function fetchTitleMatchedEntries");
assert.ok(start >= 0 && end > start, "title-family helpers must remain available for testing");

const context = vm.createContext({ String });
vm.runInContext(source.slice(start, end), context);

assert.equal(context.franchiseTitleStem("Sky Knights: Crimson Arc"), "sky knights");
assert.equal(context.franchiseTitleStem("Odyssey Season 3"), "odyssey");
assert.equal(context.franchiseTitleStem("Paper Moon Part II"), "paper moon");
assert.equal(context.animeMatchesTitleFamily({ title: "Sky Knights Season 2" }, "sky knights"), true);
assert.equal(context.animeMatchesTitleFamily({ title: "Night Knights" }, "sky knights"), false);
assert.equal(context.animeMatchesTitleFamily({ title: "Unrelated", canonicalTitles: ["Paper Moon Movie"] }, "paper moon"), true);
assert.equal(context.animeMatchesTitleFamily({ title: "Unrelated", alternativeTitles: ["Paper Moon Movie"] }, "paper moon"), false);
assert.equal(context.animeMatchesTitleFamily({ title: "Onigiri" }, "demon slayer"), false);

console.log("API title-family matching checks passed");
