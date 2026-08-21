import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("function avatarHue");
const end = source.indexOf("function escapeHtml");
assert.ok(start >= 0 && end > start, "collaboration helpers must remain available for testing");

const luna = { username: "Luna", usernameLower: "luna", friends: ["sol"], list: [{ animeId: 1 }, { animeId: 2 }] };
const sol = { username: "Sol", usernameLower: "sol", friends: ["luna"], list: [{ animeId: 1 }, { animeId: 3 }] };
const nova = { username: "Nova", usernameLower: "nova", friends: [], list: [{ animeId: 2 }] };
const context = vm.createContext({
  store: { users: [luna, sol, nova] },
  currentUser: () => luna,
  Set,
  Number
});
vm.runInContext(source.slice(start, end), context);

assert.deepEqual(Array.from(context.connectedProfiles(luna), (profile) => profile.username), ["Sol"]);
assert.deepEqual(Array.from(context.profilesForAnime(1, luna), (profile) => profile.username), ["Luna", "Sol"]);
assert.deepEqual(Array.from(context.profilesForAnime(2, luna), (profile) => profile.username), ["Luna"]);
assert.deepEqual(Array.from(context.sharedAnimeIds(luna)), [1]);
assert.equal(context.avatarHue("Luna"), context.avatarHue("Luna"));

console.log("Collaborative list checks passed");
