// 1st upper floor (1. OG) of Foyer 10, where the TTF Hackathon takes place.
// Geometry ported from team-05 (frontend-starter/components/gast/levels.ts): digitised from the
// organiser's event plan and checked against Timo's on-site photos. Plan pixels → venue metres via toWorld.
import type { GraphNode, Pt } from "./routing";

const SX = 0.0602,
  SY = 0.0507;
const PLAN_X0 = 120,
  PLAN_Y0 = 180,
  PLAN_X1 = 1475;
const E0: Pt = [-98.0, -138.89];
const E1: Pt = [-60.27, -22.38];
const FOYER_LEN = Math.hypot(E1[0] - E0[0], E1[1] - E0[1]);
const U: Pt = [(E1[0] - E0[0]) / FOYER_LEN, (E1[1] - E0[1]) / FOYER_LEN];
const W: Pt = [-U[1], U[0]];
const ALONG_OFFSET = (FOYER_LEN - (PLAN_X1 - PLAN_X0) * SX) / 2;

function toWorld([px, py]: Pt): Pt {
  const a = ALONG_OFFSET + (px - PLAN_X0) * SX;
  const c = (py - PLAN_Y0) * SY;
  const r = (v: number) => Math.round(v * 100) / 100;
  return [r(E0[0] + a * U[0] + c * W[0]), r(E0[1] + a * U[1] + c * W[1])];
}
const c = (x: number, y: number) => toWorld([x, y]);
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [c(x0, y0), c(x1, y0), c(x1, y1), c(x0, y1)];

// Walking time equivalents in metres (at ~1.2 m/s): ~5 m rise by stairs ≈ 17 s; lift wait + ride ≈ 40 s.
export const STAIRS_COST_M = 20;
export const LIFT_COST_M = 48;

export const OG_ELEVATION = 5;
export const OG_ROOM_H = 4.4;

export interface Connector {
  id: string;
  name: string;
  kind: "stairs" | "lift";
  poly: Pt[];
  bottom: Pt;
  top: Pt;
  approx: boolean;
}

// "Lift Mitte" is left out on purpose: it appears on the event plan but no photo confirms it.
export const CONNECTORS: Connector[] = [
  { id: "og:treppe-nord", name: "Treppe Nord", kind: "stairs", poly: rect(265, 188, 385, 255), bottom: c(265, 222), top: c(325, 270), approx: false },
  { id: "og:treppe-sued", name: "Treppe Süd", kind: "stairs", poly: rect(1235, 188, 1335, 255), bottom: c(1235, 222), top: c(1285, 270), approx: false },
  { id: "og:treppe-lobby-west", name: "Treppe Lobby West", kind: "stairs", poly: rect(-45, 293, 0, 470), bottom: c(-22, 293), top: c(-22, 470), approx: false },
  { id: "og:lift-west", name: "Lift West", kind: "lift", poly: rect(-90, 210, -48, 259), bottom: c(-69, 270), top: c(-69, 282), approx: false },
  // Seen in photos, position mirrored from the west side.
  { id: "og:treppe-lounge-ost", name: "Treppe Lounge Ost", kind: "stairs", poly: rect(1595, 293, 1640, 470), bottom: c(1617, 293), top: c(1617, 470), approx: true },
  { id: "og:lift-ost", name: "Lift Ost", kind: "lift", poly: rect(1643, 210, 1685, 259), bottom: c(1664, 270), top: c(1664, 282), approx: true },
];

export interface OgArea {
  name: string;
  kind: "room" | "lobby" | "service" | "wc" | "zone";
  poly: Pt[];
}

