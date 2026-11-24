import { NavLink, useParams } from "react-router-dom";
import AgentTown from "../town/AgentTown.jsx";
import RulesTown from "../town/RulesTown.jsx";

export default function Town() {
  const { view } = useParams();
  const rules = view === "rules";
  return (
    <div className="town-page">
      <header className="town-head">
        <h1 className="page-title">The Town</h1>
        <p className="muted">Load a set of rules and watch what can happen. The engine knows nothing about theology; it only runs rules. Doors show which side their handle is on, after Holman Hunt’s <em>The Light of the World</em>: a door with no handle outside opens only from within.</p>
        <nav className="town-tabs" aria-label="Town views">
          <NavLink to="/town" end>Agents in the town</NavLink>
          <NavLink to="/town/rules">Rule engine: Grace and set theory</NavLink>
        </nav>
      </header>
      {rules ? (
        <div className="town-pair">
          <p className="muted town-pair-lede">One engine, two rule sets. Press Run on both: the set-theory town moves with no one choosing; the Grace town stops at every door whose handle is on the inside.</p>
          <RulesTown src="grace-rules.json" />
          <RulesTown src="zfc-rules.json" />
        </div>
      ) : <AgentTown />}
    </div>
  );
}
