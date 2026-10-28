import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { layers } from "../src/lib/graph.js";

// The site's own depth calculation must reproduce the Architecture Check's layer widths exactly.
const idx = JSON.parse(fs.readFileSync(new URL("../public/data/index/claims.json", import.meta.url))).filter((c) => c.main);
const csv = fs.readFileSync(new URL("../data/sources/chain-2026-10-28/overlay/layer_widths.csv", import.meta.url), "utf8").replace(/^﻿/, "").trim().split("\n").slice(1).map((l) => l.split(","));
const expected = (graph) => csv.filter((r) => r[0] === graph).sort((a, b) => a[1] - b[1]).map((r) => +r[2]);

for (const [graph, mode, active] of [["proposed_active", "proposed", true], ["proposed_all", "proposed", false], ["declared_active", "declared", true], ["declared_all", "declared", false], ["declared_plus_primary_active", "both", true], ["declared_plus_primary_all", "both", false]]) {
  test(`layer widths match the report: ${graph}`, () => {
    const pool = idx.filter((c) => !active || c.active);
    assert.deepEqual(layers(pool, mode).widths, expected(graph));
  });
}
