import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const start = source.indexOf("function comparableTitle");
const end = source.indexOf("async function handleWatchRegions");
assert.ok(start >= 0 && end > start, "regional provider helpers must remain available for testing");

const context = vm.createContext({ String });
vm.runInContext(source.slice(start, end), context);

const matches = [
  { id: 1, name: "Moon Story", first_air_date: "2019-01-01" },
  { id: 2, name: "Moon Story", first_air_date: "2024-01-01" },
  { id: 3, name: "Moon Stories", first_air_date: "2024-01-01" }
];
assert.equal(context.chooseMediaMatch(matches, "Moon Story", 2024, "tv").id, 2);

const providers = context.providerList([
  { provider_id: 2, provider_name: "Second", logo_path: "/second.png", display_priority: 20 },
  { provider_id: 1, provider_name: "First", logo_path: "/first.png", display_priority: 5 }
]);
assert.deepEqual(Array.from(providers, (provider) => provider.id), [1, 2]);
assert.equal(providers[0].logoUrl, "https://image.tmdb.org/t/p/w92/first.png");

console.log("Regional provider matching checks passed");
