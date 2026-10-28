import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useIndex } from "../lib/data.js";
import { binOf, BIN_LABEL, word } from "../lib/record.js";
import { WarrantMarker } from "../components/claims.jsx";
import { LINKS, layers } from "../lib/graph.js";

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
  const [historical, setHistorical] = useState(false);
  const [linkMode, setLinkMode] = useState("declared");
  const [q, setQ] = useState("");

  // the graph is the chain's nodes (each node's main claim); a sample paper's fixtures are not nodes
  const base = useMemo(() => { const all = index || []; const nodes = all.filter((c) => c.main); return nodes.length ? nodes : all.filter((c) => !c.node); }, [index]);
  const pool = base.filter((c) => historical || c.active !== false);
  const model = useMemo(() => {
    const l = layers(pool, linkMode);
    return { ...l, maxDepth: Math.max(0, l.widths.length - 1) };
  }, [pool.length, linkMode, historical, index]);

  if (error) return <p className="page-pad">The graph index could not be loaded.</p>;
  if (!index) return <p className="page-pad ftp-empty">Loading…</p>;

  const needle = q.trim().toLowerCase();
  const shown = pool.filter(LENSES[lens].test).filter((c) => !needle || c.id.toLowerCase().includes(needle) || (c.title || "").toLowerCase().includes(needle) || c.text.toLowerCase().includes(needle));
  const ancestors = new Set(), descendants = new Set();
  if (sel && model.byId[sel]) {
    const up = (id) => model.parents(model.byId[id]).forEach((p) => { if (!ancestors.has(p)) { ancestors.add(p); up(p); } });
    up(sel);
    const kids = {}; pool.forEach((c) => model.parents(c).forEach((p) => (kids[p] = kids[p] || []).push(c.id)));
    const down = (id) => (kids[id] || []).forEach((k) => { if (!descendants.has(k)) { descendants.add(k); down(k); } });
    down(sel);
  }
  const cur = sel && model.byId[sel];
  const counts = shown.reduce((m, c) => { const b = binOf(c.grade); m[b] = (m[b] || 0) + 1; return m; }, {});
  const histCount = base.filter((c) => c.active === false).length;

  return (
    <div className="graph-page">
      <header className="graph-head">
        <h1 className="page-title">The graph</h1>
        <p className="muted">Each dot is a node of the chain, colored by its main claim’s grade. Depth runs down: a node sits one row below the deepest thing it rests on, and the top row rests on nothing recorded. That top row holds starting points, not only the axiom. A0 (God is) is the admitted root; the links that place nodes under it are context, not proof arrows, so they do not set depth. Click a node to light up what it rests on (gold) and what rests on it (outline).</p>
        <div className="graph-controls">
          <div className="lens-row" role="radiogroup" aria-label="Lens">
            {Object.entries(LENSES).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={lens === k} className="lens" onClick={() => setLens(k)}>{l.label} <span className="muted">{pool.filter(l.test).length}</span></button>)}
          </div>
          <div className="graph-toggles">
            <span className="link-mode" role="radiogroup" aria-label="Which support links set depth">
              {Object.entries(LINKS).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={linkMode === k} title={l.help} onClick={() => { setLinkMode(k); setSel(null); }}>{l.label}</button>)}
            </span>
            <label className="at-check"><input type="checkbox" checked={historical} onChange={(e) => { setHistorical(e.target.checked); setSel(null); }} /> Show the {histCount} historical nodes (retired or merged)</label>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a node: BC6, Wall, grace…" aria-label="Find a node" />
          </div>
        </div>
        <p className="graph-widths muted">Nodes per row, top down: {model.widths.join(" · ")} ({LINKS[linkMode].help}; {historical ? "all records" : "active records"})</p>
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
                  const cls = sel ? (sel === c.id ? " is-sel" : ancestors.has(c.id) ? " is-anc" : descendants.has(c.id) ? " is-desc" : " is-dim") : "";
                  return <button key={c.id} type="button" className={`graph-dot ftp-bin-${b}${cls}${c.active === false ? " is-hist" : ""}${c.id === "A0" ? " is-root" : ""}`}
                    onClick={() => setSel(sel === c.id ? null : c.id)} title={`${c.title || c.id}: ${c.text}`} aria-label={`${c.title || c.id}, ${BIN_LABEL[b]}`} aria-pressed={sel === c.id}>
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
              <p className="ftp-label">{cur.title || cur.id}{cur.lifecycle ? ` · ${word(cur.lifecycle)}` : ""}</p>
              <p className="ftp-claim">{cur.text}</p>
              <p><WarrantMarker grade={cur.grade} showLabel /></p>
              {cur.grade.warrant === "conditionally_proved" && <p className="ftp-premise"><span className="ftp-if">If </span>{cur.grade.warrant_premise}</p>}
              <p className="muted">Rests on: {model.parents(cur).length ? model.parents(cur).map((id) => id + (!(cur.declared || cur.rests_on || []).includes(id) ? " (AI-proposed)" : "")).join(", ") : "nothing recorded"}{cur.context_parent ? ` · context: under ${cur.context_parent}` : ""}</p>
              <p className="muted">{ancestors.size} upstream · {descendants.size} downstream{cur.claim_count ? ` · ${cur.claim_count} claims inside` : ""}</p>
              <Link className="ftp-link" to={`/claims/${encodeURIComponent(cur.id)}`}>Open the node →</Link>
            </div>
          ) : <p className="ftp-empty">Click a dot to see its record.</p>}
        </aside>
      </div>
    </div>
  );
}
