/**
 * XSectionFx — holographic + instrument visuals of the 3x cross-section (plain module).
 *
 * Owns builders for: the cyan frame (corner brackets + edges), the scan ring, the projection
 * platform, glow strokes / dashed arcs / target rings / leader lines, the projection link down to
 * the wound, the sparkle + comet used for result feedback, the chrome 3/8-circle needle (and its
 * hologram twin), and XSThread — a bounded, preallocated glowing thread tube that follows a path.
 *
 * Everything returned is plain SceneObjects + materials; colour/fade goes through Tint objects
 * (SteadyHandsVisuals) so callers keep the Tint semantics tests rely on.
 * Must not: hold flow state, score anything, or create colliders.
 */
import {Tint} from "../SteadyHandsVisuals"
import {
  C4,
  MeshAcc,
  V3,
  add,
  chrome,
  circlePts,
  cross,
  dot,
  emitGlowDisc,
  emitGlowLine,
  emitRibbon,
  alphaMaterial,
  emitTube,
  fresnel,
  glowMaterial,
  meshObject,
  norm,
  scl,
  segPts,
  sub,
} from "./XSectionGeom"

export const CYAN: C4 = [0.5, 0.91, 1.0, 1]
export const CYAN_HI: C4 = [0.75, 0.96, 1.0, 1]
/** Solid cyan for strokes drawn over bright tissue (normal blend). */
export const STROKE = new vec4(0.22, 0.8, 1.0, 1)
const WHITE: C4 = [1, 1, 1, 1]

/** A glow mesh with its own Tint (additive). */
export interface GlowPiece {
  so: SceneObject
  tint: Tint
}

export function glowPiece(parent: SceneObject, name: string, acc: MeshAcc, base: Material, color: vec4, pos: vec3 = vec3.zero(), blend: "add" | "alpha" = "add"): GlowPiece {
  const mat = blend === "add" ? glowMaterial(base) : alphaMaterial(base)
  const tint = new Tint(mat, color, blend)
  const m = meshObject(parent, name, acc, mat, pos)
  return {so: m.so, tint: tint}
}

/** Camera-facing (for a fixed view direction) soft beam along a 3D polyline. */
export function emitBeam(acc: MeshAcc, pts: V3[], view: V3, halfWidth: number, color: C4, along: (t: number) => number = () => 1, profile: number[] = [0, 0.3, 1, 0.3, 0]): void {
  const sides: V3[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const t = norm(sub(b, a), [1, 0, 0])
    let s = cross(view, t)
    if (Math.sqrt(dot(s, s)) < 0.05) s = cross([0, 1, 0], t)
    sides.push(norm(s, [0, 1, 0]))
  }
  emitRibbon(acc, pts, sides, halfWidth, profile, color, along, view)
}

// ── frame / scan / platform ─────────────────────────────────────────────────

export interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
  z0: number
  z1: number
}

/** Corner brackets (bright) + faint full edges around the block. */
export function buildFrame(parent: SceneObject, base: Material, box: Box, view: V3): GlowPiece {
  const acc = new MeshAcc()
  const xs = [box.x0, box.x1]
  const ys = [box.y0, box.y1]
  const zs = [box.z0, box.z1]
  const edge = (a: V3, b: V3, k: number) => emitBeam(acc, segPts(a, b, 12), view, 0.05, [CYAN[0] * k, CYAN[1] * k, CYAN[2] * k, 1], (t) => 0.55 + 0.45 * Math.pow(Math.abs(2 * t - 1), 3))
  // 12 faint edges.
  for (const y of ys) for (const z of zs) edge([box.x0, y, z], [box.x1, y, z], 0.42)
  for (const x of xs) for (const z of zs) edge([x, box.y0, z], [x, box.y1, z], 0.42)
  for (const x of xs) for (const y of ys) edge([x, y, box.z0], [x, y, box.z1], 0.42)
  // Brackets: short bright legs from every corner.
  const L = 0.9
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        const c: V3 = [x, y, z]
        const dx = x === box.x0 ? 1 : -1
        const dy = y === box.y0 ? 1 : -1
        const dz = z === box.z0 ? 1 : -1
        for (const d of [
          [dx, 0, 0],
          [0, dy, 0],
          [0, 0, dz],
        ] as V3[]) {
          emitBeam(acc, segPts(c, add(c, scl(d, L)), 6), view, 0.1, CYAN_HI, (t) => 1 - 0.7 * t)
        }
        emitGlowDisc(acc, c, norm(cross(view, [0, 1, 0])), norm(cross(view, cross(view, [0, 1, 0]))), 0.16, CYAN_HI, 12)
      }
    }
  }
  return glowPiece(parent, "HoloFrame", acc, base, new vec4(1, 1, 1, 1))
}

