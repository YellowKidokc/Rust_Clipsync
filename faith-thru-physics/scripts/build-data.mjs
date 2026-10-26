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
for (const d of ["claims", "index", "papers", "towns"]) fs.mkdirSync(path.join(OUT, d), { recursive: true });
const write = (p, o) => fs.writeFileSync(path.join(OUT, p), JSON.stringify(o) + "\n");
const safe = (id) => encodeURIComponent(id);

const claims = new Map(), rejects = [], papers = [], series = [];
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
  index.push({ id, series: r.series, paper: r.paper, text: r.text, type: r.type, tags: r.tags, grade: { warrant: r.grade.warrant, outcome: r.grade.outcome ?? null, canon_status: r.grade.canon_status, warrant_premise: r.grade.warrant_premise },
    rests_on: (r.neighbors || []).filter((n) => n.edge === "rests_on").map((n) => n.id), bridges: (r.neighbors || []).some((n) => n.edge === "bridges_to") });
}
for (const p of papers) {
  const missing = [];
  p.sections.forEach((s) => s.paragraphs.forEach((para) => para.forEach((seg) => { if (seg && seg.claim && !claims.has(seg.claim)) missing.push(seg.claim); })));
  p.missing_claims = [...new Set(missing)];
  write(`papers/${p.paper}.json`, p);
}
write("index/claims.json", index);
write("index/papers.json", papers.map((p) => ({ paper: p.paper, series: p.series, title: p.title, subtitle: p.subtitle || "", date: p.date || "" })));
write("index/series.json", series);
write("rejects.json", rejects);
for (const f of fs.readdirSync(path.join(SRC, "towns"))) fs.copyFileSync(path.join(SRC, "towns", f), path.join(OUT, "towns", f));
write("index/towns.json", fs.readdirSync(path.join(SRC, "towns")).map((f) => { const t = JSON.parse(fs.readFileSync(path.join(SRC, "towns", f), "utf8")); return { file: f, name: t.name, format: t.format || "town-rules/1" }; }));
console.log(`claims: ${claims.size} valid, ${rejects.length} rejected · papers: ${papers.length} · towns copied`);
for (const r of rejects) console.log(`  rejected ${r.claim_id || r.file}: ${r.errors.join("; ")}`);
