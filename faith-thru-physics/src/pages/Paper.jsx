import { useEffect, useState } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { useJSON, getJSON, claimPath, useIndex } from "../lib/data.js";
import { ClaimCard, TenSecondCard, WarrantMarker, Rejected } from "../components/claims.jsx";
import { word } from "../lib/record.js";

export default function Paper() {
  const { paper } = useParams();
  const { search: hash } = useLocation();
  const { data: p, error } = useJSON(`papers/${paper}.json`);
  const { index, lookup } = useIndex();
  const [tab, setTab] = useState("paper");
  const [active, setActive] = useState(null);
  const [record, setRecord] = useState(null);

  useEffect(() => { if (p && !active) setActive(p.ten_second?.claim || null); }, [p]);
  useEffect(() => { if (!active) return; setRecord(null); getJSON(claimPath(active)).then(setRecord, () => setRecord({ missing: active })); }, [active]);
  useEffect(() => { // arriving from a claim page: highlight that sentence
    const m = /claim=([^&]+)/.exec(hash || "");
    if (m) setActive(decodeURIComponent(m[1]));
  }, [hash]);
  useEffect(() => { const el = active && document.querySelector(`[data-claim="${CSS.escape(active)}"]`); if (el && (hash || "").includes("claim=")) el.scrollIntoView({ block: "center" }); }, [p, active]);

  if (error) return <p className="page-pad">This paper isn’t on file. <Link to="/papers">All papers</Link></p>;
  if (!p || !index) return <p className="page-pad ftp-empty">Loading…</p>;
  const ts = p.ten_second, tsGrade = lookup[ts?.claim];
  const claimIds = [...new Set(p.sections.flatMap((s) => s.paragraphs.flat().filter((x) => x && x.claim).map((x) => x.claim)))];

  const seg = (x, i) => {
    if (typeof x === "string") return <span key={i}>{x}</span>;
    const g = lookup[x.claim];
    return (
      <span key={i} data-claim={x.claim}>
        <span className={active === x.claim ? "hl" : ""}>{x.text}</span>{" "}
        {g ? <WarrantMarker grade={g} label={x.claim} active={active === x.claim} onClick={() => setActive(x.claim)} />
           : <button type="button" className="ftp-marker ftp-missing-marker" onClick={() => setActive(x.claim)} aria-label={`${x.claim}: no valid record`}>?</button>}
      </span>
    );
  };

  return (
    <div className="paper">
      <header className="paper-head">
        <p className="ftp-label"><Link to="/papers">{p.series} series</Link> · {p.subtitle}</p>
        <h1>{p.title}</h1>
        <p className="muted">{p.author} · {p.date}</p>
      </header>
      <div className="paper-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "paper"} onClick={() => setTab("paper")}>Paper</button>
        <button role="tab" aria-selected={tab === "ledger"} onClick={() => setTab("ledger")}>Ledger</button>
      </div>
      {tab === "paper" ? (
        <div className="paper-grid">
          <article className="paper-body">
            {ts && <TenSecondCard ground={ts.ground} question={ts.question} claim={(index.find((c) => c.id === ts.claim) || {}).text || ts.claim} grade={tsGrade} breakIt={ts.break_it} />}
            {p.sample_note && <p className="paper-note">{p.sample_note}</p>}
            {p.sections.map((s, si) => (
              <section key={si} className={`paper-sec level-${s.level || 1}`}>
                <h2>{s.heading}</h2>
                {s.paragraphs.map((para, pi) => <p key={pi} id={`s${si}p${pi}`} className="prose">{para.map(seg)}</p>)}
              </section>
            ))}
          </article>
          <aside className="paper-margin" aria-live="polite">
            {!record ? <p className="ftp-empty">Loading the claim…</p>
              : record.missing ? <Rejected errors={[`${record.missing}: no valid record on file. See Rejected records.`]} />
              : <ClaimCard key={record.claim_id} record={record} />}
          </aside>
        </div>
      ) : (
        <section className="ledger">
          <p className="muted">Every table and score for this paper lives here, not in the prose. Grades are copied from the claim records. Scores are AI-proposed wherever they appear.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Claim</th><th>Text</th><th>Warrant</th><th>Outcome</th><th>Canon</th></tr></thead>
            <tbody>{claimIds.map((id) => { const c = index.find((x) => x.id === id); return c ? (
              <tr key={id}><td><WarrantMarker grade={c.grade} /> <Link to={`/claims/${encodeURIComponent(id)}`}>{id}</Link></td><td>{c.text}</td>
                <td>{word(c.grade.warrant)}{c.grade.warrant_premise ? ` (if ${c.grade.warrant_premise.split(":")[0]})` : ""}</td><td>{word(c.grade.outcome)}</td><td>{word(c.grade.canon_status)}</td></tr>
            ) : <tr key={id}><td>{id}</td><td colSpan="4" className="ftp-missing">No valid record on file (see Rejected records).</td></tr>; })}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