/** A horizontal glowing ring around the block footprint (moved in Y to sweep). */
export function buildScanRing(parent: SceneObject, base: Material, box: Box, view: V3): GlowPiece {
  const acc = new MeshAcc()
  const m = 0.12
  const c: V3[] = [
    [box.x0 - m, 0, box.z1 + m],
    [box.x1 + m, 0, box.z1 + m],
    [box.x1 + m, 0, box.z0 - m],
    [box.x0 - m, 0, box.z0 - m],
  ]
  for (let i = 0; i < 4; i++) emitBeam(acc, segPts(c[i], c[(i + 1) % 4], 16), view, 0.09, WHITE)
  // Faint sheet: bright at the rim, fading inward.
  const inset = 1.2
  const inner: V3[] = [
    [box.x0 - m + inset, 0, box.z1 + m - inset],
    [box.x1 + m - inset, 0, box.z1 + m - inset],
    [box.x1 + m - inset, 0, box.z0 - m + inset],
    [box.x0 - m + inset, 0, box.z0 - m + inset],
  ]
  for (let i = 0; i < 4; i++) {
    const a = acc.vert(c[i], [0, 1, 0], [0, 0], [0.22, 0.22, 0.22, 0.22])
    const b = acc.vert(c[(i + 1) % 4], [0, 1, 0], [0, 0], [0.22, 0.22, 0.22, 0.22])
    const ci = acc.vert(inner[(i + 1) % 4], [0, 1, 0], [0, 0], [0, 0, 0, 0])
    const d = acc.vert(inner[i], [0, 1, 0], [0, 0], [0, 0, 0, 0])
    acc.tri(a, b, ci)
    acc.tri(a, ci, d)
  }
  return glowPiece(parent, "ScanRing", acc, base, new vec4(CYAN_HI[0], CYAN_HI[1], CYAN_HI[2], 1))
}

/** Holographic projection platform under the block: soft plate + grid + rim. */
export function buildPlatform(parent: SceneObject, base: Material, box: Box, y: number): GlowPiece {
  const acc = new MeshAcc()
  const m = 0.7
  const x0 = box.x0 - m
  const x1 = box.x1 + m
  const z0 = box.z0 - m
  const z1 = box.z1 + m
  const up: V3 = [0, 1, 0]
  const fadeEdge = (x: number, z: number) => {
    const dx = Math.min(x - x0, x1 - x) / m
    const dz = Math.min(z - z0, z1 - z) / m
    return Math.max(0, Math.min(1, Math.min(dx, dz)))
  }
  // Grid lines every 1 cm.
  for (let x = Math.ceil(x0); x <= x1; x += 1) {
    const pts = segPts([x, y, z0], [x, y, z1], 20)
    emitRibbon(acc, pts, pts.map(() => [1, 0, 0] as V3), 0.025, [0, 1, 0], [0.5, 0.91, 1.0, 1], (t) => 0.22 * fadeEdge(x, z0 + (z1 - z0) * t), up)
  }
  for (let z = Math.ceil(z0); z <= z1; z += 1) {
    const pts = segPts([x0, y, z], [x1, y, z], 40)
    emitRibbon(acc, pts, pts.map(() => [0, 0, 1] as V3), 0.025, [0, 1, 0], [0.5, 0.91, 1.0, 1], (t) => 0.22 * fadeEdge(x0 + (x1 - x0) * t, z), up)
  }
  // Rim (bright) around the plate.
  const rim: V3[] = [
    [x0, y, z1],
    [x1, y, z1],
    [x1, y, z0],
    [x0, y, z0],
    [x0, y, z1],
  ]
  for (let i = 0; i < 4; i++) {
    const pts = segPts(rim[i], rim[i + 1], 30)
    const t = norm(sub(rim[i + 1], rim[i]))
    emitRibbon(acc, pts, pts.map(() => cross(up, t)), 0.07, [0, 0.4, 1, 0.4, 0], [0.5, 0.91, 1.0, 1], () => 0.7, up)
  }
  return glowPiece(parent, "Platform", acc, base, new vec4(1, 1, 1, 1))
}

// ── guide elements ──────────────────────────────────────────────────────────

/** Dashes along the ideal arc (one SceneObject per dash so they can reveal in order). */
export function buildDashedArc(parent: SceneObject, base: Material, cx: number, cy: number, r: number, z: number, dashes: number): {root: SceneObject; dashes: SceneObject[]; tint: Tint} {
  const root = global.scene.createSceneObject("IdealArc")
  root.setParent(parent)
  const mat = alphaMaterial(base)
  const tint = new Tint(mat, STROKE, "alpha")
  const out: SceneObject[] = []
  for (let i = 0; i < dashes; i++) {
    const a0 = Math.PI + (Math.PI * (i + 0.2)) / dashes
    const a1 = Math.PI + (Math.PI * (i + 0.8)) / dashes
    const pts = circlePts([cx, cy, z], [1, 0, 0], [0, 1, 0], r, a0, a1, 6)
    const acc = new MeshAcc()
    const ends = (t: number) => Math.min(1, Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * 2.2)
    emitGlowLine(acc, pts, [0, 0, 1], 0.075, WHITE, ends, [0, 1, 1, 1, 0], true)
    emitGlowLine(acc, pts, [0, 0, 1], 0.15, [1, 1, 1, 0.35], ends, [0, 0.6, 1, 0.6, 0], true)
    const m = meshObject(root, "Dash", acc, mat)
    out.push(m.so)
  }
  return {root: root, dashes: out, tint: tint}
}

