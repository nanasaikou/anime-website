import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [app, server, html] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8")
]);

for (const provider of ["google", "discord"]) {
  assert.match(html, new RegExp(`data-oauth-provider="${provider}"`));
  assert.match(server, new RegExp(`\\n  ${provider}: \\{`));
}
assert.match(server, /const oauthStart = urlPath\.match/);
assert.match(server, /const oauthCallback = urlPath\.match/);
assert.match(server, /oauthStates\.set/);
assert.match(server, /stateRecord\.provider !== provider/);
assert.doesNotMatch(html, /data-oauth-provider="apple"/);

const start = app.indexOf("function uniqueOAuthUsername");
const end = app.indexOf("function completeOAuthSignIn");
assert.ok(start >= 0 && end > start, "OAuth username helper must remain available for testing");
const context = vm.createContext({ store: { users: [{ usernameLower: "moon_user" }, { usernameLower: "moon_user_2" }] }, String });
vm.runInContext(app.slice(start, end), context);
assert.equal(context.uniqueOAuthUsername("Moon User", "google"), "Moon_User_3");
assert.equal(context.uniqueOAuthUsername("李", "discord"), "discord_user");

console.log("OAuth sign-in checks passed");
