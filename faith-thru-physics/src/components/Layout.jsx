import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { search } from "../lib/worker.js";

function ThemeToggle() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("ftp-theme") || ""; } catch { return ""; } });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
    try { theme ? localStorage.setItem("ftp-theme", theme) : localStorage.removeItem("ftp-theme"); } catch { /* private window */ }
  }, [theme]);
  const isDark = theme ? theme === "dark" : !window.matchMedia("(prefers-color-scheme: light)").matches;
  return <button type="button" className="site-theme" onClick={() => setTheme(isDark ? "light" : "dark")}>{isDark ? "Light" : "Dark"} mode</button>;
}

function Search() {
  const [q, setQ] = useState(""), [msg, setMsg] = useState("");
  return (
    <form className="site-search" role="search" onSubmit={async (e) => { e.preventDefault(); if (q.trim()) setMsg((await search(q)).message); }}>
      <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setMsg(""); }} placeholder="Search (coming soon)" aria-label="Search the corpus" />
      {msg && <p className="site-search-msg" role="status">{msg}</p>}
    </form>
  );
}

export default function Layout() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-head">
        <NavLink to="/" className="site-name">Faith thru Physics</NavLink>
        <nav aria-label="Main">
          <NavLink to="/papers">Papers</NavLink>
          <NavLink to="/graph">Graph</NavLink>
          <NavLink to="/status">Where it stands</NavLink>
          <NavLink to="/town">The Town</NavLink>
        </nav>
        <Search />
        <ThemeToggle />
      </header>
      <main id="main"><Outlet /></main>
      <footer className="site-foot">
        <p>Every claim carries an honest label saying how we know it. Scores are AI-proposed wherever they appear. <NavLink to="/rejected">Rejected records</NavLink> stay listed.</p>
      </footer>
    </>
  );
}