/** Target ring lying on the skin (XZ plane) + a light pillar rising to the label. */
export function buildTarget(parent: SceneObject, base: Material, x: number, y: number, view: V3, pillarH: number): GlowPiece {
  const acc = new MeshAcc()
  const up: V3 = [0, 1, 0]
  const c: V3 = [x, y + 0.04, 0]
  const ring = circlePts(c, [1, 0, 0], [0, 0, 1], 0.42, 0, Math.PI * 2, 40)
  emitRibbon(acc, ring, ring.map((p) => norm(sub(p, c))), 0.055, [0, 1, 1, 1, 0], WHITE, () => 1, up, true)
  const ring2 = circlePts(c, [1, 0, 0], [0, 0, 1], 0.68, 0, Math.PI * 2, 48)
  emitRibbon(acc, ring2, ring2.map((p) => norm(sub(p, c))), 0.03, [0, 1, 0], WHITE, (t) => (Math.sin(t * Math.PI * 24) > 0 ? 0.8 : 0), up, true)
  emitBeam(acc, segPts([x, y + 0.05, 0.05], [x, y + pillarH, 0.05], 10), view, 0.04, WHITE, (t) => 0.9 - 0.7 * t, [0, 1, 1, 1, 0])
  emitGlowDisc(acc, [x, y, 0.08], [1, 0, 0], [0, 1, 0], 0.12, WHITE, 16, 0.6)
  return glowPiece(parent, "Target", acc, base, STROKE, vec3.zero(), "alpha")
}

/** 90° entry guide: surface tangent, dashed perpendicular, right-angle marker. */
export function buildAngleGuide(parent: SceneObject, base: Material, x: number, y: number, z: number): GlowPiece {
  const acc = new MeshAcc()
  const pn: V3 = [0, 0, 1]
  emitGlowLine(acc, segPts([x - 1.3, y, z], [x + 0.25, y, z], 10), pn, 0.035, WHITE, (t) => 0.25 + 0.75 * t, [0, 1, 1, 1, 0], true)
  for (let i = 0; i < 5; i++) {
    const y0 = y + 0.55 - i * 0.36
    emitGlowLine(acc, segPts([x, y0, z], [x, y0 - 0.2, z], 3), pn, 0.035, WHITE, () => 0.9, [0, 1, 1, 1, 0], true)
  }
  const s = 0.34
  emitGlowLine(acc, [[x - s, y, z], [x - s, y - s, z], [x, y - s, z]], pn, 0.035, WHITE, () => 1, [0, 1, 1, 1, 0], true)
  return glowPiece(parent, "EntryAngleGuide", acc, base, STROKE, vec3.zero(), "alpha")
}

/** Leader line + anchor dot from a layer to its label (flat, in the section plane). */
export function buildLeader(parent: SceneObject, base: Material, anchor: V3, elbow: V3, end: V3, color: vec4): GlowPiece {
  const acc = new MeshAcc()
  const pn: V3 = [0, 0, 1]
  const pts = segPts(anchor, elbow, 8).concat(segPts(elbow, end, 8).slice(1))
  emitGlowLine(acc, pts, pn, 0.045, WHITE, (t) => 0.55 + 0.45 * t)
  emitGlowDisc(acc, anchor, [1, 0, 0], [0, 1, 0], 0.17, WHITE, 14)
  emitGlowDisc(acc, anchor, [1, 0, 0], [0, 1, 0], 0.07, WHITE, 10, 0.4)
  return glowPiece(parent, "Leader", acc, base, color)
}

/** Rounded-rectangle outline (badge pill). */
export function buildPill(parent: SceneObject, base: Material, c: V3, w: number, h: number): GlowPiece {
  const acc = new MeshAcc()
  const r = h / 2
  const pts: V3[] = []
  const hw = w / 2 - r
  pts.push(...circlePts([c[0] + hw, c[1], c[2]], [1, 0, 0], [0, 1, 0], r, -Math.PI / 2, Math.PI / 2, 12))
  pts.push(...circlePts([c[0] - hw, c[1], c[2]], [1, 0, 0], [0, 1, 0], r, Math.PI / 2, (3 * Math.PI) / 2, 12))
  pts.push(pts[0])
  emitGlowLine(acc, pts, [0, 0, 1], 0.06, WHITE, () => 1, [0, 0.45, 1, 0.45, 0])
  return glowPiece(parent, "BadgePill", acc, base, new vec4(CYAN[0], CYAN[1], CYAN[2], 1))
}

