import { Link, useParams } from "react-router-dom";
import { useJSON, claimPath, useIndex } from "../lib/data.js";
import { GradeBlock, ClaimPath, WarrantMarker } from "../components/claims.jsx";
import { validate, word } from "../lib/record.js";

export default function Claim() {
  const { id } = useParams();
  const { data: r, error } = useJSON(claimPath(id));
  const { lookup } = useIndex();
  if (error) return <div className="page-pad narrow"><h1 className="page-title">{id}</h1><p>No valid record for this claim is on file. It may have been <Link to="/rejected">rejected</Link> for failing the format.</p></div>;
  if (!r) return <p className="page-pad ftp-empty">Loading…</p>;
  const v = validate(r);
  if (!v.ok) return <div className="page-pad narrow"><p>Record rejected: {v.errors.join("; ")}</p></div>;
  const g = r.grade;
  return (
    <div className="claim-page">
      <header>
        <p className="ftp-label">{r.series} · {r.paper} · {r.claim_id} · {word(r.tags?.claim_role)} · {word(r.tags?.system_part)}</p>
        <h1>{r.text}</h1>
      </header>
      <section><h2>Grade</h2><GradeBlock grade={g} /></section>
      <section><h2>Path</h2><ClaimPath record={r} lookup={lookup} /></section>
      <section>
        <h2>What holds it up</h2>
        <ul className="plain-list prose-list">
          {g.warrant === "conditionally_proved" && <li>Premise <strong>{g.warrant_premise}</strong>. The claim is only as strong as this.</li>}
          {(r.receipts || []).map((x, i) => <li key={i}>{x.kind} receipt: <code>{x.ref}</code> ({word(x.verification)}){g.warrant === "conditionally_proved" ? ". It checks the logic, not the premise." : "."}</li>)}
          {(r.neighbors || []).filter((n) => n.edge === "rests_on").map((n) => <li key={n.id}>Rests on {lookup[n.id] ? <><WarrantMarker grade={lookup[n.id]} /> <Link to={`/claims/${encodeURIComponent(n.id)}`}>{n.id}</Link></> : <span className="ftp-missing">{n.id} (not on file)</span>}</li>)}
          {g.warrant === "admitted" && <li>Admitted openly as a foundation; it is not derived here.</li>}
          {!(r.receipts || []).length && !(r.neighbors || []).some((n) => n.edge === "rests_on") && g.warrant !== "conditionally_proved" && g.warrant !== "admitted" && <li className="muted">Nothing on file holds it up yet.</li>}
        </ul>
      </section>
      <section className="break-box">
        <h2>What would break it</h2>
        <p>{r.breaks_if || (g.warrant === "conditionally_proved" ? `A case where ${g.warrant_premise.split(":").slice(1).join(":").trim() || g.warrant_premise} fails.` : "Not yet written for this claim.")}</p>
      </section>
      <section className="source-box">
        <h2>Source</h2>
        <p>“{r.source.quote}” <span className="muted">· {r.source.file}{r.source.stated ? "" : " · inferred: " + r.source.reasoning}</span></p>
        {r.generated_by && <p className="ftp-ai">{r.generated_by}</p>}
      </section>
      {(r.appears_in || []).length > 0 && (
        <nav className="back-links">{r.appears_in.map((a) => (
          <Link key={a.anchor} to={`/papers/${a.paper}?claim=${encodeURIComponent(r.claim_id)}`}>← Back to the sentence in {a.title}: “{a.text}”</Link>
        ))}</nav>
      )}
    </div>
  );
}
