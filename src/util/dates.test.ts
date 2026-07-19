import { test } from "node:test";
import assert from "node:assert/strict";
import { toLocalDay, isValidDateString, isParseableDate } from "./dates.js";

test("toLocalDay formats an ISO timestamp as YYYY-MM-DD", () => {
  assert.equal(toLocalDay("2026-07-14T10:00:00.000Z"), new Date("2026-07-14T10:00:00.000Z").getFullYear() +
    "-" + String(new Date("2026-07-14T10:00:00.000Z").getMonth() + 1).padStart(2, "0") +
    "-" + String(new Date("2026-07-14T10:00:00.000Z").getDate()).padStart(2, "0"));
});

test("isValidDateString rejects malformed strings", () => {
  assert.equal(isValidDateString("2026-07-14"), true);
  assert.equal(isValidDateString("not-a-date"), false);
  assert.equal(isValidDateString("2026-13-99"), false);
});

test("isParseableDate accepts anything Date.parse accepts", () => {
  assert.equal(isParseableDate("2026-07-14"), true);
  assert.equal(isParseableDate("garbage"), false);
});
