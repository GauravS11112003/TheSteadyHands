/**
 * XSectionGeom — procedural mesh kit for the 3x skin cross-section (plain module, no components).
 *
 * Owns:
 *  - MeshAcc: an interleaved vertex/index accumulator (position, normal, uv0, colour) that turns
 *    into a MeshBuilder + RenderMeshVisual in one call.
 *  - Emitters with verified CCW winding: parametric grids (layer faces), tubes (parallel-transport
 *    frames), ellipsoids, flat ribbons (soft glow lines) and helpers for circles / polylines.
 *  - Small deterministic noise (value noise, fbm, jittered voronoi) and colour helpers
 *    (baked lighting, pseudo-chrome, hologram fresnel).
 *
 * Must not: hold app state, touch flow logic, or create colliders.
 */

export type V3 = [number, number, number]
export type C4 = [number, number, number, number]
export type UV = [number, number]

const LAYOUT = [
  {name: "position", components: 3},
  {name: "normal", components: 3, normalized: true},
  {name: "texture0", components: 2},
  {name: "color", components: 4},
]

// ── vector helpers (tuples keep the generators allocation-light) ─────────────

export function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
export function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
export function scl(a: V3, s: number): V3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}
export function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
export function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
export function len(a: V3): number {
  return Math.sqrt(dot(a, a))
}
export function norm(a: V3, fallback: V3 = [0, 0, 1]): V3 {
  const l = len(a)
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : fallback
}
export function mix(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}
export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
export function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
export function mixC(a: C4, b: C4, t: number): C4 {
  return [lerpN(a[0], b[0], t), lerpN(a[1], b[1], t), lerpN(a[2], b[2], t), lerpN(a[3], b[3], t)]
}
export function mulC(c: C4, k: number): C4 {
  return [c[0] * k, c[1] * k, c[2] * k, c[3] * k]
}

// ── noise ─────────────────────────────────────────────────────────────────

function hash2(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967296
}

/** Smooth value noise in [0, 1]. */
export function vnoise(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy)
  const b = hash2(ix + 1, iy)
  const c = hash2(ix, iy + 1)
  const d = hash2(ix + 1, iy + 1)
  return lerpN(lerpN(a, b, ux), lerpN(c, d, ux), uy)
}

/** Fractal value noise, roughly in [-0.5, 0.5]. */
export function fbm(x: number, y: number, oct: number = 3): number {
  let s = 0
  let a = 0.5
  let f = 1
  let n = 0
  for (let i = 0; i < oct; i++) {
    s += a * (vnoise(x * f + i * 17.3, y * f - i * 9.1) - 0.5)
    n += a
    a *= 0.5
    f *= 2.03
  }
  return s / n
}

/** Jittered-grid voronoi: distances to the nearest (f1) and second-nearest (f2) cell points. */
export function voronoi(x: number, y: number, cell: number, seed: number = 0): {f1: number; f2: number; id: number} {
  const gx = Math.floor(x / cell)
  const gy = Math.floor(y / cell)
  let f1 = 1e9
  let f2 = 1e9
  let id = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = gx + dx
      const cy = gy + dy
      const px = (cx + 0.15 + 0.7 * hash2(cx + seed, cy)) * cell
      const py = (cy + 0.15 + 0.7 * hash2(cx, cy + seed + 31)) * cell
      const d = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py))
      if (d < f1) {
        f2 = f1
        f1 = d
        id = hash2(cx * 7 + seed, cy * 13)
      } else if (d < f2) {
        f2 = d
      }
    }
  }
  return {f1: f1, f2: f2, id: id}
}

// ── mesh accumulator ────────────────────────────────────────────────────────

export class MeshAcc {
  private data: number[] = []
  private idx: number[] = []
  count = 0

  vert(p: V3, n: V3, uv: UV, c: C4): number {
    this.data.push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1], c[0], c[1], c[2], c[3])
    return this.count++
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c)
  }

  get triangleCount(): number {
    return this.idx.length / 3
  }

  toBuilder(): MeshBuilder {
    const b = new MeshBuilder(LAYOUT)
    b.topology = MeshTopology.Triangles
    b.indexType = MeshIndexType.UInt16
    if (this.count > 0) {
      b.appendVerticesInterleaved(this.data)
      b.appendIndices(this.idx)
    }
    b.updateMesh()
    return b
  }
}

