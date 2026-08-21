import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("function formatDate");
const end = source.indexOf("function releaseTime");
assert.ok(start >= 0 && end > start, "formatDate must remain available for testing");

const context = vm.createContext({ Intl, Date, Number });
vm.runInContext(source.slice(start, end), context);

assert.equal(context.formatDate(null, null).full, "Date to be announced");
assert.equal(context.formatDate(null, { year: 2027, month: null, day: null }).full, "2027");
assert.equal(context.formatDate(null, { year: 2027, month: 8, day: null }).full, "August 2027");
assert.equal(context.formatDate(null, { year: 2027, month: 8, day: 12 }).full, "August 12, 2027");
assert.equal(context.formatDate("2028-03-04T00:00:00+00:00").full, "March 4, 2028");
assert.notEqual(context.formatDate(null, null).full, "January 1, 1970");

console.log("Release-date regression checks passed");
