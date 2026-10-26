import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileSim, runMany, reportValue, createWorld, step } from "../src/lib/town/sim.js";

const load = (f) => compileSim(JSON.parse(fs.readFileSync(new URL(`../data/towns/${f}`, import.meta.url))));
const grace = load("grace-agents.json"), rival = load("grace-rival.json");

test("both sample towns load with no rejected rows", () => { assert.deepEqual(grace.rejected, []); assert.deepEqual(rival.rejected, []); });
test("a fixed seed repeats exactly", () => assert.deepEqual(runMany(grace.town, { runs: 20 }), runMany(grace.town, { runs: 20 })));
test("a rule the town lacks reads 0 with its reason", () => {
  const row = grace.town.report.find((r) => r.measure === "count:CLIMB");
  const v = reportValue(grace.town, runMany(grace.town, { runs: 5 }), row);
  assert.equal(v.value, "0"); assert.match(v.note, /no rule/);
});
test("the rival town's extra rule is counted", () => {
  const row = rival.town.report.find((r) => r.measure === "count:CLIMB");
  assert.ok(+reportValue(rival.town, runMany(rival.town, { runs: 20 }), row).value > 0);
});
test("with no Spirit, no one is awakened in the Grace town", () => {
  const res = runMany(grace.town, { runs: 10, counts: { spirit: 0 } });
  assert.equal(res.totals.fires.A || 0, 0); assert.equal(res.totals.end.grow || 0, 0);
});
test("the engine never answers when you ask to answer yourself", () => {
  const w = createWorld(grace.town, { askMe: true });
  for (let i = 0; i < 30; i++) step(w);
  assert.equal(w.fires.R || 0, 0); assert.ok(w.pending.length > 0);
});
