/**
 * XSectionTissue — builds the 3D anatomical tissue block of the 3x cross-section (plain module).
 *
 * Owns:
 *  - Layer geometry derived from viewScale: epidermis, dermis, subcutaneous fat, fascia, muscle
 *    with wavy organic boundaries, a V-cleft (the wound) at cutX through epidermis + dermis into
 *    the fat, real depth behind the cut plane (front face = the drag plane at z = 0).
 *  - Surface detail as geometry: fat lobule bumps on the cut faces, muscle striation ridges,
 *    skin micro-relief, plus a hair follicle + sebaceous gland, arrector pili, capillary loops,
 *    a vessel plexus, vessel cross-sections in the fat and hair shafts on the skin.
 *  - Baked lighting in vertex colours (kept light for the additive display) × per-layer detail
 *    textures.
 *
 * Each layer is one SceneObject whose origin sits at the layer's lowest point, so scaling it in Y
 * grows the layer up from its base (used by the scan-in).
 * Must not: hold flow state, own materials beyond per-layer clones, or create colliders.
 */
import {
  C4,
  LightRig,
  MeshAcc,
  V3,
  emitEllipsoid,
  emitGrid,
  emitTube,
  fbm,
  meshObject,
  norm,
  shade,
  smoothstep,
  voronoi,
} from "./XSectionGeom"

export interface TissueSpec {
  viewScale: number
  surfaceY: number
  cutX: number
  width: number
  bottomY: number
  depth: number
  /** Fold-local unit vector toward the eye (for baked specular). */
  view: V3
}

export interface TissueMaterials {
  tissue: Material
  vc: Material
  skin: Texture | null
  dermis: Texture | null
  fat: Texture | null
  muscle: Texture | null
}

export type LayerKey = "epidermis" | "dermis" | "fat" | "fascia" | "muscle"

export interface LayerInfo {
  key: LayerKey
  label: string
  so: SceneObject
  pivotY: number
  top: (x: number, z: number) => number
  bottom: (x: number, z: number) => number
  legend: vec4
}

export interface TissueBlock {
  /** Bottom → top (build order of the scan-in). */
  layers: LayerInfo[]
  surfaceAt: (x: number, z: number) => number
  cleftBottomY: number
  gapHalf: number
  triangles: number
}

type Face = "front" | "top" | "back" | "side" | "bottom"

interface SolidDef {
  /** x samples for a given z (same count for every z). */
  xs: (z: number) => number[]
  top: (x: number, z: number) => number
  bottom: (x: number, z: number) => number
  ny: number
  nzTop: number
  sideLeft: boolean
  sideRight: boolean
  bottomFace: boolean
  frontBump: (x: number, y: number) => number
  sideBump: (z: number, y: number) => number
  color: (p: V3, n: V3, face: Face, rel: number) => C4
  tile: [number, number]
}

const NZ_SIDE = 20