/** A SceneObject with a RenderMeshVisual showing the accumulated mesh. */
export function meshObject(
  parent: SceneObject,
  name: string,
  acc: MeshAcc,
  material: Material,
  localPos: vec3 = vec3.zero(),
): {so: SceneObject; builder: MeshBuilder; rmv: RenderMeshVisual} {
  const so = global.scene.createSceneObject(name)
  so.setParent(parent)
  so.getTransform().setLocalPosition(localPos)
  const builder = acc.toBuilder()
  const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  rmv.mesh = builder.getMesh()
  rmv.mainMaterial = material
  return {so: so, builder: builder, rmv: rmv}
}

/** Clone a vertex-colour material for normal alpha blending (strokes that must read over bright tissue). */
export function alphaMaterial(base: Material, twoSided: boolean = true): Material {
  const m = base.clone()
  m.mainPass.blendMode = BlendMode.Normal
  m.mainPass.depthWrite = false
  // Closed tubes must cull back faces, or their own back faces sort over the front (beading).
  m.mainPass.twoSided = twoSided
  return m
}

/** Clone a vertex-colour material and set it up for additive glow (no depth write, two-sided). */
export function glowMaterial(base: Material): Material {
  const m = base.clone()
  m.mainPass.blendMode = BlendMode.Add
  m.mainPass.depthWrite = false
  m.mainPass.twoSided = true
  return m
}

// ── emitters ────────────────────────────────────────────────────────────────

export interface GridOpts {
  flip?: boolean
  fallbackN: V3
  uv: (p: V3, i: number, j: number) => UV
  color: (p: V3, n: V3, i: number, j: number) => C4
}

/**
 * Parametric grid P[i][j]. Unflipped, the face normal is dP/di × dP/dj (choose the parameter
 * order so that points outward); `flip` reverses winding and normals.
 */
export function emitGrid(acc: MeshAcc, P: V3[][], o: GridOpts): void {
  const nu = P.length - 1
  const nv = P[0].length - 1
  const base = acc.count
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const du = sub(P[Math.min(nu, i + 1)][j], P[Math.max(0, i - 1)][j])
      const dv = sub(P[i][Math.min(nv, j + 1)], P[i][Math.max(0, j - 1)])
      let n = norm(cross(du, dv), o.fallbackN)
      if (o.flip) n = scl(n, -1)
      const p = P[i][j]
      acc.vert(p, n, o.uv(p, i, j), o.color(p, n, i, j))
    }
  }
  const at = (i: number, j: number) => base + i * (nv + 1) + j
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = at(i, j)
      const b = at(i + 1, j)
      const c = at(i, j + 1)
      const d = at(i + 1, j + 1)
      if (o.flip) {
        acc.tri(a, c, b)
        acc.tri(b, c, d)
      } else {
        acc.tri(a, b, c)
        acc.tri(b, d, c)
      }
    }
  }
}

/** Parallel-transport frames along a polyline (normal starts near +Z so planar curves stay flat). */
export function curveFrames(pts: V3[]): {t: V3[]; n: V3[]; b: V3[]} {
  const N = pts.length
  const T: V3[] = []
  for (let i = 0; i < N; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(N - 1, i + 1)]
    T.push(norm(sub(b, a), [1, 0, 0]))
  }
  const ax: V3 = Math.abs(T[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  let Nf = norm(sub(ax, scl(T[0], dot(ax, T[0]))), [0, 1, 0])
  const outN: V3[] = []
  const outB: V3[] = []
  for (let i = 0; i < N; i++) {
    if (i > 0) {
      const k = cross(T[i - 1], T[i])
      const kl = len(k)
      if (kl > 1e-6) {
        const kk = scl(k, 1 / kl)
        const c = Math.max(-1, Math.min(1, dot(T[i - 1], T[i])))
        const ang = Math.acos(c)
        const s = Math.sin(ang)
        const co = Math.cos(ang)
        const kxn = cross(kk, Nf)
        const kdn = dot(kk, Nf)
        Nf = norm(add(add(scl(Nf, co), scl(kxn, s)), scl(kk, kdn * (1 - co))), Nf)
      }
    }
    outN.push(Nf)
    outB.push(cross(T[i], Nf))
  }
  return {t: T, n: outN, b: outB}
}

/**
 * Tube along a curve with per-point radius. `color(p, n, t, k)` gets the surface point, its
 * outward normal, the curve fraction t (0..1) and the radial fraction k.
 */
export function emitTube(
  acc: MeshAcc,
  pts: V3[],
  radii: number[],
  radial: number,
  color: (p: V3, n: V3, t: number, k: number) => C4,
  caps: boolean = true,
): void {
  const N = pts.length
  if (N < 2) return
  const fr = curveFrames(pts)
  const R = radial + 1
  const start = acc.count
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1)
    for (let j = 0; j < R; j++) {
      const th = (j / radial) * Math.PI * 2
      const nn = add(scl(fr.n[i], Math.cos(th)), scl(fr.b[i], Math.sin(th)))
      const p = add(pts[i], scl(nn, radii[i]))
      acc.vert(p, nn, [t, j / radial], color(p, nn, t, j / radial))
    }
  }
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const bl = start + i * R + j
      const br = start + i * R + j + 1
      const tl = start + (i + 1) * R + j
      const tr = start + (i + 1) * R + j + 1
      acc.tri(bl, br, tr)
      acc.tri(bl, tr, tl)
    }
  }
  if (!caps) return
  // End caps (flat fans) only where the radius is non-zero.
  const cap = (i: number, dir: number) => {
    if (radii[i] < 1e-5) return
    const nrm = scl(fr.t[i], dir)
    const c = acc.vert(pts[i], nrm, [0.5, 0.5], color(pts[i], nrm, i / (N - 1), 0))
    const ring = acc.count
    for (let j = 0; j < R; j++) {
      const th = (j / radial) * Math.PI * 2
      const nn = add(scl(fr.n[i], Math.cos(th)), scl(fr.b[i], Math.sin(th)))
      const p = add(pts[i], scl(nn, radii[i]))
      acc.vert(p, nrm, [0.5, 0.5], color(p, nrm, i / (N - 1), j / radial))
    }
    for (let j = 0; j < radial; j++) {
      if (dir > 0) acc.tri(c, ring + j, ring + j + 1)
      else acc.tri(c, ring + j + 1, ring + j)
    }
  }
  cap(0, -1)
  cap(N - 1, 1)
}