// ── projection link to the wound ────────────────────────────────────────────

export interface LinkSpec {
  wound: V3
  padX: V3
  padUp: V3
  padZ: V3
  /** Block bottom-front corners the beams rise to. */
  cornerL: V3
  cornerR: V3
  sliceLen: number
  view: V3
}

export function buildWoundLink(parent: SceneObject, base: Material, s: LinkSpec): {link: GlowPiece; reticle: GlowPiece} {
  const r = 0.6
  const lift = scl(s.padUp, 0.06)
  const w = add(s.wound, lift)
  // Reticle on the skin: ring + slice line across the cut with end ticks.
  const ra = new MeshAcc()
  const ring = circlePts(w, s.padX, s.padZ, r, 0, Math.PI * 2, 48)
  emitRibbon(ra, ring, ring.map((p) => norm(sub(p, w))), 0.05, [0, 0.45, 1, 0.45, 0], WHITE, () => 0.9, s.padUp)
  const half = s.sliceLen / 2
  const zA = add(w, scl(s.padZ, -half))
  const zB = add(w, scl(s.padZ, half))
  emitRibbon(ra, segPts(zA, zB, 16), segPts(zA, zB, 16).map(() => s.padX), 0.03, [0, 0.45, 1, 0.45, 0], WHITE, (t) => 0.12 + 0.3 * Math.pow(Math.abs(2 * t - 1), 4), s.padUp)
  for (const e of [zA, zB]) {
    const a = add(e, scl(s.padX, -0.3))
    const b = add(e, scl(s.padX, 0.3))
    emitRibbon(ra, segPts(a, b, 4), segPts(a, b, 4).map(() => s.padZ), 0.04, [0, 0.5, 1, 0.5, 0], WHITE, () => 0.9, s.padUp)
  }
  const reticle = glowPiece(parent, "WoundReticle", ra, base, new vec4(CYAN[0], CYAN[1], CYAN[2], 1))

  // Beams from the reticle up to the block + a faint sheet between them.
  const la = new MeshAcc()
  const fromL = add(w, scl(s.padX, -r))
  const fromR = add(w, scl(s.padX, r))
  const prof = (t: number) => 0.18 + 0.75 * Math.pow(1 - t, 3) + 0.35 * Math.pow(t, 4)
  emitBeam(la, segPts(fromL, s.cornerL, 30), s.view, 0.05, WHITE, prof)
  emitBeam(la, segPts(fromR, s.cornerR, 30), s.view, 0.05, WHITE, prof)
  const n = 20
  const base0 = la.count
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const a = add(fromL, scl(sub(s.cornerL, fromL), t))
    const b = add(fromR, scl(sub(s.cornerR, fromR), t))
    const k = 0.06 * (0.3 + 0.7 * Math.pow(1 - t, 2)) + 0.03 * t
    la.vert(a, s.view, [0, t], [k, k, k, k])
    la.vert(b, s.view, [1, t], [k, k, k, k])
  }
  for (let i = 0; i < n; i++) {
    const a = base0 + i * 2
    la.tri(a, a + 2, a + 1)
    la.tri(a + 1, a + 2, a + 3)
  }
  const link = glowPiece(parent, "WoundLink", la, base, new vec4(CYAN[0], CYAN[1], CYAN[2], 1))
  return {link: link, reticle: reticle}
}

/** Small camera-facing glow dot (pulses on the link, comet on pass). */
export function buildDot(parent: SceneObject, base: Material, name: string, r: number, view: V3, color: vec4): GlowPiece {
  const acc = new MeshAcc()
  const u = norm(cross(view, [0, 1, 0]), [1, 0, 0])
  const v = norm(cross(u, view), [0, 1, 0])
  emitGlowDisc(acc, [0, 0, 0], u, v, r, WHITE, 18, 1.8)
  emitGlowDisc(acc, [0, 0, 0], u, v, r * 0.35, WHITE, 12, 0.5)
  return glowPiece(parent, name, acc, base, color)
}

/** Burst of rays + ring (pass sparkle), in the section plane. */
export function buildSparkle(parent: SceneObject, base: Material, color: vec4): GlowPiece {
  const acc = new MeshAcc()
  const pn: V3 = [0, 0, 1]
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2
    const l = i % 2 === 0 ? 1.15 : 0.75
    const d: V3 = [Math.cos(a), Math.sin(a), 0]
    emitGlowLine(acc, segPts(scl(d, 0.25), scl(d, l), 6), pn, 0.07, WHITE, (t) => 1 - t)
  }
  const ring = circlePts([0, 0, 0], [1, 0, 0], [0, 1, 0], 0.55, 0, Math.PI * 2, 40)
  emitGlowLine(acc, ring, pn, 0.06, WHITE, () => 0.8)
  emitGlowDisc(acc, [0, 0, 0], [1, 0, 0], [0, 1, 0], 0.45, WHITE, 18)
  return glowPiece(parent, "Sparkle", acc, base, color)
}

