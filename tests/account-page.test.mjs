import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, html, css] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);

assert.doesNotMatch(html, /class="nav-item" data-view="account"/);
assert.doesNotMatch(html, /id="profileButton"/);
assert.doesNotMatch(html, /class="sidebar-profile-menu"/);
assert.match(html, /class="topbar-profile-menu"/);
assert.match(html, /id="authButton" aria-haspopup="menu" aria-expanded="false"/);
assert.match(html, /id="profileDropdown" role="menu"/);
assert.match(html, /data-profile-menu-view="account"/);
assert.match(html, /id="profileMenuSignOut"/);
assert.match(html, /id="accountView" data-view-panel="account"/);
for (const id of ["accountPageAvatar", "accountPageName", "accountPageEmail", "accountPageProvider", "profileAccountDetails", "editProfileForm", "changePasswordForm", "securityProviderList", "profileSignOutButton"]) assert.match(html, new RegExp(`id="${id}"`));

const profileStart = html.indexOf('id="profileView"');
const accountStart = html.indexOf('id="accountView"');
const settingsStart = html.indexOf('id="settingsView"');
assert.ok(profileStart >= 0 && accountStart > profileStart && settingsStart > accountStart);
const profileMarkup = html.slice(profileStart, accountStart);
const accountMarkup = html.slice(accountStart, settingsStart);
assert.doesNotMatch(profileMarkup, /id="(?:editProfileForm|changePasswordForm|profileAccountDetails|profileSignOutButton)"/);
assert.match(accountMarkup, /id="editProfileForm"/);
assert.match(accountMarkup, /id="changePasswordForm"/);
assert.match(app, /nav\.dataset\.view === "account" && !currentUser\(\)/);
assert.match(app, /switchView\("account"\)/);
assert.match(app, /function toggleProfileDropdown/);
assert.match(app, /\$\("#authButton"\)\.addEventListener\("click", toggleProfileDropdown\)/);
assert.match(app, /function signOutCurrentUser/);
assert.match(css, /\.account-page-hero/);
assert.match(css, /\.profile-dropdown/);

console.log("Separate account-page checks passed");
