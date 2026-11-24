import { useJSON } from "../lib/data.js";

export default function Rejects() {
  const { data } = useJSON("rejects.json");
  if (!data) return <p className="page-pad ftp-empty">Loading…</p>;
  return (
    <div className="page-pad narrow">
      <h1 className="page-title">Rejected records</h1>
      <p className="muted">These records failed the claim-record format at build time. They are not shown anywhere else, and nothing tried to repair them. Fix the source record and they will appear.</p>
      {data.length === 0 ? <p>None.</p> : <ul className="reject-list">{data.map((r, i) => (
        <li key={i}><code>{r.claim_id || r.file}</code>{r.text && <span className="muted"> · {r.text}</span>}<ul>{r.errors.map((e) => <li key={e}>{e}</li>)}</ul></li>
      ))}</ul>}
    </div>
  );
}
