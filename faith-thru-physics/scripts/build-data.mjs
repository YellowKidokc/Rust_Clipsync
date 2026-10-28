// Build step: read data/ (the source of truth), validate every claim record,
// and write the static files the site reads into public/data/.
//   public/data/claims/<id>.json     one per valid claim (with holds_up filled in)
//   public/data/index/claims.json    a small index for the graph and lookups
//   public/data/index/papers.json    papers by series
//   public/data/papers/<paper>.json  each paper
//   public/data/towns/*.json         town files, copied as-is
//   public/data/rejects.json         every record that failed, with its reasons
// Nothing is repaired. A rejected record never reaches the site.
import fs from "node:fs";
import path from "node:path";
import { validate } from "../src/lib/record.js";

const SRC = "data", OUT = "public/data";
fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ["claims", "index", "papers", "towns", "nodes"]) fs.mkdirSync(path.join(OUT, d), { recursive: true });
const write = (p, o) => fs.writeFileSync(path.join(OUT, p), JSON.stringify(o) + "\n");
const safe = (id) => encodeURIComponent(id);

const claims = new Map(), rejects = [], papers = [], series = [], nodes = new Map();
for (const s of fs.readdirSync(path.join(SRC, "series"))) {
  const dir = path.join(SRC, "series", s);
  if (fs.existsSync(path.join(dir, "series.json"))) series.push(JSON.parse(fs.readFileSync(path.join(dir, "series.json"), "utf8")));
  const cdir = path.join(dir, "claims");
  for (const f of fs.existsSync(cdir) ? fs.readdirSync(cdir).filter((x) => x.endsWith(".json")) : []) {
    const file = path.join(cdir, f);
    let rec;
    try { rec = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { rejects.push({ file, errors: ["not valid JSON: " + e.message] }); continue; }
    const v = validate(rec);
    if (!v.ok) { rejects.push({ file, claim_id: rec.claim_id, text: rec.text, errors: v.errors }); continue; }
    if (claims.has(rec.claim_id)) { rejects.push({ file, claim_id: rec.claim_id, errors: ["duplicate claim_id"] }); continue; }
    claims.set(rec.claim_id, structuredClone(rec));
  }
  const ndir = path.join(dir, "nodes");
  for (const f of fs.existsSync(ndir) ? fs.readdirSync(ndir).filter((x) => x.endsWith(".json")) : []) { const n = JSON.parse(fs.readFileSync(path.join(ndir, f), "utf8")); nodes.set(n.id, n); }
  const pdir = path.join(dir, "papers");
  for (const f of fs.existsSync(pdir) ? fs.readdirSync(pdir).filter((x) => x.endsWith(".json")) : []) papers.push(JSON.parse(fs.readFileSync(path.join(pdir, f), "utf8")));
}
// fill the inverse edge: if X rests on Y, then Y holds up X
for (const [id, r] of claims) for (const n of r.neighbors || []) {
  if (n.edge !== "rests_on") continue;
  const up = claims.get(n.id);
  if (up && !up.neighbors.some((m) => m.id === id && m.edge === "holds_up")) up.neighbors.push({ id, edge: "holds_up", derived: true });
}
// where each claim appears in a paper (for "back to the sentence")
const appears = {};
for (const p of papers) p.sections.forEach((s, si) => s.paragraphs.forEach((para, pi) => para.forEach((seg) => {
  if (seg && seg.claim) (appears[seg.claim] = appears[seg.claim] || []).push({ paper: p.paper, title: p.title, anchor: `s${si}p${pi}`, text: seg.text });
})));
const index = [];
for (const [id, r] of claims) {
  r.appears_in = appears[id] || [];
  write(`claims/${safe(id)}.json`, r);
  // the index carries one claim per node (its main claim), claims outside any node, and any claim a paper cites
  if (r.node && !r.is_main && !appears[id]) continue;
  index.push({ id, series: r.series, paper: r.paper, text: r.text, type: r.type, tags: r.tags, grade: { warrant: r.grade.warrant, outcome: r.grade.outcome ?? null, canon_status: r.grade.canon_status, warrant_premise: r.grade.warrant_premise },
    rests_on: (r.neighbors || []).filter((n) => n.edge === "rests_on" && !n.proposed).map((n) => n.id),
    proposed: (r.neighbors || []).filter((n) => n.edge === "rests_on" && n.proposed).map((n) => n.id),
    ...(nodes.has(id) ? { declared: nodes.get(id).declared, proposed_support: nodes.get(id).proposed } : {}),
    bridges: (r.neighbors || []).some((n) => n.edge === "bridges_to") || /^BRIDGE-/.test(id),
    ...(r.node ? { node: r.node, main: !!r.is_main } : {}),
    ...(nodes.has(id) ? { title: nodes.get(id).title, lifecycle: nodes.get(id).lifecycle, bin: nodes.get(id).soundness?.bin, claim_count: nodes.get(id).claims.length, context_parent: nodes.get(id).context_parent || null, active: !["retired", "merged"].includes(nodes.get(id).lifecycle) } : {}) });
}
for (const p of papers) {
  const missing = [];
  p.sections.forEach((s) => s.paragraphs.forEach((para) => para.forEach((seg) => { if (seg && seg.claim && !claims.has(seg.claim)) missing.push(seg.claim); })));
  p.missing_claims = [...new Set(missing)];
  write(`papers/${p.paper}.json`, p);
}
// the update overlay (kept apart from source grades): newest data/sources/*/overlay/
const overlayDirs = fs.existsSync(path.join(SRC, "sources")) ? fs.readdirSync(path.join(SRC, "sources")).sort().map((d) => path.join(SRC, "sources", d, "overlay")).filter((d) => fs.existsSync(d)) : [];
const overlayDir = overlayDirs.at(-1);
const unchecked = {};
if (overlayDir) {
  fs.mkdirSync(path.join(OUT, "overlay"), { recursive: true });
  for (const f of fs.readdirSync(overlayDir).filter((x) => x.endsWith(".json"))) fs.copyFileSync(path.join(overlayDir, f), path.join(OUT, "overlay", f));
  const u = path.join(overlayDir, "unchecked_main_claims.json");
  if (fs.existsSync(u)) for (const x of JSON.parse(fs.readFileSync(u, "utf8").replace(/^\uFEFF/, ""))) for (const n of x.nodes) unchecked[n] = { verdict: x.source_verdict, obstruction: x.obstruction, checkable_by: x.what_makes_checkable, source_file: x.source_file, note: x.note };
  write("overlay/source.json", { folder: path.relative(SRC, path.dirname(overlayDir)) });
}
// node files: each claim's grade summary, and whether it passed the format
for (const [id, n] of nodes) {
  n.claim_summaries = n.claims.map((cid) => { const r = claims.get(cid); const rj = rejects.find((x) => x.claim_id === cid);
    return r ? { id: cid, text: r.text, grade: { warrant: r.grade.warrant, outcome: r.grade.outcome ?? null, canon_status: r.grade.canon_status, warrant_premise: r.grade.warrant_premise }, type: r.type }
             : { id: cid, rejected: rj ? rj.errors : ["not on file"] }; });
  if (unchecked[id]) n.unchecked = unchecked[id];
  n.held_up = [...nodes.values()].filter((m) => m.declared.includes(id)).map((m) => m.id);
  n.held_up_proposed = [...nodes.values()].filter((m) => m.proposed.includes(id) && !m.declared.includes(id)).map((m) => m.id);
  write(`nodes/${safe(id)}.json`, n);
}
write("index/claims.json", index);
write("index/papers.json", papers.map((p) => ({ paper: p.paper, series: p.series, title: p.title, subtitle: p.subtitle || "", date: p.date || "" })));
write("index/series.json", series);
write("rejects.json", rejects);
for (const f of fs.readdirSync(path.join(SRC, "towns"))) fs.copyFileSync(path.join(SRC, "towns", f), path.join(OUT, "towns", f));
write("index/towns.json", fs.readdirSync(path.join(SRC, "towns")).map((f) => { const t = JSON.parse(fs.readFileSync(path.join(SRC, "towns", f), "utf8")); return { file: f, name: t.name, format: t.format || "town-rules/1" }; }));
// For hosts that cannot hold thousands of files (a preview page), BUNDLE=1 also writes
// every data file into one data/bundle.json: { "<path>": <contents> }.
if (process.env.BUNDLE) {
  const bundle = {};
  const walk = (d) => { for (const f of fs.readdirSync(path.join(OUT, d))) { const rel = d ? `${d}/${f}` : f; const full = path.join(OUT, rel);
    if (fs.statSync(full).isDirectory()) walk(rel); else if (f.endsWith(".json") && rel !== "bundle.json") bundle[rel] = JSON.parse(fs.readFileSync(full, "utf8")); } };
  walk("");
  fs.writeFileSync(path.join(OUT, "bundle.json"), JSON.stringify(bundle));
  console.log(`bundle: ${Object.keys(bundle).length} files in data/bundle.json`);
}
console.log(`nodes: ${nodes.size} · claims: ${claims.size} valid, ${rejects.length} rejected · papers: ${papers.length} · towns copied`);
const why = {}; for (const r of rejects) for (const e of r.errors) why[e] = (why[e] || 0) + 1;
for (const [e, n] of Object.entries(why)) console.log(`  rejected ${n}: ${e}`);
