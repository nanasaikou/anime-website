import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [source, html, css] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);

for (const functionName of ["captureGroupComposerState", "restoreGroupComposerState", "renderAnimeSavePicker", "openAnimeSavePicker", "togglePersonalListDestination"]) {
  assert.match(source, new RegExp(`function ${functionName}`));
}
assert.match(source, /const composerState = captureGroupComposerState\(\);[\s\S]*restoreGroupComposerState\(composerState\);/);
assert.match(source, /groupsForUser\(\)\.length[\s\S]*openAnimeSavePicker\(animeId\)/);
assert.match(source, /data-save-personal/);
assert.match(source, /data-save-group/);
assert.match(html, /id="saveAnimeModal"/);
assert.match(html, /id="saveAnimeContent"/);
assert.match(css, /\.save-destination-list/);
assert.match(css, /\.save-destination-button\.active/);

let currentInput = {
  value: "Demon Slay",
  selectionStart: 7,
  selectionEnd: 11,
  focus() {},
  setSelectionRange() {}
};
const document = { activeElement: currentInput };
const helperStart = source.indexOf("function captureGroupComposerState");
const helperEnd = source.indexOf("async function refreshSupabaseStore");
const context = vm.createContext({
  activeGroupId: "group-1",
  document,
  $: () => currentInput,
  Number
});
vm.runInContext(source.slice(helperStart, helperEnd), context);
const state = context.captureGroupComposerState();
let focusCalled = false;
let restoredSelection = null;
currentInput = {
  value: "",
  focus() { focusCalled = true; },
  setSelectionRange(start, end) { restoredSelection = [start, end]; }
};
context.restoreGroupComposerState(state);
assert.equal(currentInput.value, "Demon Slay");
assert.equal(focusCalled, true);
assert.deepEqual(restoredSelection, [7, 11]);

console.log("Realtime chat composer and multi-list picker checks passed");
