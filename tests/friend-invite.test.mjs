import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("function buildFriendInviteLink");
const end = source.indexOf("function renderFriendInviteTools");
assert.ok(start >= 0 && end > start, "friend invite URL helpers must remain available for testing");

const window = { location: { href: "https://anime.example/app/?old=value#home" } };
const context = vm.createContext({ window, URL, String });
vm.runInContext(source.slice(start, end), context);

assert.equal(context.buildFriendInviteLink({ username: "Luna_7" }), "https://anime.example/app/?friend=Luna_7#friends");
window.location.href = "https://anime.example/app/?friend=Sol#friends";
assert.equal(context.friendInviteFromLocation(), "Sol");
window.location.href = "https://anime.example/app/?friend=not%20valid";
assert.equal(context.friendInviteFromLocation(), null);

console.log("Friend invite-link checks passed");
