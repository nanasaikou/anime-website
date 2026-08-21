import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [source, html, css] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);

assert.match(html, /class="nav-item" data-view="groups"/);
assert.match(html, /id="groupsView" data-view-panel="groups"/);
for (const id of ["groupsCount", "newGroupButton", "groupCreatePanel", "createGroupForm", "groupMemberChoices", "groupList", "groupWorkspace"]) {
  assert.match(html, new RegExp(`id="${id}"`));
}
for (const functionName of ["groupsForUser", "createGroupList", "addAnimeToGroup", "toggleGroupAnimeInterest", "sendGroupMessage", "renderGroups"]) {
  assert.match(source, new RegExp(`function ${functionName}`));
}
assert.match(source, /data-group-message-form/);
assert.match(source, /data-group-add-anime/);
assert.match(source, /entry\.addedBy = \[\.\.\.new Set/);
assert.match(source, /renderGroups\(\);/);
assert.match(css, /\.groups-layout/);
assert.match(css, /\.group-content-grid/);
assert.match(css, /\.group-chat-panel/);
assert.match(css, /\.group-anime-card/);

const luna = { username: "Luna", usernameLower: "luna", friends: ["sol"], list: [] };
const sol = { username: "Sol", usernameLower: "sol", friends: ["luna"], list: [] };
const store = { users: [luna, sol], groups: [] };
const errorElement = { textContent: "" };
class CreateFormData {
  get(key) { return key === "groupName" ? "Weekend Club" : null; }
  getAll(key) { return key === "members" ? ["sol"] : []; }
}
const createStart = source.indexOf("function createGroupList");
const createEnd = source.indexOf("function activeGroup");
const createContext = vm.createContext({
  store,
  currentUser: () => luna,
  connectedProfiles: () => [sol],
  FormData: CreateFormData,
  $: () => errorElement,
  crypto: { randomUUID: () => "group-1" },
  Date,
  Math,
  saveStore() {},
  showGroupCreator() {},
  renderAll() {},
  toast() {}
});
vm.runInContext(source.slice(createStart, createEnd), createContext);
assert.equal(createContext.createGroupList({ reset() {} }), true);
assert.deepEqual(Array.from(store.groups[0].memberUsernames), ["luna", "sol"]);
assert.equal(store.groups[0].messages[0].system, true);

const anime = { id: 101, title: "Shared Story", image: "https://example.com/poster.jpg" };
let activeUser = luna;
const addStart = source.indexOf("function addAnimeToGroup");
const addEnd = source.indexOf("function toggleGroupAnimeInterest");
const addContext = vm.createContext({
  activeGroup: () => store.groups[0],
  currentUser: () => activeUser,
  findAnime: () => anime,
  recordGroupActivity() {},
  saveStore() {},
  renderAll() {},
  toast() {},
  Number,
  Set,
  Date
});
vm.runInContext(source.slice(addStart, addEnd), addContext);
assert.equal(addContext.addAnimeToGroup(101), true);
activeUser = sol;
assert.equal(addContext.addAnimeToGroup(101), true);
assert.equal(store.groups[0].animeEntries.length, 1, "the same anime must remain one shared row");
assert.deepEqual(Array.from(store.groups[0].animeEntries[0].addedBy), ["luna", "sol"]);

console.log("Collaborative group-list checks passed");
