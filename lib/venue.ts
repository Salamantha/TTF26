// Salzburg Messe venue: ground floor (EG) plan + walking graph from team-05's tly wayfinder export
// (data/venue.json, regenerate with scripts/import-team05.mjs) joined with the 1. OG of Foyer 10 (lib/og.ts).
import raw from "@/data/venue.json";
import { Router, type GraphNode, type Pt } from "./routing";
import { buildOg, CONNECTORS, OG_AREAS } from "./og";
import { buildHotspots, densityAt, slowdown } from "./crowd";

interface VenueData {
  name: string;
  halls: { name: string | null; poly: Pt[] | null; label: Pt | null }[];
  spaces: { id: string; kind: string; code: string | null; name: string | null; hall: string | null; color: string | null; poly: Pt[] | null; label: Pt | null }[];
  pois: { kind: string; name: string | null; p: Pt }[];
  annotations: { text: string; p: Pt }[];
  nodes: GraphNode[];
  edges: [string, string, number][];
  exhibitors: Exhibitor[];
}

export interface Exhibitor {
  id: string;
  name: string;
  categories: string[];
  whyVisit: string | null;
  website: string | null;
  city: string | null;
  spaces: string[];
}

export const VENUE = raw as unknown as VenueData;
export const SPACE_BY_ID = new Map(VENUE.spaces.map((s) => [s.id, s]));
export const EXHIBITOR_BY_ID = new Map(VENUE.exhibitors.map((e) => [e.id, e]));
export const EXHIBITORS_BY_SPACE = new Map<string, Exhibitor[]>();
for (const e of VENUE.exhibitors) {
  for (const s of e.spaces) EXHIBITORS_BY_SPACE.set(s, [...(EXHIBITORS_BY_SPACE.get(s) ?? []), e]);
}
export const OG = buildOg();

// Only the EG nodes within this distance of a stair/lift foot get linked to it.
const CONNECTOR_LINK_RADIUS_M = 15;

function buildRouter() {
  const eg = new Router(VENUE.nodes, []);
  const extra: [string, string, number][] = [];
  for (const k of CONNECTORS) {
    const n = eg.nearestNode(k.bottom);
    const p = eg.nodePos(n)!;
    const d = Math.hypot(p[0] - k.bottom[0], p[1] - k.bottom[1]);
    if (d <= CONNECTOR_LINK_RADIUS_M) extra.push([n, `${k.id}:b`, Math.round(d * 100) / 100]);
  }
  return new Router([...VENUE.nodes, ...OG.nodes], [...VENUE.edges, ...OG.edges, ...extra]);
}

export const ROUTER = buildRouter();

export const STAIRS_NODES = new Set(
  CONNECTORS.filter((k) => k.kind === "stairs").flatMap((k) => [`${k.id}:b`, `${k.id}:t`])
);

export const HOTSPOTS = buildHotspots({
  entrances: VENUE.nodes.filter((n) => n.kind === "entrance").map((n) => n.p),
  stages: VENUE.spaces.filter((s) => s.kind === "stage" && s.label).map((s) => s.label!),
  pois: VENUE.pois,
  booths: VENUE.spaces.filter((s) => s.kind === "booth" && s.label).map((s) => s.label!),
  og: OG_AREAS.map((a) => ({ name: a.name, p: centroid(a.poly) })),
  ogStairTops: CONNECTORS.filter((k) => k.kind === "stairs").map((k) => k.top),
});

/** Walking-time factor per graph node from the simulated crowd at time t; `space` = room the person needs. */
export function crowdFactors(t: number, space: number) {
  const out = new Map<string, number>();
  for (const n of ROUTER.nodes) out.set(n.id, slowdown(densityAt(HOTSPOTS, n.p, levelOf(n.id) === "og" ? 1 : 0, t) * space));
  return out;
}

