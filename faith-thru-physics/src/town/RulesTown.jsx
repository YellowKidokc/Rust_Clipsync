import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { compile, options, apply, stateOf, fmt } from "../lib/town/things.js";
import { getJSON } from "../lib/data.js";
import { readTownFiles } from "./sheets.js";

// One rule fires at a time. A rule with a choice never fires on its own: only its agent answers.
const RUN_MS = 500, RUN_CAP = 24;
const reduced = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

export default function RulesTown({ src }) {
  const [base, setBase] = useState(null), [comp, setComp] = useState(null);
  const [log, setLog] = useState([]), [acting, setActing] = useState(""), [running, setRunning] = useState(false);
  const [waiting, setWaiting] = useState(null), [msg, setMsg] = useState(""), [touched, setTouched] = useState([]), [, setTick] = useState(0);
  const rr = useRef(-1), runCount = useRef(0), boxes = useRef({}), rects = useRef({}), file = useRef(null);

  function load(raw, notes = []) {
    const c = compile(raw); setComp(c); setBase(raw); setLog([]); setWaiting(null); setRunning(false); setTouched([]); rr.current = -1;
    setMsg([...notes, c.rejected.length ? `${c.rejected.length} row(s) rejected; see below.` : ""].filter(Boolean).join(" · "));
  }
  useEffect(() => { getJSON("towns/" + src).then((j) => load(j)).catch((e) => setMsg("Could not load the town: " + e.message)); }, [src]);
  const town = comp?.town;
  const opts = town ? options(town, acting) : [];

  function fire(opt, choice) {
    try { const e = apply(town, opt, choice); setLog((l) => [e, ...l].slice(0, 200)); setTouched(e.touched); setWaiting(null); setTick((t) => t + 1); }
    catch (err) { setMsg(`${opt.rule.id} could not fire: ${err.message}`); setRunning(false); }
  }
  function next() {
    const os = options(town, acting), n = os.length;
    for (let j = 1; j <= n; j++) { const i = (rr.current + j) % n, o = os[i]; if ((o.status === "ready" && o.rule.auto) || o.status === "choice") { rr.current = i; return o; } }
    return null;
  }
  function stepOnce() {
    if (!town || waiting) return;
    const o = next();
    if (!o) { setMsg("Nothing more can happen on its own. Locked rules say why."); setRunning(false); return; }
    if (o.status === "choice") { setWaiting(o); setRunning(false); return; }
    fire(o);
  }
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => { if (++runCount.current > RUN_CAP) { setRunning(false); setMsg(`Paused after ${RUN_CAP} changes. Press Run to go on.`); return; } stepOnce(); }, RUN_MS);
    return () => clearInterval(id);
  });
  useLayoutEffect(() => { // a box glides to its new room
    const nextR = {};
    for (const [id, el] of Object.entries(boxes.current)) {
      if (!el) continue;
      const r = el.getBoundingClientRect(), old = rects.current[id]; nextR[id] = r;
      if (old && !reduced() && el.animate && (Math.abs(old.left - r.left) > 1 || Math.abs(old.top - r.top) > 1))
        el.animate([{ transform: `translate(${old.left - r.left}px, ${old.top - r.top}px)` }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.7,.2,1)" });
    }
    rects.current = nextR;
  });

  if (!comp) return <div className="tw tw-empty">{msg || "Loading the town…"}</div>;
  const rooms = [];
  town.states.forEach((s) => { if (!rooms.includes(s.room)) rooms.push(s.room); });
  const placed = town.things.map((t) => ({ t, s: stateOf(town, t) }));
  if (placed.some((x) => !rooms.includes(x.s.room))) rooms.push("Unmarked");
  const agentName = (id) => { const a = town.agents.find((x) => x.id === id); return a ? a.label.replace(/^The /, "the ") : id || "the one inside"; };
  const chosen = log.filter((e) => e.choice).length, byNoOne = log.filter((e) => !e.agent).length;
  const canAnswer = waiting && (!acting || acting === waiting.rule.agent);

  return (
    <section className="tw" aria-label={town.name}>
      <header className="tw-head">
        <h3>{town.name}</h3>
        {town.note && <details className="tw-note"><summary>About this town</summary><p>{town.note}</p></details>}
        <p className="tw-tally">{log.length} changes · {chosen} chosen by someone · {byNoOne} made by no one{town.rules.some((r) => r.choices.length) ? "" : " · no rule here asks anyone"}</p>
      </header>
      <div className="tw-bar">
        <label><span className="ftp-label">Acting as </span>
          <select value={acting} onChange={(e) => setActing(e.target.value)}>
            <option value="">{town.agents.length ? "Each rule's own agent" : "No agents in this town"}</option>
            {town.agents.map((a) => <option key={a.id} value={a.id}>{a.label}{a.kind ? ` (${a.kind})` : ""}</option>)}
          </select></label>
        <button type="button" className="ftp-btn" onClick={() => { setMsg(""); stepOnce(); }} disabled={running || !!waiting}>Step</button>
        <button type="button" className="ftp-btn tw-run" onClick={() => { runCount.current = 0; setMsg(""); setRunning(!running); }} disabled={!!waiting}>{running ? "Pause" : "Run"}</button>
        <button type="button" className="ftp-btn" onClick={() => load(base)}>Reset</button>
        <button type="button" className="ftp-btn" onClick={() => file.current.click()}>Import</button>
        <input ref={file} type="file" hidden multiple accept=".json,.csv,.xlsx,.xls" onChange={async (e) => { const fs = e.target.files; if (!fs?.length) return; try { const r = await readTownFiles(fs); load(r.raw, r.notes); } catch (err) { setMsg("Import failed: " + err.message); } e.target.value = ""; }} />
        <button type="button" className="ftp-btn" onClick={() => { load({ name: "Empty town", things: [], states: [], rules: [], agents: [] }); setMsg("The town is clear. Import a JSON file, CSVs, or a workbook."); }}>Clear</button>
      </div>
      {waiting && (
        <div className="tw-wait" role="status">
          <p><strong>{waiting.rule.id} · {waiting.rule.label}</strong> is waiting on <strong>{Object.values(waiting.bind).map((t) => t.label).join(", ")}</strong>. Only {agentName(waiting.rule.agent)} can answer. The engine will not choose.</p>
          <div className="tw-choices">
            {waiting.rule.choices.map((c) => <button key={c} type="button" className="ftp-btn" disabled={!canAnswer} onClick={() => fire(waiting, c)}>{c}</button>)}
            {!canAnswer && <span className="tw-why">You are acting as {acting}; this answer is not yours.</span>}
          </div>
        </div>
      )}
      {msg && <p className="tw-msg">{msg}</p>}
      <div className="tw-map" style={{ gridTemplateColumns: `repeat(${Math.max(rooms.length, 1)}, minmax(0,1fr))` }}>
        {rooms.map((room) => (
          <div key={room} className="tw-room"><p className="ftp-label">{room}</p>
            <div className="tw-boxes">{placed.filter((x) => (rooms.includes(x.s.room) ? x.s.room : "Unmarked") === room).map((x) => {
              const vars = (town.show[x.t.kind] || Object.keys(x.t.vars)).filter((k) => k !== "members" && k in x.t.vars);
              return <div key={x.t.id} ref={(el) => { boxes.current[x.t.id] = el; }} className={`tw-box${touched.includes(x.t.id) ? " is-touched" : ""}${x.t.born ? " is-born" : ""}`} style={{ "--c": x.s.color }} title={x.s.state}>
                <span className="tw-swatch" /><span className="tw-label">{x.t.label}</span>
                {vars.length > 0 && <span className="tw-vars">{vars.map((k) => `${k} ${fmt(x.t.vars[k])}`).join(" · ")}</span>}
              </div>;
            })}</div>
          </div>
        ))}
      </div>
      <div className="tw-cols">
        <div><p className="ftp-label">Rules</p>
          <ul className="tw-rules">{opts.map((o) => { const r = o.rule; return (
            <li key={r.id} className={`tw-rule is-${o.status}`}>
              <div className="tw-rule-top"><code>{r.id}</code><span className="tw-rule-name">{r.label}</span><span className="tw-agent">{r.agent ? "only " + agentName(r.agent) : "no one acts"}</span>
                {r.handle && <span className="tw-door">{r.handle === "inside" ? "handle inside" : "from outside"}</span>}
                <span className="tw-status">{o.status === "ready" ? (r.auto ? "can fire" : "can fire when pressed") : o.status === "choice" ? "waiting for a choice" : "locked"}</span></div>
              {o.status === "locked" && <p className="tw-why">{o.why}</p>}
              {r.door && <p className="tw-doortext">{r.door}</p>}
              <p className="tw-receipt">{r.warrant ? r.warrant + " · " : ""}{r.receipt || "no receipt"}</p>
              {o.status === "ready" && <button type="button" className="tw-apply" onClick={() => fire(o)}>Apply {r.id}</button>}
              {o.status === "choice" && !waiting && <button type="button" className="tw-apply" onClick={() => setWaiting(o)}>Ask for the choice</button>}
            </li>); })}</ul>
        </div>
        <div><p className="ftp-label">Log</p>
          {log.length ? <ol className="tw-log" reversed>{log.map((e, i) => (
            <li key={log.length - i} className={i === 0 ? "is-new" : ""}><code>{e.rule.id}</code> {e.rule.label}{e.choice && <strong> — {e.choice}</strong>} on {e.on}. {e.what}.{" "}
              <span className="tw-who">{e.agent ? (e.choice ? `Chosen by ${e.agent}.` : `Applied by ${e.agent}.`) : "No one acted; the rule applied itself."}</span>
              {e.rule.receipt && <span className="tw-receipt"> Receipt: {e.rule.receipt}</span>}</li>))}</ol>
            : <p className="ftp-empty">Nothing has happened yet. Press Step or Run.</p>}
        </div>
      </div>
      {comp.rejected.length > 0 && <div className="ftp-rejected" role="alert"><p className="ftp-label">Rows rejected (not loaded, not repaired)</p><ul>{comp.rejected.map((r, i) => <li key={i}>{r.sheet} row {r.row}: {r.why}</li>)}</ul></div>}
    </section>
  );
}