export const OG_AREAS: OgArea[] = [
  { name: "Tagungsraum 4", kind: "room", poly: rect(120, 305, 397, 598) },
  { name: "Tagungsraum 5-7 (TTF)", kind: "room", poly: rect(397, 305, 1200, 598) },
  { name: "Tagungsraum 8", kind: "room", poly: rect(1200, 305, 1475, 598) },
  { name: "Lobby West", kind: "lobby", poly: rect(-95, 180, 120, 598) },
  { name: "Lounge Ost", kind: "lobby", poly: rect(1475, 180, 1690, 598) },
  { name: "Technik", kind: "service", poly: rect(180, 185, 262, 255) },
  { name: "Technik", kind: "service", poly: rect(410, 185, 605, 255) },
  { name: "Technik", kind: "service", poly: rect(610, 185, 770, 255) },
  { name: "Technik", kind: "service", poly: rect(1055, 185, 1230, 255) },
  { name: "Technik", kind: "service", poly: rect(1340, 185, 1430, 255) },
  { name: "WC D/H", kind: "wc", poly: rect(775, 190, 830, 255) },
  { name: "WC barrierefrei", kind: "wc", poly: rect(832, 190, 868, 255) },
  { name: "WC", kind: "wc", poly: rect(955, 190, 1050, 255) },
  { name: "Kino / Bühne", kind: "zone", poly: rect(145, 357, 372, 550) },
  { name: "Ikea Recharge Area", kind: "zone", poly: rect(515, 325, 678, 423) },
  { name: "Couchzone", kind: "zone", poly: rect(1077, 340, 1180, 478) },
  { name: "Chillarea", kind: "zone", poly: rect(1075, 545, 1265, 590) },
  { name: "Snackzone", kind: "zone", poly: rect(1258, 322, 1468, 355) },
  { name: "Buffet", kind: "zone", poly: rect(1432, 380, 1468, 530) },
];

const TABLES: [number, number, number][] = [
  [1, 451, 365], [2, 451, 452], [3, 451, 524], [4, 545, 452], [5, 545, 524], [6, 637, 452], [7, 637, 524],
  [8, 731, 365], [9, 731, 452], [10, 731, 524], [11, 824, 365], [12, 827, 455], [13, 827, 519],
  [14, 917, 365], [15, 917, 452], [16, 917, 524], [17, 1010, 365], [18, 1007, 450],
];

export const OG_TABLES = TABLES.map(([n, x, y]) => ({ n, poly: rect(x - 31, y - 19, x + 31, y + 19), label: c(x, y) }));

export interface OgPlace {
  id: string;
  name: string;
  aliases: string[];
  node: string;
  p: Pt;
  category?: "wc" | "wc_accessible" | "food";
}

export interface OgGraph {
  nodes: GraphNode[];
  edges: [string, string, number][];
  places: OgPlace[];
  outline: Pt[];
}

const dist = (a: Pt, b: Pt) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) * 100) / 100;

