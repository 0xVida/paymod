import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { formatRelativeTime } from "./format-relative-time.js";

const NOW = new Date("2026-08-31T12:00:00.000Z");
function secondsAgo(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

describe("formatRelativeTime", () => {
  test("just now for anything under 5 seconds old", () => {
    assert.equal(formatRelativeTime(secondsAgo(0), NOW), "just now");
    assert.equal(formatRelativeTime(secondsAgo(4), NOW), "just now");
  });

  test("seconds, minutes, hours and days, each rounded to the nearest unit", () => {
    assert.equal(formatRelativeTime(secondsAgo(30), NOW), "30 sec ago");
    assert.equal(formatRelativeTime(secondsAgo(90), NOW), "2 min ago");
    assert.equal(formatRelativeTime(secondsAgo(60 * 90), NOW), "2 hr ago");
    assert.equal(formatRelativeTime(secondsAgo(60 * 60 * 25), NOW), "1 day ago");
  });

  test("weeks, with correct singular/plural", () => {
    assert.equal(formatRelativeTime(secondsAgo(60 * 60 * 24 * 7), NOW), "1 week ago");
    assert.equal(formatRelativeTime(secondsAgo(60 * 60 * 24 * 14), NOW), "2 weeks ago");
  });

  test("falls back to a real date once it is more than about a month old", () => {
    const result = formatRelativeTime(secondsAgo(60 * 60 * 24 * 45), NOW);
    assert.doesNotMatch(result, /ago$/);
    assert.match(result, /2026/);
  });

  test("an unparseable timestamp is returned as-is rather than showing 'NaN ago'", () => {
    assert.equal(formatRelativeTime("not a date", NOW), "not a date");
  });
});
