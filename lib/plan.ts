import type { Pt, RouteResult } from "./routing";
import { simTime } from "./crowd";
import {
  ROUTER, STAIRS_NODES, CONNECTOR_BY_NAME, levelOf, connectorOf, crowdFactors, findPlace, suggestPlaces, standInfo, areaAt,
  EXAMPLE_PLACES, type Place,
} from "./venue";
import { STAIRS_COST_M, LIFT_COST_M } from "./og";
import { getObstacles, getConfirmations, getLeaderboard, getBestSplits, PERSISTENT, type Mobility, type ObstacleRecord } from "./store";

/** Mobility profiles from team-05: walking speed, stairs cost factor, room needed in crowds. */
export const MOBILITY: Record<Mobility, { label: string; speed: number; stairs: number; space: number }> = {
  walk: { label: "Walking", speed: 1.34, stairs: 1, space: 1 },
  // stairs possible but 3x as costly: taken only if the next lift is a real detour
  cane: { label: "Cane / crutches", speed: 0.8, stairs: 3, space: 1.2 },
  // no stairs at all; needs more room, so crowds slow it down earlier
  wheelchair: { label: "Wheelchair", speed: 0.9, stairs: Infinity, space: 1.6 },
};

export const ESTIMATE_DISCLAIMER =
  "Prototype: ground floor from the venue wayfinder, 1. OG and its stairs/lifts mapped from the event plan and photos; visitor density is simulated.";

export interface Segment {
  level: "eg" | "og";
  points: Pt[];
}

/** A route part for step-by-step navigation and speedrun-style splits. */
export interface Part {
  /** stable across requests (area or connector), so best splits can be matched */
  id: string;
  kind: "walk" | "lift" | "stairs";
  title: string;
  meters: number;
  level: "eg" | "og";
  points: Pt[];
  /** for stairs/lift parts: which place the feedback question is about */
  placeName?: string;
  weight: number;
}

interface Leg {
  fromName: string;
  toName: string;
  dest: Place["instances"][number] | null;
  meters: number;
  via: string[];
  parts: Part[];
  segments: Segment[];
}

/** Walking parts shorter than this are merged into a neighbour, so passing a doorway isn't its own step. */
const MIN_PART_M = 10;

const r1 = (v: number) => Math.round(v * 10) / 10;

export function fmtSeconds(s: number) {
  const total = Math.round(s);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return m ? `${m}:${String(sec).padStart(2, "0")} min` : `${sec} s`;
}

const rp = (ps: Pt[]) => ps.map(([x, y]) => [r1(x), r1(y)] as Pt);
const AREA_TITLE: Record<string, string> = { outside: "Outdoor path", "1. OG corridor": "1. OG corridor" };