export function buildOg(): OgGraph {
  const nodes: GraphNode[] = [];
  const edges: [string, string, number][] = [];
  const pos = new Map<string, Pt>();
  const add = (id: string, p: Pt) => {
    if (!pos.has(id)) {
      pos.set(id, p);
      nodes.push({ id, p, kind: "og", target: null });
    }
    return id;
  };
  const link = (a: string, b: string) => edges.push([a, b, dist(pos.get(a)!, pos.get(b)!)]);

  // Corridor along the service strip (plan y ≈ 282), from the west lobby to the east lounge.
  const CY = 282;
  const corridorXs = [-69, -22, 120, 325, 385, 415, 690, 802, 850, 985, 1002, 1230, 1285, 1290, 1475, 1617, 1664];
  const cor = (x: number) => `og:c:${x}`;
  corridorXs.forEach((x, i) => {
    add(cor(x), c(x, CY));
    if (i) link(cor(corridorXs[i - 1]), cor(x));
  });

  // Rooms, reached through their doors on the corridor (plan y = 305).
  const room = (id: string, p: Pt) => add(id, p);
  const tr4 = room("og:tr4", c(258, 450));
  const tr57 = room("og:tr5-7", c(800, 450));
  const tr8 = room("og:tr8", c(1337, 450));
  const door = (x: number, target: string) => {
    const d = add(`og:door:${x}`, c(x, 305));
    link(cor(x), d);
    link(d, target);
  };
  door(385, tr4);
  door(415, tr57);
  door(690, tr57);
  door(985, tr57);
  door(1230, tr8);
  door(1290, tr8);
  // Lobby West opens into Tagungsraum 4 through the wide passage on the plan's left edge.
  const lobbyW = add("og:lobby-west", c(-22, 400));
  link(cor(-22), lobbyW);
  const passage = add("og:passage-west", c(120, 360));
  link(lobbyW, passage);
  link(passage, tr4);
  const loungeO = add("og:lounge-ost", c(1617, 400));
  link(cor(1617), loungeO);

  // Stairs and lifts: bottom node on the ground floor (linked to the EG graph later), top node up here.
  for (const k of CONNECTORS) {
    const b = add(`${k.id}:b`, k.bottom);
    const t = add(`${k.id}:t`, k.top);
    edges.push([b, t, k.kind === "stairs" ? STAIRS_COST_M : LIFT_COST_M]);
  }
  link("og:treppe-nord:t", cor(325));
  link("og:treppe-sued:t", cor(1285));
  link("og:treppe-lobby-west:t", lobbyW);
  link("og:lift-west:t", cor(-69));
  link("og:treppe-lounge-ost:t", loungeO);
  link("og:lift-ost:t", cor(1664));

  const places: OgPlace[] = [];
  const place = (id: string, name: string, aliases: string[], p: Pt, attach: string, category?: OgPlace["category"]) => {
    const n = add(id, p);
    if (n !== attach) link(n, attach);
    places.push({ id, name, aliases, node: n, p, category });
  };
  places.push(
    { id: "og:tr5-7", name: "Tagungsraum 5-7 (TTF Hackathon, 1. OG Foyer 10)", aliases: ["ttf", "ttf hackathon", "hackathon", "ttf venue", "tagungsraum 5", "tagungsraum 6", "tagungsraum 7", "hackathon tables"], node: tr57, p: pos.get(tr57)! },
    { id: "og:tr4", name: "Tagungsraum 4 (Kino / Bühne, 1. OG)", aliases: ["tagungsraum 4", "kino", "buhne", "stage ttf", "pitch stage", "presentation", "prasentation"], node: tr4, p: pos.get(tr4)! },
    { id: "og:tr8", name: "Tagungsraum 8 (1. OG)", aliases: ["tagungsraum 8"], node: tr8, p: pos.get(tr8)! },
    { id: "og:lobby-west", name: "Lobby West (1. OG)", aliases: ["lobby west", "tagungsraum 1", "tagungsraum 2", "tagungsraum 3"], node: lobbyW, p: pos.get(lobbyW)! },
    { id: "og:lounge-ost", name: "Lounge Ost (1. OG)", aliases: ["lounge ost", "lounge"], node: loungeO, p: pos.get(loungeO)! }
  );
  place("og:snackzone", "Snackzone (1. OG)", ["snackzone", "snacks hackathon"], c(1363, 338), tr8, "food");
  place("og:buffet", "Buffet (1. OG)", ["buffet"], c(1450, 455), tr8, "food");
  place("og:couchzone", "Couchzone (1. OG)", ["couchzone", "couch"], c(1128, 409), tr57);
  place("og:chillarea", "Chillarea (1. OG)", ["chillarea", "chill area"], c(1170, 567), tr57);
  place("og:recharge", "Ikea Recharge Area (1. OG)", ["ikea recharge area", "recharge"], c(596, 374), tr57);
  place("og:wc-barrierefrei", "WC barrierefrei (1. OG)", ["wc barrierefrei"], c(850, 222), cor(850), "wc_accessible");
  place("og:wc-dh", "WC D/H (1. OG)", ["wc d h"], c(802, 222), cor(802), "wc");
  place("og:wc", "WC (1. OG)", [], c(1002, 222), cor(1002), "wc");
  for (const [n, x, y] of TABLES) place(`og:tisch-${n}`, `Tisch ${n} (TTF Hackathon)`, [`tisch ${n}`, `table ${n}`], c(x, y), tr57);
  for (const k of CONNECTORS) {
    places.push({ id: k.id, name: k.name, aliases: [k.name.toLowerCase()], node: `${k.id}:t`, p: k.top });
  }

  return { nodes, edges, places, outline: rect(PLAN_X0, PLAN_Y0, PLAN_X1, 598) };
}