/** Ellipsoid centred at c with radii r. */
export function emitEllipsoid(acc: MeshAcc, c: V3, r: V3, lat: number, lon: number, color: (p: V3, n: V3) => C4): void {
  const base = acc.count
  for (let i = 0; i <= lat; i++) {
    const th = (i / lat) * Math.PI
    for (let j = 0; j <= lon; j++) {
      const ph = (j / lon) * Math.PI * 2
      const d: V3 = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]
      const p: V3 = [c[0] + d[0] * r[0], c[1] + d[1] * r[1], c[2] + d[2] * r[2]]
      const n = norm([d[0] / r[0], d[1] / r[1], d[2] / r[2]], d)
      acc.vert(p, n, [j / lon, i / lat], color(p, n))
    }
  }
  const at = (i: number, j: number) => base + i * (lon + 1) + j
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const a = at(i, j)
      const b = at(i, j + 1)
      const cc = at(i + 1, j)
      const d = at(i + 1, j + 1)
      acc.tri(a, b, cc)
      acc.tri(b, d, cc)
    }
  }
}

/**
 * Flat soft ribbon along a polyline. `sides[i]` is the unit width direction at point i.
 * `profile` gives intensities across the width (first = one edge, last = the other edge);
 * `along(t)` scales intensity along the ribbon. Use with a two-sided additive material.
 */
export function emitRibbon(
  acc: MeshAcc,
  pts: V3[],
  sides: V3[],
  halfWidth: number,
  profile: number[],
  color: C4,
  along: (t: number) => number,
  normal: V3,
  alphaOnly: boolean = false,
): void {
  const N = pts.length
  const M = profile.length
  if (N < 2) return
  const base = acc.count
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1)
    const a = along(t)
    for (let k = 0; k < M; k++) {
      const off = -1 + (2 * k) / (M - 1)
      const p = add(pts[i], scl(sides[i], off * halfWidth))
      const s = profile[k] * a
      // alphaOnly: keep the hue solid and fade only alpha (for normal-blend strokes over bright tissue).
      const c: C4 = alphaOnly ? [color[0], color[1], color[2], color[3] * s] : [color[0] * s, color[1] * s, color[2] * s, color[3] * s]
      acc.vert(p, normal, [t, k / (M - 1)], c)
    }
  }
  for (let i = 0; i < N - 1; i++) {
    for (let k = 0; k < M - 1; k++) {
      const a = base + i * M + k
      const b = base + (i + 1) * M + k
      const c = base + i * M + k + 1
      const d = base + (i + 1) * M + k + 1
      acc.tri(a, b, c)
      acc.tri(b, d, c)
    }
  }
}

/** Width directions for a polyline lying in a plane with normal `pn` (side = pn × tangent). */
export function planarSides(pts: V3[], pn: V3): V3[] {
  const out: V3[] = []
  const N = pts.length
  for (let i = 0; i < N; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(N - 1, i + 1)]
    const t = norm(sub(b, a), [1, 0, 0])
    out.push(norm(cross(pn, t), [0, 1, 0]))
  }
  return out
}

