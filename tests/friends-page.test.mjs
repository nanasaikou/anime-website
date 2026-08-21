import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, html, css] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);

assert.match(html, /class="nav-item" data-view="friends"/);
assert.match(html, /id="friendsView" data-view-panel="friends"/);
for (const id of ["addFriendForm", "friendUsernameInput", "friendAddMessage", "friendInvitePreview", "friendInviteLink", "copyFriendInvite", "friendsCount", "friendsTabs", "friendsConnectedCount", "friendsPendingCount", "friendsOutgoingCount", "friendsRejectedCount", "friendsConnectedList", "friendsPendingList", "friendsOutgoingList", "friendsRejectedList", "friendsDiscoverList"]) {
  assert.match(html, new RegExp(`id="${id}"`));
}

assert.match(app, /function sharedAnimeWithProfile/);
assert.match(app, /function friendProfileCard/);
assert.match(app, /function renderFriends/);
assert.match(app, /function switchFriendsTab/);
assert.match(app, /function buildFriendInviteLink/);
assert.match(app, /function friendInviteFromLocation/);
assert.match(app, /function renderFriendInviteTools/);
assert.match(app, /function copyFriendInviteLink/);
assert.match(app, /function addFriendByUsername/);
assert.match(app, /function respondToFriendRequest/);
assert.match(app, /function cancelFriendRequest/);
assert.match(app, /function dismissRejectedFriend/);
assert.match(app, /No profile was found with that username/);
assert.match(app, /You cannot add your own profile/);
assert.match(app, /is already connected/);
assert.match(app, /addFriendForm.*addEventListener\("submit"/s);
assert.match(app, /renderFriends\(\);/);
assert.match(app, /data-toggle-friend=/);
assert.match(app, /data-accept-friend=/);
assert.match(app, /data-reject-friend=/);
assert.match(app, /data-cancel-friend=/);
assert.match(app, /data-open-anime=/);

for (const tab of ["connected", "pending", "outgoing", "rejected", "add"]) {
  assert.match(html, new RegExp(`data-friends-tab="${tab}"`));
  assert.match(html, new RegExp(`data-friends-panel="${tab}"`));
}
assert.match(css, /\.friends-tabs/);
assert.match(css, /\.friends-tab-panel/);
assert.match(css, /\.friend-add-panel/);
assert.match(css, /\.friend-invite-panel/);
assert.match(css, /\.friend-invite-preview/);
assert.match(css, /\.friends-card-grid/);
assert.match(css, /\.friend-profile-card/);
assert.match(css, /\.friend-request-card/);
assert.match(css, /\.private-friend-section/);
assert.match(css, /\.friend-shared-preview/);

console.log("Friends-page checks passed");
