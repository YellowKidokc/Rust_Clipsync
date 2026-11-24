// The rule engine for towns of things (sets, records): fire one rule at a time.
import { parse, ev, parseAssign, val, yes, showSet } from "./expr.js";

// ---- load: {name, things, states, rules, agents} -> compiled town, with rejected rows kept ----
var THING_FIXED = ["id", "kind", "label"];
function compile(raw) {
  var rejected = [], town = { show: raw.show || {}, name: raw.name || "Untitled town", limit: +raw.limit || 24, note: raw.note || "", source: raw.source || "", things: [], states: [], rules: [], agents: [] };
  function rej(sheet, row, why) { rejected.push({ sheet: sheet, row: row, why: why }); }
  (raw.agents || []).forEach(function (a, i) { if (!a.id) return rej("agents", i + 2, "missing id"); town.agents.push({ id: String(a.id), label: a.label || a.id, kind: a.kind || "", color: a.color || "" }); });
  var seen = {};
  (raw.things || []).forEach(function (t, i) {
    if (!t.id || !t.kind) return rej("things", i + 2, "needs id and kind");
    if (seen[t.id]) return rej("things", i + 2, "duplicate id " + t.id); seen[t.id] = 1;
    var th = { id: String(t.id), kind: String(t.kind), label: t.label || String(t.id), vars: {} };
    Object.keys(t).forEach(function (k) { if (THING_FIXED.indexOf(k) < 0) th.vars[k] = val(t[k]); });
    town.things.push(th);
  });
  (raw.states || []).forEach(function (s, i) {
    if (!s.kind || !s.state) return rej("states", i + 2, "needs kind and state");
    try { town.states.push({ kind: String(s.kind), state: String(s.state), when: parse(s.when || "true"), whenSrc: s.when || "true", color: s.color || "#888888", room: s.room || s.state }); }
    catch (e) { rej("states", i + 2, "when: " + e.message); }
  });
  (raw.rules || []).forEach(function (r, i) {
    if (!r.id) return rej("rules", i + 2, "missing id");
    try {
      var on = String(r.on || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
        var b = s.split(":"); if (b.length !== 2) throw new Error("on: write name:kind, like p:person"); return { name: b[0].trim(), kind: b[1].trim() };
      });
      var choices = String(r.choice || "").split("|").map(function (s) { return s.trim(); }).filter(Boolean);
      var then = {};
      if (choices.length) choices.forEach(function (c) { then[c] = parseAssign(r["then_" + c] || ""); });
      else then[""] = parseAssign(r.then || "");
      var create = null;
      if (r.create) {
        var ci = String(r.create).indexOf(":"); if (ci < 1) throw new Error("create: write kind: field = expr; ...");
        create = { kind: String(r.create).slice(0, ci).trim(), assigns: parseAssign(String(r.create).slice(ci + 1)) };
      }
      town.rules.push({ id: String(r.id), label: r.label || String(r.id), agent: String(r.agent || "").trim(), on: on, when: parse(r.when || "true"), whenSrc: r.when || "true",
        choices: choices, then: then, create: create, auto: r.auto === undefined || r.auto === "" ? true : yes(r.auto),
        handle: r.handle || "", door: r.door || "", receipt: r.receipt || "", warrant: r.warrant || "", boundary: r.boundary || "" });
    } catch (e) { rej("rules", i + 2, e.message); }
  });
  if (!town.things.length && !rejected.length) rejected.push({ sheet: "things", row: "-", why: "no things: the town is empty" });
  return { town: town, rejected: rejected };
}

