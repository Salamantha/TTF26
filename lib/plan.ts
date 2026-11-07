import type { Pt, RouteResult } from "./routing";
import { ROUTER, STAIRS_NODES, levelOf, connectorOf, findPlace, suggestPlaces, standInfo, EXAMPLE_PLACES, type Place, type PlaceInstance, type StandInfo } from "./venue";
import { getObstacles, getLeaderboardEntry, type LeaderboardRecord, type ObstacleRecord } from "./store";

export const WALK_SPEED_MPS = 1.2;

export const ESTIMATE_DISCLAIMER =
  "Prototype estimate: ground-floor paths come from the venue wayfinder, the 1. OG and its stairs/lifts were mapped by hand from the event plan and on-site photos. Report anything wrong with report_obstacle.";

export interface Segment {
  level: "eg" | "og";
  points: Pt[];
}

export interface Leg {
  fromName: string;
  toName: string;
  dest: PlaceInstance | null;
  meters: number;
  seconds: number;
  via: string[];
  steps: string[];
  segments: Segment[];
}

export type Plan =
  | { ok: false; error: string }
  | {
      ok: true;
      accessible: boolean;
      from: Place;
      to: Place;
      route: Leg;
      fastest: Leg | null;
      gapSeconds: number | null;
      obstacles: ObstacleRecord[];
      leaderboard: LeaderboardRecord | null;
      notes: string[];
      stand: StandInfo | null;
      otherStands: string[];
    };

