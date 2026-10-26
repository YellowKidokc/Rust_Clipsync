// claim-record/1: the one format every claim arrives in.
// A record that fails is rejected with its reasons, never repaired.

export const ALLOWED = {
  type: ["CLAIM", "PREMISE", "DEFINITION", "LEAN", "PROOF", "EVIDENCE", "AUDIT", "RECEIPT"],
  system_part: ["agent", "state", "boundary", "operator", "rule", "initial_condition", "symmetry", "constitutive_law", "conservation_law", "observable"],
  claim_role: ["axiom", "definition", "assumption", "postulate", "lemma", "theorem", "corollary", "conjecture", "identification", "isomorphism", "empirical_hypothesis"],
  register: ["spiritual", "formal", "physical", "embodied"],
  match_scope: ["states_only", "states_and_moves", "not_applicable"],
  warrant: ["proved", "conditionally_proved", "admitted", "unverified", "disputed"],
  outcome: ["holds", "fails", null],
  canon_status: ["canon", "open", "retired"],
  verification: ["machine_verified", "peer_reviewed", "author_verified", "unverified"],
  edge: ["rests_on", "holds_up", "formalizes", "sharpens", "sources", "challenges", "instantiates", "verifies", "bridges_to", "conflicts_with"],
};

export function validate(r) {
  const errs = [];
  const need = (v, name) => { if (v === undefined || v === null || v === "") errs.push("missing " + name); };
  const oneOf = (v, list, name) => { if (v !== undefined && !list.includes(v)) errs.push(`${name} not allowed: ${v}`); };
  if (!r || typeof r !== "object") return { ok: false, errors: ["not an object"] };
  const s = r.source || {}, g = r.grade || {}, t = r.tags || {};
  if (r.record_version !== "claim-record/1") errs.push("record_version must be claim-record/1");
  ["series", "paper", "claim_id", "type", "text"].forEach((k) => need(r[k], k));
  need(s.quote, "source.quote");
  if (typeof s.stated !== "boolean") errs.push("missing source.stated");
  if (s.stated === false && !s.reasoning) errs.push("inferred source needs source.reasoning");
  need(g.warrant, "grade.warrant"); need(g.canon_status, "grade.canon_status"); need(g.grade_source, "grade.grade_source");
  oneOf(r.type, ALLOWED.type, "type");
  oneOf(t.system_part, ALLOWED.system_part, "tags.system_part");
  oneOf(t.claim_role, ALLOWED.claim_role, "tags.claim_role");
  oneOf(t.register, ALLOWED.register, "tags.register");
  if (t.composition_level !== undefined && ![0, 1, 2, 3, 4].includes(t.composition_level)) errs.push("tags.composition_level not allowed");
  oneOf(g.match_scope, ALLOWED.match_scope, "grade.match_scope");
  oneOf(g.warrant, ALLOWED.warrant, "grade.warrant");
  if (g.outcome !== undefined) oneOf(g.outcome, ALLOWED.outcome, "grade.outcome");
  oneOf(g.canon_status, ALLOWED.canon_status, "grade.canon_status");
  if (g.warrant === "conditionally_proved" && !g.warrant_premise) errs.push("conditionally_proved needs grade.warrant_premise");
  (r.receipts || []).forEach((x, i) => oneOf(x.verification, ALLOWED.verification, `receipts[${i}].verification`));
  (r.neighbors || []).forEach((x, i) => oneOf(x.edge, ALLOWED.edge, `neighbors[${i}].edge`));
  return { ok: errs.length === 0, errors: errs };
}

// A failed outcome overrides the warrant for display: failures stay visible.
export function binOf(grade) {
  if (!grade) return "open";
  if (grade.outcome === "fails") return "failed";
  return { proved: "proved", conditionally_proved: "conditional", admitted: "admitted", unverified: "open", disputed: "disputed" }[grade.warrant] || "open";
}

export const BIN_LABEL = {
  proved: "Proved", conditional: "Proved, if a premise holds", admitted: "Admitted",
  open: "Open / unverified", disputed: "Disputed", failed: "Tested and failed",
};

const WORD = {
  proved: "Proved", conditionally_proved: "Conditionally proved", admitted: "Admitted", disputed: "Disputed", unverified: "Unverified",
  states_only: "States only", states_and_moves: "States and moves", not_applicable: "Not applicable",
  holds: "Holds", fails: "Fails", canon: "Canon", open: "Open", retired: "Retired",
  machine_verified: "Machine-verified", peer_reviewed: "Peer-reviewed", author_verified: "Author-verified",
};
export const word = (v) => (v == null ? "Not yet established" : WORD[v] || String(v).replace(/_/g, " "));