function describe(r: RouteResult, from: Place, to: Place, stairsFactor: number): Leg {
  const segments: Segment[] = [];
  const via: string[] = [];
  const parts: Part[] = [];
  let level = levelOf(r.nodeIds[0]);
  let seg: Pt[] = [r.points[0]];
  let run = { area: areaAt(r.points[0], level), level, points: [r.points[0]] as Pt[], meters: 0 };

  const flush = () => {
    if (run.points.length < 2 || run.meters < 0.5) return;
    const prev = parts[parts.length - 1];
    // Too short to be its own part: append to the previous walking part on the same floor.
    if (run.meters < MIN_PART_M && prev?.kind === "walk" && prev.level === run.level) {
      prev.points.push(...run.points.slice(1));
      prev.meters += run.meters;
      prev.weight += run.meters;
      return;
    }
    parts.push({ id: `walk:${run.area}`, kind: "walk", title: AREA_TITLE[run.area] ?? run.area, meters: run.meters, level: run.level, points: run.points, weight: run.meters });
  };

  for (let i = 1; i < r.nodeIds.length; i++) {
    const a = connectorOf(r.nodeIds[i - 1]);
    const b = connectorOf(r.nodeIds[i]);
    const next = levelOf(r.nodeIds[i]);
    const p0 = r.points[i - 1],
      p1 = r.points[i];
    if (a && b && a.id === b.id && next !== level) {
      segments.push({ level, points: seg });
      via.push(a.name);
      flush();
      const up = next === "og";
      parts.push({
        id: `${a.kind}:${a.id}:${up ? "up" : "down"}`,
        kind: a.kind,
        title: `${a.name} ${up ? "up to 1. OG" : "down to ground floor"}`,
        meters: 0,
        level: next,
        points: [p0, p1],
        placeName: a.name,
        weight: a.kind === "stairs" ? STAIRS_COST_M * stairsFactor : LIFT_COST_M,
      });
      level = next;
      seg = [p1];
      run = { area: areaAt(p1, level), level, points: [p1], meters: 0 };
      continue;
    }
    const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    seg.push(p1);
    const area = areaAt(p1, level);
    if (area !== run.area && run.meters >= MIN_PART_M) {
      flush();
      run = { area, level, points: [p0, p1], meters: d };
    } else {
      if (area !== run.area) run.area = area;
      run.points.push(p1);
      run.meters += d;
    }
  }
  segments.push({ level, points: seg });
  flush();

  const first = r.nodeIds[0],
    last = r.nodeIds[r.nodeIds.length - 1];
  const fromName = from.instances.find((i) => i.anchors.includes(first))?.name ?? from.name;
  const dest = to.instances.find((i) => i.anchors.includes(last)) ?? null;
  const toName = dest?.name ?? to.name;

  // The same area can come up twice (e.g. a foyer before and after a lift); keep ids unique.
  const seen = new Map<string, number>();
  for (const p of parts) {
    const n = (seen.get(p.id) ?? 0) + 1;
    seen.set(p.id, n);
    if (n > 1) p.id = `${p.id}#${n}`;
    p.meters = Math.round(p.meters);
    p.points = rp(p.points);
  }

  return {
    fromName,
    toName,
    dest,
    meters: Math.round(r.meters),
    via,
    parts,
    segments: segments.map((s) => ({ level: s.level, points: rp(s.points) })),
  };
}

function unresolved(q: string) {
  const s = suggestPlaces(q);
  return `I couldn't find "${q}" in the venue data.${s.length ? ` Closest matches: ${s.join("; ")}.` : ""} Try for example: ${EXAMPLE_PLACES.join(", ")}.`;
}

function blockedFor(obstacles: ObstacleRecord[], stepFree: boolean) {
  const out = new Set<string>();
  for (const o of obstacles) if (o.affects === "everyone" || stepFree) for (const n of o.nodes) out.add(n);
  return out;
}

export interface PlanInput {
  from: string;
  to: string;
  mobility: Mobility;
  avoidCrowds: boolean;
}

