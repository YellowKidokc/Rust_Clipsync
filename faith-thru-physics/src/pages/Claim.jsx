import { Link, useParams } from "react-router-dom";
import { useJSON, claimPath, nodePath, useIndex } from "../lib/data.js";
import { GradeBlock, ClaimPath, WarrantMarker } from "../components/claims.jsx";
import { validate, word } from "../lib/record.js";

const enc = encodeURIComponent;
const claimLink = (id) => `/claims/${enc(id)}`;

function Obstructions({ list }) {
  if (!list?.length) return null;
  return (
    <ul className="plain-list obstruction-list">
      {list.map((q) => (
        <li key={q.id}><span className={`ob-status ob-${(q.status || "").toLowerCase()}`}>{q.status || "—"}</span> <strong>{q.kind}</strong>{q.scope ? ` · ${q.scope}` : ""}<br /><span className="muted">{q.reason}</span></li>
      ))}
    </ul>
  );
}

// The node a claim belongs to: its other claims, its operators, what it rests on and holds up.
function NodePanel({ id, isMain, lookup }) {
  const { data: n } = useJSON(nodePath(id));
  if (!n) return null;
  const dep = (ids, proposed) => ids.map((d) => (
    <li key={d}>{lookup[d] ? <WarrantMarker grade={lookup[d]} /> : <WarrantMarker bin="open" />} {lookup[d] ? <Link to={claimLink(d)}>{d}</Link> : <span className="ftp-missing">{d} (not on file)</span>}{proposed && <span className="muted"> · AI-proposed link</span>}</li>
  ));
  return (
    <>
      {!isMain && <section><h2>Part of node</h2><p><Link to={claimLink(n.id)}>{n.title}</Link> <span className="muted">· {word(n.lifecycle)}</span></p></section>}
      {isMain && (
        <>
          {n.unchecked && (
            <section className="unchecked-box">
              <h2>Main claim not yet checkable</h2>
              <p>{n.unchecked.obstruction}</p>
              <p className="muted">What would make it checkable: {n.unchecked.checkable_by}</p>
              <p className="muted">From the update overlay ({n.unchecked.source_file}). It stays open until this is supplied; narrower proved lemmas do not close it.</p>
            </section>
          )}
          <section>
            <h2>The node</h2>
            <dl className="node-facts">
              <div><dt>Lifecycle</dt><dd>{word(n.lifecycle)}{n.merged_into ? ` (merged into ${n.merged_into})` : ""}</dd></div>
              <div><dt>Soundness bin</dt><dd>{n.soundness.bin || "—"}</dd></div>
              {n.tier != null && <div><dt>Tier</dt><dd>{n.tier}</dd></div>}
              {n.context_parent && <div><dt>Context</dt><dd>under {n.context_parent} (context, not derivation)</dd></div>}
            </dl>
            {n.soundness.named_premises.length > 0 && <p className="node-p"><strong>Named premises:</strong> {n.soundness.named_premises.join("; ")}</p>}
          </section>
          <section>
            <h2>Rests on</h2>
            {n.declared.length + n.proposed.length ? <ul className="plain-list">{dep(n.declared, false)}{dep(n.proposed.filter((x) => !n.declared.includes(x)), true)}</ul> : <p className="muted">Nothing recorded. It is a starting point in the graph.</p>}
            <h2 className="h2-gap">Holds up</h2>
            {n.held_up.length + n.held_up_proposed.length ? <ul className="plain-list cols">{dep(n.held_up, false)}{dep(n.held_up_proposed, true)}</ul> : <p className="muted">Nothing on file rests on it.</p>}
          </section>
          {n.ports.length > 0 && (
            <section>
              <h2>Operators (what an agent can do here)</h2>
              <ul className="plain-list">{n.ports.map((p) => <li key={p.id}><code>{p.id}</code> <strong>{(p.agent || []).join(", ")}</strong>: {p.boundary}</li>)}</ul>
              {n.id === "GRACE-001" && <p><Link to="/town">Watch these operators run in the Town →</Link></p>}
            </section>
          )}
          {n.obstructions.length > 0 && <section><h2>Where it stops (obstructions)</h2><Obstructions list={n.obstructions} /></section>}
          <section>
            <h2>All claims in this node ({n.claim_summaries.length})</h2>
            <ul className="node-claims">
              {n.claim_summaries.map((c) => c.rejected
                ? <li key={c.id} className="is-rejected"><span className="ftp-marker ftp-missing-marker" aria-hidden="true">?</span> <code>{c.id}</code> <span className="muted">rejected: {c.rejected.join("; ")}</span></li>
                : <li key={c.id}><WarrantMarker grade={c.grade} /> <Link to={claimLink(c.id)}>{c.text}</Link></li>)}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

export default function Claim() {
  const { id } = useParams();
  const { data: r, error } = useJSON(claimPath(id));
  const { lookup } = useIndex();
  if (error) return <div className="page-pad narrow"><h1 className="page-title">{id}</h1><p>No valid record for this claim is on file. It may have been <Link to="/rejected">rejected</Link> for failing the format.</p></div>;
  if (!r) return <p className="page-pad ftp-empty">Loading…</p>;
  const v = validate(r);
  if (!v.ok) return <div className="page-pad narrow"><p>Record rejected: {v.errors.join("; ")}</p></div>;
  const g = r.grade;
  const premises = r.conditional_premises?.length ? r.conditional_premises : null;
  return (
    <div className="claim-page">
      <header>
        <p className="ftp-label">{r.series} · {r.node ? (r.is_main ? `node ${r.node}` : `${r.node} · ${r.claim_id.split("::").slice(1).join(" · ")}`) : r.paper} · {word(r.tags?.claim_role)} · {word(r.tags?.system_part)}</p>
        <h1>{r.text}</h1>
      </header>
      <section><h2>Grade</h2><GradeBlock grade={g} /></section>
      {!r.node && <section><h2>Path</h2><ClaimPath record={r} lookup={lookup} /></section>}
      <section>
        <h2>What holds it up</h2>
        <ul className="plain-list prose-list">
          {g.warrant === "conditionally_proved" && <li>Only if: <strong>{g.warrant_premise}</strong>. The claim is only as strong as this.</li>}
          {premises && g.warrant !== "conditionally_proved" && <li>Premises it needs: {premises.join("; ")}</li>}
          {(r.receipts || []).map((x, i) => <li key={i}>{x.kind} receipt: <code>{x.ref}</code>{x.verification ? ` (${word(x.verification)})` : ""}{g.warrant === "conditionally_proved" ? ". It checks the logic, not the premise." : "."}</li>)}
          {g.warrant === "admitted" && <li>Admitted openly; it is not derived here.</li>}
          {g.warrant === "unverified" && !premises && <li className="muted">Not yet checked. Nothing on file holds it up.</li>}
          {r.scope && <li className="muted">Scope: {r.scope}</li>}
        </ul>
      </section>
      <section className="break-box">
        <h2>What would break it</h2>
        <p>{r.breaks_if
          || (g.warrant === "conditionally_proved" ? `Any one of its premises failing: ${g.warrant_premise}.` : null)
          || r.checkable_by
          || (premises ? `Any of the premises it needs failing.` : "Not yet written for this claim.")}</p>
        {r.denial_cost && <p className="muted">If denied: {r.denial_cost}</p>}
      </section>
      {r.obstructions?.length > 0 && <section><h2>Where it stops</h2><Obstructions list={r.obstructions} /></section>}
      {r.node && <NodePanel id={r.node} isMain={r.is_main} lookup={lookup} />}
      <section className="source-box">
        <h2>Source</h2>
        <p>“{r.source.quote}” <span className="muted">· {r.source.file}{r.source.stated ? "" : " · inferred: " + r.source.reasoning}</span></p>
        {r.canon_status_reason && <p className="muted">Canon status: {r.canon_status_reason}</p>}
        {r.generated_by && <p className="ftp-ai">{r.generated_by}</p>}
      </section>
      {(r.appears_in || []).length > 0 && (
        <nav className="back-links">{r.appears_in.map((a) => (
          <Link key={a.anchor} to={`/papers/${a.paper}?claim=${enc(r.claim_id)}`}>← Back to the sentence in {a.title}: “{a.text}”</Link>
        ))}</nav>
      )}
    </div>
  );
}