/** Dashed ring marking the needle's grab zone. */
export function buildGrabRing(parent: SceneObject, base: Material, radius: number, color: vec4): GlowPiece {
  const acc = new MeshAcc()
  const pn: V3 = [0, 0, 1]
  const n = 18
  for (let i = 0; i < n; i++) {
    const a0 = ((i + 0.2) / n) * Math.PI * 2
    const a1 = ((i + 0.8) / n) * Math.PI * 2
    emitGlowLine(acc, circlePts([0, 0, 0], [1, 0, 0], [0, 1, 0], radius, a0, a1, 4), pn, 0.06, WHITE, () => 1, [0, 0.4, 1, 0.4, 0])
  }
  const outer = circlePts([0, 0, 0], [1, 0, 0], [0, 1, 0], radius * 1.12, 0, Math.PI * 2, 48)
  emitGlowLine(acc, outer, pn, 0.12, WHITE, () => 0.18, [0, 1, 0])
  return glowPiece(parent, "GrabZone", acc, base, color)
}

// ── scoring visuals: tolerance band, protractor, result badges ───────────────

/**
 * Translucent band of half-width `tol` around the ideal arc (the pass zone), bright at its
 * edges, with a faint core line and round caps above the skin at entry / exit (the scoring
 * measures distance to the entry / exit points there).
 */
export function buildToleranceBand(parent: SceneObject, base: Material, cx: number, cy: number, R: number, tol: number, z: number): GlowPiece {
  const acc = new MeshAcc()
  const pn: V3 = [0, 0, 1]
  const c: V3 = [cx, cy, z]
  const arc = circlePts(c, [1, 0, 0], [0, 1, 0], R, Math.PI, 2 * Math.PI, 64)
  const radial = arc.map((p) => norm(sub(p, c)))
  // Fill (edges bright, soft interior).
  emitRibbon(acc, arc, radial, tol, [0.75, 0.32, 0.16, 0.12, 0.12, 0.12, 0.16, 0.32, 0.75], [1, 1, 1, 0.42], () => 1, pn, true)
  // Crisp boundary lines + soft core.
  for (const rr of [R - tol, R + tol]) {
    const pts = circlePts(c, [1, 0, 0], [0, 1, 0], rr, Math.PI, 2 * Math.PI, 64)
    emitGlowLine(acc, pts, pn, 0.022, [1, 1, 1, 0.9], () => 1, [0, 1, 1, 1, 0], true)
  }
  emitGlowLine(acc, arc, pn, 0.03, [1, 1, 1, 0.45], () => 1, [0, 1, 1, 1, 0], true)
  // Round caps above the surface at entry and exit.
  for (const ex of [cx - R, cx + R]) {
    const cc: V3 = [ex, cy, z]
    const cap = circlePts(cc, [1, 0, 0], [0, 1, 0], tol, 0, Math.PI, 24)
    emitGlowLine(acc, cap, pn, 0.022, [1, 1, 1, 0.9], () => 1, [0, 1, 1, 1, 0], true)
    const center = acc.vert(cc, pn, [0.5, 0.5], [1, 1, 1, 0.12])
    const ring = acc.count
    for (const p of cap) acc.vert(p, pn, [0, 0], [1, 1, 1, 0.3])
    for (let i = 0; i < cap.length - 1; i++) acc.tri(center, ring + i, ring + i + 1)
  }
  return glowPiece(parent, "ToleranceBand", acc, base, new vec4(0.3, 0.86, 1.0, 1), vec3.zero(), "alpha")
}

/**
 * Entry-angle protractor at the entry point: a half-circle scale below the skin with ticks every
 * 15°, and the pass wedge (90° ± tolDeg) in green. `needle` is a separate pointer (along +X from
 * its origin) the caller rotates to the measured angle.
 */
