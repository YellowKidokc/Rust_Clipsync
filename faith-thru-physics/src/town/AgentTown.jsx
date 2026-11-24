import { useEffect, useMemo, useRef, useState } from "react";
import { compileSim, createWorld, step, answer, runMany, reportValue, doorsOf } from "../lib/town/sim.js";
import { getJSON } from "../lib/data.js";
import { readTownFiles } from "./sheets.js";
import AskAI from "./AskAI.jsx";

const W = 1000, H = 600;
const reduced = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

function NodeShape({ n, selected, onPick }) {
  const r = 58;
  const hex = Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i; return `${n.x + r * Math.cos(a)},${n.y + r * Math.sin(a)}`; }).join(" ");
  return (
    <g className={`at-node at-${n.shape}${selected ? " is-sel" : ""}`} onClick={() => onPick(n.id)} role="button" tabIndex="0" aria-label={`${n.label}, ${n.shape}`}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick(n.id)}>
      {n.shape === "boundary" && <rect x={n.x - 52} y={n.y - 52} width="104" height="104" rx="6" />}
      {n.shape === "operator" && <polygon points={hex} />}
      {n.shape === "place" && <circle cx={n.x} cy={n.y} r={r} />}
      {selected && <circle cx={n.x} cy={n.y} r={r + 12} className="at-ring" />}
      <text x={n.x} y={n.y - 4} className="at-label">{n.label}</text>
      <text x={n.x} y={n.y + 14} className="at-sub">{n.sub}</text>
    </g>
  );
}

// agents sit in rings around their node, in a stable order
function layout(world) {
  const at = {};
  for (const a of world.agents) (at[a.node] = at[a.node] || []).push(a);
  const pos = {};
  for (const [nodeId, list] of Object.entries(at)) {
    const n = world.town.nodes.find((x) => x.id === nodeId);
    if (!n) continue;
    list.forEach((a, i) => {
      const ring = Math.floor(i / 14), k = i % 14, per = Math.min(14, list.length - ring * 14);
      const ang = -Math.PI / 2 + (2 * Math.PI * k) / per, rad = 82 + ring * 22;
      pos[a.id] = [n.x + rad * Math.cos(ang), n.y + rad * Math.sin(ang)];
    });
  }
  return pos;
}

