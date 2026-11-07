// Copies the venue plan + walking graph from the team-05 repo into data/venue.json.
// Usage: node scripts/import-team05.mjs [path/to/team-05/frontend-starter/public/data/app.json]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(process.argv[2] ?? resolve(root, "../team-05/frontend-starter/public/data/app.json"));
const d = JSON.parse(readFileSync(src, "utf8"));

const r1 = (v) => Math.round(v * 10) / 10;
const pt = (p) => (p ? [r1(p[0]), r1(p[1])] : null);
const poly = (ps) => (ps ? ps.map(pt) : null);

const out = {
  name: d.name,
  publishedAt: d.publishedAt,
  halls: d.halls.map((h) => ({ name: h.name || null, poly: poly(h.poly), label: pt(h.label) })),
  spaces: d.spaces.map((s) => ({
    id: s.id,
    kind: s.kind,
    code: s.code,
    name: s.name,
    hall: s.hall,
    poly: poly(s.poly),
    label: pt(s.label),
  })),
  pois: d.pois.map((p) => ({ kind: p.kind, name: p.name, p: pt(p.p) })),
  annotations: d.annotations.map((a) => ({ text: a.text, p: pt(a.p) })),
  nodes: d.nodes.map((n) => ({ id: n.id, p: n.p, kind: n.kind, target: n.target })),
  edges: d.edges,
  exhibitors: d.exhibitors.map((e) => ({ id: e.id, name: e.name, spaces: e.spaces })),
};

mkdirSync(resolve(root, "data"), { recursive: true });
writeFileSync(resolve(root, "data/venue.json"), JSON.stringify(out));
console.log(
  `wrote data/venue.json: ${out.nodes.length} nodes, ${out.edges.length} edges, ${out.spaces.length} spaces, ${out.exhibitors.length} exhibitors`
);