export function buildProtractor(parent: SceneObject, base: Material, at: V3, r: number, tolDeg: number): {root: SceneObject; frame: GlowPiece; needle: GlowPiece} {
  const root = global.scene.createSceneObject("EntryProtractor")
  root.setParent(parent)
  root.getTransform().setLocalPosition(new vec3(at[0], at[1], at[2]))
  const acc = new MeshAcc()
  const pn: V3 = [0, 0, 1]
  const o: V3 = [0, 0, 0]
  const cyan: C4 = [0.55, 0.92, 1.0, 0.75]
  const green: C4 = [0.36, 1.0, 0.54, 1]
  emitGlowLine(acc, circlePts(o, [1, 0, 0], [0, 1, 0], r, Math.PI, 2 * Math.PI, 48), pn, 0.022, cyan, () => 1, [0, 1, 1, 1, 0], true)
  for (let deg = 0; deg <= 180; deg += 15) {
    const a = Math.PI + (deg * Math.PI) / 180
    const d: V3 = [Math.cos(a), Math.sin(a), 0]
    const l = deg % 45 === 0 ? 0.16 : 0.09
    emitGlowLine(acc, segPts(scl(d, r - l), scl(d, r), 2), pn, 0.018, cyan, () => 1, [0, 1, 1, 1, 0], true)
  }
  // Pass wedge.
  const a0 = -Math.PI / 2 - (tolDeg * Math.PI) / 180
  const a1 = -Math.PI / 2 + (tolDeg * Math.PI) / 180
  const wedge = circlePts(o, [1, 0, 0], [0, 1, 0], r * 0.96, a0, a1, 12)
  const c0 = acc.vert(o, pn, [0.5, 0.5], [green[0], green[1], green[2], 0.1])
  const w0 = acc.count
  for (const p of wedge) acc.vert(p, pn, [0, 0], [green[0], green[1], green[2], 0.34])
  for (let i = 0; i < wedge.length - 1; i++) acc.tri(c0, w0 + i, w0 + i + 1)
  emitGlowLine(acc, wedge, pn, 0.03, green, () => 1, [0, 1, 1, 1, 0], true)
  for (const a of [a0, a1]) {
    const d: V3 = [Math.cos(a), Math.sin(a), 0]
    emitGlowLine(acc, segPts(scl(d, 0.08), scl(d, r * 0.96), 4), pn, 0.018, green, () => 0.9, [0, 1, 1, 1, 0], true)
  }
  const frame = glowPiece(root, "ProtractorScale", acc, base, new vec4(1, 1, 1, 1), vec3.zero(), "alpha")
  const na = new MeshAcc()
  emitGlowLine(na, segPts([0, 0, 0.01], [r * 1.18, 0, 0.01], 6), pn, 0.04, [1, 1, 1, 1], (t) => 0.75 + 0.25 * t, [0, 1, 1, 1, 0], true)
  emitGlowDisc(na, [r * 1.18, 0, 0.01], [1, 0, 0], [0, 1, 0], 0.075, [1, 1, 1, 1], 12, 0.2)
  emitGlowDisc(na, [0, 0, 0.01], [1, 0, 0], [0, 1, 0], 0.06, [1, 1, 1, 1], 12, 0.2)
  const needle = glowPiece(root, "ProtractorNeedle", na, base, new vec4(1, 1, 1, 1), vec3.zero(), "alpha")
  return {root: root, frame: frame, needle: needle}
}

/** Shape-coded result badge: ✓ in a ring (pass) or ✗ in a ring (fail), centred on its origin. */
export function buildResultBadge(parent: SceneObject, base: Material, pass: boolean, radius: number, color: vec4): GlowPiece {
  const acc = new MeshAcc()
  const pn: V3 = [0, 0, 1]
  const o: V3 = [0, 0, 0]
  const W: C4 = [1, 1, 1, 1]
  // Soft backing disc keeps the glyph legible over bright skin.
  const center = acc.vert(o, pn, [0.5, 0.5], [1, 1, 1, 0.22])
  const disc = circlePts(o, [1, 0, 0], [0, 1, 0], radius, 0, Math.PI * 2, 40)
  const d0 = acc.count
  for (const p of disc) acc.vert(p, pn, [0, 0], [1, 1, 1, 0.14])
  for (let i = 0; i < disc.length - 1; i++) acc.tri(center, d0 + i, d0 + i + 1)
  emitGlowLine(acc, disc, pn, radius * 0.11, W, () => 1, [0, 1, 1, 1, 0], true)
  const s = radius * 0.5
  if (pass) {
    emitGlowLine(acc, [[-0.95 * s, 0.02 * s, 0.01], [-0.3 * s, -0.62 * s, 0.01], [0.95 * s, 0.7 * s, 0.01]], pn, radius * 0.13, W, () => 1, [0, 1, 1, 1, 0], true)
  } else {
    emitGlowLine(acc, segPts([-0.72 * s, -0.72 * s, 0.01], [0.72 * s, 0.72 * s, 0.01], 2), pn, radius * 0.13, W, () => 1, [0, 1, 1, 1, 0], true)
    emitGlowLine(acc, segPts([-0.72 * s, 0.72 * s, 0.01], [0.72 * s, -0.72 * s, 0.01], 2), pn, radius * 0.13, W, () => 1, [0, 1, 1, 1, 0], true)
  }
  return glowPiece(parent, pass ? "ResultBadgePass" : "ResultBadgeFail", acc, base, color, vec3.zero(), "alpha")
}

// ── needle ──────────────────────────────────────────────────────────────────

/** Needle centreline in the tip frame: tip at the origin, travelling along -Y, centre at (+R, 0). */
export function needleCurve(R: number, s: number): V3 {
  return [R - R * Math.cos(s), R * Math.sin(s), 0]
}

export const NEEDLE_SPAN = (3 * Math.PI) / 4