export function fmtSeconds(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m ? `${m}m ${sec}s` : `${sec}s`;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function blockedNodes(obstacles: ObstacleRecord[], accessible: boolean) {
  const out = new Set<string>(accessible ? STAIRS_NODES : []);
  for (const o of obstacles) {
    if (o.status !== "blocked") continue;
    if (o.affects === "wheelchair" && !accessible) continue;
    for (const n of o.nodes) out.add(n);
  }
  return out;
}

function describe(r: RouteResult, from: Place, to: Place): Leg {
  const segments: Segment[] = [];
  const steps: string[] = [];
  const via: string[] = [];
  let level = levelOf(r.nodeIds[0]);
  let cur: Pt[] = [r.points[0]];
  let walked = 0;
  const floor = (l: string) => (l === "og" ? "on the 1. OG" : "on the ground floor");

  for (let i = 1; i < r.nodeIds.length; i++) {
    const a = connectorOf(r.nodeIds[i - 1]);
    const b = connectorOf(r.nodeIds[i]);
    const next = levelOf(r.nodeIds[i]);
    if (a && b && a.id === b.id && next !== level) {
      if (walked > 1) steps.push(`Walk ~${Math.round(walked)} m ${floor(level)}`);
      segments.push({ level, points: cur });
      steps.push(`Take ${a.name} ${next === "og" ? "up to the 1. OG" : "down to the ground floor"}`);
      via.push(a.name);
      level = next;
      cur = [r.points[i]];
      walked = 0;
      continue;
    }
    const [x0, y0] = r.points[i - 1],
      [x1, y1] = r.points[i];
    walked += Math.hypot(x1 - x0, y1 - y0);
    cur.push(r.points[i]);
  }
  segments.push({ level, points: cur });

  const first = r.nodeIds[0],
    last = r.nodeIds[r.nodeIds.length - 1];
  const fromName = from.instances.find((i) => i.anchors.includes(first))?.name ?? from.name;
  const dest = to.instances.find((i) => i.anchors.includes(last)) ?? null;
  const toName = dest?.name ?? to.name;
  if (walked > 1) steps.push(`Walk ~${Math.round(walked)} m ${floor(level)} to ${toName}`);

  return {
    fromName,
    toName,
    dest,
    meters: Math.round(r.meters),
    seconds: r.meters / WALK_SPEED_MPS,
    via,
    steps,
    segments: segments.map((s) => ({ level: s.level, points: s.points.map(([x, y]) => [r1(x), r1(y)] as Pt) })),
  };
}

function unresolved(q: string) {
  const s = suggestPlaces(q);
  return `I couldn't find "${q}" in the venue data.${s.length ? ` Closest matches: ${s.join("; ")}.` : ""} Try for example: ${EXAMPLE_PLACES.join(", ")}.`;
}

export async function planRoute(fromQ: string, toQ: string, accessible: boolean): Promise<Plan> {
  const from = findPlace(fromQ);
  if (!from) return { ok: false, error: unresolved(fromQ) };
  const to = findPlace(toQ);
  if (!to) return { ok: false, error: unresolved(toQ) };

  const obstacles = Object.values(await getObstacles()).filter((o) => o.status === "blocked");
  const fromAnchors = from.instances.flatMap((i) => i.anchors);
  const toAnchors = to.instances.flatMap((i) => i.anchors);

  const main = ROUTER.route(fromAnchors, toAnchors, blockedNodes(obstacles, accessible));
  const fast = accessible ? ROUTER.route(fromAnchors, toAnchors, blockedNodes(obstacles, false)) : null;

  if (!main) {
    const blockers = obstacles.map((o) => `${o.label}${o.note ? ` (${o.note})` : ""}`).join("; ");
    return {
      ok: false,
      error:
        `No ${accessible ? "step-free " : ""}route from ${from.name} to ${to.name} right now.` +
        (blockers ? ` Reported obstacles: ${blockers}.` : "") +
        (accessible && fast ? " A route with stairs exists." : ""),
    };
  }

  const route = describe(main, from, to);
  const fastest = fast ? describe(fast, from, to) : null;
  return {
    ok: true,
    accessible,
    from,
    to,
    route,
    fastest,
    gapSeconds: fastest ? Math.max(0, Math.round(route.seconds - fastest.seconds)) : null,
    obstacles,
    leaderboard: accessible ? await getLeaderboardEntry(from.id, to.id) : null,
    notes: [from.note, to.note].filter((n): n is string => !!n),
    stand: route.dest ? standInfo(route.dest) : null,
    otherStands: to.instances.length > 1 && route.dest?.exhibitorId
      ? [...new Set(to.instances.filter((i) => i.exhibitorId !== route.dest!.exhibitorId).map((i) => i.name))].slice(0, 5)
      : [],
  };
}

/** Everything the map widget draws, small enough to also sit in the model's context. */
export function widgetData(plan: Extract<Plan, { ok: true }>) {
  const { route, fastest, accessible } = plan;
  const allPts = route.segments.flatMap((s) => s.points);
  const gapLabel =
    plan.gapSeconds !== null && fastest
      ? plan.gapSeconds > 0
        ? `With stairs it would take ${fmtSeconds(fastest.seconds)}${fastest.via.length ? ` (via ${fastest.via.join(", ")})` : ""}, a gap of ${plan.gapSeconds}s. Reporting obstacles and lift status helps close it.`
        : "No gap: the step-free route is as fast as the fastest route."
      : undefined;
  const raceLabel = accessible
    ? plan.leaderboard
      ? `Accessible-route record for this path: ${fmtSeconds(plan.leaderboard.bestSeconds)} by ${plan.leaderboard.holder}. Beat it and log your time with log_attempt.`
      : "No accessible-route record for this path yet. Be the first: log your time with log_attempt."
    : undefined;
  return {
    accessible,
    fromName: route.fromName,
    toName: route.toName,
    totalTimeLabel: fmtSeconds(route.seconds),
    distanceLabel: `${route.meters} m`,
    via: route.via,
    steps: route.steps,
    gapLabel,
    raceLabel,
    notes: plan.notes,
    stand: plan.stand,
    otherStands: plan.otherStands,
    destSpaceId: route.dest?.spaceId ?? null,
    disclaimer: ESTIMATE_DISCLAIMER,
    segments: route.segments,
    fastestSegments: fastest && plan.gapSeconds ? fastest.segments : null,
    start: allPts[0],
    end: allPts[allPts.length - 1],
    obstacles: plan.obstacles.map((o) => ({ p: o.p, label: o.label, affects: o.affects })),
  };
}

export type WidgetData = ReturnType<typeof widgetData>;
