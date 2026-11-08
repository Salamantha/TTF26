// Interactive 3D route map for the ChatGPT widget and the /map page.
// Scene ported from team-05 (frontend-starter/components/gast/Map3D.tsx), without React.
// Bundled into one IIFE by scripts/build-widget.mjs; the venue geometry comes from
// window.__TTF_VENUE__ (lib/widget.ts) and the route from window.openai.toolOutput.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { densityAt, densityColour, simTime, DENSITY_LEGEND, type Hotspot } from "../lib/crowd";

type Pt = [number, number];

interface Venue {
  halls: { name: string | null; poly: Pt[]; label: Pt | null; h: number }[];
  booths: { id: string; poly: Pt[]; code: string | null; kind: string; color: string | null; label: Pt | null; ex: string }[];
  blocks: Pt[][];
  hotspots: Hotspot[];
  og: {
    elevation: number;
    roomH: number;
    outline: Pt[];
    areas: { name: string; kind: string; poly: Pt[] }[];
    tables: { n: number; poly: Pt[]; label: Pt }[];
    connectors: { name: string; kind: "stairs" | "lift"; poly: Pt[]; bottom: Pt; top: Pt; approx: boolean }[];
  };
}

type Mobility = "walk" | "cane" | "wheelchair";

interface RouteData {
  query: { from: string; to: string };
  mobility: Mobility;
  mobilityLabel: string;
  avoidCrowds: boolean;
  fromName: string;
  toName: string;
  seconds: number;
  timeLabel: string;
  distanceLabel: string;
  via: string[];
  parts: {
    id: string;
    kind: "walk" | "lift" | "stairs";
    title: string;
    meters: number;
    level: "eg" | "og";
    points: Pt[];
    placeName?: string;
    plannedSeconds: number;
    bestSeconds: number | null;
    confirmedAt: string | null;
  }[];
  compare: {
    fastest: { seconds: number; label: string; via: string[] } | null;
    stepFree: { seconds: number; label: string; via: string[] } | null;
    gapSeconds: number | null;
  };
  leaderboard: { holder: string; seconds: number; label: string; recordedAt: string }[];
  persistent: boolean;
  segments: { level: "eg" | "og"; points: Pt[] }[];
  fastestSegments: { level: "eg" | "og"; points: Pt[] }[] | null;
  start: Pt;
  end: Pt;
  obstacles: { id: string; p: Pt; label: string; affects: string; radius: number; level: 0 | 1 }[];
  destSpaceId: string | null;
  stand: {
    code: string | null;
    hall: string | null;
    exhibitor: string | null;
    categories: string[];
    whyVisit: string | null;
    website: string | null;
    alsoHere: string[];
  } | null;
  otherStands: string[];
}

interface ToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

interface Run {
  key: string;
  startedAt: number;
  idx: number;
  partStartedAt: number;
  splits: Record<string, number>;
  /** false = plain step-by-step navigation without a clock */
  timed: boolean;
  /** the route as first asked, kept for the leaderboard when the run is re-planned mid-way */
  origin?: { from: string; to: string };
  originFastest?: number | null;
  rerouted?: number;
  /** what the runner reported along the way, for the thank-you at the end */
  confirmed?: string[];
  reported?: number;
  deviations?: number;
}

interface WidgetState {
  run?: Run | null;
  name?: string;
  heat?: boolean;
}

declare global {
  interface Window {
    __TTF_VENUE__: Venue;
    openai?: {
      toolOutput?: RouteData;
      theme?: string;
      widgetState?: WidgetState | null;
      setWidgetState?: (s: WidgetState) => Promise<void> | void;
      callTool?: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
      requestDisplayMode?: (o: { mode: string }) => Promise<unknown>;
    };
  }
}

const BOOTH_H = 2.5,
  STAGE_H = 1,
  SELECTED_H = 3.5,
  BLOCK_H = 3,
  ARENA_WALL = 10,
  ARENA_DOME = 8;
const FOV = 45,
  RAD = Math.PI / 180,
  POLAR = 55 * RAD;
const ROUTE_R = 0.45,
  DASH = 2.2,
  GAP = 1.6;
// Labels fade with camera distance: [fully visible up to, gone at] metres. Booth codes only up close.
const FADE = { booth: [28, 50], og: [45, 85], table: [30, 55] } as const;

const PALETTES = {
  light: { bg: "#f4f4f0", hall: "#e2e2dc", stroke: "#9a9a90", booth: "#cfd8e3", stage: "#e8c9a0", block: "#bbbbb5", accent: "#e4572e", eg: "#1a7f37", og: "#2563eb", fast: "#d97706", text: "#1f2328" },
  dark: { bg: "#16181d", hall: "#2b2f37", stroke: "#4b5263", booth: "#3a4250", stage: "#6b5a3e", block: "#30343c", accent: "#ff6b4a", eg: "#3fb950", og: "#58a6ff", fast: "#f0a43a", text: "#e6edf3" },
};

const SVG_NS = "http://www.w3.org/2000/svg";
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const centroid = (poly: Pt[]): Pt => {
  let x = 0,
    y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
};
const inside = ([x, y]: Pt, poly: Pt[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/** Extrude a plan polygon to height h (+Y); plan y maps to +Z. */
function extrude(poly: Pt[], h: number, baseY = 0, holes: Pt[][] = []) {
  if (poly.length < 3) return null;
  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, -y)));
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, -y))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  if (baseY) g.translate(0, baseY, 0);
  return g;
}

function dashedTube(segs: THREE.LineCurve3[], r: number) {
  const pieces: THREE.BufferGeometry[] = [];
  let dash: THREE.Vector3[] = [];
  let on = true,
    rem = DASH;
  const flush = () => {
    if (dash.length >= 2) {
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 1; i < dash.length; i++) path.add(new THREE.LineCurve3(dash[i - 1], dash[i]));
      pieces.push(new THREE.TubeGeometry(path, Math.max(1, dash.length - 1), r, 6, false));
    }
    dash = [];
  };
  for (const s of segs) {
    const len = s.v1.distanceTo(s.v2);
    let t = 0;
    while (len - t > 1e-6) {
      const step = Math.min(rem, len - t);
      if (on) {
        if (!dash.length) dash.push(s.v1.clone().lerp(s.v2, t / len));
        dash.push(s.v1.clone().lerp(s.v2, (t + step) / len));
      }
      t += step;
      rem -= step;
      if (rem <= 1e-6) {
        if (on) flush();
        on = !on;
        rem = on ? DASH : GAP;
      }
    }
  }
  flush();
  if (!pieces.length) return null;
  const merged = mergeGeometries(pieces);
  for (const p of pieces) p.dispose();
  return merged;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

