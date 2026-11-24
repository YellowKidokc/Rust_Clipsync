// Agents in the town: many agents moving between nodes by rules from a sheet.
// The simulation knows nothing about any particular town. It enforces three things:
//   1. an agent acts only through a rule that names its kind as the actor;
//   2. a rule with a choice is answered by the person it belongs to (their own
//      acceptance rate, or you, if you ask to answer), never by the engine;
//   3. every random draw comes from one seeded generator, so a fixed seed repeats exactly.
import { parse, ev, parseAssign, yes } from "./expr.js";

export function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHAPES = ["place", "boundary", "operator"];

// ---- load a town file; bad rows are rejected with a reason, not repaired ----
export function compileSim(raw) {
  const rejected = [];
  const rej = (sheet, row, why) => rejected.push({ sheet, row, why });
  const town = {
    name: raw.name || "Untitled town", note: raw.note || "", source: raw.source || "",
    params: [], nodes: [], kinds: [], states: [], rules: [], report: [],
  };
  (raw.params || []).forEach((p, i) => {
    if (!p.id) return rej("params", i + 2, "missing id");
    town.params.push({ id: p.id, label: p.label || p.id, min: +(p.min ?? 0), max: +(p.max ?? 1), step: +(p.step ?? 0.05), value: +(p.value ?? 0.5) });
  });
  const nodeIds = new Set();
  (raw.nodes || []).forEach((n, i) => {
    if (!n.id) return rej("nodes", i + 2, "missing id");
    const shape = SHAPES.includes(n.shape) ? n.shape : "place";
    if (n.shape && !SHAPES.includes(n.shape)) rej("nodes", i + 2, `shape "${n.shape}" is not place, boundary or operator; drawn as a place`);
    nodeIds.add(String(n.id));
    town.nodes.push({ id: String(n.id), label: n.label || n.id, shape, x: +n.x || 0, y: +n.y || 0, sub: n.sub || "", front: n.front || "", back: n.back || "" });
  });
  (raw.kinds || []).forEach((k, i) => {
    if (!k.kind) return rej("kinds", i + 2, "missing kind");
    if (k.start_node && !nodeIds.has(k.start_node)) return rej("kinds", i + 2, `start_node "${k.start_node}" is not a node`);
    town.kinds.push({ kind: k.kind, label: k.label || k.kind, count: +(k.count ?? 1), max: +(k.max ?? 20), start_node: k.start_node || (town.nodes[0] || {}).id,
      start_state: k.start_state || "", vars: k.vars || {}, color: k.color || "", behaves: yes(k.behaves), report: yes(k.report), name: k.name || "", each: k.each || k.label });
  });
  (raw.states || []).forEach((s, i) => {
    if (!s.kind || !s.state) return rej("states", i + 2, "needs kind and state");
    town.states.push({ kind: s.kind, state: s.state, label: s.label || s.state, color: s.color || "#888888" });
  });
  const kindSet = new Set(town.kinds.map((k) => k.kind));
  (raw.rules || []).forEach((r, i) => {
    try {
      if (!r.id) throw new Error("missing id");
      if (!r.actor) throw new Error("missing actor (the kind of agent who acts)");
      if (!kindSet.has(r.actor)) throw new Error(`actor "${r.actor}" is not a kind in this town`);
      if (r.target && !kindSet.has(r.target)) throw new Error(`target "${r.target}" is not a kind in this town`);
      for (const f of ["from", "to", "to_" + "accept", "to_refuse"]) if (r[f] && !nodeIds.has(r[f])) throw new Error(`${f} "${r[f]}" is not a node`);
      const choices = String(r.choice || "").split("|").map((s) => s.trim()).filter(Boolean);
      if (choices.length && choices.length !== 2) throw new Error("choice needs exactly two answers, like accept|refuse");
      const then = {}, to = {};
      if (choices.length) choices.forEach((c) => { then[c] = parseAssign(r["then_" + c] || ""); to[c] = r["to_" + c] || r.to || ""; });
      else { then[""] = parseAssign(r.then || ""); to[""] = r.to || ""; }
      town.rules.push({
        id: String(r.id), label: r.label || String(r.id), actor: r.actor, target: r.target || "",
        from: r.from || "", when: parse(r.when || "true"), whenSrc: r.when || "true",
        choices, then, to, lean: r.lean ? parse(r.lean) : null, leanSrc: r.lean || "",
        chance: r.chance === undefined || r.chance === "" ? null : parse(String(r.chance)),
        blocks: String(r.blocks || "").split(/[,|]/).map((s) => s.trim()).filter(Boolean),
        actorTo: r.actor_to || "", always: yes(r.always), say: r.say || "", door: r.door || "", handle: r.handle || "",
        receipt: r.receipt || "", warrant: r.warrant || "",
      });
    } catch (e) { rej("rules", i + 2, e.message); }
  });
  (raw.report || []).forEach((row, i) => {
    if (!row.label || !row.measure) return rej("report", i + 2, "needs label and measure");
    if (!/^(end|avg_steps):state=.+$|^count:[^=]+(=.+)?$/.test(row.measure)) return rej("report", i + 2, `measure "${row.measure}" is not end:state=…, avg_steps:state=… or count:RULE[=choice]`);
    town.report.push({ label: row.label, measure: row.measure, why_zero: row.why_zero || "" });
  });
  if (!town.nodes.length) rejected.push({ sheet: "nodes", row: "-", why: "no nodes: the town is empty" });
  return { town, rejected };
}

