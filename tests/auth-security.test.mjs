import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, html, css] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);

for (const id of [
  "changePasswordForm",
  "securityCurrentPasswordField",
  "generateRecoveryCode",
  "recoveryCodeDisplay",
  "securityProviderList",
  "showPasswordReset",
  "resetPasswordForm"
]) assert.match(html, new RegExp(`id="${id}"`));

assert.match(app, /const PBKDF2_ITERATIONS = 600000/);
assert.match(app, /crypto\.subtle\.deriveBits\(\{ name: "PBKDF2", hash: "SHA-256"/);
assert.match(app, /crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
assert.match(app, /function constantTimeEqual/);
assert.match(app, /async function updateAccountPassword/);
assert.match(app, /async function resetPasswordWithRecovery/);
assert.match(app, /user\.passwordHash = null/);
assert.match(app, /data-link-provider/);
assert.match(app, /data-unlink-provider/);
assert.doesNotMatch(app, /store\.users\.push\(\{ username, usernameLower, passwordHash, createdAt/);
assert.match(css, /\.profile-security-grid/);
assert.match(css, /\.security-provider-row/);

console.log("Authentication security checks passed");
