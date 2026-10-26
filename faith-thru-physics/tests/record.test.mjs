import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validate, binOf } from "../src/lib/record.js";

const c81 = JSON.parse(fs.readFileSync(new URL("../data/series/grace/claims/C8.1.json", import.meta.url)));

test("a well-formed record passes", () => assert.equal(validate(c81).ok, true));
test("a conditional claim without its premise is rejected", () => {
  const r = structuredClone(c81); delete r.grade.warrant_premise;
  assert.deepEqual(validate(r).errors, ["conditionally_proved needs grade.warrant_premise"]);
});
test("a missing grade source is rejected", () => {
  const r = structuredClone(c81); delete r.grade.grade_source;
  assert.equal(validate(r).ok, false);
});
test("values outside the allowed lists are rejected", () => {
  const r = structuredClone(c81); r.grade.warrant = "basically_proved";
  assert.match(validate(r).errors.join(), /grade.warrant not allowed/);
});
test("a failed outcome always displays as failed", () => assert.equal(binOf({ warrant: "proved", outcome: "fails" }), "failed"));
