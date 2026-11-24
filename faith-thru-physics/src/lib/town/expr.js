// A small, safe expression language (no eval) plus hereditarily finite sets.
// Shared by every town; it knows nothing about any particular one.

// ---- hereditarily finite sets as canonical strings: "{}" , "{{}}" ----
function splitSet(s) {
  s = String(s).trim();
  if (s[0] !== "{" || s[s.length - 1] !== "}") throw new Error("not a set: " + s);
  var inner = s.slice(1, -1), out = [], depth = 0, start = 0;
  if (!inner) return out;
  for (var i = 0; i < inner.length; i++) {
    var c = inner[i];
    if (c === "{") depth++; else if (c === "}") depth--;
    else if (c === "," && depth === 0) { out.push(inner.slice(start, i)); start = i + 1; }
  }
  out.push(inner.slice(start));
  return out.map(canon);
}
function mk(members) {
  var u = {}; members.forEach(function (m) { u[m] = 1; });
  return "{" + Object.keys(u).sort().join(",") + "}";
}
function canon(s) { return mk(splitSet(s)); }
var SETFN = {
  pair: function (a, b) { return mk([canon(a), canon(b)]); },
  union: function (a) { var m = []; splitSet(a).forEach(function (x) { m = m.concat(splitSet(x)); }); return mk(m); },
  power: function (a) {
    var m = splitSet(a), subs = [];
    if (m.length > 4) throw new Error("power set too large to draw");
    for (var k = 0; k < (1 << m.length); k++) subs.push(mk(m.filter(function (_, i) { return k & (1 << i); })));
    return mk(subs);
  },
  size: function (a) { return splitSet(a).length; },
  rank: function rank(a) { var m = splitSet(a); return m.length ? 1 + Math.max.apply(null, m.map(rank)) : 0; },
  member: function (x, a) { return splitSet(a).indexOf(canon(x)) >= 0; },
  min: Math.min, max: Math.max, abs: Math.abs, round: function (x, d) { var p = Math.pow(10, d || 0); return Math.round(x * p) / p; }
};
function showSet(s) {
  if (typeof s !== "string" || s[0] !== "{") return s;
  if (s === "{}") return "∅";
  var m = splitSet(s).sort(function (a, b) { return a.length - b.length || (a < b ? -1 : 1); });
  return "{" + m.map(showSet).join(", ") + "}";
}

// ---- a small safe expression language (no eval) ----
function tokenize(src) {
  var t = [], i = 0, re = /\s*(?:(\d+\.?\d*)|('(?:[^']*)'|"(?:[^"]*)")|([A-Za-z_][\w.]*)|(==|!=|<=|>=|&&|\|\||[-+*\/<>!(),=;:|]))/y;
  src = String(src);
  while (i < src.length) {
    re.lastIndex = i; var m = re.exec(src);
    if (!m) { if (/^\s*$/.test(src.slice(i))) break; throw new Error("cannot read near “" + src.slice(i, i + 12) + "”"); }
    i = re.lastIndex;
    if (m[1] !== undefined) t.push({ k: "num", v: parseFloat(m[1]) });
    else if (m[2] !== undefined) t.push({ k: "str", v: m[2].slice(1, -1) });
    else if (m[3] !== undefined) {
      var w = m[3].toLowerCase();
      if (w === "and") t.push({ k: "op", v: "&&" }); else if (w === "or") t.push({ k: "op", v: "||" }); else if (w === "not") t.push({ k: "op", v: "!" });
      else if (w === "true" || w === "false") t.push({ k: "bool", v: w === "true" });
      else t.push({ k: "id", v: m[3] });
    } else if (m[4] !== undefined) t.push({ k: "op", v: m[4] });
  }
  return t;
}
function parse(src) {
  var t = tokenize(src), p = 0;
  function peek(v) { return t[p] && t[p].k === "op" && t[p].v === v; }
  function eat(v) { if (!peek(v)) throw new Error("expected " + v); p++; }
  function bin(next, ops) { return function () { var l = next(); while (t[p] && t[p].k === "op" && ops.indexOf(t[p].v) >= 0) { var o = t[p++].v; l = { o: o, l: l, r: next() }; } return l; }; }
  function prim() {
    var x = t[p++];
    if (!x) throw new Error("unexpected end");
    if (x.k === "num" || x.k === "str" || x.k === "bool") return { c: x.v };
    if (x.k === "op" && x.v === "(") { var e = or(); eat(")"); return e; }
    if (x.k === "op" && (x.v === "!" || x.v === "-")) return { u: x.v, e: prim() };
    if (x.k === "id") {
      if (peek("(")) { p++; var args = []; if (!peek(")")) { args.push(or()); while (peek(",")) { p++; args.push(or()); } } eat(")"); return { f: x.v, a: args }; }
      return { v: x.v };
    }
    throw new Error("unexpected " + x.v);
  }
  var mul = bin(prim, ["*", "/"]), add = bin(mul, ["+", "-"]), cmp = bin(add, ["<", ">", "<=", ">=", "==", "!=", "="]), and = bin(cmp, ["&&"]), or = bin(and, ["||"]);
  var e = or(); if (p < t.length) throw new Error("unexpected " + t[p].v); return e;
}
function ev(n, env) {
  if ("c" in n) return n.c;
  if (n.v) { if (!(n.v in env)) throw new Error("unknown name " + n.v); return env[n.v]; }
  if (n.u) { var x = ev(n.e, env); return n.u === "!" ? !x : -x; }
  if (n.f) { var fn = SETFN[n.f]; if (!fn) throw new Error("unknown function " + n.f); return fn.apply(null, n.a.map(function (a) { return ev(a, env); })); }
  var l = ev(n.l, env), r = ev(n.r, env);
  switch (n.o) { case "+": return l + r; case "-": return l - r; case "*": return l * r; case "/": return l / r;
    case "<": return l < r; case ">": return l > r; case "<=": return l <= r; case ">=": return l >= r;
    case "==": case "=": return l == r; case "!=": return l != r; case "&&": return l && r; case "||": return l || r; }
}
// "x.phase = 0; x.boundary = 'open'"  ->  [{target:"x.phase", expr}]
function parseAssign(src) {
  if (!src || !String(src).trim()) return [];
  return String(src).split(";").map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
    var i = s.indexOf("="); if (i < 1) throw new Error("assignment needs '=': " + s);
    return { target: s.slice(0, i).trim(), expr: parse(s.slice(i + 1)) };
  });
}
function val(v) { // spreadsheet cell -> typed value
  if (typeof v !== "string") return v;
  var s = v.trim(); if (s === "") return "";
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  if (s[0] === "{") { try { return canon(s); } catch (e) { return s; } }
  return s;
}
function yes(v) { return v === true || /^(y|yes|true|1)$/i.test(String(v || "").trim()); }


export { splitSet, canon, SETFN, showSet, tokenize, parse, ev, parseAssign, val, yes };