function inside([x, y]: Pt, poly: Pt[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const OG_ROOMS = OG_AREAS.filter((a) => a.kind === "room" || a.kind === "lobby");

/** Name of the hall / foyer / 1. OG room a point lies in, for naming route parts. */
export function areaAt(p: Pt, level: "eg" | "og"): string {
  if (level === "og") return OG_ROOMS.find((a) => inside(p, a.poly))?.name ?? "1. OG corridor";
  const h = VENUE.halls.find((h) => h.poly && inside(p, h.poly));
  return h ? h.name ?? "Salzburgarena" : "outside";
}

function centroid(poly: Pt[]): Pt {
  return [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
}

export function levelOf(nodeId: string): "eg" | "og" {
  return nodeId.startsWith("og:") && !nodeId.endsWith(":b") ? "og" : "eg";
}

export const CONNECTOR_BY_NAME = new Map(CONNECTORS.map((k) => [k.name, k]));

/** Nearest walkway node on one floor (stair/lift ends excluded), e.g. for "route from where I am now". */
export function nearestNodeOn(p: Pt, level: "eg" | "og"): string | null {
  let best: string | null = null,
    bd = Infinity;
  for (const n of ROUTER.nodes) {
    if (levelOf(n.id) !== level || n.id.endsWith(":b") || n.id.endsWith(":t")) continue;
    const d = (n.p[0] - p[0]) ** 2 + (n.p[1] - p[1]) ** 2;
    if (d < bd) {
      bd = d;
      best = n.id;
    }
  }
  return best;
}

export function connectorOf(nodeId: string) {
  return CONNECTORS.find((k) => nodeId === `${k.id}:b` || nodeId === `${k.id}:t`);
}

// ---------------------------------------------------------------- places

export interface PlaceInstance {
  name: string;
  anchors: string[];
  p: Pt;
  spaceId?: string;
  exhibitorId?: string;
}

export interface Place {
  id: string;
  name: string;
  instances: PlaceInstance[];
  /** Nodes an obstacle at this place blocks; defaults to nodes near each instance. */
  blockNodes?: string[];
  note?: string;
}

const STOP = new Set([
  "the", "a", "an", "to", "at", "in", "of", "near", "next", "by", "my", "der", "die", "das", "den", "dem", "zum", "zur",
  "im", "am", "von", "beim", "bei", "booth", "stand", "stall", "salzburg", "messe", "messezentrum", "please",
]);
const SYN: Record<string, string> = {
  hall: "halle", halls: "halle", hallen: "halle", room: "tagungsraum", raum: "tagungsraum", table: "tisch",
  elevator: "lift", aufzug: "lift", fahrstuhl: "lift", stairs: "treppe", staircase: "treppe", stair: "treppe",
  north: "nord", south: "sud", sued: "sud", east: "ost", upstairs: "og", obergeschoss: "og",
};

export function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s: string) {
  return normalize(s)
    .split(" ")
    .filter((t) => t && !STOP.has(t))
    .map((t) => SYN[t] ?? t);
}

const isNum = (t: string) => /^\d/.test(t);

function score(q: string[], name: string): number {
  const n = tokens(name);
  if (!n.length || !q.length) return 0;
  const qs = new Set(q),
    ns = new Set(n);
  const qNums = q.filter(isNum),
    nNums = n.filter(isNum);
  if (qNums.some((t) => !ns.has(t))) return 0;
  if (nNums.length && !qNums.length) return 0;
  const shared = [...qs].filter((t) => ns.has(t));
  const overlap = shared.length;
  if (!shared.some((t) => !isNum(t))) return 0;
  return (overlap / qs.size) * 0.6 + (overlap / ns.size) * 0.4;
}

const anchorAt = (p: Pt) => [ROUTER.nearestNode(p)];

function spaceAnchors(spaceId: string, label: Pt | null): string[] {
  const doors = VENUE.nodes.filter((n) => n.target === spaceId).map((n) => n.id);
  if (doors.length) return doors;
  return label ? anchorAt(label) : [];
}

interface NamedPlace extends Place {
  names: string[];
}

function buildNamedPlaces(): NamedPlace[] {
  const out: NamedPlace[] = [];
  for (const p of OG.places) {
    const k = CONNECTORS.find((c) => c.id === p.id);
    out.push({
      id: p.id,
      name: k ? `${k.name} (${k.kind === "lift" ? "lift" : "stairs"} to 1. OG)` : p.name,
      names: [p.name, ...p.aliases],
      instances: [{ name: p.name, anchors: [p.node], p: p.p }],
      blockNodes: k ? [`${k.id}:b`, `${k.id}:t`] : undefined,
      note: k?.approx ? `${k.name}'s exact position is estimated (mirrored from the west side).` : undefined,
    });
  }
  for (const h of VENUE.halls) {
    if (!h.name || !h.label) continue;
    out.push({ id: `hall:${normalize(h.name)}`, name: h.name, names: [h.name], instances: [{ name: h.name, anchors: anchorAt(h.label), p: h.label }] });
  }
  for (const a of VENUE.annotations) {
    if (a.text === "Eingang" || out.some((o) => o.names.includes(a.text))) continue;
    out.push({ id: `spot:${normalize(a.text)}`, name: a.text, names: [a.text], instances: [{ name: a.text, anchors: anchorAt(a.p), p: a.p }] });
  }
  for (const s of VENUE.spaces) {
    if (!s.name || s.kind === "booth" || !s.label) continue;
    out.push({ id: `space:${s.id}`, name: s.hall ? `${s.name} (${s.hall})` : s.name, names: [s.name], instances: [{ name: s.name, anchors: spaceAnchors(s.id, s.label), p: s.label }] });
  }
  for (const e of VENUE.exhibitors) {
    const instances = exhibitorStands(e);
    if (instances.length) out.push({ id: `exhibitor:${e.id}`, name: instances[0].name, names: [e.name], instances });
  }
  return out;
}

function exhibitorStands(e: Exhibitor): PlaceInstance[] {
  return e.spaces
    .map((id) => SPACE_BY_ID.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s?.label)
    .map((s) => ({
      name: `${e.name} (Stand ${s.code ?? "?"}${s.hall ? `, ${s.hall}` : ""})`,
      anchors: spaceAnchors(s.id, s.label),
      p: s.label!,
      spaceId: s.id,
      exhibitorId: e.id,
    }));
}

// English (and colloquial) words for the German exhibitor categories.
const CATEGORY_SYN: Record<string, string> = {
  icecream: "eis", gelato: "eis", eisstand: "eis", eiscreme: "eis", wine: "wein", wines: "wein", beer: "bier",
  cheese: "kase", dessert: "desserts", sweets: "sussspeisen", chocolate: "confiserie", cake: "patisserie",
  pastry: "patisserie", bread: "backwaren", bakery: "backwaren", meat: "fleisch", sausage: "wurstwaren", fish: "fisch",
  seafood: "meeresfruchte", pasta: "nudeln", noodles: "nudeln", spices: "gewurze", juice: "fruchtsafte",
  smoothie: "smoothies", champagne: "champagner", sparkling: "sekt", spirits: "spirituosen", gin: "spirituosen",
  cocktail: "mix", cocktails: "mix", vegan: "vegane", organic: "bio", tea: "tee", furniture: "mobiliar",
  lighting: "beleuchtungssysteme", textiles: "textilien", cleaning: "reinigung", hygiene: "betriebshygiene",
};
const EXHIBITOR_CATEGORIES = [...new Set(VENUE.exhibitors.flatMap((e) => e.categories))].map((c) => ({
  name: c,
  tokens: normalize(c).split(" ").filter((t) => t.length > 1),
}));

function exhibitorCategory(qt: string[]): string | null {
  let best: string | null = null,
    bs = 0;
  for (const c of EXHIBITOR_CATEGORIES) {
    let s = 0;
    for (const t of qt) {
      if (t.length < 3) continue;
      if (c.tokens.includes(t)) s += 2;
      else if (t.length >= 4 && c.tokens.some((ct) => ct.startsWith(t))) s += 1;
    }
    if (s > bs) {
      bs = s;
      best = c.name;
    }
  }
  return best;
}

function exhibitorCategoryPlace(category: string): Place {
  const exhibitors = VENUE.exhibitors.filter((e) => e.categories.includes(category));
  // Prefer specialists: wholesalers list dozens of categories; an ice cream maker lists few or says so.
  const words = new Set(normalize(category).split(" ").filter((t) => t.length > 1));
  for (const [syn, target] of Object.entries(CATEGORY_SYN)) if (words.has(target)) words.add(syn);
  const mentions = (e: Exhibitor) =>
    normalize(`${e.name} ${e.whyVisit ?? ""}`)
      .replace(/\bice ?cream\b/g, "icecream")
      .split(" ")
      .some((t) => words.has(t) || [...words].some((w) => w.length >= 3 && t.endsWith(w) && t.length <= w.length + 6));
  const specialists = exhibitors.filter((e) => e.categories.length <= 3 || mentions(e));
  const pool = specialists.length ? specialists : exhibitors;
  return {
    id: `excat:${normalize(category)}`,
    name: `nearest "${category}" stand`,
    instances: pool.flatMap(exhibitorStands),
    note: `${exhibitors.length} exhibitors are listed under "${category}"; this routes to the nearest ${specialists.length ? "specialist" : "one"}.`,
  };
}

export interface StandInfo {
  code: string | null;
  hall: string | null;
  exhibitor: string | null;
  categories: string[];
  whyVisit: string | null;
  website: string | null;
  alsoHere: string[];
}

export function standInfo(inst: PlaceInstance): StandInfo | null {
  if (!inst.spaceId) return null;
  const s = SPACE_BY_ID.get(inst.spaceId);
  if (!s) return null;
  const here = EXHIBITORS_BY_SPACE.get(s.id) ?? [];
  const e = (inst.exhibitorId && EXHIBITOR_BY_ID.get(inst.exhibitorId)) || here[0];
  return {
    code: s.code,
    hall: s.hall,
    exhibitor: e?.name ?? s.name,
    categories: e?.categories ?? [],
    whyVisit: e?.whyVisit ?? null,
    website: e?.website ?? null,
    alsoHere: here.filter((x) => x !== e).map((x) => x.name),
  };
}

const NAMED = buildNamedPlaces();
const BOOTHS_BY_CODE = new Map(
  VENUE.spaces.filter((s) => s.code && s.label).map((s) => [normalize(s.code!).replace(/ /g, ""), s])
);

const egPois = (kinds: string[], label: string): PlaceInstance[] =>
  VENUE.pois.filter((p) => kinds.includes(p.kind)).map((p) => ({ name: p.name ?? label, anchors: anchorAt(p.p), p: p.p }));
const ogPois = (cat: string): PlaceInstance[] =>
  OG.places.filter((p) => p.category === cat).map((p) => ({ name: p.name, anchors: [p.node], p: p.p }));

interface Category {
  id: string;
  name: string;
  words: string[];
  instances: () => PlaceInstance[];
  note?: (q: string) => string | undefined;
}

const has = (q: string, words: string[]) => words.some((w) => ` ${q} `.includes(` ${w} `));
const TOILET = ["wc", "toilet", "toilets", "toilette", "toiletten", "restroom", "restrooms", "bathroom", "klo"];
const ACCESSIBLE = ["accessible", "barrierefrei", "disabled", "wheelchair", "rollstuhl", "behinderten"];
const ENTRANCE_FOYERS = ["Foyer 10", "Foyer 1"];

function entranceInstances(): PlaceInstance[] {
  const all = VENUE.nodes.filter((n) => n.kind === "entrance");
  const out: PlaceInstance[] = [];
  for (const name of ENTRANCE_FOYERS) {
    const hall = VENUE.halls.find((h) => h.name === name);
    if (!hall?.label) continue;
    let best = all[0],
      bd = Infinity;
    for (const n of all) {
      const d = Math.hypot(n.p[0] - hall.label[0], n.p[1] - hall.label[1]);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    out.push({ name: `Eingang ${name}`, anchors: [best.id], p: best.p });
  }
  return out;
}

const CATEGORIES: Category[] = [
  { id: "cat:wc-accessible", name: "nearest accessible toilet", words: [], instances: () => [...egPois(["wc_accessible"], "WC barrierefrei"), ...ogPois("wc_accessible")] },
  { id: "cat:wc", name: "nearest toilet", words: TOILET, instances: () => [...egPois(["wc", "wc_women", "wc_men", "wc_accessible"], "WC"), ...ogPois("wc"), ...ogPois("wc_accessible")] },
  {
    id: "cat:food",
    name: "nearest food stand",
    words: ["food", "essen", "imbiss", "snack", "snacks", "restaurant", "bistro", "lunch", "mittagessen", "hungry", "burger", "pizza", "eat"],
    instances: () => [
      ...egPois(["food"], "Food"),
      ...VENUE.annotations.filter((a) => /bistro/i.test(a.text)).map((a) => ({ name: a.text, anchors: anchorAt(a.p), p: a.p })),
      ...ogPois("food"),
    ],
  },
  { id: "cat:cafe", name: "nearest café", words: ["cafe", "kaffee", "coffee", "espresso", "cappuccino"], instances: () => egPois(["cafe"], "Café") },
  { id: "cat:info", name: "nearest info point", words: ["info", "information", "infopoint", "infostand", "help"], instances: () => egPois(["info"], "Info") },
  { id: "cat:cloakroom", name: "nearest cloakroom", words: ["garderobe", "cloakroom", "coat", "coats", "wardrobe"], instances: () => egPois(["cloakroom"], "Garderobe") },
  { id: "cat:first-aid", name: "first aid", words: ["first aid", "erste hilfe", "sanitater", "sanitaeter", "medical", "doctor", "arzt"], instances: () => egPois(["first_aid"], "Erste Hilfe") },
  { id: "cat:atm", name: "nearest ATM", words: ["atm", "bankomat", "geldautomat", "cash"], instances: () => egPois(["atm"], "Bankomat") },
  { id: "cat:ticket", name: "nearest ticket office", words: ["ticket", "tickets", "kasse", "ticket office"], instances: () => egPois(["ticket_office"], "Kasse") },
  { id: "cat:entrance", name: "entrance", words: ["entrance", "eingang", "entry", "haupteingang", "main entrance", "entrances"], instances: entranceInstances },
];

export function findPlace(query: string): Place | null {
  const q = normalize(query).replace(/\bice ?cream\b/g, "icecream");
  if (!q) return null;
  const qt = tokens(q);

  const code = q.replace(/ /g, "");
  const booth = BOOTHS_BY_CODE.get(code);
  if (booth) {
    const e = EXHIBITORS_BY_SPACE.get(booth.id)?.[0];
    const name = `${e ? `${e.name} (` : ""}Stand ${booth.code}${booth.hall ? `, ${booth.hall}` : ""}${e ? ")" : ""}`;
    return { id: `space:${booth.id}`, name, instances: [{ name, anchors: spaceAnchors(booth.id, booth.label), p: booth.label!, spaceId: booth.id, exhibitorId: e?.id }] };
  }

  let best: NamedPlace | null = null,
    bs = 0;
  for (const p of NAMED) {
    for (const n of p.names) {
      const s = score(qt, n);
      if (s > bs) {
        bs = s;
        best = p;
      }
    }
  }
  // A strong name hit ("Halle 2", "Lift West", an exhibitor) wins over a generic word like "toilet".
  if (best && bs >= 0.85) return best;

  if (has(q, TOILET) && has(q, ACCESSIBLE)) return categoryPlace(CATEGORIES[0], q);
  // Venue-service words (food, coffee, toilet…) mean the venue's own spots, not exhibitors selling those things.
  const serviceWords = new Set(CATEGORIES.flatMap((c) => c.words));
  const productWords = qt.filter((t) => !serviceWords.has(t)).map((t) => CATEGORY_SYN[t] ?? t);
  const exCat = productWords.length ? exhibitorCategory(productWords) : null;
  if (exCat) return exhibitorCategoryPlace(exCat);
  for (const cat of CATEGORIES.slice(1)) {
    if (has(q, cat.words) || cat.words.some((w) => w.includes(" ") && q.includes(w))) {
      if (cat.id === "cat:entrance" && qt.some(isNum)) {
        const specific = cat.instances().find((i) => score(qt, i.name.replace("Eingang ", "")) > 0);
        if (specific) return { id: `entrance:${normalize(specific.name)}`, name: specific.name, instances: [specific] };
      }
      return categoryPlace(cat, q);
    }
  }
  return best && bs >= 0.5 ? best : null;
}

function categoryPlace(cat: Category, q: string): Place {
  return { id: cat.id, name: cat.name, instances: cat.instances(), note: cat.note?.(q) };
}

export function placeById(id: string): Place | null {
  return NAMED.find((p) => p.id === id) ?? null;
}

/** Up to `n` place names that partially match, for "did you mean" answers. */
export function suggestPlaces(query: string, n = 8): string[] {
  const qt = tokens(query);
  return NAMED.map((p) => ({ p, s: Math.max(...p.names.map((name) => score(qt, name))) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.p.name);
}

export const EXAMPLE_PLACES = [
  "Eingang Foyer 1",
  "Eingang Foyer 10",
  "TTF Hackathon (Tagungsraum 5-7, 1. OG)",
  "Tagungsraum 4 / Bühne",
  "Tisch 1-18",
  "Halle 1-10",
  "Lift West",
  "Treppe Nord",
  "food / coffee / toilet / accessible toilet / info",
  "an exhibitor name or booth code like A-0212",
];
