import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useIndex } from "../lib/data.js";
import { binOf, BIN_LABEL, word } from "../lib/record.js";
import { WarrantMarker } from "../components/claims.jsx";

// Columns: the kind of part. "conserved" is conservation_law; anything else lands in "other".
const COLS = [["agent", "Agent"], ["state", "State"], ["boundary", "Boundary"], ["operator", "Operator"], ["rule", "Rule"], ["conservation_law", "Conserved"], ["observable", "Observable"], ["other", "Other"]];
const colOf = (c) => (COLS.some(([k]) => k === c.tags?.system_part) ? c.tags.system_part : "other");

// Lenses (a provisional mapping from the classifications; see README):
export const LENSES = {
  all: { label: "Everything", test: () => true },
  axioms: { label: "The axiom", test: (c) => c.tags?.claim_role === "axiom" },
  assumptions: { label: "Assumptions", test: (c) => ["assumption", "postulate"].includes(c.tags?.claim_role) },
  definitions: { label: "Definitions", test: (c) => c.tags?.claim_role === "definition" },
  arguments: { label: "Arguments", test: (c) => ["lemma", "theorem", "corollary", "conjecture"].includes(c.tags?.claim_role) },
  doctrines: { label: "Doctrines", test: (c) => c.tags?.register === "spiritual" },
  laws: { label: "Laws", test: (c) => ["rule", "conservation_law", "constitutive_law"].includes(c.tags?.system_part) },
  bridges: { label: "Bridges", test: (c) => ["identification", "isomorphism"].includes(c.tags?.claim_role) || c.bridges },
};

export default function Graph() {
  const { index, error } = useIndex();
  const [lens, setLens] = useState("all");
  const [sel, setSel] = useState(null);

  const model = useMemo(() => {
    if (!index) return null;
    const byId = Object.fromEntries(index.map((c) => [c.id, c]));
    const depth = {};
    const d = (id, seen = new Set()) => {
      if (id in depth) return depth[id];
      if (seen.has(id)) return 0; seen.add(id);
      const ps = (byId[id]?.rests_on || []).filter((p) => byId[p]);
      return (depth[id] = ps.length ? 1 + Math.max(...ps.map((p) => d(p, seen))) : 0);
    };
    index.forEach((c) => d(c.id));
    const maxDepth = Math.max(0, ...Object.values(depth));
    return { byId, depth, maxDepth };
  }, [index]);

  if (error) return <p className="page-pad">The graph index could not be loaded.</p>;
  if (!model) return <p className="page-pad ftp-empty">Loading…</p>;

  const shown = index.filter(LENSES[lens].test);
  const ancestors = new Set();
  if (sel) { const walk = (id) => (model.byId[id]?.rests_on || []).forEach((p) => { if (!ancestors.has(p)) { ancestors.add(p); walk(p); } }); walk(sel); }
  const cur = sel && model.byId[sel];
  const counts = shown.reduce((m, c) => { const b = binOf(c.grade); m[b] = (m[b] || 0) + 1; return m; }, {});

  return (
    <div className="graph-page">
      <header className="graph-head">
        <h1 className="page-title">The graph</h1>
        <p className="muted">Every claim on file as a dot, colored by its warrant. Depth runs down (what rests on what; the top row rests on nothing on file), and the kind of part runs across. Click a claim to light up everything it rests on.</p>
        <div className="lens-row" role="radiogroup" aria-label="Lens">
          {Object.entries(LENSES).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={lens === k} className="lens" onClick={() => setLens(k)}>{l.label} <span className="muted">{index.filter(l.test).length}</span></button>)}
        </div>
        <p className="graph-counts">{Object.entries(counts).map(([b, n]) => <span key={b}><WarrantMarker bin={b} /> {n} {BIN_LABEL[b].toLowerCase()}</span>)}</p>
      </header>
      <div className="graph-wrap">
        <div className="graph-grid" style={{ gridTemplateColumns: `96px repeat(${COLS.length}, minmax(64px, 1fr))` }}>
          <div />
          {COLS.map(([k, l]) => <div key={k} className="graph-colhead ftp-label">{l}</div>)}
          {Array.from({ length: model.maxDepth + 1 }, (_, depth) => [
            <div key={"d" + depth} className="graph-rowhead ftp-label">{depth === 0 ? "Top" : `Depth ${depth}`}</div>,
            ...COLS.map(([k]) => (
              <div key={depth + k} className="graph-cell">
                {shown.filter((c) => model.depth[c.id] === depth && colOf(c) === k).map((c) => {
                  const b = binOf(c.grade);
                  return <button key={c.id} type="button" className={`graph-dot ftp-bin-${b}${sel === c.id ? " is-sel" : ""}${ancestors.has(c.id) ? " is-anc" : ""}${sel && sel !== c.id && !ancestors.has(c.id) ? " is-dim" : ""}`}
                    onClick={() => setSel(sel === c.id ? null : c.id)} title={`${c.id}: ${c.text}`} aria-label={`${c.id}, ${BIN_LABEL[b]}`} aria-pressed={sel === c.id}>
                    <WarrantMarker bin={b} />
                  </button>;
                })}
              </div>
            )),
          ])}
        </div>
        <aside className="graph-side" aria-live="polite">
          {cur ? (
            <div className="graph-record">
              <p className="ftp-label">{cur.id} · {word(cur.tags?.claim_role)}</p>
              <p className="ftp-claim">{cur.text}</p>
              <p><WarrantMarker grade={cur.grade} showLabel /></p>
              {cur.grade.warrant === "conditionally_proved" && <p className="ftp-premise"><span className="ftp-if">If </span>{cur.grade.warrant_premise}</p>}
              <p className="muted">Rests on: {cur.rests_on.length ? cur.rests_on.map((id) => model.byId[id] ? id : id + " (not on file)").join(", ") : "nothing on file"}</p>
              <Link className="ftp-link" to={`/claims/${encodeURIComponent(cur.id)}`}>Open the claim →</Link>
            </div>
          ) : <p className="ftp-empty">Click a dot to see its record.</p>}
        </aside>
      </div>
    </div>
  );
}
