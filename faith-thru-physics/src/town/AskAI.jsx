import { useState } from "react";

// Optional AI with the visitor's own key. The key stays in this browser and goes
// straight to Anthropic, never to this site. The AI explains or suggests; it never
// applies a rule or answers anyone's choice.
const KEY = "ftp-ai-key";
const read = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };

export default function AskAI({ context, hasHistory }) {
  const [key, setKey] = useState(read), [out, setOut] = useState(""), [busy, setBusy] = useState(false);
  const save = (v) => { setKey(v); try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* private window */ } };
  async function ask(kind) {
    const q = kind === "explain" ? "Explain in two or three plain sentences what the most recent changes did and which rules allowed them."
      : "Propose one next move: which rule could fire and why. Never answer a choice that belongs to a person in the town; say whose it is instead.";
    setBusy(true); setOut("");
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 400, system: "You explain a rules simulation. Use only the rules and state given. Be brief and exact. The town shows the structure of its rules; it does not prove them.",
          messages: [{ role: "user", content: q + "\n\n" + JSON.stringify(context()) }] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || r.status);
      setOut(j.content.map((c) => c.text || "").join(""));
    } catch (e) { setOut("The request failed: " + e.message); }
    setBusy(false);
  }
  return (
    <details className="ask-ai">
      <summary>Ask an AI (optional, with your own key)</summary>
      <p className="muted">Your Anthropic API key is kept in this browser only and sent straight to Anthropic, never to this site. The AI can explain or suggest; it cannot apply a rule or answer anyone’s choice.</p>
      <div className="ask-row">
        <input type="password" placeholder="sk-ant-…" value={key} onChange={(e) => save(e.target.value.trim())} aria-label="Your API key" autoComplete="off" />
        {key && <button type="button" className="ftp-btn" onClick={() => save("")}>Forget key</button>}
      </div>
      <div className="ask-row">
        <button type="button" className="ftp-btn" disabled={!key || busy || !hasHistory} onClick={() => ask("explain")}>Explain what just happened</button>
        <button type="button" className="ftp-btn" disabled={!key || busy} onClick={() => ask("propose")}>Propose the next move</button>
      </div>
      {busy && <p className="ftp-empty">Asking…</p>}
      {out && <div className="ask-out"><p className="ftp-ai">AI-proposed. Not a rule firing; nothing was applied.</p><p>{out}</p></div>}
    </details>
  );
}