export function buildTissue(root: SceneObject, spec: TissueSpec, mats: TissueMaterials): TissueBlock {
  const vs = spec.viewScale
  const S = spec.surfaceY
  const cx = spec.cutX
  const W2 = spec.width / 2
  const B0 = spec.bottomY
  const D = spec.depth

  // Real thickness (mm) × viewScale → view cm. Stylised but in proportion.
  const epiT = 0.08 * vs
  const dermT = 0.22 * vs
  const fasT = Math.max(0.08, 0.025 * vs)
  // Fat fills the block so the muscle stays a ~quarter-height base layer at any scale.
  const muscleT = 0.25 * (S - B0)
  const fatT = Math.max(0.6, S - B0 - epiT - dermT - fasT - muscleT)
  const g = 0.125 * vs // half the wound gape at the surface (1.25 mm real)
  // Cleft bottom: into the fat, but always shallower than the stitch arc (depth 0.5*vs) so the
  // ideal bite passes under the wound base.
  const yC = S - Math.min(epiT + dermT + 0.3 * fatT, 0.8 * 0.5 * vs)
  const sc = vs / 4.5

  const rig: LightRig = {
    key: norm([-0.35, 0.8, 0.5]),
    keyI: 0.42,
    fill: norm([0.8, 0.1, 0.6]),
    fillI: 0.12,
    ambient: 0.56,
    view: spec.view,
  }

  // ── boundary functions ────────────────────────────────────────────────
  const lip = (x: number) => {
    const d = Math.abs(x - cx) - g
    return 0.045 * sc * Math.exp(-Math.pow((d - 0.16) / 0.2, 2))
  }
  const surf = (x: number, z: number) => S + 0.02 * fbm(x * 0.8 + 3.1, z * 0.8) + 0.008 * Math.sin(x * 1.9 + z * 1.3) + lip(x)
  const dej = (x: number, z: number) =>
    S - epiT + 0.045 * sc * Math.sin((2 * Math.PI * x) / 0.7 + 0.8 * Math.sin(z * 0.9)) + 0.02 * fbm(x * 1.3, z * 1.3 + 7)
  const dfj = (x: number, z: number) =>
    S -
    epiT -
    dermT +
    0.07 * Math.sin(x * 0.9 + 0.5 + z * 0.35) +
    0.1 * sc * (Math.pow(Math.abs(Math.sin(((x + 0.25 * Math.sin(z * 0.8)) * Math.PI) / 0.85)), 0.55) - 0.6)
  const ffj = (x: number, z: number) =>
    S - epiT - dermT - fatT + 0.06 * Math.sin(x * 0.55 + 1.3) + 0.04 * Math.sin(x * 1.7 + z * 0.6 + 0.4) + 0.025 * fbm(x * 0.8 + 11, z * 0.8)
  const fmj = (x: number, z: number) => ffj(x, z) - fasT
  const bot = (_x: number, _z: number) => B0
  const wallTop = S + 0.06
  const wallY = (x: number) => yC + (wallTop - yC) * Math.pow(Math.abs(x - cx) / g, 0.85)

  // ── x sampling ──────────────────────────────────────────────────────────
  const bisect = (f: (x: number) => number, a: number, b: number) => {
    let fa = f(a)
    for (let k = 0; k < 40; k++) {
      const m = (a + b) / 2
      const fm = f(m)
      if (fm * fa > 0) {
        a = m
        fa = fm
      } else b = m
    }
    return (a + b) / 2
  }
  const uniform = (a: number, b: number, n: number) => {
    const out: number[] = []
    for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n)
    return out
  }
  const halfXs = (side: -1 | 1, bottomFn: (x: number, z: number) => number, h: number) => {
    const n2 = 14
    const xK = cx + side * (g + 0.2)
    const n1 = Math.max(4, Math.round((W2 - Math.abs(xK)) / h))
    return (z: number): number[] => {
      // Where the wound wall meets this layer's bottom (the layer pinches out there).
      let xEnd = cx
      if (bottomFn(cx, z) > yC) {
        xEnd = bisect((x) => wallY(x) - bottomFn(x, z), cx + side * g * 1.3, cx)
      }
      if (side < 0) {
        const a = uniform(-W2, xK, n1)
        const b = uniform(xK, xEnd, n2)
        return a.concat(b.slice(1))
      }
      const a = uniform(xEnd, xK, n2)
      const b = uniform(xK, W2, n1)
      return a.concat(b.slice(1))
    }
  }

  // ── colour models ───────────────────────────────────────────────────────
  const C = (r: number, gg: number, b: number): V3 => [r, gg, b]
  const epiColor = (p: V3, n: V3, face: Face, rel: number): C4 => {
    if (face === "top") {
      const d = Math.abs(p[0] - cx) - g
      const flush = Math.exp(-Math.pow(Math.max(0, d) / 0.9, 2))
      const inWall = p[1] < surf(p[0], p[2]) - 0.03
      if (inWall) return shade(rig, n, C(1.0, 0.86, 0.8), 0.1, 16, 0.9)
      const base: V3 = [1.0, 0.86 - 0.1 * flush, 0.77 - 0.08 * flush]
      return shade(rig, n, base, 0.2, 26)
    }
    let a: V3 = C(0.99, 0.87, 0.79)
    if (rel < 0.18) a = C(1.0, 0.95, 0.9)
    else if (rel > 0.78) a = C(0.93, 0.77, 0.67)
    return shade(rig, n, a, 0.07, 12)
  }
  const dermColor = (p: V3, n: V3, face: Face, rel: number): C4 => {
    if (face === "top") {
      // Only the wound wall is visible from above: raw pink-white.
      const depth = (S - p[1]) / (S - yC)
      return shade(rig, n, C(1.0, 0.84 - 0.08 * depth, 0.84 - 0.08 * depth), 0.18, 20, 1 - 0.12 * depth)
    }
    const a: V3 = rel < 0.28 ? C(1.0, 0.86, 0.87) : C(1.0, 0.95, 0.93)
    return shade(rig, n, a, 0.08, 14)
  }
  const fatColor = (p: V3, n: V3, face: Face, _rel: number): C4 => {
    const u = face === "side" ? p[2] : p[0]
    const v = voronoi(u, p[1], 0.5, 3)
    const septum = 1 - smoothstep(0.02, 0.08, v.f2 - v.f1)
    const lobe: V3 = C(1.0, 0.93 - 0.05 * v.id, 0.66 - 0.06 * v.id)
    const a: V3 = [lobe[0], lobe[1] + (0.9 - lobe[1]) * septum, lobe[2] + (0.86 - lobe[2]) * septum]
    if (face === "top") return shade(rig, n, C(1.0, 0.9, 0.66), 0.35, 30, 0.92)
    return shade(rig, n, a, 0.3, 30)
  }
  const fasColor = (_p: V3, n: V3, _face: Face, _rel: number): C4 => shade(rig, n, C(0.9, 0.94, 1.0), 0.45, 18)
  const musColor = (p: V3, n: V3, _face: Face, rel: number): C4 => {
    const band = 0.5 + 0.5 * Math.sin(p[1] * 9.0 + Math.sin(p[0] * 0.6) * 1.2)
    const a: V3 = [1.0, 0.86 + 0.06 * band, 0.84 + 0.06 * band]
    return shade(rig, n, a, 0.18, 22, 0.95 + 0.05 * rel)
  }

  // ── bumps ───────────────────────────────────────────────────────────────
  const noBump = () => 0
  const fatBump = (u: number, y: number) => {
    const v = voronoi(u, y, 0.5, 3)
    return 0.11 * sc * Math.pow(Math.min(1, (v.f2 - v.f1) / 0.28), 0.6)
  }
  const dermBump = (u: number, y: number) => 0.014 * Math.sin(y * 26 + 2.2 * Math.sin(u * 1.7) + 3 * fbm(u * 0.7, y * 2))
  const musBump = (u: number, y: number) =>
    0.028 * (0.5 + 0.5 * Math.sin((2 * Math.PI * y) / 0.17 + 0.5 * Math.sin(u * 0.9))) - 0.03 * Math.exp(-Math.pow(Math.sin(y * 6.1 + u * 0.12) / 0.12, 2))

  // ── layer table (top → bottom) ───────────────────────────────────────────
  interface Def {
    key: LayerKey
    label: string
    top: (x: number, z: number) => number
    bottom: (x: number, z: number) => number
    split: boolean
    h: number
    ny: number
    color: (p: V3, n: V3, face: Face, rel: number) => C4
    bump: (u: number, y: number) => number
    tex: Texture | null
    tile: [number, number]
    legend: vec4
    bottomFace: boolean
  }
  const defs: Def[] = [
    {key: "epidermis", label: "Epidermis", top: surf, bottom: dej, split: true, h: 0.14, ny: 3, color: epiColor, bump: noBump, tex: mats.skin, tile: [3.6, 3.6], legend: new vec4(1.0, 0.9, 0.82, 1), bottomFace: false},
    {key: "dermis", label: "Dermis", top: dej, bottom: dfj, split: true, h: 0.14, ny: 8, color: dermColor, bump: dermBump, tex: mats.dermis, tile: [1.8, 1.8], legend: new vec4(1.0, 0.78, 0.82, 1), bottomFace: false},
    {key: "fat", label: "Subcutaneous fat", top: dfj, bottom: ffj, split: true, h: 0.11, ny: 14, color: fatColor, bump: fatBump, tex: mats.fat, tile: [2.4, 2.4], legend: new vec4(1.0, 0.88, 0.5, 1), bottomFace: false},
    {key: "fascia", label: "Fascia", top: ffj, bottom: fmj, split: false, h: 0.15, ny: 2, color: fasColor, bump: noBump, tex: null, tile: [2, 2], legend: new vec4(0.86, 0.93, 1.0, 1), bottomFace: false},
    {key: "muscle", label: "Muscle", top: fmj, bottom: bot, split: false, h: 0.15, ny: 14, color: musColor, bump: musBump, tex: mats.muscle, tile: [3.2, 1.66], legend: new vec4(1.0, 0.66, 0.66, 1), bottomFace: true},
  ]

  const layers: LayerInfo[] = []
  let triangles = 0
  for (const d of defs) {
    const acc = new MeshAcc()
    // Lowest point of the layer = scan-in pivot.
    let pivot = Infinity
    for (let x = -W2; x <= W2; x += 0.25) for (let z = -D; z <= 0; z += 1) pivot = Math.min(pivot, d.bottom(x, z))
    pivot -= 0.02
    const effTop = d.split ? (x: number, z: number) => Math.min(d.top(x, z), wallY(x)) : d.top
    const solids: SolidDef[] = []
    const mk = (xs: (z: number) => number[], left: boolean, right: boolean): SolidDef => ({
      xs: xs,
      top: effTop,
      bottom: d.bottom,
      ny: d.ny,
      nzTop: d.key === "epidermis" ? NZ_SIDE : d.key === "dermis" || d.key === "fat" ? 5 : 2,
      sideLeft: left,
      sideRight: right,
      bottomFace: d.bottomFace,
      frontBump: d.bump,
      sideBump: d.bump,
      color: d.color,
      tile: d.tile,
    })
    if (d.split) {
      solids.push(mk(halfXs(-1, d.bottom, d.h), true, false))
      solids.push(mk(halfXs(1, d.bottom, d.h), false, true))
    } else {
      const xs = uniform(-W2, W2, Math.round(spec.width / d.h))
      solids.push(mk(() => xs, true, true))
    }
    for (const s of solids) emitSolid(acc, s, D, pivot, W2)
    const mat = d.tex ? mats.tissue.clone() : mats.vc.clone()
    const lift: {[k: string]: vec4} = {
      epidermis: new vec4(1.12, 1.1, 1.08, 1),
      dermis: new vec4(1.06, 1.06, 1.06, 1),
      fat: new vec4(1.32, 1.28, 1.12, 1),
      fascia: new vec4(1, 1, 1, 1),
      muscle: new vec4(1.1, 1.6, 1.55, 1),
    }
    mat.mainPass.baseColor = lift[d.key]
    if (d.tex) {
      mat.mainPass.baseTex = d.tex
      try {
        mat.mainPass.samplers.baseTex.wrap = WrapMode.MirroredRepeat
      } catch (e) {
        // Sampler access is optional; textures still tile via UVs on clamp-free assets.
      }
    }
    triangles += acc.triangleCount
    const obj = meshObject(root, "Layer_" + d.label.replace(/ /g, ""), acc, mat, new vec3(0, pivot, 0))
    layers.push({key: d.key, label: d.label, so: obj.so, pivotY: pivot, top: effTop, bottom: d.bottom, legend: d.legend})
  }

  // ── anatomical details (children of their layers, authored in Fold coords) ─────
  const byKey = (k: LayerKey) => layers.filter((l) => l.key === k)[0]
  const detailRoot = (k: LayerKey, name: string) => {
    const l = byKey(k)
    const so = global.scene.createSceneObject(name)
    so.setParent(l.so)
    so.getTransform().setLocalPosition(new vec3(0, -l.pivotY, 0))
    return so
  }
  const dcol = (albedo: V3, ks: number = 0.25) => (_p: V3, n: V3) => shade(rig, n, albedo, ks, 24)

  // Hair shafts on the skin (keep clear of the stitch + wound).
  {
    const acc = new MeshAcc()
    const hairs: [number, number, number, number][] = [
      [-7.7, -1.2, 1.25, 0.2],
      [-6.3, -3.1, 1.05, -0.1],
      [-5.2, -1.8, 1.35, 0.15],
      [-8.4, -3.9, 1.1, 0.05],
      [2.6, -2.5, 1.2, -0.15],
      [3.6, -4.0, 1.0, 0.1],
      [5.9, -1.4, 1.3, 0.2],
      [6.9, -3.3, 1.15, -0.05],
      [8.1, -2.0, 1.25, 0.12],
      [7.6, -4.4, 0.95, 0.0],
    ]
    for (const h of hairs) {
      const [hx, hz, L, tw] = h
      const base: V3 = [hx, surf(hx, hz) - 0.03, hz]
      const dir = norm([-0.55 + tw, 0.78, 0.25])
      const pts: V3[] = []
      const radii: number[] = []
      const n = 10
      for (let i = 0; i <= n; i++) {
        const t = i / n
        const bend = 0.18 * t * t * L
        pts.push([base[0] + dir[0] * L * t - bend, base[1] + dir[1] * L * t - bend * 0.4, base[2] + dir[2] * L * t])
        radii.push((0.034 - 0.022 * t) * sc)
      }
      emitTube(acc, pts, radii, 6, (_p, nn) => shade(rig, nn, [0.74, 0.58, 0.46], 0.35, 30))
    }
    triangles += acc.triangleCount
    meshObject(detailRoot("epidermis", "HairShafts"), "Hairs", acc, mats.vc.clone())
  }

  // Dermis structures: follicle + gland + arrector pili, capillary loops, vessel plexus.
  {
    const acc = new MeshAcc()
    const fx = Math.min(W2 - 3.5, cx + 5.8)
    const fTop: V3 = [fx + 0.25, S + 0.02, -0.02]
    const fBot: V3 = [fx - 0.55, S - epiT - dermT - 0.22 * sc, -0.02]
    const axis = norm([fBot[0] - fTop[0], fBot[1] - fTop[1], 0])
    const side: V3 = [-axis[1], axis[0], 0] // points to the right/up of the shaft
    // Outer root sheath.
    {
      const pts: V3[] = []
      const radii: number[] = []
      for (let i = 0; i <= 16; i++) {
        const t = i / 16
        pts.push([fTop[0] + (fBot[0] - fTop[0]) * t, fTop[1] + (fBot[1] - fTop[1]) * t, fTop[2]])
        radii.push((0.15 + 0.03 * Math.sin(t * Math.PI)) * sc)
      }
      emitTube(acc, pts, radii, 10, dcol([1.0, 0.93, 0.86], 0.2))
    }
    // Bulb + dermal papilla.
    emitEllipsoid(acc, [fBot[0], fBot[1], fBot[2]], [0.3 * sc, 0.32 * sc, 0.22 * sc], 10, 14, dcol([1.0, 0.89, 0.8]))
    emitEllipsoid(acc, [fBot[0], fBot[1] - 0.12 * sc, fBot[2] + 0.06], [0.13 * sc, 0.12 * sc, 0.16 * sc], 8, 10, dcol([1.0, 0.68, 0.7]))
    // Hair shaft: from the bulb up the follicle and out above the skin.
    {
      const pts: V3[] = []
      const radii: number[] = []
      const above = 1.5 * sc
      for (let i = 0; i <= 22; i++) {
        const t = i / 22
        if (t < 0.6) {
          const u = t / 0.6
          pts.push([fBot[0] + (fTop[0] - fBot[0]) * u, fBot[1] + (fTop[1] - fBot[1]) * u, 0.05])
        } else {
          const u = (t - 0.6) / 0.4
          pts.push([fTop[0] + 0.6 * above * u + 0.15 * u * u, fTop[1] + 0.75 * above * u - 0.25 * u * u, 0.05 + 0.2 * u])
        }
        radii.push((0.06 - 0.03 * Math.max(0, (t - 0.6) / 0.4)) * sc)
      }
      emitTube(acc, pts, radii, 8, dcol([0.76, 0.6, 0.47], 0.4))
    }
    // Sebaceous gland: clustered lobules on the right of the upper follicle.
    {
      const gC: V3 = [fTop[0] + (fBot[0] - fTop[0]) * 0.36, fTop[1] + (fBot[1] - fTop[1]) * 0.36, 0]
      const lobes: [number, number, number][] = [
        [0.3, 0.06, 0.16],
        [0.48, -0.12, 0.14],
        [0.34, -0.26, 0.15],
        [0.56, 0.1, 0.12],
      ]
      for (const lb of lobes) {
        const c: V3 = [gC[0] + side[0] * lb[0] * sc + axis[0] * lb[1] * sc, gC[1] + side[1] * lb[0] * sc + axis[1] * lb[1] * sc, 0]
        emitEllipsoid(acc, c, [lb[2] * sc, lb[2] * sc, lb[2] * 0.8 * sc], 8, 10, dcol([1.0, 0.95, 0.72], 0.35))
      }
      // Arrector pili: from below the gland up to the dermal-epidermal junction.
      const a0: V3 = [fTop[0] + (fBot[0] - fTop[0]) * 0.62 + side[0] * 0.12, fTop[1] + (fBot[1] - fTop[1]) * 0.62 + side[1] * 0.12, 0]
      const ax1 = a0[0] + 1.1 * sc
      const a1: V3 = [ax1, dej(ax1, 0) - 0.05, 0]
      const pts: V3[] = []
      const radii: number[] = []
      for (let i = 0; i <= 10; i++) {
        const t = i / 10
        pts.push([a0[0] + (a1[0] - a0[0]) * t, a0[1] + (a1[1] - a0[1]) * t + 0.08 * Math.sin(t * Math.PI), 0])
        radii.push(0.045 * sc * (0.6 + 0.4 * Math.sin(t * Math.PI)))
      }
      emitTube(acc, pts, radii, 6, dcol([0.98, 0.62, 0.62]))
    }
    // Capillary loops in the dermal papillae (skip the stitch/wound zone and the follicle).
    const g0 = cx - 0.5 * vs - 0.6
    const g1 = cx + 0.5 * vs + 0.6
    for (let k = -20; k <= 20; k++) {
      const x = 0.7 * (0.25 + k)
      if (Math.abs(x) > W2 - 0.4) continue
      if (x > g0 && x < g1) continue
      if (Math.abs(x - fx) < 1.0) continue
      if (k % 2 !== 0) continue
      const top = dej(x, 0) - 0.05
      const hgt = 0.34 * sc
      const r = 0.08 * sc
      const pts: V3[] = []
      for (let i = 0; i <= 14; i++) {
        const t = i / 14
        if (t < 0.4) pts.push([x - r, top - hgt + (hgt - r) * (t / 0.4), 0])
        else if (t > 0.6) pts.push([x + r, top - r - (hgt - r) * ((t - 0.6) / 0.4), 0])
        else {
          const a = Math.PI - ((t - 0.4) / 0.2) * Math.PI
          pts.push([x + Math.cos(a) * r, top - r + Math.sin(a) * r, 0])
        }
      }
      const radii = pts.map(() => 0.028 * sc)
      emitTube(acc, pts, radii, 5, (_p, nn, t) => shade(rig, nn, [1.0, 0.42 + 0.06 * t, 0.42 + 0.3 * t], 0.3, 30), false)
    }
    // Deep vessel plexus just above the fat (artery + vein), interrupted by the wound.
    const plexus = (dy: number, rad: number, col: V3, phase: number) => {
      for (const sgn of [-1, 1]) {
        const pts: V3[] = []
        const xa = sgn < 0 ? -W2 + 0.05 : cx + 0.12
        const xb = sgn < 0 ? cx - 0.12 : W2 - 0.05
        const n = Math.max(4, Math.round((xb - xa) / 0.35))
        for (let i = 0; i <= n; i++) {
          const x = xa + ((xb - xa) * i) / n
          let y = dfj(x, 0) + dy + 0.05 * Math.sin(x * 1.3 + phase)
          if (y > wallY(x) - rad * 1.5) y = wallY(x) - rad * 1.5
          pts.push([x, y, 0])
        }
        // Drop points that fell into the wound gap.
        const keep = pts.filter((p) => p[1] < wallY(p[0]) - rad)
        if (keep.length >= 2) emitTube(acc, keep, keep.map(() => rad), 6, dcol(col, 0.35))
      }
    }
    plexus(0.16 * sc, 0.07 * sc, [1.0, 0.45, 0.45], 0.3)
    plexus(0.3 * sc, 0.085 * sc, [0.72, 0.7, 1.0], 1.9)
    triangles += acc.triangleCount
    meshObject(detailRoot("dermis", "DermisStructures"), "Structures", acc, mats.vc.clone())
  }

  // Fat: vessels cut in cross-section (short cylinders into the cut face).
  {
    const acc = new MeshAcc()
    const mid = (S - epiT - dermT) - fatT * 0.62
    const vessels: [number, number, number, V3][] = [
      [W2 - 2.3, mid, 0.16 * sc, [1.0, 0.5, 0.5]],
      [W2 - 1.7, mid - 0.12, 0.2 * sc, [0.72, 0.7, 1.0]],
      [-W2 + 1.9, mid + 0.25, 0.13 * sc, [1.0, 0.5, 0.5]],
    ]
    for (const v of vessels) {
      const pts: V3[] = [
        [v[0], v[1], 0.06],
        [v[0], v[1], -0.5],
      ]
      emitTube(acc, pts, [v[2], v[2]], 14, dcol(v[3], 0.4))
    }
    triangles += acc.triangleCount
    meshObject(detailRoot("fat", "FatVessels"), "Vessels", acc, mats.vc.clone())
  }

  return {layers: layers.reverse(), surfaceAt: surf, cleftBottomY: yC, gapHalf: g, triangles: triangles}
}

