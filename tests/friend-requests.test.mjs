import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("function toggleFriend");
const end = source.indexOf("function addToList");
assert.ok(start >= 0 && end > start, "friend request actions must remain available for testing");

const luna = { username: "Luna", usernameLower: "luna", friends: [], list: [] };
const sol = { username: "Sol", usernameLower: "sol", friends: [], list: [] };
const nova = { username: "Nova", usernameLower: "nova", friends: [], list: [] };
const store = { users: [luna, sol, nova] };
let activeUser = luna;
const elements = {
  "#friendAddMessage": { textContent: "", className: "" },
  "#friendUsernameInput": { value: "" }
};
const context = vm.createContext({
  store,
  currentUser: () => activeUser,
  requireAuth: () => true,
  ensureFriendRequestState(profile) {
    profile.friends ||= [];
    profile.incomingFriendRequests ||= [];
    profile.outgoingFriendRequests ||= [];
    profile.rejectedFriendRequests ||= [];
    return profile;
  },
  $: (selector) => elements[selector],
  openModal() {},
  saveStore() {},
  renderAll() {},
  toast() {},
  Set,
  String
});
vm.runInContext(source.slice(start, end), context);

assert.equal(context.addFriendByUsername("SOL"), true);
assert.deepEqual(Array.from(luna.outgoingFriendRequests), ["sol"]);
assert.deepEqual(Array.from(sol.incomingFriendRequests), ["luna"]);
assert.deepEqual(Array.from(luna.friends), [], "sending a request must not immediately connect profiles");

activeUser = sol;
assert.equal(context.respondToFriendRequest("luna", "reject"), true);
assert.deepEqual(Array.from(sol.rejectedFriendRequests), ["luna"]);
assert.deepEqual(Array.from(luna.outgoingFriendRequests), []);
assert.deepEqual(Array.from(luna.rejectedFriendRequests), [], "the rejected sender must not receive rejected-history state");

activeUser = luna;
assert.equal(context.addFriendByUsername("nova"), true);
activeUser = nova;
assert.equal(context.respondToFriendRequest("luna", "accept"), true);
assert.deepEqual(Array.from(nova.friends), ["luna"]);
assert.deepEqual(Array.from(luna.friends), ["nova"]);

activeUser = sol;
assert.equal(context.dismissRejectedFriend("luna"), true);
assert.deepEqual(Array.from(sol.rejectedFriendRequests), []);

console.log("Friend-request privacy and lifecycle checks passed");
