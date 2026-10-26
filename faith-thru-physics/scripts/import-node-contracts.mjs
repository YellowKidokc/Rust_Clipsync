// One-off converter: a node_contracts.json file -> one claim-record/1 file per claim.
// Grades are COPIED from the contract's tags. Nothing is generated except what is named below.
//   usage: node scripts/import-node-contracts.mjs data/sources/grace-001/node_contracts.json grace grace-001
// Named exceptions (each is visible in the record):
//   - canon_status is not in node_contracts.json; it is written as "open" (not yet ruled canon)
//     and grade_source says so, awaiting David's ruling.
//   - system_part "conservation law" is written conservation_law (spelling only).
//   - receipts take verification "unverified": the contract lists evidence but not how it was checked.
import fs from "node:fs";
import path from "node:path";

const [file, series, paper] = process.argv.slice(2);
if (!file || !series || !paper) { console.error("usage: import-node-contracts.mjs <file> <series> <paper>"); process.exit(1); }
const src = JSON.parse(fs.readFileSync(file, "utf8"));
const out = path.join("data/series", series, "claims");
fs.mkdirSync(out, { recursive: true });
const rel = file.replace(/\\/g, "/");
const norm = (s) => (s == null ? s : String(s).trim().replace(/\s+/g, "_"));
const receipt = (e) => ({ kind: /\.lean/.test(e) ? "lean" : /\.py/.test(e) ? "code" : "source", ref: e, verification: "unverified" });

function grade(tags, id) {
  const w = tags.warrant || {};
  return {
    warrant: norm(w.status) || "unverified",
    outcome: null,
    canon_status: "open",
    grade_source: `copied:${rel}#${id} (warrant: tags.warrant.status, kind ${w.kind || "not stated"}; canon_status not in source, written open)`,
  };
}
function write(rec) { fs.writeFileSync(path.join(out, rec.claim_id + ".json"), JSON.stringify(rec, null, 2) + "\n"); }
const base = (id, text, quote, tags) => ({
  record_version: "claim-record/1", series, paper, claim_id: id, type: "CLAIM", text,
  source: { file: rel, quote, stated: true },
  tags: { system_part: norm(tags.system_part), composition_level: tags.composition_level, claim_role: norm(tags.claim_role), register: norm(tags.register) },
  grade: grade(tags, id),
});

let n = 0;
for (const c of src.claims || []) {
  write({ ...base(c.id, c.claim, c.claim, c.tags), strength: c.strength, receipts: (c.evidence || []).map(receipt), neighbors: [],
    generated_by: "converted by scripts/import-node-contracts.mjs (no AI)" });
  n++;
}
for (const p of src.operational_ports || []) {
  const id = `${paper.toUpperCase()}.${p.id}`;
  const text = `Operator ${p.id} (${(p.agent || []).join(", ")}): ${p.boundary}`;
  write({ ...base(id, text, p.boundary, p.tags), receipts: (p.evidence || []).map(receipt),
    neighbors: (p.claim_dependencies || []).map((d) => ({ id: d, edge: "rests_on" })),
    warrant_boundary: p.warrant_boundary, generated_by: "converted by scripts/import-node-contracts.mjs (no AI)" });
  n++;
}
console.log(`wrote ${n} records to ${out}`);