function ReportTable({ a, b }) {
  const rows = [...a.town.report.map((r) => r.label)];
  if (b) for (const r of b.town.report) if (!rows.includes(r.label)) rows.push(r.label);
  const cell = (side, label) => {
    const row = side.town.report.find((r) => r.label === label);
    if (!row) return <td className="muted">not measured here</td>;
    const v = reportValue(side.town, side.res, row);
    return <td><strong>{v.value}</strong>{v.note && <span className="rep-note"> ({v.note})</span>}</td>;
  };
  const differs = (label) => {
    if (!b) return false;
    const ra = a.town.report.find((r) => r.label === label), rb = b.town.report.find((r) => r.label === label);
    return !!(ra && rb) && reportValue(a.town, a.res, ra).value !== reportValue(b.town, b.res, rb).value;
  };
  return (
    <div className="table-wrap">
      <table className="rep-table">
        <thead><tr><th>Measure</th><th>{a.town.name}</th>{b && <th>{b.town.name}</th>}</tr></thead>
        <tbody>{rows.map((label) => <tr key={label} className={differs(label) ? "is-diff" : ""}><td>{label}</td>{cell(a, label)}{b && cell(b, label)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function AgentTown({ initial = "grace-agents.json", rival = "grace-rival.json" }) {
  const [rawA, setRawA] = useState(null), [rawB, setRawB] = useState(null);
  const [townList, setTownList] = useState([]);
  const [msg, setMsg] = useState("");
  const A = useMemo(() => (rawA ? compileSim(rawA) : null), [rawA]);
  const B = useMemo(() => (rawB ? compileSim(rawB) : null), [rawB]);
  const [counts, setCounts] = useState({}), [params, setParams] = useState({});
  const [mode, setMode] = useState("follow"), [askMe, setAskMe] = useState(false);
  const [seed, setSeed] = useState(2828), [fixed, setFixed] = useState(true), [runs, setRuns] = useState(100), [steps, setSteps] = useState(60);
  const [speed, setSpeed] = useState(800);
  const [picked, setPicked] = useState(null);
  const [running, setRunning] = useState(false);
  const [, setTick] = useState(0);
  const [reports, setReports] = useState(null);
  const world = useRef(null), fileA = useRef(null), fileB = useRef(null);

  useEffect(() => {
    getJSON("index/towns.json").then((l) => setTownList(l.filter((t) => /agents/.test(t.format)))).catch(() => {});
    getJSON("towns/" + initial).then(setRawA).catch((e) => setMsg("Could not load the town: " + e.message));
  }, [initial]);

  const town = A?.town;
  useEffect(() => { // new town: reset settings from its sheet
    if (!town) return;
    setCounts(Object.fromEntries(town.kinds.map((k) => [k.kind, k.count])));
    setParams(Object.fromEntries(town.params.map((p) => [p.id, p.value])));
    setPicked(town.nodes[0]?.id || null); setReports(null);
  }, [town]);
  useEffect(() => { if (town) restart(); }, [town, counts, params, mode, askMe]); // eslint-disable-line

  function restart() {
    world.current = createWorld(town, { counts, params, mode, askMe, seed: fixed ? seed : Math.floor(Math.random() * 2 ** 31) });
    setRunning(false); setTick((t) => t + 1);
  }
  function once() { if (world.current) { step(world.current); setTick((t) => t + 1); } }
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => { if (world.current.tick >= 500) { setRunning(false); return; } once(); }, speed);
    return () => clearInterval(id);
  }, [running, speed]);

  function runReports() {
    const seedUsed = fixed ? seed : Math.floor(Math.random() * 2 ** 31);
    const opts = { runs, steps, seed: seedUsed, counts, params, mode };
    const out = { a: { town, res: runMany(town, opts) }, seedUsed, opts };
    if (B) out.b = { town: B.town, res: runMany(B.town, opts) };
    setReports(out);
  }
  async function importInto(setter, e) {
    const fs = e.target.files; if (!fs?.length) return;
    try {
      const r = await readTownFiles(fs);
      if (!r.isAgents) { setMsg("That file is a rule town (things, states, rules). Load it in the Rule engine tab."); return; }
      setter(r.raw); setMsg(r.notes.join(" · "));
    } catch (err) { setMsg("Import failed: " + err.message); }
    e.target.value = "";
  }

  if (!A) return <p className="ftp-empty">{msg || "Loading the town…"}</p>;
  const w = world.current;
  const pos = w ? layout(w) : {};
  const stateColor = (a) => {
    const s = town.states.find((x) => x.kind === a.kind && x.state === a.state);
    return s ? s.color : (town.kinds.find((k) => k.kind === a.kind) || {}).color || "#999";
  };
  const edges = [];
  for (const r of town.rules) for (const to of Object.values(r.to)) if (r.from && to && r.from !== to && !edges.some(([x, y]) => x === r.from && y === to)) edges.push([r.from, to]);
  const node = (id) => town.nodes.find((n) => n.id === id);
  const doors = picked ? doorsOf(town, picked) : null;
  const pn = picked && node(picked);
  const motion = reduced() ? "none" : `transform ${Math.min(450, speed * 0.6)}ms cubic-bezier(.2,.7,.2,1), fill 400ms`;

  return (
    <div className="at">
      <div className="at-side">
        <section>
          <h3><span className="at-num">1</span>What can happen here</h3>
          <div className="at-nodes">{town.nodes.map((n) => <button key={n.id} type="button" className="at-pick" aria-pressed={picked === n.id} onClick={() => setPicked(n.id)}>{n.label} <span className="muted">· {n.shape}</span></button>)}</div>
          {pn && (
            <div className="at-doors">
              <p className="at-door-h">Front door: ways in</p>
              {pn.front && <p>{pn.front}</p>}
              <ul>{doors.ins.map((d, i) => <li key={i}><code>{d.rule.id}</code> {d.rule.label}{d.choice ? ` (${d.choice})` : ""}: {d.who}{d.from ? `, from ${node(d.from)?.label}` : ""}.{d.rule.door && <span className="muted"> {d.rule.door}</span>}</li>)}
                {!doors.ins.length && <li className="muted">No rule brings anyone here; agents can only start here.</li>}</ul>
              <p className="at-door-h">Back door: ways out</p>
              {pn.back && <p>{pn.back}</p>}
              <ul>{doors.outs.map((d, i) => <li key={i}><code>{d.rule.id}</code> {d.rule.label}{d.choice ? ` (${d.choice})` : ""}: {d.who}, to {node(d.to)?.label}.</li>)}
                {!doors.outs.length && <li className="muted">No rule lets anyone leave from here.</li>}</ul>
            </div>
          )}
        </section>
        <section>
          <h3><span className="at-num">2</span>Agents</h3>
          {town.kinds.map((k) => (
            <label key={k.kind} className="at-count"><span><i className="at-swatch" style={{ background: k.color || (town.states.find((s) => s.kind === k.kind) || {}).color }} />{k.label}</span>
              <input type="number" min="0" max={k.max} value={counts[k.kind] ?? k.count} onChange={(e) => setCounts({ ...counts, [k.kind]: Math.max(0, Math.min(k.max, +e.target.value || 0)) })} /></label>
          ))}
        </section>
        <section>
          <h3><span className="at-num">3</span>How people behave</h3>
          <div className="at-seg" role="radiogroup">
            <button type="button" role="radio" aria-checked={mode === "follow"} onClick={() => setMode("follow")}>Follow the rules in order</button>
            <button type="button" role="radio" aria-checked={mode === "random"} onClick={() => setMode("random")}>Wander at random</button>
          </div>
          <p className="at-hint">Wandering still uses only moves the rules allow. When awakened, each person answers for themselves.</p>
          {town.params.map((p) => (
            <label key={p.id} className="at-param"><span>{p.label}</span>
              <span className="at-param-row"><input type="range" min={p.min} max={p.max} step={p.step} value={params[p.id] ?? p.value} onChange={(e) => setParams({ ...params, [p.id]: +e.target.value })} />
                <b>{Math.round((params[p.id] ?? p.value) * 100)}%</b></span></label>
          ))}
          <label className="at-check"><input type="checkbox" checked={askMe} onChange={(e) => setAskMe(e.target.checked)} /> Let me answer for each person when watching</label>
        </section>
        <section>
          <h3><span className="at-num">4</span>Watch</h3>
          <div className="at-btns">
            <button type="button" className="ftp-btn at-go" onClick={() => setRunning(!running)}>{running ? "Pause" : "Run"}</button>
            <button type="button" className="ftp-btn" onClick={once} disabled={running}>Step</button>
            <button type="button" className="ftp-btn" onClick={restart}>Start over</button>
          </div>
          <label className="at-param"><span>Speed</span><input type="range" min="300" max="1600" step="100" value={1900 - speed} onChange={(e) => setSpeed(1900 - +e.target.value)} /></label>
        </section>
        <section>
          <h3><span className="at-num">5</span>Run many</h3>
          <label className="at-check"><input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} /> Fixed seed, so results repeat exactly</label>
          <div className="at-nums">
            <label>Seed <input type="number" value={seed} disabled={!fixed} onChange={(e) => setSeed(+e.target.value || 0)} /></label>
            <label>Runs <input type="number" min="1" max="1000" value={runs} onChange={(e) => setRuns(Math.max(1, Math.min(1000, +e.target.value || 1)))} /></label>
            <label>Steps <input type="number" min="1" max="500" value={steps} onChange={(e) => setSteps(Math.max(1, Math.min(500, +e.target.value || 1)))} /></label>
          </div>
          <button type="button" className="ftp-btn at-go" onClick={runReports}>Run {runs} times and report</button>
        </section>
        <section>
          <h3><span className="at-num">6</span>Compare</h3>
          <select value={rawB ? (townList.find((t) => t.name === rawB.name) || {}).file || "_imported" : ""} onChange={async (e) => { const f = e.target.value; if (!f) { setRawB(null); return; } if (f !== "_imported") setRawB(await getJSON("towns/" + f)); setReports(null); }} aria-label="Rival rule set">
            <option value="">No rival rule set</option>
            {townList.filter((t) => t.file !== initial).map((t) => <option key={t.file} value={t.file}>{t.name}</option>)}
            {rawB && !townList.some((t) => t.name === rawB.name) && <option value="_imported">{rawB.name}</option>}
          </select>
          <div className="at-btns">
            <button type="button" className="ftp-btn" onClick={() => fileB.current.click()}>Import a rival…</button>
            <input ref={fileB} type="file" hidden multiple accept=".json,.csv,.xlsx,.xls" onChange={(e) => importInto(setRawB, e)} />
          </div>
          {B && <p className="at-hint">Both run with the same settings and seed when you press Run {runs} times.</p>}
        </section>
        <section>
          <div className="at-btns">
            <button type="button" className="ftp-btn" onClick={() => fileA.current.click()}>Import your own axioms</button>
            <input ref={fileA} type="file" hidden multiple accept=".json,.csv,.xlsx,.xls" onChange={(e) => importInto(setRawA, e)} />
            <button type="button" className="ftp-btn" onClick={() => { setRawA({ format: "town-agents/1", name: "Empty town", nodes: [], kinds: [], states: [], rules: [], report: [] }); setRawB(null); setMsg("The town is clear. Import nodes, kinds, states, rules and report sheets, or one JSON file."); }}>Clear the town</button>
          </div>
        </section>
      </div>

      <div className="at-main">
        <header className="at-head">
          <h2>{town.name}</h2>
          {town.note && <details><summary>About this town</summary><p>{town.note}</p>{town.source && <p className="muted">Source: <code>{town.source}</code></p>}</details>}
          {msg && <p className="at-msg">{msg}</p>}
        </header>
        {w && w.pending.length > 0 && (
          <div className="at-wait">{w.pending.map((p) => {
            const t = w.agents.find((x) => x.id === p.t), r = town.rules.find((x) => x.id === p.rule);
            return <div key={p.t}><p><strong>{t.label}</strong> stands at the door. Only {t.label} can answer; you are answering as them.</p>
              <div className="at-btns">{r.choices.map((c) => <button key={c} type="button" className="ftp-btn" onClick={() => { answer(w, p.t, c); setTick((x) => x + 1); }}>{c}</button>)}</div></div>;
          })}</div>
        )}
        <div className="at-stage">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${town.name}: nodes and moving agents`}>
            <defs><marker id="at-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="at-arrowhead" /></marker></defs>
            {edges.map(([f, t]) => { const a = node(f), b = node(t); if (!a || !b) return null; const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, o = 64;
              return <line key={f + t} className="at-edge" x1={a.x + (dx / L) * o} y1={a.y + (dy / L) * o} x2={b.x - (dx / L) * o} y2={b.y - (dy / L) * o} markerEnd="url(#at-arrow)" />; })}
            {town.nodes.map((n) => <NodeShape key={n.id} n={n} selected={picked === n.id} onPick={setPicked} />)}
            {w && w.agents.map((a) => { const p = pos[a.id]; if (!p) return null; const person = !town.kinds.find((k) => k.kind === a.kind)?.color;
              const touched = w.log[0]?.tick === w.tick && w.log[0]?.touched?.includes(a.id);
              return <g key={a.id} className="at-agent" style={{ transform: `translate(${p[0]}px, ${p[1]}px)`, transition: motion }}>
                <circle r={person ? 9 : 11} style={{ fill: stateColor(a), transition: reduced() ? "none" : "fill 400ms" }} className={touched ? "is-touched" : ""} />
                {!person && <circle r="4" className="at-agent-core" />}
                <title>{a.label}{a.state ? ` · ${(town.states.find((s) => s.kind === a.kind && s.state === a.state) || {}).label || a.state}` : ""}</title>
              </g>; })}
          </svg>
          <div className="at-legend">
            {town.states.map((s) => <span key={s.kind + s.state}><i style={{ background: s.color }} />{s.label}</span>)}
            {town.kinds.filter((k) => k.color).map((k) => <span key={k.kind}><i className="at-legend-k" style={{ background: k.color }} />{k.label}</span>)}
          </div>
          <p className="at-honest">The town shows the structure of the rules we wrote. It doesn’t prove them.</p>
        </div>
        <div className="at-log-wrap">
          <p className="ftp-label">Log {w ? `· step ${w.tick}` : ""}</p>
          {w && w.log.length ? <ol className="at-log">{w.log.slice(0, 80).map((e, i) => (
            <li key={w.log.length - i} className={e.tick === w.tick ? "is-new" : ""}>
              <span className="at-tick">{e.tick}</span> <code>{e.rule.id}</code> {e.text}{e.by && <span className="at-by"> ({e.by})</span>}
              {e.rule.receipt && <span className="at-receipt"> Rule {e.rule.id} · {e.rule.warrant} · {e.rule.receipt}</span>}
            </li>))}</ol> : <p className="ftp-empty">Press Run or Step to watch.</p>}
        </div>
        {reports && (
          <section className="at-report">
            <h3>Report</h3>
            <p className="muted">{reports.opts.runs} runs × {reports.opts.steps} steps · seed {reports.seedUsed}{fixed ? " (fixed: press again and you get the same numbers)" : ""} · {town.kinds.map((k) => `${k.label}: ${counts[k.kind] ?? k.count}`).join(", ")} · {town.params.map((p) => `${p.label.toLowerCase()} ${Math.round((params[p.id] ?? p.value) * 100)}%`).join(", ")} · {mode === "follow" ? "following the rules in order" : "wandering at random"}</p>
            <ReportTable a={reports.a} b={reports.b} />
            <p className="muted">These numbers follow from the rules and the settings above, nothing more. Rows that differ between the two rule sets are marked. A 0 with a reason means no rule in that town allows it.</p>
          </section>
        )}
        <AskAI context={() => ({ town: town.name, step: w?.tick, agents: w?.agents.map((a) => ({ label: a.label, kind: a.kind, node: a.node, state: a.state })), rules: town.rules.map((r) => ({ id: r.id, label: r.label, actor: r.actor, target: r.target, from: r.from, when: r.whenSrc, choice: r.choices.join("|"), receipt: r.receipt })), recent: w?.log.slice(0, 8).map((e) => e.text) })} hasHistory={!!w?.log.length} />
      </div>
    </div>
  );
}
