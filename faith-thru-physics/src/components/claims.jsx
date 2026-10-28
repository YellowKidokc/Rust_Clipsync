import { useState } from "react";
import { Link } from "react-router-dom";
import { validate, binOf, BIN_LABEL, word } from "../lib/record.js";

// The small marker: shape and color both carry the bin, so it reads without color.
export function WarrantMarker({ grade, bin, label, active, onClick, showLabel }) {
  const b = bin || binOf(grade);
  const Tag = onClick ? "button" : "span";
  return (
    <Tag className={`ftp-marker ftp-bin-${b}${active ? " is-active" : ""}`} type={onClick ? "button" : undefined} onClick={onClick}
      aria-label={(label ? label + ": " : "") + BIN_LABEL[b]} title={BIN_LABEL[b]}>
      <svg viewBox="0 0 12 12" aria-hidden="true">
        {b === "proved" && <circle cx="6" cy="6" r="5" className="f" />}
        {b === "conditional" && <><circle cx="6" cy="6" r="4.4" className="s" /><path d="M6 1.6 A4.4 4.4 0 0 0 6 10.4 Z" className="f" /></>}
        {b === "admitted" && <circle cx="6" cy="6" r="4.4" className="s" />}
        {b === "disputed" && <><circle cx="6" cy="6" r="4.4" className="s" /><path d="M3 6 H9" className="s" /></>}
        {b === "failed" && <path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" className="s x" />}
        {b === "negative" && <><circle cx="6" cy="6" r="5" className="f" /><path d="M3.2 6 H8.8" className="cut" /></>}
        {b === "open" && <circle cx="6" cy="6" r="4.4" className="s d" />}
      </svg>
      {showLabel && <span className="ftp-marker-label">{BIN_LABEL[b]}</span>}
    </Tag>
  );
}

const Field = ({ label, children }) => <div className="ftp-field"><dt>{label}</dt><dd>{children}</dd></div>;

// The grade in three separate fields, never one score.
export function GradeBlock({ grade = {} }) {
  return (
    <div className="ftp-grade">
      <div className="ftp-grade-head"><WarrantMarker grade={grade} showLabel /></div>
      {grade.warrant === "conditionally_proved" && <p className="ftp-premise"><span className="ftp-if">If </span>{grade.warrant_premise}</p>}
      {binOf(grade) === "negative" && <p className="ftp-negative">This is a proof that the named assertion is false: a negative result, not a failed proof.</p>}
      <dl className="ftp-fields">
        <Field label="Warrant">{word(grade.warrant)}</Field>
        <Field label="Outcome">{word(grade.outcome)}</Field>
        <Field label="Match scope">{word(grade.match_scope || null)}</Field>
        <Field label="Canon status">{word(grade.canon_status)}</Field>
      </dl>
      {grade.note && <p className="ftp-gnote">{grade.note}</p>}
      <p className="ftp-source">Grade copied from <code>{grade.grade_source || "no source"}</code></p>
    </div>
  );
}

export function Rejected({ errors }) {
  return (
    <div className="ftp-rejected" role="alert">
      <p className="ftp-label">Record rejected</p>
      <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
    </div>
  );
}

// The margin card. Front: claim and grade. Back: evidence, proof, receipt.
export function ClaimCard({ record }) {
  const [flipped, setFlipped] = useState(false);
  const v = validate(record);
  if (!v.ok) return <Rejected errors={v.errors} />;
  const r = record, href = `/claims/${encodeURIComponent(r.claim_id)}`;
  return (
    <div className={`ftp-card ftp-bin-edge-${binOf(r.grade)}${flipped ? " is-flipped" : ""}`}>
      <div className="ftp-card-inner">
        <div className="ftp-face ftp-front" aria-hidden={flipped} inert={flipped ? "" : undefined}>
          <div className="ftp-card-top"><code className="ftp-id">{r.claim_id}</code><span className="ftp-label">{r.tags?.claim_role || r.type.toLowerCase()}</span></div>
          <p className="ftp-claim">{r.text}</p>
          <GradeBlock grade={r.grade} />
          <div className="ftp-actions">
            <button type="button" className="ftp-btn" onClick={() => setFlipped(true)}>Turn it over</button>
            <Link className="ftp-link" to={href}>Open the claim →</Link>
          </div>
        </div>
        <div className="ftp-face ftp-back" aria-hidden={!flipped} inert={!flipped ? "" : undefined}>
          <div className="ftp-card-top"><code className="ftp-id">{r.claim_id}</code><span className="ftp-label">Evidence · proof · receipt</span></div>
          <p className="ftp-label">In the source</p>
          <blockquote className="ftp-quote">“{r.source.quote}”{!r.source.stated && <span className="ftp-inferred"> Inferred: {r.source.reasoning}</span>}</blockquote>
          <p className="ftp-label">Receipts</p>
          {r.grade.warrant === "conditionally_proved" && (
            <p className="ftp-premise"><span className="ftp-if">Still rests on </span>{r.grade.warrant_premise}. The receipts below check the logic, not this premise.</p>
          )}
          {r.receipts?.length ? (
            <ul className="ftp-receipts">{r.receipts.map((x, i) => (
              <li key={i}><span className="ftp-kind">{x.kind}</span><code>{x.ref}</code><span className={`ftp-ver ftp-ver-${x.verification || "none"}`}>{x.verification ? word(x.verification) : "how it was checked is not stated"}</span></li>
            ))}</ul>
          ) : <p className="ftp-empty">No receipt on file.</p>}
          {r.generated_by && <p className="ftp-ai">{r.generated_by}</p>}
          <div className="ftp-actions">
            <button type="button" className="ftp-btn" onClick={() => setFlipped(false)}>Turn back</button>
            <Link className="ftp-link" to={href}>Open the claim →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TenSecondCard({ ground, question, claim, grade, breakIt }) {
  const b = binOf(grade);
  return (
    <details className="ftp-ten">
      <summary><span className="ftp-label">10-second card</span><WarrantMarker bin={b} showLabel /></summary>
      <dl className="ftp-ten-body">
        <Field label="Ground">{ground}</Field>
        <Field label="Question">{question}</Field>
        <Field label="Claim">{claim}</Field>
        <Field label="Grade">{BIN_LABEL[b]}{grade?.warrant === "conditionally_proved" && <span className="ftp-premise-inline"> — if {grade.warrant_premise}</span>}</Field>
        <Field label="Fastest way to break it">{breakIt}</Field>
      </dl>
    </details>
  );
}

// What it rests on, itself, what it holds up. A neighbor not on file is shown as such, never stronger.
export function ClaimPath({ record, lookup }) {
  const ns = record.neighbors || [];
  const col = (edge, title) => {
    const items = ns.filter((n) => n.edge === edge);
    return (
      <div className="ftp-path-col"><p className="ftp-label">{title}</p>
        {items.length ? <ul>{items.map((n) => {
          const g = lookup[n.id];
          return <li key={n.id}>{g ? <WarrantMarker grade={g} /> : <WarrantMarker bin="open" />}
            {g ? <Link to={`/claims/${encodeURIComponent(n.id)}`}>{n.id}</Link> : <span className="ftp-missing" title="No valid record on file">{n.id} · not on file</span>}</li>;
        })}</ul> : <p className="ftp-empty">Nothing on file.</p>}
      </div>
    );
  };
  const others = ns.filter((n) => n.edge !== "rests_on" && n.edge !== "holds_up");
  return (
    <div className="ftp-path">
      {col("rests_on", "Rests on")}
      <div className="ftp-path-self"><WarrantMarker grade={record.grade} /><code>{record.claim_id}</code></div>
      {col("holds_up", "Holds up")}
      {others.length > 0 && <p className="ftp-path-other">{others.map((n) => `${n.edge.replace(/_/g, " ")} ${n.id}`).join(" · ")}</p>}
    </div>
  );
}