/**
 * Builds a 3/8-circle needle (tip frame) under `parent`: body mesh (chrome or hologram), an
 * in-plane halo, a tip glint, and a short swaged thread stub. Returns the pieces.
 */
export function buildNeedle(
  parent: SceneObject,
  opts: {
    R: number
    wire: number
    bodyMat: Material
    hologram: boolean
    view: V3
    haloMat: Material
    threadMat: Material
  },
): {body: SceneObject; halo: SceneObject; thread: SceneObject} {
  const R = opts.R
  const wire = opts.wire
  const acc = new MeshAcc()
  const pts: V3[] = []
  const radii: number[] = []
  const N = 48
  const sTip = 0.32
  const sSwage = NEEDLE_SPAN - 0.13
  for (let i = 0; i <= N; i++) {
    const s = (NEEDLE_SPAN * i) / N
    pts.push(needleCurve(R, s))
    let r = wire
    if (s < sTip) r = wire * Math.max(0.04, Math.pow(s / sTip, 0.75))
    if (s > sSwage) r = wire * 1.18
    radii.push(r)
  }
  const tint: V3 = [0.92, 0.96, 1.0]
  emitTube(acc, pts, radii, 12, (_p, n) => {
    if (opts.hologram) {
      const k = fresnel(n, opts.view, 0.3, 1.3)
      return [1, 1, 1, k]
    }
    return chrome(n, tint)
  })
  const body = meshObject(parent, opts.hologram ? "GhostNeedleBody" : "NeedleBody", acc, opts.bodyMat).so

  // Halo: soft in-plane glow following the body + glint at the tip.
  const ha = new MeshAcc()
  emitGlowLine(ha, pts, [0, 0, 1], wire * 3.2, WHITE, (t) => 0.55 + 0.45 * Math.pow(1 - t, 2), [0, 0.22, 0.6, 0.22, 0])
  const g = wire * 4
  emitGlowLine(ha, segPts([-g, 0, 0.02], [g, 0, 0.02], 4), [0, 0, 1], wire * 0.9, WHITE, (t) => Math.sin(Math.PI * t))
  emitGlowLine(ha, segPts([0, -g * 1.4, 0.02], [0, g, 0.02], 4), [0, 0, 1], wire * 0.9, WHITE, (t) => Math.sin(Math.PI * t))
  emitGlowDisc(ha, [0, 0, 0.03], [1, 0, 0], [0, 1, 0], wire * 2.6, WHITE, 14)
  const halo = meshObject(parent, "NeedleGlow", ha, opts.haloMat).so

  // Thread stub leaving the swage: follows the circle briefly, then trails off toward the viewer.
  const ta = new MeshAcc()
  const tp: V3[] = []
  for (let i = 0; i <= 18; i++) {
    const t = i / 18
    const s = NEEDLE_SPAN + 0.42 * t
    const p = needleCurve(R, s)
    tp.push([p[0] + 0.25 * t * t * R * 0.3, p[1] - 0.35 * t * t, 0.12 * t * t])
  }
  emitTube(ta, tp, tp.map((_, i) => wire * 0.5 * (1 - 0.35 * (i / 18))), 6, (_p, n) => {
    const k = 0.55 + 0.45 * Math.max(0, n[2])
    return [k, k, k, 1]
  })
  const thread = meshObject(parent, "ThreadStub", ta, opts.threadMat).so
  return {body: body, halo: halo, thread: thread}
}

// ── dynamic thread ──────────────────────────────────────────────────────────

export interface P2 {
  x: number
  y: number
}

/**
 * Glowing thread tube that follows a 2D path in the section plane. Preallocated (bounded); each
 * setPath() rewrites the vertices in one call. Core tube uses `coreMat`, the soft halo `glowMat`.
 */
export class XSThread {
  readonly root: SceneObject
  private core: MeshBuilder
  private glow: MeshBuilder
  private coreVerts = 0
  private glowVerts = 0
  private radial = 6
  private profile = [0, 0.22, 0.78, 0.22, 0]

  constructor(
    parent: SceneObject,
    name: string,
    coreMat: Material,
    glowMat: Material,
    private maxRings: number,
    private radius: number,
    private glowHalf: number,
    private z: number,
    private view: V3,
  ) {
    this.root = global.scene.createSceneObject(name)
    this.root.setParent(parent)
    // Core tube topology.
    const ca = new MeshAcc()
    const R = this.radial + 1
    for (let i = 0; i < maxRings; i++) for (let j = 0; j < R; j++) ca.vert([0, 0, z], [0, 0, 1], [0, 0], [0, 0, 0, 0])
    for (let i = 0; i < maxRings - 1; i++) {
      for (let j = 0; j < this.radial; j++) {
        const bl = i * R + j
        const br = i * R + j + 1
        const tl = (i + 1) * R + j
        const tr = (i + 1) * R + j + 1
        ca.tri(bl, br, tr)
        ca.tri(bl, tr, tl)
      }
    }
    this.coreVerts = ca.count
    this.core = meshObject(this.root, "ThreadCore", ca, coreMat).builder
    const ga = new MeshAcc()
    const M = this.profile.length
    for (let i = 0; i < maxRings; i++) for (let k = 0; k < M; k++) ga.vert([0, 0, z], [0, 0, 1], [0, 0], [0, 0, 0, 0])
    for (let i = 0; i < maxRings - 1; i++) {
      for (let k = 0; k < M - 1; k++) {
        const a = i * M + k
        const b = (i + 1) * M + k
        ga.tri(a, b, a + 1)
        ga.tri(a + 1, b, b + 1)
      }
    }
    this.glowVerts = ga.count
    this.glow = meshObject(this.root, "ThreadGlow", ga, glowMat).builder
  }