/** Soft in-plane line between points (glow stroke). */
export function emitGlowLine(
  acc: MeshAcc,
  pts: V3[],
  pn: V3,
  halfWidth: number,
  color: C4,
  along: (t: number) => number = () => 1,
  profile: number[] = [0, 0.35, 1, 0.35, 0],
  alphaOnly: boolean = false,
): void {
  emitRibbon(acc, pts, planarSides(pts, pn), halfWidth, profile, color, along, pn, alphaOnly)
}

/** Points on a circle (or arc) centred at c spanned by unit axes u, v. */
export function circlePts(c: V3, u: V3, v: V3, r: number, a0: number, a1: number, n: number): V3[] {
  const out: V3[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push(add(c, add(scl(u, Math.cos(a) * r), scl(v, Math.sin(a) * r))))
  }
  return out
}

/** Straight segment a → b sampled into n pieces. */
export function segPts(a: V3, b: V3, n: number = 1): V3[] {
  const out: V3[] = []
  for (let i = 0; i <= n; i++) out.push(mix(a, b, i / n))
  return out
}

/** A flat disc with a radial falloff (glow dot), lying in the plane spanned by u, v. */
export function emitGlowDisc(acc: MeshAcc, c: V3, u: V3, v: V3, r: number, color: C4, seg: number = 20, falloff: number = 1.6): void {
  const nrm = norm(cross(u, v))
  const center = acc.vert(c, nrm, [0.5, 0.5], color)
  const rings = 3
  const base = acc.count
  for (let k = 1; k <= rings; k++) {
    const rr = (r * k) / rings
    const s = Math.pow(1 - k / rings, falloff)
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2
      const p = add(c, add(scl(u, Math.cos(a) * rr), scl(v, Math.sin(a) * rr)))
      acc.vert(p, nrm, [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)], mulC(color, s))
    }
  }
  for (let j = 0; j < seg; j++) acc.tri(center, base + j, base + j + 1)
  for (let k = 0; k < rings - 1; k++) {
    for (let j = 0; j < seg; j++) {
      const a = base + k * (seg + 1) + j
      const b = base + (k + 1) * (seg + 1) + j
      acc.tri(a, b, a + 1)
      acc.tri(a + 1, b, b + 1)
    }
  }
}

// ── colour helpers ──────────────────────────────────────────────────────────

export interface LightRig {
  key: V3
  keyI: number
  fill: V3
  fillI: number
  ambient: number
  view: V3
}

/** Baked lighting: albedo × (ambient + diffuse) + white-ish specular. */
export function shade(rig: LightRig, n: V3, albedo: V3, ks: number, shin: number, ao: number = 1): C4 {
  const d1 = Math.max(0, dot(n, rig.key))
  const d2 = Math.max(0, dot(n, rig.fill))
  const wrap = 0.5 + 0.5 * dot(n, rig.key) // soft wrap keeps shadow sides light (additive display)
  const diff = (rig.ambient + rig.keyI * (0.65 * d1 + 0.35 * wrap) + rig.fillI * d2) * ao
  const h = norm(add(rig.key, rig.view))
  const sp = ks * Math.pow(Math.max(0, dot(n, h)), shin)
  return [
    Math.min(1, albedo[0] * diff + sp),
    Math.min(1, albedo[1] * diff + sp),
    Math.min(1, albedo[2] * diff + sp * 0.97),
    1,
  ]
}

/**
 * Pseudo-chrome for a thin object viewed along +Z: rotation-invariant about Z, so a needle that
 * spins in the section plane keeps a believable reflection.
 */
export function chrome(n: V3, tint: V3 = [0.92, 0.96, 1.0]): C4 {
  const nz = Math.abs(n[2])
  const rz = 2 * nz * nz - 1 // reflected view vector's z
  // Studio-like environment: soft bright centre, hard highlight band, cool darker rim.
  let e = 0.62 + 0.22 * rz
  e += 0.55 * Math.exp(-Math.pow((rz - 0.25) / 0.16, 2))
  e += 0.25 * Math.exp(-Math.pow((rz + 0.55) / 0.18, 2))
  const rim = 1 - nz
  e = e * (1 - 0.25 * rim * rim)
  return [Math.min(1, tint[0] * e), Math.min(1, tint[1] * e), Math.min(1, tint[2] * e + 0.04), 1]
}

/** Hologram fresnel intensity: edges bright, faces facing the viewer dim. */
export function fresnel(n: V3, view: V3, base: number = 0.22, pow: number = 1.6): number {
  return base + (1 - base) * Math.pow(1 - Math.abs(dot(n, view)), pow)
}
