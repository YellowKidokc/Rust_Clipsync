// Read a town from files: one JSON file, CSVs named by sheet, or one workbook.
// Sheet names: things, states, rules, agents (rule towns) · nodes, kinds, states, rules, report, params (agent towns).
import { parseCSV } from "../lib/town/things.js";
import { val } from "../lib/town/expr.js";

const SHEETS = ["things", "states", "rules", "agents", "nodes", "kinds", "report", "params"];
const sheetOf = (name) => {
  const n = String(name).toLowerCase().replace(/\.(csv|xlsx?)$/, "");
  return SHEETS.find((s) => n === s || n.endsWith("-" + s) || n.endsWith("_" + s) || n.endsWith(" " + s)) || SHEETS.find((s) => n.includes(s));
};

function loadScript(src) {
  return new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("could not load the spreadsheet reader")); document.head.appendChild(s); });
}

// kinds rows from a sheet: columns named var.<name> become starting values
function tidy(raw) {
  if (raw.kinds) raw.kinds = raw.kinds.map((k) => {
    const out = { vars: {} };
    for (const [c, v] of Object.entries(k)) { if (c.startsWith("var.")) out.vars[c.slice(4)] = val(v); else out[c] = v; }
    return out;
  });
  if (raw.nodes || raw.kinds) raw.format = raw.format || "town-agents/1";
  return raw;
}

export async function readTownFiles(files) {
  const raw = {}, notes = [];
  let json = null, name = "";
  for (const f of Array.from(files)) {
    const n = f.name.toLowerCase();
    if (n.endsWith(".json")) { json = JSON.parse(await f.text()); continue; }
    if (n.endsWith(".csv")) {
      const s = sheetOf(n);
      if (!s) { notes.push(`${f.name}: name it after its sheet, like rules.csv`); continue; }
      raw[s] = parseCSV(await f.text());
      name = name || f.name.replace(/[-_ ]?(things|states|rules|agents|nodes|kinds|report|params)?\.csv$/i, "");
      continue;
    }
    if (/\.xlsx?$/.test(n)) {
      if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
      const wb = window.XLSX.read(await f.arrayBuffer(), { type: "array" });
      for (const sn of wb.SheetNames) {
        const s = sheetOf(sn);
        if (s) raw[s] = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: "", raw: false });
        else notes.push(`sheet “${sn}” ignored`);
      }
      name = f.name.replace(/\.xlsx?$/i, "");
      continue;
    }
    notes.push(`${f.name}: not CSV, Excel or JSON`);
  }
  const town = json || tidy({ name: name || "Imported town", ...raw });
  return { raw: town, notes, isAgents: !!(town.nodes || town.kinds || /agents/.test(town.format || "")) };
}
