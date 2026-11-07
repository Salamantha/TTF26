// SIMULATED visitor density (persons per m²) for the demo, ported from team-05
// (frontend-starter/components/gast/crowd.ts). Real deployments would feed measured densities instead.
// Shared by the server (crowd-aware routing) and the widget (heatmap); both use simTime() on the
// wall clock, so they agree on the crowd state.
type Pt = [number, number];

export interface Hotspot {
  p: Pt;
  level: number;
  peak: number;
  sigma: number;
  period: number;
  phase: number;
  wander: number;
}

/** Free walking speed (m/s), Weidmann 1993. */
export const V_FREE = 1.34;
/** From this density a spot counts as extreme and routes go around it. */
export const EXTREME = 4;

/** 2 s real time = 20 s simulated, counted from a fixed epoch. */
export function simTime(now = Date.now()) {
  return ((now - Date.UTC(2026, 10, 7)) / 1000) * 10;
}

/** Walking-time factor for a density (1 = free walking), Weidmann's speed-density relation. */
export function slowdown(rho: number) {
  if (rho <= 0.5) return 1;
  const v = V_FREE * (1 - Math.exp(-1.913 * (1 / Math.min(rho, 5.3) - 1 / 5.4)));
  const f = V_FREE / Math.max(v, 0.03);
  return rho >= EXTREME ? f * 4 : f;
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export interface HotspotInput {
  entrances: Pt[];
  stages: Pt[];
  pois: { kind: string; p: Pt }[];
  booths: Pt[];
  og: { name: string; p: Pt }[];
  ogStairTops: Pt[];
}

/** Seeded, so the same hotspots come out on every server instance. */
export function buildHotspots(d: HotspotInput): Hotspot[] {
  const r = rng(2026);
  const out: Hotspot[] = [];
  const add = (p: Pt, level: number, peak: number, sigma: number) =>
    out.push({ p, level, peak, sigma, period: 40 + r() * 80, phase: r() * Math.PI * 2, wander: 1 + r() * 3 });
  for (const p of d.entrances) add(p, 0, 1.6, 9);
  for (const p of d.stages) add(p, 0, 2.8, 9);
  for (const p of d.pois) {
    if (p.kind === "food" || p.kind === "cafe") add(p.p, 0, 2.2, 7);
    else if (p.kind.startsWith("wc")) add(p.p, 0, 1.1, 3.5);
    else if (p.kind === "info" || p.kind === "cloakroom") add(p.p, 0, 1.3, 4);
  }
  for (let i = 0; i < 30 && d.booths.length; i++) add(d.booths[Math.floor(r() * d.booths.length)], 0, 0.9 + r() * 1.6, 4 + r() * 6);
  const ogPeaks: [string, number, number][] = [["Kino", 2.6, 7], ["Buffet", 2.6, 5], ["Snackzone", 2.2, 5], ["Couchzone", 1.5, 5], ["Ikea", 1.2, 5]];
  for (const [name, peak, sigma] of ogPeaks) {
    const a = d.og.find((x) => x.name.startsWith(name));
    if (a) add(a.p, 1, peak, sigma);
  }
  for (const p of d.ogStairTops) add(p, 1, 1.2, 3);
  return out;
}

/** Density in persons/m² at a point on a floor (0 = ground floor, 1 = 1. OG) at simulated time t. */
export function densityAt(hotspots: Hotspot[], [x, y]: Pt, level: number, t: number) {
  let rho = 0.25 + 0.18 * (Math.sin(x * 0.07 + t * 0.05) * Math.cos(y * 0.06 - t * 0.04) + Math.sin((x + y) * 0.031 + t * 0.03));
  for (const h of hotspots) {
    if (h.level !== level) continue;
    const cx = h.p[0] + h.wander * Math.sin((t / h.period) * 2 + h.phase),
      cy = h.p[1] + h.wander * Math.cos((t / h.period) * 1.7 + h.phase);
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    if (d2 > 9 * h.sigma * h.sigma) continue;
    const pulse = 0.7 + 0.3 * Math.sin((t / h.period) * Math.PI * 2 + h.phase);
    rho += h.peak * pulse * Math.exp(-d2 / (2 * h.sigma * h.sigma));
  }
  return Math.max(0, rho);
}

/** Colour ramp green → yellow → orange → red → dark red; alpha grows with density. */
export function densityColour(rho: number): [number, number, number, number] {
  const stops: [number, [number, number, number]][] = [[0.5, [34, 197, 94]], [1.5, [234, 179, 8]], [2.5, [249, 115, 22]], [3.5, [239, 68, 68]], [5, [127, 29, 29]]];
  let c = stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [r0, c0] = stops[i - 1],
      [r1, c1] = stops[i];
    if (rho <= r1) {
      const t = Math.max(0, (rho - r0) / (r1 - r0));
      c = c0.map((v, j) => v + (c1[j] - v) * t) as typeof c;
      break;
    }
    c = c1;
  }
  const a = Math.min(0.8, Math.max(0, (rho - 0.4) / 1.6) * 0.8);
  return [c[0], c[1], c[2], a];
}

export const DENSITY_LEGEND = [
  { label: "< 1", rho: 0.8 },
  { label: "1–2", rho: 1.5 },
  { label: "2–3", rho: 2.5 },
  { label: "3–4", rho: 3.5 },
  { label: "> 4", rho: 4.8 },
].map((l) => ({ label: l.label, css: (([r, g, b]) => `rgb(${r},${g},${b})`)(densityColour(l.rho)) }));
