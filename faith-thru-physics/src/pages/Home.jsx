import { Link } from "react-router-dom";
import { WarrantMarker } from "../components/claims.jsx";

export default function Home() {
  return (
    <div className="home">
      <p className="home-lede">Faith thru Physics tests Christian theology the way a scientist tests a theory, and every claim carries an honest label saying how we know it.</p>
      <div className="home-ways">
        <Link to="/papers/grace-necessity-paper-1" className="home-way"><span className="home-way-title">Read a paper</span><span>Prose first. Tap a marker to see what holds a claim up.</span></Link>
        <Link to="/graph" className="home-way"><span className="home-way-title">Explore the graph</span><span>Every claim as a dot, from the one axiom down.</span></Link>
        <Link to="/town" className="home-way"><span className="home-way-title">Walk the Town</span><span>Load a set of rules, add people, and watch what can happen.</span></Link>
      </div>
      <p className="home-status"><Link to="/status">Where it stands</Link>: every node of the chain, what is proved, what holds only if a premise holds, and what is still open.</p>
      <dl className="home-key" aria-label="What the markers mean">
        {["proved", "negative", "conditional", "admitted", "open", "disputed", "failed"].map((b) => <div key={b}><WarrantMarker bin={b} showLabel /></div>)}
      </dl>
    </div>
  );
}