  /** Smooth + resample a raw path into at most maxRings points. */
  private resample(path: P2[]): P2[] {
    if (path.length < 2) return path.slice()
    // Two Chaikin passes keep corners soft without drifting the ends.
    let pts = path.slice()
    for (let pass = 0; pass < 2; pass++) {
      if (pts.length < 3) break
      const out: P2[] = [pts[0]]
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]
        const b = pts[i + 1]
        out.push({x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25})
        out.push({x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75})
      }
      out.push(pts[pts.length - 1])
      pts = out
    }
    let L = 0
    const cum = [0]
    for (let i = 1; i < pts.length; i++) {
      L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
      cum.push(L)
    }
    if (L < 1e-4) return [pts[0], pts[pts.length - 1]]
    const n = Math.max(2, Math.min(this.maxRings, Math.ceil(L / 0.07) + 1))
    const out: P2[] = []
    let k = 0
    for (let i = 0; i < n; i++) {
      const d = (L * i) / (n - 1)
      while (k < cum.length - 2 && cum[k + 1] < d) k++
      const seg = cum[k + 1] - cum[k]
      const u = seg > 1e-6 ? (d - cum[k]) / seg : 0
      out.push({x: pts[k].x + (pts[k + 1].x - pts[k].x) * u, y: pts[k].y + (pts[k + 1].y - pts[k].y) * u})
    }
    return out
  }

  /** `colorAt` (optional) colours the core per point, e.g. by distance from the ideal arc. */
  setPath(path: P2[], colorAt?: (p: P2) => [number, number, number]): void {
    const pts = this.resample(path)
    const n = pts.length
    const z = this.z
    const R = this.radial + 1
    const cd: number[] = []
    const gd: number[] = []
    for (let i = 0; i < this.maxRings; i++) {
      const ii = Math.min(i, n - 1)
      const p = pts[ii]
      const a = pts[Math.max(0, ii - 1)]
      const b = pts[Math.min(n - 1, ii + 1)]
      let tx = b.x - a.x
      let ty = b.y - a.y
      const tl = Math.hypot(tx, ty)
      if (tl > 1e-6) {
        tx /= tl
        ty /= tl
      } else {
        tx = 1
        ty = 0
      }
      const alive = i < n && n >= 2
      const t = n > 1 ? ii / (n - 1) : 0
      // Thread is brightest at its live end (the needle) and slightly dimmer at the entry.
      const along = alive ? 0.7 + 0.3 * t : 0
      const r = alive ? this.radius * (i === 0 || i === n - 1 ? 0.6 : 1) : 0
      // Core: N = +Z, B = T × N.
      const bx = ty
      const by = -tx
      const col = colorAt && alive ? colorAt(p) : [1, 1, 1]
      for (let j = 0; j < R; j++) {
        const th = (j / this.radial) * Math.PI * 2
        const nx = bx * Math.sin(th)
        const ny = by * Math.sin(th)
        const nz = Math.cos(th)
        const k = along * (0.5 + 0.5 * Math.max(0, nx * this.view[0] + ny * this.view[1] + nz * this.view[2]))
        cd.push(p.x + nx * r, p.y + ny * r, z + nz * r, nx, ny, nz, t, j / this.radial, col[0] * k, col[1] * k, col[2] * k, 1)
      }
      // Glow ribbon in the plane.
      const sx = -ty
      const sy = tx
      for (let q = 0; q < this.profile.length; q++) {
        const off = (-1 + (2 * q) / (this.profile.length - 1)) * (alive ? this.glowHalf : 0)
        const k = this.profile[q] * along
        gd.push(p.x + sx * off, p.y + sy * off, z - 0.01, 0, 0, 1, t, q / 4, k, k, k, k)
      }
    }
    this.core.eraseVertices(0, this.coreVerts)
    this.core.appendVerticesInterleaved(cd)
    this.core.updateMesh()
    this.glow.eraseVertices(0, this.glowVerts)
    this.glow.appendVerticesInterleaved(gd)
    this.glow.updateMesh()
    this.root.enabled = n >= 2
  }

  clear(): void {
    this.root.enabled = false
  }
}