// "What can happen here": ways in and ways out of a node, read from the rule sheet.
export function doorsOf(town, nodeId) {
  const label = (k) => (town.kinds.find((x) => x.kind === k) || {}).label || k;
  const ins = [], outs = [];
  for (const r of town.rules) {
    const dests = Object.entries(r.to).filter(([, n]) => n);
    for (const [choice, n] of dests) {
      const moved = r.target ? label(r.target) : label(r.actor);
      const line = { rule: r, choice, who: r.target ? `${label(r.actor)}, acting on ${moved.toLowerCase()}` : `${moved}, on their own`, from: r.from, to: n };
      if (n === nodeId && r.from !== nodeId) ins.push(line);
      if (r.from === nodeId && n !== nodeId) outs.push(line);
    }
  }
  return { ins, outs };
}

// ---- one world ----
export function createWorld(town, opts = {}) {
  const counts = opts.counts || {};
  const params = Object.fromEntries(town.params.map((p) => [p.id, opts.params && p.id in opts.params ? opts.params[p.id] : p.value]));
  const world = { town, params, mode: opts.mode || "follow", askMe: !!opts.askMe, rand: rng(opts.seed ?? 2828), tick: 0, agents: [],
    fires: {}, pending: [], reached: {}, log: [], quiet: !!opts.quiet };
  let n = 0;
  for (const k of town.kinds) {
    const c = Math.max(0, Math.min(k.max, counts[k.kind] ?? k.count));
    for (let i = 0; i < c; i++) {
      n++;
      const label = k.name ? (c > 1 ? `${k.name} ${i + 1}` : k.name) : `${k.each} ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""}`;
      world.agents.push({ id: "a" + n, kind: k.kind, label, node: k.start_node, state: k.start_state, vars: { ...k.vars }, born: 0 });
    }
  }
  return world;
}

function envOf(world, a, t) {
  const env = { ...world.params, tick: world.tick };
  for (const [name, ag] of [["a", a], ["t", t || a]]) {
    env[name + ".node"] = ag.node; env[name + ".state"] = ag.state; env[name + ".kind"] = ag.kind; env[name + ".label"] = ag.label;
    for (const [k, v] of Object.entries(ag.vars)) env[name + "." + k] = v;
  }
  return env;
}

function candidates(world, a, blocked) {
  const out = [];
  for (const r of world.town.rules) {
    if (r.actor !== a.kind) continue;
    const pool = r.target ? world.agents.filter((x) => x.kind === r.target) : [a];
    for (const t of pool) {
      if (r.from && t.node !== r.from) continue;
      if ((blocked[t.id] || []).includes(r.id)) continue;
      if (world.pending.some((p) => p.t === t.id)) continue;
      let ok; try { ok = ev(r.when, envOf(world, a, t)); } catch { ok = false; }
      if (!ok) continue;
      if (!r.choices.length && !r.always && !changes(world, r, a, t, "")) continue;
      out.push({ r, t });
    }
  }
  return out;
}

function changes(world, r, a, t, choice) {
  const env = envOf(world, a, t);
  const dest = r.to[choice];
  if (dest && dest !== t.node) return true;
  for (const asg of r.then[choice] || []) {
    const [who, field] = asg.target.split(".");
    const ag = who === "a" ? a : t;
    const cur = field === "state" ? ag.state : field === "node" ? ag.node : ag.vars[field];
    let v; try { v = ev(asg.expr, env); } catch { return false; }
    if (typeof v === "number") v = Math.round(v * 1e9) / 1e9;
    if (cur !== v) return true;
  }
  return false;
}

function say(world, r, a, t, choice) {
  const fill = (s) => s.replace(/\{a\}/g, a.label).replace(/\{t\}/g, t.label).replace(/\{choice\}/g, choice);
  if (r.say) return fill(r.say);
  return `${a.label}: ${r.label}${t !== a ? " on " + t.label : ""}${choice ? " (" + choice + ")" : ""}.`;
}

function record(world, entry) {
  if (world.quiet) return;
  world.log.unshift(entry);
  if (world.log.length > 300) world.log.length = 300;
}

