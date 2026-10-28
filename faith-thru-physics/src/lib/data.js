// Reads the static JSON the build wrote into public/data/. Nothing else feeds the pages.
import { useEffect, useState } from "react";

const BASE = import.meta.env.BASE_URL + "data/";
const cache = new Map();

// The preview build ships every data file inside one bundle.json (see scripts/build-data.mjs).
let bundle = null;
const bundled = () => (bundle ??= fetch(BASE + "bundle.json").then((r) => (r.ok ? r.json() : null)).catch(() => null));

export function getJSON(path) {
  if (import.meta.env.MODE === "preview" && !cache.has(path)) {
    cache.set(path, bundled().then((b) => {
      const key = decodeURIComponent(path); // claim and node paths are encoded once for the URL
      if (b && key in b) return b[key];
      throw new Error(`404 ${path}`);
    }).catch((e) => { cache.delete(path); throw e; }));
  }
  if (!cache.has(path)) {
    cache.set(path, fetch(BASE + path).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return r.json();
    }).catch((e) => { cache.delete(path); throw e; }));
  }
  return cache.get(path);
}
export const claimPath = (id) => `claims/${encodeURIComponent(encodeURIComponent(id))}.json`;
export const nodePath = (id) => `nodes/${encodeURIComponent(encodeURIComponent(id))}.json`;
export const dataURL = (path) => BASE + path;

// { data, error } for one path; null path = nothing to load
export function useJSON(path) {
  const [state, set] = useState({ data: null, error: null });
  useEffect(() => {
    if (!path) return;
    let live = true;
    set({ data: null, error: null });
    getJSON(path).then((data) => live && set({ data, error: null }), (error) => live && set({ data: null, error }));
    return () => { live = false; };
  }, [path]);
  return state;
}

// grade lookup by claim id, from the small index
export function useIndex() {
  const { data, error } = useJSON("index/claims.json");
  const lookup = {};
  for (const c of data || []) lookup[c.id] = c.grade;
  return { index: data, lookup, error };
}
