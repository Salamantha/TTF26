// Walking-graph router ported from team-05 (frontend-starter/components/gast/routing.ts),
// trimmed to A→B routing and extended with a set of blocked nodes for obstacles.

export type Pt = [number, number];

export interface GraphNode {
  id: string;
  p: Pt;
  kind: string;
  target: string | null;
}

export interface RouteResult {
  nodeIds: string[];
  points: Pt[];
  /** physical length walked */
  meters: number;
  /** length weighted by stairs/lift costs and crowding; divide by the walking speed for the time */
  effMeters: number;
}

export interface RouteOptions {
  blocked: Set<string>;
  /** stairs edges (both ends in this set) are multiplied by `stairsFactor`; Infinity = not usable */
  stairsNodes: Set<string>;
  stairsFactor: number;
  /** walking-time factor per node from crowding (1 = free); null = no crowd data */
  crowd: Map<string, number> | null;
  /** choose the path with crowding taken into account (otherwise it only affects the time) */
  avoidCrowd: boolean;
}

class Heap {
  private a: [number, string][] = [];
  get size() {
    return this.a.length;
  }
  push(item: [number, string]) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, string] {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class Router {
  private adj = new Map<string, [string, number][]>();
  private pos = new Map<string, Pt>();
  readonly nodes: GraphNode[];

  constructor(nodes: GraphNode[], edges: [string, string, number][]) {
    this.nodes = nodes;
    for (const n of nodes) {
      this.pos.set(n.id, n.p);
      this.adj.set(n.id, []);
    }
    for (const [a, b, c] of edges) {
      this.adj.get(a)?.push([b, c]);
      this.adj.get(b)?.push([a, c]);
    }
  }

  nodePos(id: string) {
    return this.pos.get(id);
  }

  nearestNode(p: Pt): string {
    let best = "",
      bd = Infinity;
    for (const [id, [x, y]] of this.pos) {
      const d = (x - p[0]) ** 2 + (y - p[1]) ** 2;
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  nodesWithin(p: Pt, radius: number): string[] {
    const r2 = radius * radius;
    const out: string[] = [];
    for (const [id, [x, y]] of this.pos) {
      if ((x - p[0]) ** 2 + (y - p[1]) ** 2 <= r2) out.push(id);
    }
    return out;
  }

  /** Cheapest path from any of `from` to the nearest of `to`, never entering blocked nodes. */
  route(from: string[], to: string[], o: RouteOptions): RouteResult | null {
    const { blocked } = o;
    const pf = (a: string, b: string) => (o.stairsNodes.has(a) && o.stairsNodes.has(b) ? o.stairsFactor : 1);
    const cf = (a: string, b: string) => (o.crowd ? ((o.crowd.get(a) ?? 1) + (o.crowd.get(b) ?? 1)) / 2 : 1);
    const targets = new Set(to.filter((t) => !blocked.has(t)));
    if (!targets.size) return null;
    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const h = new Heap();
    for (const s of from) {
      if (blocked.has(s)) continue;
      dist.set(s, 0);
      h.push([0, s]);
    }
    let hit: string | null = null;
    while (h.size) {
      const [d, u] = h.pop();
      if (d > (dist.get(u) ?? Infinity)) continue;
      if (targets.has(u)) {
        hit = u;
        break;
      }
      for (const [v, w] of this.adj.get(u) ?? []) {
        if (blocked.has(v)) continue;
        const f = pf(u, v);
        if (f === Infinity) continue;
        const nd = d + w * f * (o.avoidCrowd ? cf(u, v) : 1);
        if (nd < (dist.get(v) ?? Infinity)) {
          dist.set(v, nd);
          prev.set(v, u);
          h.push([nd, v]);
        }
      }
    }
    if (!hit) return null;
    const nodeIds: string[] = [];
    for (let n: string | undefined = hit; n; n = prev.get(n)) nodeIds.push(n);
    nodeIds.reverse();
    let meters = 0,
      effMeters = 0;
    for (let i = 1; i < nodeIds.length; i++) {
      const a = nodeIds[i - 1],
        b = nodeIds[i];
      const [x0, y0] = this.pos.get(a)!,
        [x1, y1] = this.pos.get(b)!;
      meters += Math.hypot(x1 - x0, y1 - y0);
      const w = this.adj.get(a)!.find((e) => e[0] === b)![1];
      effMeters += w * pf(a, b) * cf(a, b);
    }
    return { nodeIds, points: nodeIds.map((n) => this.pos.get(n)!), meters, effMeters };
  }
}