function applyRule(world, r, a, t, choice, blocked, by) {
  const env = envOf(world, a, t);
  for (const asg of r.then[choice] || []) {
    const [who, field] = asg.target.split(".");
    const ag = who === "a" ? a : t;
    let v = ev(asg.expr, env);
    if (typeof v === "number") v = Math.round(v * 1e9) / 1e9;
    if (field === "state") ag.state = v; else if (field === "node") ag.node = v; else ag.vars[field] = v;
  }
  if (r.to[choice]) t.node = r.to[choice];
  if (r.actorTo === "target" && t !== a) a.node = t.node;
  for (const b of r.blocks) (blocked[t.id] = blocked[t.id] || []).push(b);
  world.fires[r.id] = (world.fires[r.id] || 0) + 1;
  if (choice) world.fires[r.id + "=" + choice] = (world.fires[r.id + "=" + choice] || 0) + 1;
  const k = `${t.id}:${t.state}`;
  if (!(k in world.reached)) world.reached[k] = world.tick;
  record(world, { tick: world.tick, rule: r, text: say(world, r, a, t, choice), choice, by, actor: a.label, target: t.label, touched: [a.id, t.id] });
}

function fire(world, c, a, blocked) {
  const { r, t } = c;
  if (r.chance) {
    let p; try { p = +ev(r.chance, envOf(world, a, t)); } catch { p = 0; }
    if (world.rand() >= p) return; // tried; the chance did not come up, nothing changes
  }
  if (r.choices.length) {
    if (world.askMe) { world.pending.push({ t: t.id, a: a.id, rule: r.id }); record(world, { tick: world.tick, rule: r, text: `${t.label} stands at the door. Only ${t.label} can answer; waiting for you to answer as them.`, waiting: true, touched: [t.id] }); return; }
    let lean = 0.5;
    try { lean = r.lean ? +ev(r.lean, envOf(world, a, t)) : 0.5; } catch { /* keep .5 */ }
    const choice = world.rand() < lean ? r.choices[0] : r.choices[1];
    applyRule(world, r, a, t, choice, blocked, `their own choice (modeled: ${Math.round(lean * 100)}% ${r.choices[0]})`);
    return;
  }
  applyRule(world, r, a, t, "", blocked, "");
}

export function step(world) {
  world.tick++;
  const blocked = {};
  for (const a of world.agents) {
    const cs = candidates(world, a, blocked);
    if (!cs.length) continue;
    const k = world.town.kinds.find((x) => x.kind === a.kind);
    let c;
    if (k && k.behaves && world.mode === "random") c = cs[Math.floor(world.rand() * cs.length)];
    else {
      const first = cs[0].r, same = cs.filter((x) => x.r === first);
      c = same[Math.floor(world.rand() * same.length)];
    }
    fire(world, c, a, blocked);
  }
  return world;
}

// You answer for a person who is waiting at a choice.
export function answer(world, targetId, choice) {
  const i = world.pending.findIndex((p) => p.t === targetId);
  if (i < 0) return;
  const p = world.pending[i]; world.pending.splice(i, 1);
  const r = world.town.rules.find((x) => x.id === p.rule);
  const a = world.agents.find((x) => x.id === p.a), t = world.agents.find((x) => x.id === p.t);
  applyRule(world, r, a, t, choice, {}, "answered by you, as them");
}

// ---- many runs and a report ----
export function runMany(town, { runs = 100, steps = 60, seed = 2828, counts, params, mode } = {}) {
  const rand = rng(seed), reportKind = (town.kinds.find((k) => k.report) || town.kinds[0] || {}).kind;
  const totals = { people: 0, end: {}, stepSum: {}, stepN: {}, fires: {} };
  for (let i = 0; i < runs; i++) {
    const w = createWorld(town, { counts, params, mode, seed: Math.floor(rand() * 2 ** 32), quiet: true });
    for (let s = 0; s < steps; s++) step(w);
    for (const a of w.agents.filter((x) => x.kind === reportKind)) {
      totals.people++;
      totals.end[a.state] = (totals.end[a.state] || 0) + 1;
    }
    for (const [k, t] of Object.entries(w.reached)) {
      const [id, state] = k.split(":");
      if (w.agents.find((x) => x.id === id && x.kind === reportKind)) { totals.stepSum[state] = (totals.stepSum[state] || 0) + t; totals.stepN[state] = (totals.stepN[state] || 0) + 1; }
    }
    for (const [k, v] of Object.entries(w.fires)) totals.fires[k] = (totals.fires[k] || 0) + v;
  }
  return { runs, steps, seed, totals, reportKind };
}

// One value per report row; a row whose rule this town does not have reads 0 with the reason.
export function reportValue(town, res, row) {
  const [kind, rest] = row.measure.split(/:(.*)/s);
  const t = res.totals;
  if (kind === "end") { const st = rest.split("=")[1]; const n = t.end[st] || 0; return { value: t.people ? Math.round((100 * n) / t.people) + "%" : "0%", raw: t.people ? n / t.people : 0 }; }
  if (kind === "avg_steps") { const st = rest.split("=")[1]; const n = t.stepN[st] || 0; return n ? { value: (t.stepSum[st] / n).toFixed(1), raw: t.stepSum[st] / n } : { value: "—", raw: null, note: "no one reached it" }; }
  const ruleId = rest.split("=")[0];
  if (!town.rules.some((r) => r.id === ruleId)) return { value: "0", raw: 0, note: row.why_zero || "no rule in this town allows it" };
  return { value: String(t.fires[rest] || 0), raw: t.fires[rest] || 0 };
}
