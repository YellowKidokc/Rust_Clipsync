import { Link } from "react-router-dom";
import { useJSON, useIndex } from "../lib/data.js";
import { binOf, BIN_LABEL } from "../lib/record.js";
import { WarrantMarker } from "../components/claims.jsx";

// Where the framework stands: counts from the claim records, then the update overlay,
// which is kept apart from the source grades and never changes them.
const STATUS_TONE = { UNRESOLVED: "open", OPEN: "open", UNRESOLVED_INTERPRETATION: "open", UNRESOLVED_APPLICATION: "open", COVERAGE_LIMIT: "open", PROPOSED_RECONCILIATION: "proposed", PROPOSED_VERIFIED_ADAPTER: "proposed" };
const nice = (s) => String(s || "").replace(/_/g, " ").toLowerCase();

export default function Status() {
  const { index } = useIndex();
  const { data: updates } = useJSON("overlay/proposed_page_updates.json");
  const { data: unchecked } = useJSON("overlay/unchecked_main_claims.json");
  const { data: lean } = useJSON("overlay/lean_results.json");
  const { data: z3 } = useJSON("overlay/bidirectional_z3_results.json");
  const { data: native } = useJSON("overlay/native_operator_results.json");
  const { data: theorems } = useJSON("overlay/compiled_theorem_index.json");
  const { data: workbook } = useJSON("overlay/workbook_math_checks.json");
  const { data: contracts } = useJSON("overlay/candidate_operator_contracts.json");
  const { data: rejects } = useJSON("rejects.json");
  const { data: src } = useJSON("overlay/source.json");
  if (!index) return <p className="page-pad ftp-empty">Loading…</p>;

  const nodes = index.filter((c) => c.main);
  const active = nodes.filter((c) => c.active);
  const counts = active.reduce((m, c) => { const b = binOf(c.grade); m[b] = (m[b] || 0) + 1; return m; }, {});
  const z3fams = z3?.families || [];
  const z3dirs = z3fams.flatMap((f) => [f.forward?.status, f.reverse?.status]).filter(Boolean);
  const z3count = (s) => z3dirs.filter((x) => x === s).length;
  const leanFiles = [...new Set((theorems || []).map((t) => t.file))];

  return (
    <div className="status-page">
      <header>
        <h1 className="page-title">Where it stands</h1>
        <p className="lede">The whole axiom chain, counted honestly: what is proved, what holds only if a premise holds, what is admitted, and what nobody has checked yet.</p>
      </header>

      <section className="status-counts">
        <div><span className="big">{nodes.length}</span><span>node records</span></div>
        <div><span className="big">{active.length}</span><span>active</span></div>
        <div><span className="big">{nodes.length - active.length}</span><span>historical (retired or merged), still on file</span></div>
        <div><span className="big">{(index.length && nodes.reduce((s, c) => s + (c.claim_count || 0), 0)).toLocaleString()}</span><span>separate claims inside them</span></div>
      </section>
      <p className="muted">A record count is not a count of verified axioms. There is one axiom, A0: God is, admitted openly as the root.</p>

      <section>
        <h2>The active nodes by their main claim’s grade</h2>
        <ul className="bin-bars">
          {["proved", "negative", "conditional", "admitted", "open", "disputed", "failed"].filter((b) => counts[b]).map((b) => (
            <li key={b}><WarrantMarker bin={b} showLabel /><span className="bar"><i className={`ftp-bin-${b}`} style={{ width: `${(100 * counts[b]) / active.length}%` }} /></span><b>{counts[b]}</b></li>
          ))}
        </ul>
        <p className="muted">Grades are copied from each node’s main claim. A proved side claim inside a node does not lift its main claim. <Link to="/graph">See them in the graph →</Link></p>
      </section>

      {unchecked && (
        <section>
          <h2>{unchecked.length} main claims are not yet checkable</h2>
          <p className="muted">Each is kept visibly open. Narrow proved lemmas do not clear this list.</p>
          <details className="status-list">
            <summary>Show all {unchecked.length}, with what blocks each one</summary>
            <ul>{unchecked.map((u, i) => (
              <li key={i}>{u.nodes.map((n) => <Link key={n} to={`/claims/${encodeURIComponent(n)}`}><code>{n}</code></Link>)} <span className="muted">· {u.source_file}</span>
                <p>{u.obstruction}</p></li>
            ))}</ul>
          </details>
        </section>
      )}

      <section>
        <h2>Machine-checked receipts</h2>
        <div className="receipt-grid">
          <div><span className="big">{theorems?.length ?? "…"}</span><span>Lean theorems compile ({leanFiles.length} files), each in its stated scope</span></div>
          <div><span className="big">{z3dirs.length || "…"}</span><span>Z3 directions checked: {z3count("ENTAILS")} entailments, {z3count("COUNTERMODEL")} countermodels</span></div>
          <div><span className="big">{native ? native.counts.calls.toLocaleString() : "…"}</span><span>operator calls on {native ? native.counts.states.toLocaleString() : "…"} chosen grid states, {native ? native.assertion_failures.length : "…"} assertion failures</span></div>
        </div>
        {native && <p className="muted">Scope: {native.scope}.</p>}
        {lean && (
          <details className="status-list">
            <summary>Lean files in the operator pass</summary>
            <ul>{lean.map((f) => <li key={f.file}><code>{f.file}</code> <span className="pass">{f.status}</span> <span className="muted">· {f.theorems.join(", ")}</span></li>)}</ul>
          </details>
        )}
        {workbook && (
          <details className="status-list">
            <summary>Workbook formulas checked against Z3 ({workbook.filter((w) => w.status === "sat").length} counterexamples found)</summary>
            <ul>{workbook.map((w) => <li key={w.name}><strong>{w.name}</strong>: {w.status === "sat" ? <>fails; counterexample <code>{w.countermodel}</code></> : "holds (no counterexample)"}</li>)}</ul>
          </details>
        )}
      </section>

      {updates && (
        <section>
          <h2>The update overlay</h2>
          <p className="muted">These are proposed changes and scoped results{src ? ` from ${src.folder}` : ""}. They sit beside the source grades and never change them. No canonical source or adopted axiom was edited.</p>
          <ul className="update-list">{updates.map((u) => (
            <li key={u.id}><div className="upd-top"><code>{u.id}</code> <strong>{u.area}</strong> <span className={`upd-status tone-${STATUS_TONE[u.status] || "scoped"}`}>{nice(u.status)}</span></div><p>{u.action}</p></li>
          ))}</ul>
        </section>
      )}

      {contracts && (
        <section>
          <h2>Candidate operator contract <span className="upd-status tone-proposed">{nice(contracts.status)}</span></h2>
          <p className="muted">{contracts.purpose}. {contracts.scope}</p>
          <ul className="plain-list">{contracts.operators.map((o) => (
            <li key={o.name}><code>{o.name}</code> {o.status ? <span className="muted">({nice(o.status)})</span> : <>· {o.actor}</>}{o.open_obligation && <span className="muted"> · still open: {o.open_obligation}</span>}{o.reason && <span className="muted"> · {o.reason}</span>}</li>
          ))}</ul>
        </section>
      )}

      {rejects && (
        <section>
          <h2>{rejects.length} records the site will not show</h2>
          <p className="muted">They fail the claim-record format. {(() => { const n = rejects.filter((r) => r.errors.some((e) => e.includes("warrant_premise"))).length; return n === rejects.length ? "Every one is a conditionally proved claim that names no premise." : `${n} are conditionally proved claims that name no premise.`; })()} The site never shows a conditional claim without its “if”. <Link to="/rejected">See every one and why →</Link></p>
        </section>
      )}
    </div>
  );
}