export async function planRoute(input: PlanInput) {
  const { mobility, avoidCrowds } = input;
  const from = findPlace(input.from);
  if (!from) return { ok: false as const, error: unresolved(input.from) };
  const to = findPlace(input.to);
  if (!to) return { ok: false as const, error: unresolved(input.to) };

  const [obstacleMap, confirmations, top, bestSplits] = await Promise.all([
    getObstacles(),
    getConfirmations(),
    getLeaderboard(from.id, to.id, mobility),
    getBestSplits(from.id, to.id, mobility),
  ]);
  const obstacles = Object.values(obstacleMap).filter((o) => o.status === "blocked");
  const fa = from.instances.flatMap((i) => i.anchors),
    ta = to.instances.flatMap((i) => i.anchors);
  const t = simTime();
  const crowd = (space: number) => crowdFactors(t, space);
  const profile = MOBILITY[mobility];

  const run = (stairs: number, stepFree: boolean, space: number) =>
    ROUTER.route(fa, ta, { blocked: blockedFor(obstacles, stepFree), stairsNodes: STAIRS_NODES, stairsFactor: stairs, crowd: crowd(space), avoidCrowd: avoidCrowds });

  // The selected profile's route, plus fastest vs step-free at the same walking pace for the comparison,
  // so the gap is the detour (what better information can shrink), not the difference in speed.
  const main = run(profile.stairs, mobility !== "walk", profile.space);
  const fastest = run(1, false, 1);
  const stepFree = run(Infinity, true, 1);

  if (!main) {
    const blockers = obstacles.map((o) => `${o.label}${o.note ? ` (${o.note})` : ""}`).join("; ");
    return {
      ok: false as const,
      error:
        `No ${mobility === "walk" ? "" : "step-free "}route from ${from.name} to ${to.name} right now.` +
        (blockers ? ` Reported obstacles: ${blockers}.` : "") +
        (mobility !== "walk" && fastest ? " A route with stairs exists." : ""),
    };
  }

  const route = describe(main, from, to, profile.stairs);
  const fastLeg = fastest ? describe(fastest, from, to, 1) : null;
  const freeLeg = stepFree ? describe(stepFree, from, to, Infinity) : null;
  const seconds = main.effMeters / profile.speed;
  // Planned time per part: the route's total time shared out by distance (and stairs/lift cost).
  const totalWeight = route.parts.reduce((a, p) => a + p.weight, 0) || 1;
  const parts = route.parts.map(({ weight, ...p }) => ({
    ...p,
    plannedSeconds: Math.max(1, Math.round((weight / totalWeight) * seconds)),
    bestSeconds: bestSplits[p.id] ?? null,
    confirmedAt: p.placeName ? confirmations[CONNECTOR_BY_NAME.get(p.placeName)!.id] ?? null : null,
  }));
  const fastS = fastest ? fastest.effMeters / MOBILITY.walk.speed : null;
  const freeS = stepFree ? stepFree.effMeters / MOBILITY.walk.speed : null;
  const gapSeconds = fastS !== null && freeS !== null ? Math.max(0, Math.round(freeS - fastS)) : null;

  const checks = [...new Set([...route.via, ...(freeLeg?.via ?? [])])].map((name) => {
    const k = CONNECTOR_BY_NAME.get(name)!;
    return { name, kind: k.kind, placeId: k.id, confirmedAt: confirmations[k.id] ?? null, approx: k.approx };
  });
  const allPts = route.segments.flatMap((s) => s.points);
  const routeDiffers = fastLeg && fastLeg.via.join() !== route.via.join();

  return {
    ok: true as const,
    fromId: from.id,
    toId: to.id,
    data: {
      query: { from: input.from, to: input.to },
      mobility,
      mobilityLabel: profile.label,
      avoidCrowds,
      fromName: route.fromName,
      toName: route.toName,
      seconds: Math.round(seconds),
      timeLabel: fmtSeconds(seconds),
      distanceLabel: `${route.meters} m`,
      via: route.via,
      parts,
      compare: {
        fastest: fastS !== null && fastLeg ? { seconds: Math.round(fastS), label: fmtSeconds(fastS), via: fastLeg.via } : null,
        stepFree: freeS !== null && freeLeg ? { seconds: Math.round(freeS), label: fmtSeconds(freeS), via: freeLeg.via } : null,
        gapSeconds,
      },
      leaderboard: top.map((a) => ({ holder: a.holder, seconds: a.seconds, label: fmtSeconds(a.seconds), recordedAt: a.recordedAt })),
      persistent: PERSISTENT,
      checks,
      notes: [from.note, to.note].filter((n): n is string => !!n),
      stand: route.dest ? standInfo(route.dest) : null,
      otherStands:
        to.instances.length > 1 && route.dest?.exhibitorId
          ? [...new Set(to.instances.filter((i) => i.exhibitorId !== route.dest!.exhibitorId).map((i) => i.name))].slice(0, 5)
          : [],
      destSpaceId: route.dest?.spaceId ?? null,
      disclaimer: ESTIMATE_DISCLAIMER,
      segments: route.segments,
      fastestSegments: routeDiffers ? fastLeg!.segments : null,
      start: allPts[0],
      end: allPts[allPts.length - 1],
      obstacles: obstacles.map((o) => ({ id: o.placeId, p: o.p, label: o.label, affects: o.affects, radius: o.radius ?? 4, level: o.level ?? (o.placeId.startsWith("og:") ? 1 : 0) })),
    },
  };
}

export type RouteData = Extract<Awaited<ReturnType<typeof planRoute>>, { ok: true }>["data"];
