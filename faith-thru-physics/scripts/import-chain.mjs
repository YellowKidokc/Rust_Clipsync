// Import the axiom chain: one node record per file (the CHAIN_RERUN / Architecture Check
// "source/nodes/*.yaml" files, which are JSON) -> data/series/chain/.
//   usage: node scripts/import-chain.mjs <nodes-folder> "<snapshot label>"
// Rerun it on a newer snapshot; it replaces data/series/chain/ completely. Nothing is edited by hand.
//
// What is copied, not generated:
//   every grade field (warrant, outcome, canon_status, match_scope, note), statements, premises,
//   dependencies (declared and AI-proposed kept apart), obstructions (Q15/Q16), soundness bin,
//   denial cost, what would make it checkable, proof references.
// Named mechanical changes (visible in each record):
//   - spelling: "conditionally proved" -> conditionally_proved, "states only" -> states_only, etc.
//   - a node's main claim takes the node id as its claim_id (A1.1::main -> A1.1).
//   - warrant_premise for a conditionally proved claim = its conditional_premises, or for a main
//     claim the node's soundness.named_premises. If neither exists the field stays empty and the
//     record is rejected at build time, as the format requires.
//   - receipts carry no "verification" value: the source does not say how each was checked.
import fs from "node:fs";
import path from "node:path";

const [dir, snapshot = "unlabeled snapshot"] = process.argv.slice(2);
if (!dir) { console.error('usage: import-chain.mjs <nodes-folder> "<snapshot label>"'); process.exit(1); }

const OUT = "data/series/chain";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "claims"), { recursive: true });
fs.mkdirSync(path.join(OUT, "nodes"), { recursive: true });

const norm = (s) => (s == null ? s : String(s).trim().replace(/\s+/g, "_"));
const fileSafe = (id) => id.replace(/::/g, "__").replace(/[<>:"/\\|?*]/g, "_"); // Windows-safe names
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []);

const nodes = fs.readdirSync(dir).filter((f) => /\.(ya?ml|json)$/.test(f)).map((f) => ({ file: f, n: read(path.join(dir, f)) }));
const ids = new Set(nodes.map((x) => x.n.id));
let claims = 0, conditionalNoPremise = 0;

for (const { file, n } of nodes) {
  const src = `source/nodes/${file}`;
  const mainId = `${n.id}::main`;
  const declared = list(n.dependencies?.source_declared);
  const proposed = list(n.dependencies?.proposed_primary_support);
  const claimIds = [];

  for (const c of list(n.claims)) {
    const isMain = c.id === mainId;
    const claim_id = isMain ? n.id : c.id;
    const g = c.grade || {};
    const warrant = norm(g.warrant) || norm(c.tags?.warrant?.status) || "unverified";
    let premise = list(c.conditional_premises).join("; ");
    if (!premise && isMain) premise = list(n.soundness?.named_premises).join("; ");
    if (warrant === "conditionally_proved" && !premise) conditionalNoPremise++;
    const t = c.tags || {};
    const rec = {
      record_version: "claim-record/1",
      series: "chain",
      paper: n.id,
      claim_id,
      type: /::receipt::/.test(c.id) ? "RECEIPT" : "CLAIM",
      text: c.statement,
      source: { file: src, quote: c.statement, stated: true },
      tags: { system_part: norm(t.system_part), composition_level: t.composition_level, claim_role: norm(t.claim_role), register: norm(t.register) },
      grade: {
        match_scope: norm(g.match_scope) || undefined,
        warrant,
        ...(premise ? { warrant_premise: premise } : {}),
        outcome: g.outcome ?? null,
        canon_status: g.canon_status || c.canon_status,
        grade_source: `copied:${src}#${c.id} (${snapshot})`,
        note: g.note,
      },
      receipts: list(c.proof_refs).map((ref) => ({ kind: /\.lean/i.test(ref) ? "lean" : /z3/i.test(ref) ? "z3" : "source", ref: String(ref).replace(/\\/g, "/") })),
      neighbors: isMain
        ? [...declared.map((id) => ({ id, edge: "rests_on" })), ...proposed.filter((id) => !declared.includes(id)).map((id) => ({ id, edge: "rests_on", proposed: true }))]
        : [],
      node: n.id,
      is_main: isMain,
      strength: c.strength,
      scope: c.scope || c.scope_limit || undefined,
      conditional_premises: c.conditional_premises || undefined,
      canon_status_reason: c.canon_status_reason,
      obstructions: list(c.Q15).map((q) => ({ id: q.id, kind: q.kind, status: q.Q16, scope: q.scope, reason: q.reason })),
      ...(isMain ? { denial_cost: n.soundness?.denial_cost || undefined, checkable_by: n.soundness?.what_makes_checkable || undefined } : {}),
      generated_by: c.classification_proposal?.approval || undefined,
    };
    fs.writeFileSync(path.join(OUT, "claims", fileSafe(claim_id) + ".json"), JSON.stringify(rec, null, 1) + "\n");
    claimIds.push(claim_id);
    claims++;
  }

  const node = {
    id: n.id, title: n.title, lifecycle: n.node_lifecycle, tier: n.tier, context_parent: n.context_parent,
    merged_into: n.merged_into || null, proposal_only: n.proposal_only, mode: n.proposed_mode,
    declared, proposed, missing_suppliers: [...declared, ...proposed].filter((id) => !ids.has(id)),
    soundness: { bin: n.soundness?.bin, named_premises: list(n.soundness?.named_premises), denial_cost: n.soundness?.denial_cost, checkable_by: n.soundness?.what_makes_checkable, receipt: list(n.soundness?.receipt).map((r) => String(r).replace(/\\/g, "/")) },
    obstructions: list(n.Q15).map((q) => ({ id: q.id, kind: q.kind, status: q.Q16, scope: q.scope, reason: q.reason })),
    ports: list(n.ports).map((p) => ({ id: p.id, agent: p.agent, boundary: p.boundary, input: p.input, output: p.output, evidence: p.evidence })),
    main: n.id, claims: claimIds, source: `source/nodes/${file}`, snapshot,
  };
  fs.writeFileSync(path.join(OUT, "nodes", fileSafe(n.id) + ".json"), JSON.stringify(node, null, 1) + "\n");
}
fs.writeFileSync(path.join(OUT, "series.json"), JSON.stringify({ series: "chain", title: "The axiom chain", summary: `Every node in the chain, from A0 (God is) outward. Snapshot: ${snapshot}.`, snapshot }, null, 1) + "\n");
console.log(`chain: ${nodes.length} nodes, ${claims} claims written to ${OUT} (${conditionalNoPremise} conditionally proved claims name no premise and will be rejected)`);
