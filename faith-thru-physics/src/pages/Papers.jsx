import { Link } from "react-router-dom";
import { useJSON } from "../lib/data.js";

export default function Papers() {
  const { data: papers } = useJSON("index/papers.json"), { data: series } = useJSON("index/series.json");
  if (!papers || !series) return <p className="page-pad ftp-empty">Loading…</p>;
  return (
    <div className="page-pad narrow">
      <h1 className="page-title">Papers</h1>
      {series.map((s) => (
        <section key={s.series} className="series-block">
          <h2>{s.title}</h2><p className="muted">{s.summary}</p>
          <ul className="plain-list">
            {papers.filter((p) => p.series === s.series).map((p) => <li key={p.paper}><Link to={`/papers/${p.paper}`}>{p.title}{p.subtitle ? `, ${p.subtitle}` : ""}</Link> <span className="muted">{p.date}</span></li>)}
            {!papers.some((p) => p.series === s.series) && <li className="muted">No papers yet; its claims are in the graph.</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}
