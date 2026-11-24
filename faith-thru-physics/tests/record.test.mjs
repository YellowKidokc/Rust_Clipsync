import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validate, binOf } from "../src/lib/record.js";

const c81 = JSON.parse(fs.readFileSync(new URL("../data/series/chain/claims/C8.1.json", import.meta.url)));

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
test("an unproved claim that fails displays as failed", () => assert.equal(binOf({ warrant: "unverified", outcome: "fails" }), "failed"));
test("a proof that the target is false is a negative result, not a failure", () => assert.equal(binOf({ warrant: "proved", outcome: "fails" }), "negative"));
test("every chain record that fails is a proved negative result (2026-10-28 snapshot)", () => {
  const dir = new URL("../data/series/chain/claims/", import.meta.url);
  const fails = fs.readdirSync(dir).map((f) => JSON.parse(fs.readFileSync(new URL(f, dir)))).filter((r) => r.grade.outcome === "fails");
  assert.ok(fails.length > 0);
  for (const r of fails) assert.equal(binOf(r.grade), "negative", r.claim_id);
});