function start() {
  const venue = window.__TTF_VENUE__;
  const root = document.getElementById("ttf-root")!;
  const host = document.getElementById("ttf-3d")!;
  const dark = window.openai?.theme ? window.openai.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const C = dark ? PALETTES.dark : PALETTES.light;
  root.classList.toggle("dark", dark);
  const OG_Y = venue.og.elevation;

  const w0 = Math.max(host.clientWidth, 1),
    h0 = Math.max(host.clientHeight, 1);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w0, h0);
  host.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.setSize(w0, h0);
  Object.assign(labels.domElement.style, { position: "absolute", top: "0", left: "0", pointerEvents: "none" });
  host.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.bg);
  const camera = new THREE.PerspectiveCamera(FOV, w0 / h0, 1, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 12;
  controls.maxDistance = 900;
  controls.screenSpacePanning = false;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x888880, dark ? 1.1 : 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, dark ? 1.0 : 1.4);
  sun.position.set(200, 300, 200);
  scene.add(sun);

  const mats = {
    wall: new THREE.MeshStandardMaterial({ color: C.hall, transparent: true, opacity: dark ? 0.28 : 0.18, depthWrite: false, side: THREE.DoubleSide }),
    floor: new THREE.MeshStandardMaterial({ color: C.hall, roughness: 0.9 }),
    edge: new THREE.LineBasicMaterial({ color: C.stroke }),
    block: new THREE.MeshStandardMaterial({ color: C.block, roughness: 0.9 }),
  };
  const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  const add = (g: THREE.BufferGeometry | null, m: THREE.Material, order = 0) => {
    if (!g) return null;
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = order;
    scene.add(mesh);
    return mesh;
  };
  const detailLabels: [CSS2DObject, number, number][] = [];
  const label = (text: string, [x, y]: Pt, h: number, cls: string, fade: readonly [number, number] | null = FADE.og, parent: THREE.Object3D = scene) => {
    const div = el("div", `l3 ${cls}`, text);
    const o = new CSS2DObject(div);
    o.position.set(x, h, y);
    parent.add(o);
    if (fade) detailLabels.push([o, fade[0], fade[1]]);
    return o;
  };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), mat(C.bg, { roughness: 1 }));
  ground.position.y = -0.02;
  scene.add(ground);

  // Halls: see-through walls with outlines, floor, labels.
  for (const h of venue.halls) {
    const wall = extrude(h.poly, h.h);
    if (wall) {
      add(wall, mats.wall, 2);
      scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(wall), mats.edge));
    }
    add(extrude(h.poly, 0.05), mats.floor);
    let top = h.h;
    if (!h.name) {
      let bx0 = Infinity,
        bz0 = Infinity,
        bx1 = -Infinity,
        bz1 = -Infinity;
      for (const [x, y] of h.poly) {
        bx0 = Math.min(bx0, x);
        bz0 = Math.min(bz0, y);
        bx1 = Math.max(bx1, x);
        bz1 = Math.max(bz1, y);
      }
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), mats.wall);
      dome.scale.set((bx1 - bx0) / 2, ARENA_DOME, (bz1 - bz0) / 2);
      dome.position.set((bx0 + bx1) / 2, ARENA_WALL, (bz0 + bz1) / 2);
      dome.renderOrder = 2;
      scene.add(dome);
      top += ARENA_DOME;
    }
    if (h.label) label(h.name ?? "Salzburgarena", h.label, top + 1, "hall", null);
  }

  // Booths and stages (pickable), plus fixed obstacles.
  const pickables: THREE.Mesh[] = [];
  const boothMesh = new Map<string, { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; h: number; base: THREE.Color }>();
  const boothById = new Map(venue.booths.map((b) => [b.id, b]));
  for (const b of venue.booths) {
    const h = b.kind === "stage" ? STAGE_H : BOOTH_H;
    const g = extrude(b.poly, h);
    if (!g) continue;
    const base = new THREE.Color(b.kind === "stage" ? C.stage : C.booth);
    if (b.color) base.lerp(new THREE.Color(b.color), dark ? 0.45 : 0.55);
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: base.clone(), roughness: 0.8 }));
    mesh.userData.id = b.id;
    scene.add(mesh);
    pickables.push(mesh);
    boothMesh.set(b.id, { mesh, h, base });
    if (b.code && b.label) label(b.code, b.label, h + 0.4, "booth", FADE.booth);
  }
  for (const poly of venue.blocks) add(extrude(poly, BLOCK_H), mats.block);

  // 1. OG of Foyer 10: slab with stairwell openings, rooms, zones, tables, stairs as steps, lift shafts.
  const og = venue.og;
  const openings = (poly: Pt[]) => og.connectors.filter((s) => inside(centroid(s.poly), poly)).map((s) => s.poly);
  const slabMat = mat(C.hall, { transparent: true, opacity: 0.85 });
  const slabs: THREE.Mesh[] = [];
  const slab = add(extrude(og.outline, 0.25, OG_Y - 0.25, openings(og.outline)), slabMat);
  if (slab) slabs.push(slab);
  const zoneMat = mat(C.accent, { transparent: true, opacity: 0.35 });
  for (const a of og.areas) {
    if (a.kind === "room") {
      const g = extrude(a.poly, og.roomH, OG_Y);
      if (g) {
        add(g, mats.wall, 2);
        scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), mats.edge));
      }
      label(a.name, centroid(a.poly), OG_Y + 1.6, "og");
    } else if (a.kind === "lobby") {
      const s = add(extrude(a.poly, 0.25, OG_Y - 0.25, openings(a.poly)), slabMat);
      if (s) slabs.push(s);
      label(a.name + " ≈", centroid(a.poly), OG_Y + 1.5, "og");
    } else if (a.kind === "service") add(extrude(a.poly, 3, OG_Y), mats.block);
    else if (a.kind === "wc") {
      add(extrude(a.poly, 2.6, OG_Y), mat("#3b82f6"));
      label(a.name, centroid(a.poly), OG_Y + 3.2, "og");
    } else if (a.kind === "zone") {
      add(extrude(a.poly, 0.08, OG_Y + 0.03), zoneMat);
      label(a.name, centroid(a.poly), OG_Y + 1, "og");
    }
  }
  const tableMat = mat(C.booth);
  for (const t of og.tables) {
    add(extrude(t.poly, 0.75, OG_Y), tableMat);
    label(String(t.n), t.label, OG_Y + 1.2, "og table", FADE.table);
  }
  const stairMat = mat("#f59e0b");
  for (const s of og.connectors) {
    if (s.kind === "lift") {
      add(extrude(s.poly, OG_Y + 3, 0), mat("#22d3ee", { transparent: true, opacity: 0.45, depthWrite: false }), 2);
    } else {
      let [p0, p1, p2, p3] = s.poly;
      const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const climb: Pt = [s.top[0] - s.bottom[0], s.top[1] - s.bottom[1]];
      const dot = (a: Pt, b: Pt) => Math.abs(a[0] * (b[0] - p0[0]) + a[1] * (b[1] - p0[1])) / (d(p0, b) || 1);
      if (dot(climb, p3) > dot(climb, p1)) [p0, p1, p2, p3] = [p0, p3, p2, p1];
      if (d(s.bottom, mid(p1, p2)) < d(s.bottom, mid(p0, p3))) [p0, p1, p2, p3] = [p1, p0, p3, p2];
      const steps = 16;
      const lerp = (p: Pt, q: Pt, t: number): Pt => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      for (let i = 0; i < steps; i++) {
        const a = i / steps,
          b = (i + 1) / steps;
        add(extrude([lerp(p0, p1, a), lerp(p0, p1, b), lerp(p3, p2, b), lerp(p3, p2, a)], (OG_Y * (i + 1)) / steps, 0), stairMat);
      }
    }
    label(s.name + (s.approx ? " ≈" : ""), centroid(s.poly), OG_Y + 3.6, "og stair");
  }
  label("1. OG Foyer 10 · TTF Hackathon", centroid(og.outline), OG_Y + og.roomH + 1.5, "hall", null);

  // Simulated visitor density as heat textures on both floors (same simulation and clock the server routes with).
  const CELL = 1.5;
  const heatLayers = [
    { level: 0, y: 0.09, polys: venue.halls.map((h) => h.poly) },
    { level: 1, y: OG_Y + 0.03, polys: [og.outline, ...og.areas.filter((a) => a.kind === "lobby").map((a) => a.poly)] },
  ].map(({ level, y, polys }) => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of polys) for (const [x, z] of p) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, z);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, z);
    }
    const W = Math.ceil((x1 - x0) / CELL),
      H = Math.ceil((y1 - y0) / CELL);
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = W;
    maskCanvas.height = H;
    const mctx = maskCanvas.getContext("2d")!;
    mctx.fillStyle = "#fff";
    for (const p of polys) {
      mctx.beginPath();
      p.forEach(([x, z], i) => (i ? mctx.lineTo((x - x0) / CELL, (z - y0) / CELL) : mctx.moveTo((x - x0) / CELL, (z - y0) / CELL)));
      mctx.closePath();
      mctx.fill();
    }
    const mask = mctx.getImageData(0, 0, W, H).data;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W * CELL, H * CELL).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    mesh.position.set(x0 + (W * CELL) / 2, y, y0 + (H * CELL) / 2);
    mesh.renderOrder = 1;
    scene.add(mesh);
    return { level, x0, y0, W, H, mask, canvas, tex, mesh };
  });
  const paintHeat = () => {
    const t = simTime();
    for (const l of heatLayers) {
      const ctx = l.canvas.getContext("2d")!;
      const img = ctx.createImageData(l.W, l.H);
      for (let j = 0; j < l.H; j++)
        for (let i = 0; i < l.W; i++) {
          const k = (j * l.W + i) * 4;
          if (!l.mask[k + 3]) continue;
          const [r, g, b, a] = densityColour(densityAt(venue.hotspots, [l.x0 + (i + 0.5) * CELL, l.y0 + (j + 0.5) * CELL], l.level, t));
          img.data[k] = r;
          img.data[k + 1] = g;
          img.data[k + 2] = b;
          img.data[k + 3] = Math.round(a * 255);
        }
      ctx.putImageData(img, 0, 0);
      l.tex.needsUpdate = true;
    }
  };
  let heatOn = false;
  let heatTimer: ReturnType<typeof setInterval> | null = null;
  const setHeat = (on: boolean) => {
    heatOn = on;
    for (const l of heatLayers) l.mesh.visible = on;
    if (heatTimer) clearInterval(heatTimer);
    heatTimer = null;
    if (on) {
      paintHeat();
      heatTimer = setInterval(paintHeat, 2000);
    }
    document.getElementById("ttf-heat")!.setAttribute("aria-pressed", String(on));
    document.getElementById("ttf-heat-legend")!.hidden = !on;
  };

  // Route layer, rebuilt for every tool result.
  const routeGroup = new THREE.Group();
  scene.add(routeGroup);
  let routeBox = new THREE.Box3(new THREE.Vector3(-150, 0, -290), new THREE.Vector3(140, 10, 200));
  let selectedBooth: string | null = null;

  const paint = () => {
    for (const [id, b] of boothMesh) {
      const isDest = id === selectedBooth;
      b.mesh.material.color.copy(isDest ? new THREE.Color(C.accent) : b.base);
      b.mesh.material.emissive.set(isDest ? new THREE.Color(C.accent).multiplyScalar(0.3) : 0x000000);
      b.mesh.scale.y = isDest ? SELECTED_H / b.h : 1;
    }
  };

  const toPath = (segs: RouteData["segments"], lift: number) => {
    const path = new THREE.CurvePath<THREE.Vector3>();
    let prev: THREE.Vector3 | null = null;
    for (const s of segs) {
      for (const [x, y] of s.points) {
        const p = new THREE.Vector3(x, (s.level === "og" ? OG_Y : 0) + lift, y);
        if (prev && prev.distanceTo(p) > 0.01) path.add(new THREE.LineCurve3(prev, p));
        prev = p;
      }
    }
    return path;
  };

  function drawRoute(d: RouteData) {
    for (const c of [...routeGroup.children]) {
      routeGroup.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
    if (d.fastestSegments) {
      const fp = toPath(d.fastestSegments, 0.5);
      if (fp.curves.length) {
        const g = dashedTube(fp.curves as THREE.LineCurve3[], ROUTE_R * 0.7);
        // Drawn over everything: it mostly runs under the OG slab or beside the main route.
        if (g) {
          const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: C.fast, transparent: true, opacity: 0.75, depthTest: false }));
          m.renderOrder = 5;
          routeGroup.add(m);
        }
      }
    }
    // One tube per floor (green ground floor, blue 1. OG); each reaches the next floor's start,
    // so the stairs/lift climb is drawn in the colour of the floor it leaves.
    const lifted = (s: RouteData["segments"][number]) =>
      s.points.map(([x, y]) => new THREE.Vector3(x, (s.level === "og" ? OG_Y : 0) + 0.7, y));
    d.segments.forEach((s, i) => {
      const vs = lifted(s);
      const next = d.segments[i + 1];
      if (next) vs.push(lifted(next)[0]);
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let k = 1; k < vs.length; k++) if (vs[k - 1].distanceTo(vs[k]) > 0.01) path.add(new THREE.LineCurve3(vs[k - 1], vs[k]));
      if (!path.curves.length) return;
      const col = s.level === "og" ? C.og : C.eg;
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, path.curves.length * 2, ROUTE_R, 6, false), new THREE.MeshBasicMaterial({ color: col }));
      tube.renderOrder = 3;
      routeGroup.add(tube);
      // Dashed copy drawn only where something solid (e.g. the OG slab) hides the route.
      const hidden = dashedTube(path.curves as THREE.LineCurve3[], ROUTE_R);
      if (hidden) {
        const m = new THREE.Mesh(hidden, new THREE.MeshBasicMaterial({ color: col, depthFunc: THREE.GreaterDepth, depthWrite: false, transparent: true, opacity: 0.9 }));
        m.renderOrder = 4;
        routeGroup.add(m);
      }
    });
    const floorY = (s: RouteData["segments"][number] | undefined) => (s?.level === "og" ? OG_Y : 0);
    label("A", d.start, floorY(d.segments[0]) + 4, "pin a", null, routeGroup);
    label("B", d.end, floorY(d.segments[d.segments.length - 1]) + 4, "pin b", null, routeGroup);
    drawObstacles(d.obstacles);

    selectedBooth = d.destSpaceId;
    paint();

    routeBox = new THREE.Box3();
    const grow = (segs: RouteData["segments"] | null) =>
      segs?.forEach((s) => s.points.forEach(([x, y]) => routeBox.expandByPoint(new THREE.Vector3(x, s.level === "og" ? OG_Y : 0, y))));
    grow(d.segments);
    grow(d.fastestSegments);
    frame(false);
  }

  // Reported obstacles as orange areas at their real radius, on their floor.
  const obstacleGroup = new THREE.Group();
  scene.add(obstacleGroup);
  const obstacleMat = new THREE.MeshBasicMaterial({ color: "#f97316", transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
  const obstacleRing = new THREE.MeshBasicMaterial({ color: "#ea580c", depthTest: false, transparent: true, opacity: 0.9 });
  function drawObstacles(list: RouteData["obstacles"]) {
    for (const c of [...obstacleGroup.children]) {
      obstacleGroup.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
    for (const o of list) {
      const y = (o.level === 1 ? OG_Y : 0) + 0.2;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(o.radius, 40).rotateX(-Math.PI / 2), obstacleMat);
      disc.position.set(o.p[0], y, o.p[1]);
      disc.renderOrder = 5;
      const ring = new THREE.Mesh(new THREE.RingGeometry(o.radius - 0.25, o.radius, 48).rotateX(-Math.PI / 2), obstacleRing);
      ring.position.set(o.p[0], y + 0.01, o.p[1]);
      ring.renderOrder = 6;
      obstacleGroup.add(disc, ring);
      label(`⚠ ${o.label}`, o.p, y + 3, "obstacle", null, obstacleGroup);
    }
  }

  // Current navigation step: a bright tube on top of the route, and the camera follows it.
  const hlGroup = new THREE.Group();
  scene.add(hlGroup);
  const hlMat = new THREE.MeshBasicMaterial({ color: "#facc15", depthTest: false, transparent: true, opacity: 0.95 });
  function highlightPart(part: RouteData["parts"][number] | null, prevLevel: "eg" | "og" = "eg") {
    for (const c of [...hlGroup.children]) {
      hlGroup.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
    if (!part) return;
    // Stairs/lift parts start on the floor they leave; walking parts stay on one floor.
    const ys = part.points.map((_, i) => ((part.kind === "walk" ? part.level : i === 0 ? prevLevel : part.level) === "og" ? OG_Y : 0) + 0.9);
    const vs = part.points.map(([x, z], i) => new THREE.Vector3(x, ys[i], z));
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let k = 1; k < vs.length; k++) if (vs[k - 1].distanceTo(vs[k]) > 0.01) path.add(new THREE.LineCurve3(vs[k - 1], vs[k]));
    if (path.curves.length) {
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, path.curves.length * 2, ROUTE_R * 1.7, 8, false), hlMat);
      tube.renderOrder = 7;
      hlGroup.add(tube);
    }
    const box = new THREE.Box3().setFromPoints(vs);
    frameBox(box, true, 30);
  }

  function frame(animated: boolean, topDown = false) {
    frameBox(routeBox, animated, 40, topDown);
  }

  function frameBox(box: THREE.Box3, animated: boolean, minSpan: number, topDown = false) {
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, minSpan) * 1.25;
    const dist = clamp(span / (2 * Math.tan((FOV * RAD) / 2)) / Math.min(1, camera.aspect) + 10, 25, 700);
    const polar = topDown ? 0.01 : POLAR;
    const pos = new THREE.Vector3().setFromSphericalCoords(dist, polar, topDown ? 0 : -0.35).add(c);
    if (!animated) {
      controls.target.copy(c);
      camera.position.copy(pos);
      controls.update();
      return;
    }
    const t0 = controls.target.clone(),
      p0 = camera.position.clone(),
      s0 = performance.now();
    const tick = (t: number) => {
      const k = clamp((t - s0) / 450, 0, 1),
        e = 1 - (1 - k) ** 3;
      controls.target.lerpVectors(t0, c, e);
      camera.position.lerpVectors(p0, pos, e);
      controls.update();
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Click a booth: who exhibits there.
  const info = document.getElementById("ttf-pick")!;
  const ray = new THREE.Raycaster(),
    ndc = new THREE.Vector2();
  const pick = (cx: number, cy: number) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([...slabs, ...pickables], false)[0];
    return hit && hit.object.userData.id ? (hit.object.userData.id as string) : null;
  };
  let down: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    down = null;
    const id = pick(e.clientX, e.clientY);
    const b = id ? boothById.get(id) : null;
    info.replaceChildren();
    info.hidden = !b;
    if (b) {
      el("strong", "", `Stand ${b.code ?? "?"}`, info);
      el("div", "", b.ex || "No exhibitor listed", info);
    }
  });

  const ro = new ResizeObserver(() => {
    const w = Math.max(host.clientWidth, 1),
      h = Math.max(host.clientHeight, 1);
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  ro.observe(host);

  const alpha = new Map<CSS2DObject, number>();
  const loop = () => {
    requestAnimationFrame(loop);
    controls.update();
    for (const [l, near, far] of detailLabels) {
      const a = Math.round(clamp((far - camera.position.distanceTo(l.position)) / (far - near), 0, 1) * 20) / 20;
      if (alpha.get(l) === a) continue;
      alpha.set(l, a);
      l.visible = a > 0;
      l.element.style.opacity = String(a);
    }
    renderer.render(scene, camera);
    labels.render(scene, camera);
  };
  requestAnimationFrame(loop);

  const $ = (id: string) => document.getElementById(id)!;
  $("ttf-reset").onclick = () => frame(true);
  $("ttf-top").onclick = () => frame(true, true);
  const full = $("ttf-full");
  if (window.openai?.requestDisplayMode) full.onclick = () => window.openai!.requestDisplayMode!({ mode: "fullscreen" });
  else full.hidden = true;

  // Widget state survives re-renders inside ChatGPT; localStorage covers the plain /map page.
  const loadState = (): WidgetState => {
    const s = window.openai?.widgetState;
    if (s) return { ...s };
    try {
      return JSON.parse(localStorage.getItem("ttf-widget") || "{}");
    } catch {
      return {};
    }
  };
  let state = loadState();
  const saveState = (patch: Partial<WidgetState>) => {
    state = { ...state, ...patch };
    try {
      window.openai?.setWidgetState?.(state);
    } catch {}
    try {
      localStorage.setItem("ttf-widget", JSON.stringify(state));
    } catch {}
  };

  const toastEl = $("ttf-toast");
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const toast = (msg: string) => {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 5000);
  };

  const legend = $("ttf-heat-legend");
  for (const l of DENSITY_LEGEND) {
    const s = el("span", "", undefined, legend);
    el("i", "", undefined, s).style.background = l.css;
    s.append(l.label);
  }
  el("span", "unit", "people/m² · simulated", legend);
  setHeat(state.heat ?? new URLSearchParams(location.search).has("heat"));
  $("ttf-heat").onclick = () => {
    setHeat(!heatOn);
    saveState({ heat: heatOn });
  };

  // ChatGPT wraps tool errors in a Python-style dump ("RuntimeException: … TextContent(type='text', text='…')");
  // show only the tool's own text.
  const readable = (raw: string): string => {
    const m = raw.match(/text=\\?["']([\s\S]+?)\\?["'],\s*annotations/);
    if (m) return m[1].replace(/\\"/g, '"');
    try {
      const j = JSON.parse(raw);
      if (typeof j?.detail === "string") return readable(j.detail);
    } catch {}
    return raw.length > 200 ? "Something went wrong. Please try again." : raw;
  };
  // Our own error texts put one fact per line (escaped as "\n" inside ChatGPT's exception text); drop the
  // possibly long obstacle list so the message stays short.
  const brief = (s: string) =>
    s
      .split(/\\n|\n/)
      .filter((l) => !l.startsWith("Reported obstacles"))
      .join(" ")
      .trim();
  const canCall = !!window.openai?.callTool;
  const call = async (name: string, args: Record<string, unknown>) => {
    let r: ToolResult;
    try {
      r = await window.openai!.callTool!(name, args);
    } catch (e) {
      throw new Error(brief(readable(String((e as Error)?.message ?? e))));
    }
    const msg = r?.content?.find((c) => c.type === "text")?.text ?? "";
    if (r?.isError) throw new Error(readable(brief(msg)) || "Something went wrong.");
    return { msg, data: r?.structuredContent as Record<string, unknown> | undefined };
  };

  let last: RouteData | null = null;
  let lastJson = "";
  let busy = false;
  let mode: "overview" | "nav" | "finish" = "overview";
  const replan = async (patch: { mobility?: Mobility; avoidCrowds?: boolean }) => {
    if (!last || busy || !canCall || mode !== "overview") return;
    busy = true;
    root.classList.add("busy");
    try {
      const { data } = await call("find_accessible_route", {
        from: last.query.from,
        to: last.query.to,
        mobility: patch.mobility ?? last.mobility,
        avoidCrowds: patch.avoidCrowds ?? last.avoidCrowds,
      });
      show(data as unknown as RouteData, true);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      busy = false;
      root.classList.remove("busy");
    }
  };

  // Mobility profiles (Material Icons, Apache 2.0: directions_walk, elderly, accessible), as in team-05.
  const ICON: Record<Mobility, string> = {
    walk: "M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7",
    cane: "M13.5 5.5c1.09 0 2-.9 2-2s-.91-2-2-2-2 .9-2 2 .9 2 2 2zM20 12.5V23h-1V12.5c0-.28-.22-.5-.5-.5s-.5.22-.5.5v1h-1v-.69c-1.46-.38-2.7-1.29-3.51-2.52-.31.87-.49 1.78-.49 2.71 0 .23.02.46.03.69L15 16.5V23h-2v-5l-1.78-2.54L11 19l-3 4-1.6-1.2L9 18.33V13c0-1.15.18-2.29.5-3.39l-1.5.85V14H6V9.3l5.4-3.07v.01c.59-.31 1.32-.33 1.94.03.36.21.63.51.8.85l.79 1.67C15.58 10.1 16.94 11 18.5 11c.83 0 1.5.67 1.5 1.5z",
    wheelchair: "M12 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 7V9c-1.54.02-3.09-.75-4.07-1.83l-1.29-1.43c-.17-.19-.38-.34-.61-.45-.01 0-.01-.01-.02-.01H13c-.35-.2-.75-.3-1.19-.26C10.76 5.11 10 6.04 10 7.09V13c0 1.1.9 2 2 2h5v5h2v-5.5c0-1.1-.9-2-2-2h-3v-3.45c1.29 1.07 3.25 1.94 5 1.95zm-6.17 5c-.41 1.16-1.52 2-2.83 2-1.66 0-3-1.34-3-3 0-1.31.84-2.41 2-2.83V12.1c-2.28.46-4 2.48-4 4.9 0 2.76 2.24 5 5 5 2.42 0 4.44-1.72 4.9-4h-2.07z",
  };
  const icon = (m: Mobility) => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICON[m]);
    svg.appendChild(path);
    return svg;
  };
  const PROFILE_LABEL: Record<Mobility, string> = { walk: "Walking", cane: "Cane / crutches", wheelchair: "Wheelchair" };
  const prof = $("ttf-profile");
  for (const m of ["walk", "cane", "wheelchair"] as Mobility[]) {
    const b = el("button", "", undefined, prof);
    b.type = "button";
    b.dataset.m = m;
    b.title = PROFILE_LABEL[m];
    b.setAttribute("aria-label", PROFILE_LABEL[m]);
    b.append(icon(m));
    b.onclick = () => replan({ mobility: m });
  }
  const avoid = $("ttf-avoid") as HTMLInputElement;
  avoid.onchange = () => replan({ avoidCrowds: avoid.checked });

  const clock = (s: number, tenths = false) => {
    const t = Math.max(0, s);
    const m = Math.floor(t / 60);
    const sec = t % 60;
    return `${m}:${(tenths ? sec.toFixed(1) : String(Math.floor(sec))).padStart(tenths ? 4 : 2, "0")}`;
  };
  const signed = (s: number) => `${s > 0 ? "+" : "−"}${Math.abs(s).toFixed(1)}`;

  // What kind of attempt this is, shown on Start, during navigation and at the finish.
  const MODE: Record<Mobility, { label: string; note: string; cls: string }> = {
    wheelchair: { label: "Step-free route", note: "no stairs · lifts only", cls: "free" },
    cane: { label: "Cane / crutches route", note: "stairs only if the lift is far", cls: "cane" },
    walk: { label: "Walking route", note: "stairs allowed", cls: "walk" },
  };
  const modeBadge = (m: Mobility, parent: HTMLElement) => {
    const b = el("span", `mode ${MODE[m].cls}`, undefined, parent);
    b.append(icon(m), el("strong", "", MODE[m].label), el("span", "", ` · ${MODE[m].note}`));
    return b;
  };

  function setMode(m: typeof mode) {
    mode = m;
    $("ttf-overview").hidden = m !== "overview";
    $("ttf-nav").hidden = m !== "nav";
    $("ttf-finish").hidden = m !== "finish";
    const locked = m !== "overview" || !canCall;
    prof.querySelectorAll("button").forEach((b) => (b.disabled = locked));
    avoid.disabled = locked;
    root.classList.toggle("navigating", m === "nav");
  }

  function renderHeader(d: RouteData) {
    $("ttf-title").textContent = `${d.fromName} → ${d.toName}`;
    $("ttf-sub").textContent = `${d.timeLabel} · ${d.distanceLabel}`;
    prof.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === d.mobility)));
    avoid.checked = d.avoidCrowds;
  }

  // ---------------------------------------------------------------- overview: the gap + one call to action

  function renderOverview(d: RouteData) {
    const card = $("ttf-gap");
    card.replaceChildren();
    const { fastest, stepFree, gapSeconds } = d.compare;
    const head = el("div", "gap-head", undefined, card);
    el("span", gapSeconds ? "gap-big" : "gap-big zero", gapSeconds ? `+${gapSeconds} s` : "0 s", head);
    el("span", "gap-q", gapSeconds ? "Can you close the gap?" : "No gap here. Beat the record?", head);
    const max = Math.max(fastest?.seconds ?? 0, stepFree?.seconds ?? 0, 1);
    const bar = (m: Mobility, label: string, r: RouteData["compare"]["fastest"], cls: string) => {
      const row = el("div", "bar-row", undefined, card);
      const lab = el("span", "bar-label", undefined, row);
      lab.append(icon(m), label);
      const track = el("span", "bar", undefined, row);
      // The step-free bar is the stairs bar plus a striped yellow piece: that piece is the gap.
      const base = cls === "free" && fastest && r && r.seconds > fastest.seconds ? fastest.seconds : r?.seconds ?? 0;
      const b = el("i", cls, undefined, track);
      b.style.width = `${(base / max) * 100}%`;
      if (r && base < r.seconds) {
        b.classList.add("cut");
        const g = el("i", "gap", undefined, track);
        g.style.width = `${((r.seconds - base) / max) * 100}%`;
        g.title = `the gap: +${r.seconds - base} s`;
      }
      el("span", "bar-time", r ? clock(r.seconds) : "–", row);
    };
    bar("walk", "Stairs", fastest, "fast");
    bar("wheelchair", "Step-free", stepFree, "free");
    const starts = el("div", "starts", undefined, card);
    const nav = el("button", "big", "Navigate ▸", starts);
    const race = el("button", "primary big", d.mobility === "walk" ? "⏱ Time my walk" : "⏱ Beat the gap", starts);
    nav.type = race.type = "button";
    nav.title = "Step-by-step directions, no timer";
    race.title = d.mobility === "walk" ? "Timed walking run" : "Timed run: try to find a faster accessible way";
    nav.disabled = race.disabled = !canCall;
    nav.onclick = () => startRun(d, false);
    race.onclick = () => startRun(d, true);
    el("div", "muted small hint", "Either way, reporting obstacles on the way helps make this route more accessible.", card);

    const lb = $("ttf-lb");
    lb.replaceChildren();
    el("summary", "", `Leaderboard${d.leaderboard.length ? ` · ${d.leaderboard[0].label}` : ""}`, lb);
    if (d.leaderboard.length) {
      const ol = el("ol", "lb", undefined, lb);
      d.leaderboard.forEach((a) => {
        const li = el("li", "", undefined, ol);
        el("span", "", a.holder, li);
        el("strong", "", clock(a.seconds), li);
      });
    } else el("div", "muted", "No times yet.", lb);

    const stand = $("ttf-stand");
    stand.replaceChildren();
    stand.hidden = !d.stand;
    if (d.stand) {
      const det = el("details", "", undefined, stand);
      el("summary", "", `${d.stand.exhibitor ?? "Stand"} · ${d.stand.code ?? ""}`, det);
      if (d.stand.whyVisit) el("p", "muted", d.stand.whyVisit, det);
      if (d.stand.website) {
        const a = el("a", "link", d.stand.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), det);
        a.href = d.stand.website;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
    }
  }

  // ---------------------------------------------------------------- step-by-step navigation (timed or not)

  let tick: ReturnType<typeof setInterval> | null = null;
  const stopTick = () => {
    if (tick) clearInterval(tick);
    tick = null;
  };
  const runKey = (d: RouteData) => `${d.query.from}|${d.query.to}|${d.mobility}`;
  const levelBefore = (d: RouteData, idx: number) => (idx > 0 ? d.parts[idx - 1].level : d.segments[0]?.level ?? "eg");
  const target = (p: RouteData["parts"][number]) => p.bestSeconds ?? p.plannedSeconds;

  function startRun(d: RouteData, timed: boolean) {
    const now = Date.now();
    saveState({
      run: {
        key: runKey(d),
        timed,
        origin: d.query,
        originFastest: d.compare.fastest?.seconds ?? null,
        startedAt: now,
        idx: 0,
        partStartedAt: now,
        splits: {},
      },
    });
    $("ttf-q").replaceChildren();
    enterNav(d);
  }

  function enterNav(d: RouteData) {
    setMode("nav");
    $("ttf-nav-next").after($("ttf-q")); // finish() may have moved it to the finish card
    renderNav(d);
    stopTick();
    if (state.run?.timed) {
      tick = setInterval(() => updateTimers(d), 100);
      updateTimers(d);
    }
  }

  function renderNav(d: RouteData) {
    const run = state.run!;
    const part = d.parts[run.idx];
    root.classList.toggle("untimed", !run.timed);
    $("ttf-nav-step").textContent = `Step ${run.idx + 1}/${d.parts.length}${run.rerouted ? " · new route" : ""}`;
    const modeEl = $("ttf-nav-mode");
    modeEl.replaceChildren();
    modeBadge(d.mobility, modeEl);
    if (!run.timed) el("span", "untimed-tag", "not timed", modeEl);
    $("ttf-nav-title").textContent = part.title;
    $("ttf-nav-meta").textContent = part.kind === "walk" ? `${part.meters} m` : part.kind === "lift" ? "lift" : "stairs";
    $("ttf-nav-target").textContent = part.bestSeconds !== null ? `best ${clock(part.bestSeconds, true)}` : `plan ${clock(part.plannedSeconds)}`;
    $("ttf-nav-next").textContent = run.idx === d.parts.length - 1 ? "Arrived ✓" : "Next ▸";
    $("ttf-nav-untime").hidden = !run.timed;
    const list = $("ttf-splits");
    list.replaceChildren(
      ...d.parts.map((p, i) => {
        const li = el("li", i < run.idx ? "done" : i === run.idx ? "current" : "");
        const name = el("span", "s-name", undefined, li);
        if (i < run.idx) {
          const fp = el("i", "fp-ico", undefined, name);
          fp.setAttribute("role", "img");
          fp.setAttribute("aria-label", "done");
        }
        name.append(p.title);
        const sec = run.splits[p.id];
        if (!run.timed) {
          el("span", "s-delta", "", li);
          el("span", "s-time muted", p.kind === "walk" ? `${p.meters} m` : "", li);
        } else if (sec !== undefined) {
          const delta = sec - target(p);
          const gold = p.bestSeconds === null || sec < p.bestSeconds;
          el("span", `s-delta ${gold ? "gold" : delta > 0 ? "slow" : "fast"}`, gold && p.bestSeconds !== null ? "best!" : signed(delta), li);
          el("span", "s-time", clock(sec, true), li);
        } else {
          el("span", "s-delta", "", li);
          el("span", "s-time muted", clock(target(p)), li);
        }
        return li;
      })
    );
    highlightPart(part, levelBefore(d, run.idx));
  }

  function updateTimers(d: RouteData) {
    const run = state.run;
    if (!run?.timed) return;
    const now = Date.now();
    $("ttf-nav-total").textContent = clock((now - run.startedAt) / 1000, true);
    const part = d.parts[run.idx];
    if (!part) return;
    const split = (now - run.partStartedAt) / 1000;
    $("ttf-nav-split").textContent = clock(split, true);
    const delta = split - target(part);
    const dl = $("ttf-nav-delta");
    dl.textContent = signed(delta);
    dl.className = `delta ${delta > 0 ? "slow" : "fast"}`;
  }

  function nextPart(d: RouteData) {
    const run = state.run;
    if (!run) return;
    const part = d.parts[run.idx];
    if (!part) return;
    const now = Date.now();
    const splits = run.timed ? { ...run.splits, [part.id]: Math.round(Math.max(0.1, (now - run.partStartedAt) / 1000) * 10) / 10 } : run.splits;
    const idx = run.idx + 1;
    saveState({ run: { ...run, idx, partStartedAt: now, splits } });
    ask(d, part);
    if (idx >= d.parts.length) {
      stopTick();
      highlightPart(null);
      finish(d);
      return;
    }
    renderNav(d);
  }
  $("ttf-nav-next").onclick = () => last && nextPart(last);
  $("ttf-nav-stop").onclick = () => {
    stopTick();
    saveState({ run: null });
    highlightPart(null);
    $("ttf-q").replaceChildren();
    if (last) {
      setMode("overview");
      renderOverview(last);
    }
    frame(true);
  };
  // Timing is always optional: stop the clock and keep navigating.
  $("ttf-nav-untime").onclick = () => {
    if (!state.run || !last) return;
    stopTick();
    saveState({ run: { ...state.run, timed: false } });
    renderNav(last);
  };
  $("ttf-nav-blocked").onclick = () => last && state.run && openPanel("blocked", last, last.parts[state.run.idx] ?? null);
  $("ttf-nav-deviate").onclick = () => last && state.run && openPanel("deviate", last, last.parts[state.run.idx] ?? null);

  /** Re-plan from a point on the map to the same destination and continue navigating (the clock keeps running). */
  async function reroute(d: RouteData, pos: { x: number; y: number; level: 0 | 1 }) {
    const run = state.run;
    if (!run) return;
    const { data } = await call("find_accessible_route", {
      from: "Your position",
      to: d.query.to,
      mobility: d.mobility,
      avoidCrowds: d.avoidCrowds,
      fromPoint: pos,
    });
    const nd = data as unknown as RouteData;
    if (!nd?.parts?.length) throw new Error("No other way found from here. Please ask staff for help.");
    const now = Date.now();
    saveState({ run: { ...run, key: runKey(nd), idx: 0, partStartedAt: now, rerouted: (run.rerouted ?? 0) + 1 } });
    last = nd;
    lastJson = JSON.stringify(nd);
    drawRoute(nd);
    renderHeader(nd);
    enterNav(nd);
  }

  const credit = (patch: { confirmed?: string; reported?: number; deviations?: number }) => {
    const run = state.run;
    if (!run) return;
    saveState({
      run: {
        ...run,
        confirmed: patch.confirmed ? [...new Set([...(run.confirmed ?? []), patch.confirmed])] : run.confirmed,
        reported: (run.reported ?? 0) + (patch.reported ?? 0),
        deviations: (run.deviations ?? 0) + (patch.deviations ?? 0),
      },
    });
  };

  /** Targeted question right after a stairs/lift part: one tap, answered into routing for everyone. */
  function ask(d: RouteData, part: RouteData["parts"][number]) {
    const q = $("ttf-q");
    // Keep an unanswered question until a new one replaces it, so tapping Next quickly doesn't lose it.
    if (part.kind === "walk" || !part.placeName) {
      if (!q.querySelector("button:not(:disabled)")) q.replaceChildren();
      return;
    }
    q.replaceChildren();
    const name = part.placeName;
    el("span", "", `Was ${name} ${part.kind === "lift" ? "working" : "passable"}?`, q);
    const yes = el("button", "", "Yes", q),
      no = el("button", "", "No", q);
    yes.type = no.type = "button";
    yes.disabled = no.disabled = !canCall;
    const answer = async (working: boolean) => {
      yes.disabled = no.disabled = true;
      try {
        await call(
          "report_obstacle",
          working
            ? { location: name, status: "clear" }
            : { location: name, status: "blocked", affects: part.kind === "lift" ? "wheelchair" : "everyone", note: "reported during navigation" }
        );
        q.replaceChildren(el("span", "muted", working ? `Thanks, ${name} marked as working.` : `Thanks, ${name} marked as out of order.`));
        credit(working ? { confirmed: name } : { reported: 1 });
      } catch (e) {
        toast((e as Error).message);
        yes.disabled = no.disabled = false;
      }
    };
    yes.onclick = () => answer(true);
    no.onclick = () => answer(false);
  }

  // ---------------------------------------------------------------- finish

  function thankYou(card: HTMLElement, d: RouteData, run: Run) {
    // Everyone gets thanked, record or not, timed or not: every run and every answer keeps the route current.
    const thanks = el("div", "thanks", undefined, card);
    // The TacticalNewt newt walks across once, leaving fading footprints.
    const logo = document.querySelector<HTMLImageElement>("#ttf-root .newt-logo");
    if (logo) {
      const walk = el("div", "newt-walk", undefined, thanks);
      walk.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 9; i++) {
        const fp = el("i", "fp", undefined, walk);
        fp.style.left = `calc(${i * 10}% - ${i * 3}px)`;
        fp.style.top = i % 2 ? "26px" : "5px";
        fp.style.animationDelay = `${i * 0.26}s`;
      }
      const img = el("img", "", undefined, walk);
      img.src = logo.src;
      img.alt = "";
    }
    el("strong", "", "Thank you!", thanks);
    el(
      "div",
      "",
      run.timed
        ? d.mobility === "walk"
          ? "Your run shows how this route really feels, so the step-free one can catch up."
          : "Your run shows where this route is still slow, and helps make it more accessible for the next person."
        : "Every walk with feedback helps keep this route accurate and more accessible.",
      thanks
    );
    const n = (k: number, one: string) => `${k} ${one}${k > 1 ? "s" : ""}`;
    const did = [
      run.confirmed?.length ? `confirmed ${run.confirmed.join(" and ")}` : "",
      run.reported ? `reported ${n(run.reported, "obstacle")}` : "",
      run.deviations ? `shared ${n(run.deviations, "better way")}` : "",
    ].filter(Boolean);
    if (did.length) el("div", "muted", `You ${did.join(", ")}.`, thanks);
  }

  function finish(d: RouteData) {
    setMode("finish");
    const run = state.run!;
    const card = $("ttf-finish");
    card.replaceChildren();
    modeBadge(d.mobility, el("div", "mode-row", undefined, card));
    // An unanswered lift/stairs question (e.g. the lift was the last step) stays answerable here.
    const q = $("ttf-q");
    const keepQ = () => {
      if (q.querySelector("button:not(:disabled)")) card.append(q);
    };

    if (!run.timed) {
      el("div", "gap-q", `You've arrived at ${d.toName}.`, card);
      keepQ();
      thankYou(card, d, run);
      doneButtons(card, d);
      return;
    }

    const total = Math.round(Object.values(run.splits).reduce((a, b) => a + b, 0));
    const fastest = run.originFastest ?? d.compare.fastest?.seconds ?? null;
    keepQ();
    const head = el("div", "gap-head", undefined, card);
    const vsStairs = fastest !== null ? total - fastest : null;
    el("span", vsStairs !== null && vsStairs <= 0 ? "gap-big zero" : "gap-big", clock(total), head);
    el("span", "gap-q", vsStairs !== null && vsStairs <= 0 ? "Gap closed!" : vsStairs !== null ? `+${vsStairs} s vs. stairs` : "Done!", head);
    const max = Math.max(total, fastest ?? 0, 1);
    const bar = (label: string, s: number | null, cls: string) => {
      const row = el("div", "bar-row", undefined, card);
      el("span", "bar-label", label, row);
      el("i", cls, undefined, el("span", "bar", undefined, row)).style.width = `${s ? (s / max) * 100 : 0}%`;
      el("span", "bar-time", s !== null ? clock(s) : "–", row);
    };
    bar("You", total, "you");
    bar("Stairs", fastest, "fast");
    const golds = d.parts.filter((p) => run.splits[p.id] !== undefined && (p.bestSeconds === null || run.splits[p.id] < p.bestSeconds)).length;
    if (golds && !run.rerouted) el("div", "muted", `${golds} best split${golds > 1 ? "s" : ""}`, card);
    if (run.rerouted) el("div", "muted", "Including a detour.", card);
    thankYou(card, d, run);

    const origin = run.origin ?? d.query;
    const form = el("form", "row", undefined, card);
    const input = el("input", "", undefined, form);
    input.placeholder = "Your name";
    input.value = state.name ?? "";
    input.maxLength = 40;
    input.required = true;
    input.setAttribute("aria-label", "Your name");
    const save = el("button", "primary", "Save time", form);
    save.type = "submit";
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      save.disabled = true;
      saveState({ name });
      try {
        const r = await call("log_attempt", {
          from: origin.from,
          to: origin.to,
          mobility: d.mobility,
          seconds: total,
          holder: name,
          ...(run.rerouted ? {} : { splits: run.splits }),
        });
        toast(r.data?.saved === false ? String(r.data.reason ?? r.msg) : r.msg);
        form.replaceChildren(el("span", "muted", r.data?.saved === false ? "Not saved." : `Saved for ${name}. Thanks for helping!`));
      } catch (err) {
        toast((err as Error).message);
        save.disabled = false;
      }
    };
    doneButtons(card, d);
  }

  function doneButtons(card: HTMLElement, d: RouteData) {
    const row = el("div", "row", undefined, card);
    const again = el("button", "", "Again", row);
    const done = el("button", "", "Done", row);
    again.type = done.type = "button";
    const timed = !!state.run?.timed;
    again.onclick = () => startRun(d, timed);
    done.onclick = () => {
      saveState({ run: null });
      $("ttf-q").replaceChildren();
      setMode("overview");
      renderOverview(d);
      frame(true);
      replan({});
    };
  }

  // ---------------------------------------------------------------- report / blocked / different way, with a 2D map

  const sv = (tag: string, attrs: Record<string, string | number>, parent: Element) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    parent.appendChild(n);
    return n;
  };
  const pts = (p: Pt[]) => p.map(([x, y]) => `${x},${y}`).join(" ");

  type PanelKind = "report" | "blocked" | "deviate";
  const PANEL: Record<PanelKind, { title: string; chips: [string, string][] | null; ask: string; tap: string; save: string }> = {
    report: { title: "Report an obstacle", chips: null, ask: "What's blocking the way?", tap: "Tap the map where the obstacle is.", save: "Save" },
    blocked: {
      title: "Blocked? Find another way",
      chips: [["door-closed", "Door closed"], ["door-access", "Door not accessible"], ["lift", "Lift out of order"], ["thing", "Something in the way"]],
      ask: "Anything to add? (optional)",
      tap: "Tap where it's blocked.",
      save: "Report & find another way",
    },
    deviate: {
      title: "Went a different way?",
      chips: [["shorter", "Shorter way"], ["blocked", "Blocked / closed"], ["accessible", "More accessible"], ["lost", "Got lost"], ["other", "Other"]],
      ask: "What did you do instead? (optional)",
      tap: "Tap where you are now.",
      save: "Save & route from here",
    },
  };

  function openPanel(kind: PanelKind, d: RouteData, part: RouteData["parts"][number] | null) {
    const cfg = PANEL[kind];
    const card = $("ttf-report");
    card.replaceChildren();
    card.hidden = false;
    const usesOg = d.segments.some((s) => s.level === "og");
    const idx = state.run?.idx ?? 0;
    // Stairs/lift parts start on the floor you're leaving.
    const partLevel = part ? (part.kind === "walk" ? part.level : levelBefore(d, idx)) : d.segments[0]?.level ?? "eg";
    let level: 0 | 1 = partLevel === "og" ? 1 : 0;
    const focus = part && part.points.length ? part.points : d.segments.flatMap((s) => s.points);
    const start = part?.points[0];
    const ahead = part?.points[Math.min(1, part.points.length - 1)];
    let marker: Pt | null = kind === "deviate" && start ? [start[0], start[1]] : kind !== "report" && ahead ? [ahead[0], ahead[1]] : part ? focus[Math.floor(focus.length / 2)] : null;
    let chip: string | null = null;

    const head = el("div", "row", undefined, card);
    el("strong", "", cfg.title, head);
    const close = el("button", "ghost", "✕", head);
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.onclick = () => (card.hidden = true);
    if (cfg.chips) {
      const chips = el("div", "chips", undefined, card);
      for (const [id, label] of cfg.chips) {
        if (id === "lift" && part?.kind !== "lift") continue;
        const b = el("button", "", label, chips);
        b.type = "button";
        b.setAttribute("aria-pressed", "false");
        b.onclick = () => {
          chip = id;
          chips.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          if (id === "door-access") wc.checked = true;
        };
      }
    }
    const what = el("input", "", undefined, card);
    what.placeholder = cfg.ask;
    what.maxLength = 120;
    what.setAttribute("aria-label", cfg.ask);

    let floorRow: HTMLElement | null = null;
    if (usesOg) {
      floorRow = el("div", "floors", undefined, card);
      for (const [lv, lab] of [[0, "Ground floor"], [1, "1. OG"]] as const) {
        const b = el("button", "", lab, floorRow);
        b.type = "button";
        b.dataset.lv = String(lv);
        b.onclick = () => {
          level = lv;
          draw();
        };
      }
    }
    const svg = sv("svg", { class: "map2d", role: "img", "aria-label": cfg.tap }, card) as SVGSVGElement;
    el("div", "muted small", cfg.tap, card);
    const row = el("div", "row", undefined, card);
    const lab = el("label", "small", undefined, row);
    const wc = el("input", "", undefined, lab);
    wc.type = "checkbox";
    lab.append(" only a problem for wheelchairs");
    if (kind === "deviate") lab.hidden = true;
    const save = el("button", "primary", cfg.save, row);
    save.type = "button";

    function draw() {
      floorRow?.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lv === String(level))));
      svg.replaceChildren();
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const [x, y] of focus) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      const pad = 20,
        w = Math.max(x1 - x0 + 2 * pad, 60),
        h = Math.max(y1 - y0 + 2 * pad, 40);
      svg.setAttribute("viewBox", `${(x0 + x1) / 2 - w / 2} ${(y0 + y1) / 2 - h / 2} ${w} ${h}`);
      const base = sv("g", { class: "base" }, svg);
      if (level === 0) {
        for (const hl of venue.halls) sv("polygon", { points: pts(hl.poly), class: "hall" }, base);
        for (const b of venue.booths) sv("polygon", { points: pts(b.poly), class: "booth" }, base);
      } else {
        sv("polygon", { points: pts(venue.og.outline), class: "hall" }, base);
        for (const a of venue.og.areas) sv("polygon", { points: pts(a.poly), class: a.kind === "room" || a.kind === "lobby" ? "hall" : "booth" }, base);
      }
      for (const s of d.segments) if ((s.level === "og" ? 1 : 0) === level) sv("polyline", { points: pts(s.points), class: `route ${s.level}` }, svg);
      if (part && part.kind === "walk" && (part.level === "og" ? 1 : 0) === level) sv("polyline", { points: pts(part.points), class: "route current" }, svg);
      for (const o of d.obstacles) if (o.level === level) sv("circle", { cx: o.p[0], cy: o.p[1], r: o.radius, class: "obst" }, svg);
      if (marker) sv("circle", { cx: marker[0], cy: marker[1], r: kind === "deviate" ? 2.5 : 4, class: kind === "deviate" ? "you" : "marker" }, svg);
    }
    svg.addEventListener("click", (e) => {
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      marker = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
      draw();
    });

    save.disabled = !canCall;
    save.onclick = async () => {
      const text = what.value.trim();
      const chipLabel = cfg.chips?.find(([id]) => id === chip)?.[1] ?? "";
      if (kind === "report" && !text) return what.focus();
      if (kind !== "report" && !chip) return toast("Please pick what happened.");
      if (!marker) return toast(cfg.tap);
      save.disabled = true;
      const affects = wc.checked ? "wheelchair" : "everyone";
      // Done with the form: close it right away (it comes back only if saving fails).
      card.hidden = true;
      toast("Saving…");
      try {
        if (kind === "deviate") {
          const origin = state.run?.origin ?? d.query;
          await call("report_deviation", {
            from: origin.from,
            to: origin.to,
            mobility: d.mobility,
            partId: part?.id,
            partTitle: part?.title,
            reason: chip,
            note: text || undefined,
            x: marker[0],
            y: marker[1],
            level,
          });
          credit({ deviations: 1 });
          toast("Thanks! New route from where you are.");
          card.hidden = true;
          await reroute(d, { x: marker[0], y: marker[1], level });
          return;
        }
        const description = [chipLabel, text].filter(Boolean).join(": ") || text;
        // On a stairs/lift step the connector itself is what's blocked (a map area never blocks lift/stair ends).
        if (kind === "blocked" && part && part.kind !== "walk" && part.placeName) {
          const onlyWheelchair = chip === "lift" || chip === "door-access" || (chip === "thing" && wc.checked);
          await call("report_obstacle", {
            location: part.placeName,
            status: "blocked",
            affects: onlyWheelchair ? "wheelchair" : "everyone",
            note: description || "reported during navigation",
          });
        } else {
          const r = await call("mark_obstacle_area", { x: marker[0], y: marker[1], level, description, affects });
          d.obstacles = [...d.obstacles, { id: String(r.data?.placeId ?? "new"), p: marker, label: description, affects, radius: 4, level }];
          drawObstacles(d.obstacles);
        }
        credit({ reported: 1 });
        card.hidden = true;
        if (kind === "blocked" && part && start) {
          toast("Thanks! Finding another way…");
          await reroute(d, { x: start[0], y: start[1], level: partLevel === "og" ? 1 : 0 });
        } else {
          toast("Thanks! Saved, routes now go around it.");
          if (mode === "overview") replan({});
        }
      } catch (err) {
        toast((err as Error).message);
        card.hidden = false;
        save.disabled = false;
      }
    };
    draw();
    if (kind === "report") what.focus();
  }
  $("ttf-report-btn").onclick = () => last && openPanel("report", last, null);

  // ---------------------------------------------------------------- live obstacles

  // Every 20 s (and when the widget becomes visible again) fetch the current obstacles. New or cleared ones are
  // drawn right away; on the overview the route is re-planned around them, during navigation a new obstacle on
  // the remaining route triggers a hint.
  type ObstacleCard = { id: string; title: string; where: string; affects: "everyone" | "wheelchair"; p: Pt; radius: number; level: 0 | 1 };
  let obstBusy = false;
  async function refreshObstacles() {
    const d = last;
    if (!d || !canCall || obstBusy || busy || mode === "finish" || document.visibilityState === "hidden") return;
    obstBusy = true;
    try {
      const { data } = await call("list_obstacles", {});
      const cards = (data?.obstacles ?? []) as ObstacleCard[];
      if (d !== last) return; // the route changed meanwhile
      const before = new Set(d.obstacles.map((o) => o.id));
      if (cards.length === before.size && cards.every((c) => before.has(c.id))) return;
      const added = cards.filter((c) => !before.has(c.id));
      d.obstacles = cards.map((c) => ({ id: c.id, p: c.p, label: c.where ? `${c.title} – ${c.where}` : c.title, affects: c.affects, radius: c.radius, level: c.level }));
      lastJson = JSON.stringify(d);
      drawObstacles(d.obstacles);
      if (mode === "overview") {
        replan({});
      } else if (mode === "nav" && state.run) {
        const ahead = d.parts.slice(state.run.idx);
        const hit = added.find((c) =>
          ahead.some((p) => (p.level === "og" ? 1 : 0) === c.level && p.points.some(([x, y]) => Math.hypot(x - c.p[0], y - c.p[1]) <= c.radius + 1.5))
        );
        if (hit) toast(`New obstacle on your route: ${hit.title}. Tap ⚠ Blocked to find another way.`);
      }
    } catch {
      // Live updates are best effort; the next try comes in 20 s.
    } finally {
      obstBusy = false;
    }
  }
  setInterval(refreshObstacles, 20000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshObstacles());

  // ---------------------------------------------------------------- data in

  // ChatGPT re-sends the same tool output as a fresh object whenever widget state is saved; only a really new
  // route may reset the view (otherwise "Arrived" would jump from the finish screen back to the overview).
  const show = (d: RouteData | null | undefined, force = false) => {
    if (!d || !d.segments || !d.parts) return;
    const json = JSON.stringify(d);
    if (json === lastJson && !force) return;
    lastJson = json;
    last = d;
    drawRoute(d);
    renderHeader(d);
    const run = state.run && state.run.key === runKey(d) && state.run.idx < d.parts.length ? state.run : null;
    if (run) enterNav(d);
    else {
      setMode("overview");
      renderOverview(d);
    }
  };
  const current = () => {
    try {
      return window.openai?.toolOutput;
    } catch {
      return undefined;
    }
  };
  // ChatGPT re-delivers the original tool output whenever widget state is saved. Only a different output from
  // the host (a new question in the chat) may replace what the widget shows; routes re-planned inside the widget
  // (profile switch, detours) must survive those re-deliveries.
  let hostJson = "";
  const fromHost = (d: RouteData | null | undefined) => {
    if (!d || !d.segments || !d.parts) return;
    const json = JSON.stringify(d);
    if (json === hostJson) return;
    hostJson = json;
    show(d);
  };
  fromHost(current());
  window.addEventListener("openai:set_globals", (e) => {
    const g = (e as CustomEvent).detail?.globals;
    fromHost(g?.toolOutput ?? current());
  });
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m?.jsonrpc === "2.0" && m.method === "ui/notifications/tool-result" && m.params) fromHost(m.params.structuredContent ?? m.params);
  });
  let tries = 0;
  const poll = setInterval(() => {
    const d = current();
    if (d || ++tries > 40) {
      clearInterval(poll);
      fromHost(d);
    }
  }, 250);
  if (!current()) frame(false);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
