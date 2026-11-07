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
  meters: number;
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

  /** Shortest path from any of `from` to the nearest of `to`, never entering `blocked` nodes. */
  route(from: string[], to: string[], blocked: Set<string>): RouteResult | null {
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
        const nd = d + w;
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
    return { nodeIds, points: nodeIds.map((n) => this.pos.get(n)!), meters: dist.get(hit)! };
  }
}
