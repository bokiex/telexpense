import test from "node:test";
import assert from "node:assert/strict";
import { isRecurringRuleDue } from "../lib/repository";

test("recurring trigger skips rules when no candidate is due", () => {
  assert.equal(isRecurringRuleDue(20, 31, 19, false), false);
});

test("recurring trigger selects a due rule", () => {
  assert.equal(isRecurringRuleDue(19, 31, 19, false), true);
});

test("recurring trigger clamps days beyond the end of the month", () => {
  assert.equal(isRecurringRuleDue(31, 28, 28, false), true);
});

test("recurring trigger skips a rule already run this month", () => {
  assert.equal(isRecurringRuleDue(1, 31, 31, true), false);
});