function stateOf(town, th) {
  for (var i = 0; i < town.states.length; i++) {
    var s = town.states[i]; if (s.kind !== th.kind) continue;
    try { if (ev(s.when, envFor({ x: th }, th))) return s; } catch (e) { /* skip */ }
  }
  return { state: "unmarked", color: "#777777", room: "Unmarked" };
}
function envFor(bind) {
  var env = {};
  Object.keys(bind).forEach(function (n) { var th = bind[n]; env[n] = th.vars.members !== undefined ? th.vars.members : th.id; env[n + ".id"] = th.id; env[n + ".label"] = th.label;
    Object.keys(th.vars).forEach(function (k) { env[n + "." + k] = th.vars[k]; }); });
  return env;
}
function bindings(town, rule) {
  var out = [[]];
  rule.on.forEach(function (slot) {
    var next = [], pool = town.things.filter(function (t) { return t.kind === slot.kind; });
    out.forEach(function (b) { pool.forEach(function (t) { next.push(b.concat([t])); }); });
    out = next;
  });
  return out.map(function (list) { var b = {}; rule.on.forEach(function (s, i) { b[s.name] = list[i]; }); return b; });
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// apply one outcome to copies; returns {changes:[...], created} or throws
function outcome(town, rule, bind, choice) {
  var env = envFor(bind), changes = [], created = null;
  (rule.then[choice || ""] || []).forEach(function (a) {
    var dot = a.target.indexOf("."), n = a.target.slice(0, dot), f = a.target.slice(dot + 1), th = bind[n];
    if (!th || dot < 0) throw new Error("cannot set " + a.target);
    var nv = ev(a.expr, env); if (typeof nv === "number") nv = Math.round(nv * 1e9) / 1e9;
    if (!same(th.vars[f], nv)) changes.push({ id: th.id, field: f, from: th.vars[f], to: nv });
  });
  if (rule.create) {
    var vars = {}; rule.create.assigns.forEach(function (a) { var f = a.target.replace(/^.*\./, ""); vars[f] = ev(a.expr, env); });
    var dup = town.things.some(function (t) { return t.kind === rule.create.kind && same(t.vars, vars); });
    if (!dup) { if (town.things.length >= town.limit) throw new Error("the town is full (" + town.limit + " things)"); created = { kind: rule.create.kind, vars: vars }; }
  }
  return { changes: changes, created: created };
}
function agentOK(rule, actingAs) { return !actingAs || !rule.agent || rule.agent === actingAs; }

// every rule x binding with its status: ready | choice | locked (with reason)
function options(town, actingAs) {
  return town.rules.map(function (rule) {
    var bs = bindings(town, rule), best = null, reasons = {};
    if (!bs.length) return { rule: rule, status: "locked", why: "nothing of kind " + rule.on.map(function (s) { return s.kind; }).join(", ") + " in the town" };
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i], ok;
      try { ok = ev(rule.when, envFor(b)); } catch (e) { reasons["condition cannot be read: " + e.message] = 1; continue; }
      if (!ok) { reasons["only if " + rule.whenSrc + " (not true here)"] = 1; continue; }
      if (rule.choices.length) { best = { rule: rule, bind: b, status: "choice" }; break; }
      var o; try { o = outcome(town, rule, b); } catch (e) { reasons[e.message] = 1; continue; }
      if (!o.changes.length && !o.created) { reasons["would change nothing"] = 1; continue; }
      best = { rule: rule, bind: b, status: "ready", preview: o }; break;
    }
    if (best && !agentOK(rule, actingAs)) return { rule: rule, bind: best.bind, status: "locked", why: "only " + rule.agent + " may apply this (you are acting as " + actingAs + ")" };
    return best || { rule: rule, status: "locked", why: Object.keys(reasons)[0] || "not available" };
  });
}
var nextId = 1;
function apply(town, opt, choice) {
  var o = outcome(town, opt.rule, opt.bind, choice);
  o.changes.forEach(function (c) { town.things.filter(function (t) { return t.id === c.id; })[0].vars[c.field] = c.to; });
  var made = null;
  if (o.created) {
    var label = o.created.vars.members !== undefined ? showSet(o.created.vars.members) : opt.rule.create.kind + " " + nextId;
    made = { id: "n" + (nextId++), kind: o.created.kind, label: label, vars: o.created.vars, born: true };
    town.things.push(made);
  }
  var on = Object.keys(opt.bind).map(function (n) { return n + " = " + opt.bind[n].label; }).join(", ");
  var what = o.changes.map(function (c) { return opt.bind[Object.keys(opt.bind).filter(function (n) { return opt.bind[n].id === c.id; })[0]].label + "." + c.field + " " + fmt(c.from) + " → " + fmt(c.to); });
  if (made) what.push("new " + made.kind + " " + made.label);
  return { rule: opt.rule, on: on, choice: choice || "", what: what.length ? what.join("; ") : "no change",
    agent: opt.rule.agent || "", touched: o.changes.map(function (c) { return c.id; }).concat(made ? [made.id] : []) };
}
function fmt(v) { return typeof v === "string" ? showSet(v) : typeof v === "number" ? String(Math.round(v * 1000) / 1000) : String(v); }
function clone(t) { return JSON.parse(JSON.stringify(t, function (k, v) { return v; })); }

// ---- sheets: CSV text, SheetJS workbook, or JSON object ----
function parseCSV(text) {
  var rows = [], row = [], cell = "", q = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  rows = rows.filter(function (r) { return r.some(function (x) { return x.trim(); }); });
  if (!rows.length) return [];
  var head = rows[0].map(function (h) { return h.trim(); });
  return rows.slice(1).map(function (r) { var o = {}; head.forEach(function (h, i) { if (h) o[h] = r[i] === undefined ? "" : r[i]; }); return o; });
}
function sheetName(n) { n = String(n).toLowerCase(); return ["things", "states", "rules", "agents"].filter(function (s) { return n.indexOf(s) >= 0; })[0]; }


export { compile, options, apply, stateOf, parseCSV, sheetName, fmt };