/** One closed layer solid: front (cut) face, top, back, outer sides, optional bottom. */
function emitSolid(acc: MeshAcc, s: SolidDef, D: number, pivot: number, W2: number): void {
  const taper = 0.14
  const edgeW = (u: number, lo: number, hi: number) => smoothstep(0, taper, u - lo) * smoothstep(0, taper, hi - u)
  const P = (x: number, y: number, z: number): V3 => [x, y - pivot, z]
  const unP = (p: V3): V3 => [p[0], p[1] + pivot, p[2]]
  const xs0 = s.xs(0)
  const nu = xs0.length - 1

  // Front face (z = 0), bumps toward the viewer.
  {
    const G: V3[][] = []
    const rel: number[][] = []
    for (let i = 0; i <= nu; i++) {
      const x = xs0[i]
      const yb = s.bottom(x, 0)
      const yt = Math.max(yb, s.top(x, 0))
      const col: V3[] = []
      const rc: number[] = []
      const outerW = (s.sideLeft ? smoothstep(0, taper, x + W2) : 1) * (s.sideRight ? smoothstep(0, taper, W2 - x) : 1)
      for (let j = 0; j <= s.ny; j++) {
        const y = yb + ((yt - yb) * j) / s.ny
        const w = edgeW(y, yb, yt) * outerW
        col.push(P(x, y, s.frontBump(x, y) * w))
        rc.push(yt - yb > 1e-5 ? (yt - y) / (yt - yb) : 0)
      }
      G.push(col)
      rel.push(rc)
    }
    emitGrid(acc, G, {
      fallbackN: [0, 0, 1],
      uv: (p) => [p[0] / s.tile[0], (p[1] + pivot) / s.tile[1]],
      color: (p, n, i, j) => s.color(unP(p), n, "front", rel[i][j]),
    })
  }

  // Top face (includes any wound-wall portion).
  {
    const G: V3[][] = []
    const zs: number[] = []
    for (let k = 0; k <= s.nzTop; k++) zs.push((-D * k) / s.nzTop)
    const xsByZ = zs.map((z) => s.xs(z))
    for (let i = 0; i <= nu; i++) {
      const col: V3[] = []
      for (let k = 0; k <= s.nzTop; k++) {
        const z = zs[k]
        const x = xsByZ[k][i]
        col.push(P(x, Math.max(s.bottom(x, z), s.top(x, z)), z))
      }
      G.push(col)
    }
    emitGrid(acc, G, {
      fallbackN: [0, 1, 0],
      uv: (p) => [p[0] / s.tile[0], p[2] / s.tile[1]],
      color: (p, n) => s.color(unP(p), n, "top", 0),
    })
  }

  // Back face (z = -D), flat.
  {
    const xsB = s.xs(-D)
    const G: V3[][] = []
    for (let i = 0; i <= nu; i++) {
      const x = xsB[i]
      const yb = s.bottom(x, -D)
      const yt = Math.max(yb, s.top(x, -D))
      G.push([P(x, yb, -D), P(x, yt, -D)])
    }
    emitGrid(acc, G, {
      flip: true,
      fallbackN: [0, 0, -1],
      uv: (p) => [p[0] / s.tile[0], (p[1] + pivot) / s.tile[1]],
      color: (p, n) => s.color(unP(p), n, "back", 0.5),
    })
  }

  // Outer sides (x = ±W2), bumps outward.
  const sideFace = (sgn: -1 | 1) => {
    const G: V3[][] = []
    const rel: number[][] = []
    const x = sgn * W2
    for (let j = 0; j <= s.ny; j++) {
      const col: V3[] = []
      const rc: number[] = []
      for (let k = 0; k <= NZ_SIDE; k++) {
        const z = (-D * k) / NZ_SIDE
        const yb = s.bottom(x, z)
        const yt = Math.max(yb, s.top(x, z))
        const y = yb + ((yt - yb) * j) / s.ny
        const w = edgeW(y, yb, yt) * edgeW(z, -D, 0)
        col.push(P(x + sgn * s.sideBump(z, y) * w, y, z))
        rc.push(yt - yb > 1e-5 ? (yt - y) / (yt - yb) : 0)
      }
      G.push(col)
      rel.push(rc)
    }
    emitGrid(acc, G, {
      flip: sgn > 0,
      fallbackN: [sgn, 0, 0],
      uv: (p) => [p[2] / s.tile[0], (p[1] + pivot) / s.tile[1]],
      color: (p, n, j, k) => s.color(unP(p), n, "side", rel[j][k]),
    })
  }
  if (s.sideLeft) sideFace(-1)
  if (s.sideRight) sideFace(1)

  // Bottom (only the block's base).
  if (s.bottomFace) {
    const G: V3[][] = []
    const n = 30
    for (let i = 0; i <= n; i++) {
      const x = -W2 + (2 * W2 * i) / n
      const col: V3[] = []
      for (let k = 0; k <= 4; k++) {
        const z = (-D * k) / 4
        col.push(P(x, s.bottom(x, z), z))
      }
      G.push(col)
    }
    emitGrid(acc, G, {
      flip: true,
      fallbackN: [0, -1, 0],
      uv: (p) => [p[0] / s.tile[0], p[2] / s.tile[1]],
      color: (p, nn) => s.color(unP(p), nn, "bottom", 1),
    })
  }
}
