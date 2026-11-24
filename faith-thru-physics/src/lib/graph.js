// Depth in the support graph: the longest chain of support links below a node.
// Context links (a node placed under A0) are never support links.
export const LINKS = {
  declared: { label: "Declared links", help: "the dependencies the sources declare" },
  proposed: { label: "AI-proposed links", help: "the primary support an AI review proposed" },
  both: { label: "Both", help: "declared and proposed together" },
};

export function supportOf(c, mode) {
  if (!c) return [];
  const declared = c.declared ?? c.rests_on ?? [];
  const proposed = c.proposed_support ?? [];
  if (mode === "proposed") return c.declared ? proposed : declared;
  if (mode === "both") return [...new Set([...declared, ...proposed])];
  return declared;
}

// { depth: {id: n}, widths: [count per depth] } over the given nodes; links to nodes outside the set are ignored
export function layers(nodes, mode) {
  const by = Object.fromEntries(nodes.map((c) => [c.id, c]));
  const parents = (c) => supportOf(c, mode).filter((p) => by[p]);
  const depth = {};
  const visit = (id, seen = new Set()) => {
    if (id in depth) return depth[id];
    if (seen.has(id)) return 0;
    seen.add(id);
    const ps = parents(by[id]);
    return (depth[id] = ps.length ? 1 + Math.max(...ps.map((p) => visit(p, seen))) : 0);
  };
  nodes.forEach((c) => visit(c.id));
  const widths = [];
  for (const d of Object.values(depth)) widths[d] = (widths[d] || 0) + 1;
  return { depth, widths: Array.from(widths, (w) => w || 0), parents, byId: by };
}
