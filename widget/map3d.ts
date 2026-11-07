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
  steps: string[];
  compare: {
    fastest: { seconds: number; label: string; via: string[] } | null;
    stepFree: { seconds: number; label: string; via: string[] } | null;
    gapSeconds: number | null;
  };
  leaderboard: { holder: string; seconds: number; label: string; recordedAt: string }[];
  persistent: boolean;
  checks: { name: string; kind: "stairs" | "lift"; placeId: string; confirmedAt: string | null; approx: boolean }[];
  notes: string[];
  disclaimer: string;
  segments: { level: "eg" | "og"; points: Pt[] }[];
  fastestSegments: { level: "eg" | "og"; points: Pt[] }[] | null;
  start: Pt;
  end: Pt;
  obstacles: { p: Pt; label: string; affects: string }[];
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

interface WidgetState {
  race?: { key: string; startedAt: number } | null;
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
    for (const o of d.obstacles) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3, 20), new THREE.MeshStandardMaterial({ color: "#d1242f", emissive: "#5a0d10" }));
      cyl.position.set(o.p[0], 1.5, o.p[1]);
      routeGroup.add(cyl);
      label(`⚠ ${o.label}`, o.p, 4.5, "obstacle", null, routeGroup);
    }

    selectedBooth = d.destSpaceId;
    paint();

    routeBox = new THREE.Box3();
    const grow = (segs: RouteData["segments"] | null) =>
      segs?.forEach((s) => s.points.forEach(([x, y]) => routeBox.expandByPoint(new THREE.Vector3(x, s.level === "og" ? OG_Y : 0, y))));
    grow(d.segments);
    grow(d.fastestSegments);
    frame(false);
  }

  function frame(animated: boolean, topDown = false) {
    const c = routeBox.getCenter(new THREE.Vector3());
    const size = routeBox.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 40) * 1.25;
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
    toastTimer = setTimeout(() => (toastEl.hidden = true), 6000);
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

  const canCall = !!window.openai?.callTool;
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await window.openai!.callTool!(name, args);
    const msg = r?.content?.find((c) => c.type === "text")?.text ?? "";
    if (r?.isError) throw new Error(msg || "Something went wrong.");
    return { msg, data: r?.structuredContent };
  };

  let last: RouteData | null = null;
  let busy = false;
  const replan = async (patch: { mobility?: Mobility; avoidCrowds?: boolean }) => {
    if (!last || busy || !canCall) return;
    busy = true;
    root.classList.add("busy");
    try {
      const { data } = await call("find_accessible_route", {
        from: last.query.from,
        to: last.query.to,
        mobility: patch.mobility ?? last.mobility,
        avoidCrowds: patch.avoidCrowds ?? last.avoidCrowds,
      });
      show(data as RouteData, true);
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
  const PROFILE_LABEL: Record<Mobility, string> = { walk: "Walking", cane: "Cane / crutches", wheelchair: "Wheelchair" };
  const prof = $("ttf-profile");
  for (const m of ["walk", "cane", "wheelchair"] as Mobility[]) {
    const b = el("button", "", undefined, prof);
    b.type = "button";
    b.dataset.m = m;
    b.title = PROFILE_LABEL[m];
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON[m]);
    svg.appendChild(path);
    b.append(svg, el("span", "", PROFILE_LABEL[m]));
    b.disabled = !canCall;
    b.onclick = () => replan({ mobility: m });
  }
  const avoid = $("ttf-avoid") as HTMLInputElement;
  avoid.disabled = !canCall;
  avoid.onchange = () => replan({ avoidCrowds: avoid.checked });

  const ago = (iso: string) => {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  };
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function renderHeader(d: RouteData) {
    $("ttf-title").textContent = `${d.fromName} → ${d.toName}`;
    $("ttf-sub").textContent = `${d.mobilityLabel} · ${d.timeLabel} · ${d.distanceLabel}${d.via.length ? ` · via ${d.via.join(", ")}` : ""}`;
    prof.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === d.mobility)));
    avoid.checked = d.avoidCrowds;
  }

  function renderCompare(d: RouteData) {
    const card = $("ttf-compare");
    card.replaceChildren();
    const { fastest, stepFree, gapSeconds } = d.compare;
    el("div", "card-title", "Fastest vs step-free (same walking pace)", card);
    const max = Math.max(fastest?.seconds ?? 0, stepFree?.seconds ?? 0, 1);
    const row = (label: string, r: RouteData["compare"]["fastest"], cls: string) => {
      const line = el("div", "cmp-row", undefined, card);
      el("span", "cmp-label", label, line);
      const bar = el("span", "cmp-bar", undefined, line);
      el("i", cls, undefined, bar).style.width = `${r ? (r.seconds / max) * 100 : 0}%`;
      el("span", "cmp-time", r ? r.label : "no route", line);
      el("span", "cmp-via", r ? (r.via.length ? `via ${r.via.join(", ")}` : "no floor change") : "", line);
    };
    row("Fastest", fastest, "fast");
    row("Step-free", stepFree, "free");
    el(
      "div",
      gapSeconds ? "gap" : "gap zero",
      gapSeconds
        ? `Step-free detour: +${gapSeconds} s. Confirming lifts and reporting obstacles brings it toward zero.`
        : "No detour: step-free visitors are as fast as everyone else here.",
      card
    );
    for (const c of d.checks) {
      el(
        "div",
        c.confirmedAt ? "check ok" : "check",
        `${c.name}: ${c.confirmedAt ? `confirmed working ${ago(c.confirmedAt)}` : "not confirmed yet"}${c.approx ? " · position estimated" : ""}`,
        card
      );
    }
  }

  const raceKey = (d: RouteData) => `${d.query.from}|${d.query.to}|${d.mobility}`;
  let tick: ReturnType<typeof setInterval> | null = null;
  const stopTick = () => {
    if (tick) clearInterval(tick);
    tick = null;
  };

  function renderRace(d: RouteData) {
    stopTick();
    const card = $("ttf-race");
    card.replaceChildren();
    el("div", "card-title", `Route record · ${d.mobilityLabel}`, card);
    if (d.leaderboard.length) {
      const ol = el("ol", "lb", undefined, card);
      d.leaderboard.forEach((a, i) => {
        const li = el("li", i ? "" : "first", undefined, ol);
        el("span", "", a.holder, li);
        el("strong", "", a.label, li);
      });
    } else el("div", "muted", `No record yet. Planned time: ${d.timeLabel}. Be the first!`, card);
    const running = state.race && state.race.key === raceKey(d) ? state.race : null;
    const row = el("div", "race-row", undefined, card);
    if (!running) {
      const b = el("button", "primary", d.leaderboard.length ? `Race the record (${d.leaderboard[0].label})` : "Start the timer", row);
      b.type = "button";
      b.disabled = !canCall;
      b.onclick = () => {
        saveState({ race: { key: raceKey(d), startedAt: Date.now() } });
        renderRace(d);
      };
    } else {
      const t = el("span", "timer", clock((Date.now() - running.startedAt) / 1000), row);
      tick = setInterval(() => (t.textContent = clock((Date.now() - running.startedAt) / 1000)), 500);
      const done = el("button", "primary", "I've arrived", row);
      const cancel = el("button", "", "Cancel", row);
      done.type = cancel.type = "button";
      cancel.onclick = () => {
        saveState({ race: null });
        renderRace(d);
      };
      done.onclick = () => {
        stopTick();
        finishRace(d, Math.max(1, Math.round((Date.now() - running.startedAt) / 1000)));
      };
    }
    if (!d.persistent) el("div", "muted small", "Times are kept in memory until the database is connected.", card);
  }

  function finishRace(d: RouteData, seconds: number) {
    const card = $("ttf-race");
    card.replaceChildren();
    el("div", "card-title", `You made it in ${clock(seconds)}`, card);
    const form = el("form", "race-row", undefined, card);
    const input = el("input", "", undefined, form);
    input.placeholder = "Your name";
    input.value = state.name ?? "";
    input.maxLength = 40;
    input.required = true;
    input.setAttribute("aria-label", "Your name");
    const send = el("button", "primary", "Save my time", form);
    send.type = "submit";
    const skip = el("button", "", "Skip", form);
    skip.type = "button";
    skip.onclick = () => {
      saveState({ race: null });
      renderRace(d);
      renderFeedback(d, true);
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      send.disabled = true;
      saveState({ name, race: null });
      try {
        toast((await call("log_attempt", { from: d.query.from, to: d.query.to, mobility: d.mobility, seconds, holder: name })).msg);
      } catch (err) {
        toast((err as Error).message);
      }
      await replan({});
      renderFeedback(last ?? d, true);
    };
    input.focus();
  }

  function renderFeedback(d: RouteData, open: boolean) {
    const card = $("ttf-feedback");
    card.replaceChildren();
    card.hidden = !open;
    if (!open) return;
    el("div", "card-title", "Help keep this route up to date", card);
    const answer = async (buttons: HTMLButtonElement[], run: () => Promise<{ msg: string }>, refresh: boolean) => {
      buttons.forEach((b) => (b.disabled = true));
      try {
        toast((await run()).msg);
        if (refresh) await replan({});
      } catch (e) {
        toast((e as Error).message);
        buttons.forEach((b) => (b.disabled = false));
      }
    };
    for (const c of d.checks) {
      const row = el("div", "fb-row", undefined, card);
      el("span", "", `Was ${c.name} ${c.kind === "lift" ? "working" : "passable"}?`, row);
      const y = el("button", "", "Yes", row),
        n = el("button", "", "No", row);
      y.type = n.type = "button";
      y.disabled = n.disabled = !canCall;
      y.onclick = () => answer([y, n], () => call("report_obstacle", { location: c.name, status: "clear" }), true);
      n.onclick = () =>
        answer(
          [y, n],
          () => call("report_obstacle", { location: c.name, status: "blocked", affects: c.kind === "lift" ? "wheelchair" : "everyone", note: "reported in the route widget" }),
          true
        );
    }
    const row = el("div", "fb-row", undefined, card);
    el("span", "", "Anything blocking your way?", row);
    const no = el("button", "", "No", row),
      yes = el("button", "", "Yes", row);
    no.type = yes.type = "button";
    no.disabled = yes.disabled = !canCall;
    no.onclick = () => {
      no.disabled = yes.disabled = true;
      toast("Thanks for checking!");
    };
    yes.onclick = () => {
      no.disabled = yes.disabled = true;
      const form = el("form", "race-row", undefined, card);
      const where = el("input", "", undefined, form);
      where.placeholder = "Where? e.g. Eingang Foyer 1, Halle 2";
      where.required = true;
      where.setAttribute("aria-label", "Where is the obstacle?");
      const lab = el("label", "small", undefined, form);
      const cb = el("input", "", undefined, lab);
      cb.type = "checkbox";
      lab.append(" only blocks wheelchairs");
      const send = el("button", "primary", "Report", form);
      send.type = "submit";
      form.onsubmit = (e) => {
        e.preventDefault();
        answer(
          [send],
          () => call("report_obstacle", { location: where.value.trim(), status: "blocked", affects: cb.checked ? "wheelchair" : "everyone", note: "reported in the route widget" }),
          true
        );
      };
      where.focus();
    };
  }
  $("ttf-report").onclick = () => last && renderFeedback(last, $("ttf-feedback").hidden);

  function renderStand(d: RouteData) {
    const card = $("ttf-stand");
    card.replaceChildren();
    card.hidden = !d.stand;
    if (!d.stand) return;
    const s = d.stand;
    el("div", "card-title", s.exhibitor ?? "Stand", card);
    el("div", "muted", [s.code && `Stand ${s.code}`, s.hall, ...s.categories.slice(0, 3)].filter(Boolean).join(" · "), card);
    if (s.whyVisit) {
      const det = el("details", "", undefined, card);
      el("summary", "", "Why visit", det);
      el("p", "", s.whyVisit, det);
    }
    if (s.alsoHere.length) el("div", "muted small", `Also here: ${s.alsoHere.join(", ")}`, card);
    if (s.website) {
      const a = el("a", "link", s.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), card);
      a.href = s.website;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    if (d.otherStands.length) el("div", "muted small", `Similar stands: ${d.otherStands.join("; ")}`, card);
  }

  function renderDetails(d: RouteData) {
    $("ttf-dir-sum").textContent = `Directions · ${d.steps.length} step${d.steps.length === 1 ? "" : "s"}`;
    $("ttf-steps").replaceChildren(...d.steps.map((s) => el("li", "", s)));
    $("ttf-foot").replaceChildren(...[...d.notes, d.disclaimer].map((s) => el("p", "", s)));
    $("ttf-legend-fast").hidden = !d.fastestSegments;
  }

  const show = (d: RouteData | null | undefined, force = false) => {
    if (!d || !d.segments || (d === last && !force)) return;
    last = d;
    drawRoute(d);
    renderHeader(d);
    renderCompare(d);
    renderRace(d);
    renderStand(d);
    renderDetails(d);
    if (!$("ttf-feedback").hidden) renderFeedback(d, true);
  };
  const current = () => {
    try {
      return window.openai?.toolOutput;
    } catch {
      return undefined;
    }
  };
  show(current());
  window.addEventListener("openai:set_globals", (e) => {
    const g = (e as CustomEvent).detail?.globals;
    show(g?.toolOutput ?? current());
  });
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m?.jsonrpc === "2.0" && m.method === "ui/notifications/tool-result" && m.params) show(m.params.structuredContent ?? m.params);
  });
  let tries = 0;
  const poll = setInterval(() => {
    const d = current();
    if (d || ++tries > 40) {
      clearInterval(poll);
      show(d);
    }
  }, 250);
  if (!current()) frame(false);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
