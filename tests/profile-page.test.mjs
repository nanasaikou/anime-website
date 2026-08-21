import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, html, css] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);

assert.match(html, /id="profileView" data-view-panel="profile"/);
assert.doesNotMatch(html, /id="profileModal"/);
for (const id of ["profileTitlesStat", "profileEpisodesStat", "profileWatchingStat", "profileCompletedStat", "profilePlannedStat", "profileRatingStat", "profileSharedStat", "profileGenreList", "profileStudioList", "profileAccountDetails", "profileStatusBreakdown", "profileRatedCount", "editProfileForm", "editProfileError", "profileBio", "profileBioCount", "profileAvatarPreview", "profileAvatarDropZone", "profileAvatarFile", "chooseProfileAvatar", "removeProfileAvatar", "resetProfileForm", "profileRecentList"]) assert.match(html, new RegExp(`id="${id}"`));
assert.match(app, /function renderProfilePage/);
assert.match(app, /authButton\.innerHTML = avatarInnerMarkup\(user\)/);
assert.match(app, /function saveEditedProfile/);
assert.match(app, /That username is already taken/);
assert.match(app, /friendName === previousUsernameLower \? usernameLower/);
assert.match(app, /valid HTTPS image URL/);
assert.match(app, /function resizeProfileAvatar/);
assert.match(app, /canvas\.toDataURL\("image\/jpeg", \.82\)/);
assert.match(app, /addEventListener\("drop"/);
assert.match(app, /customAvatarDataUrl/);
assert.match(app, /switchView\("profile"\)/);
assert.doesNotMatch(app, /openModal\("profileModal"\)/);
assert.match(css, /\.profile-page-hero/);
assert.match(css, /\.auth-button\.signed-in img/);
assert.match(css, /\.profile-content-grid/);
assert.match(css, /\.profile-account-details/);
assert.match(css, /\.profile-status-breakdown/);
assert.match(css, /\.edit-profile-form/);
assert.match(css, /\.profile-avatar-dropzone/);
assert.match(css, /\.profile-avatar-preview/);

console.log("Full profile-page checks passed");
