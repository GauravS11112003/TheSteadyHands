/**
 * StageMeshKit — geometry helpers for the STAGE stand-in world (plain module, not a component).
 *
 * Owns:
 *  - MeshKit: an accumulator of vertices (position, normal, tangent, uv, colour) + triangles
 *    that turns into a RenderMesh via MeshBuilder (UInt16 indices, so ≤ 65 535 vertices).
 *  - Grid surfaces with smooth finite-difference normals + tangents, optional quad mask (holes).
 *  - Rounded boxes, capped tubes/cylinders swept along polylines, lathes.
 *  - Small deterministic noise used to vary cloth folds and tissue colour.
 *
 * Must not: touch the scene graph beyond creating the RenderMeshVisual it is asked to make,
 * or hold any app state. Units are cm in the caller's local frame.
 */

export type V3 = [number, number, number]
export type RGBA = [number, number, number, number]

export function v3(x: number, y: number, z: number): V3 {
  return [x, y, z]
}
export function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
export function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
export function scale(a: V3, k: number): V3 {
  return [a[0] * k, a[1] * k, a[2] * k]
}
export function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
export function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
export function norm(a: V3): V3 {
  const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]
}
export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x
}
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
/** Polynomial smooth max (k = blend width). */
export function smax(a: number, b: number, k: number): number {
  const h = clamp(0.5 + (0.5 * (a - b)) / k, 0, 1)
  return lerp(b, a, h) + k * h * (1 - h)
}

/** Deterministic hash → [0,1). */
export function hash1(i: number, seed: number): number {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
/** Smooth 1D value noise in [-1,1]. */
export function noise1(x: number, seed: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return (lerp(hash1(i, seed), hash1(i + 1, seed), u) - 0.5) * 2
}
/** Smooth 2D value noise in [-1,1]. */
export function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const h = (a: number, b: number) => hash1(a * 7919 + b * 104729, seed)
  const a = h(xi, yi)
  const b = h(xi + 1, yi)
  const c = h(xi, yi + 1)
  const d = h(xi + 1, yi + 1)
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy - 0.5) * 2
}

const WHITE: RGBA = [1, 1, 1, 1]

export class MeshKit {
  readonly pos: number[] = []
  readonly nrm: number[] = []
  readonly tan: number[] = []
  readonly uv: number[] = []
  readonly col: number[] = []
  readonly idx: number[] = []

  get vertexCount(): number {
    return this.pos.length / 3
  }
  get triangleCount(): number {
    return this.idx.length / 3
  }

  vertex(p: V3, n: V3, uv: [number, number], t: V3 = [1, 0, 0], tw: number = 1, c: RGBA = WHITE): number {
    const i = this.vertexCount
    this.pos.push(p[0], p[1], p[2])
    this.nrm.push(n[0], n[1], n[2])
    this.tan.push(t[0], t[1], t[2], tw)
    this.uv.push(uv[0], uv[1])
    this.col.push(c[0], c[1], c[2], c[3])
    return i
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c)
  }

  /**
   * A grid surface. P[j][i] (rows j along v, columns i along u). Front face = along dPu × dPv
   * unless `flip`. Normals/tangents from central differences on the grid (smooth).
   * `keepQuad(i, j)` can drop quads (holes). `colorAt(i, j)` gives per-vertex colour.
   */
  grid(
    P: V3[][],
    UV: [number, number][][],
    opts: {
      flip?: boolean
      keepQuad?: (i: number, j: number) => boolean
      colorAt?: (i: number, j: number) => RGBA
      normalOverride?: (i: number, j: number, n: V3) => V3
    } = {},
  ): void {
    const nv = P.length
    const nu = P[0].length
    const base = this.vertexCount
    const flip = !!opts.flip
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const iu0 = Math.max(0, i - 1)
        const iu1 = Math.min(nu - 1, i + 1)
        const jv0 = Math.max(0, j - 1)
        const jv1 = Math.min(nv - 1, j + 1)
        const du = sub(P[j][iu1], P[j][iu0])
        const dv = sub(P[jv1][i], P[jv0][i])
        let n = norm(cross(du, dv))
        if (flip) n = scale(n, -1)
        if (opts.normalOverride) n = opts.normalOverride(i, j, n)
        // tangent = dP/du orthogonalised against n; handedness from dP/dv
        const uvU = sub3uv(UV[j][iu1], UV[j][iu0])
        let t = norm(sub(du, scale(n, dot(du, n))))
        if (uvU < 0) t = scale(t, -1)
        const b = cross(n, t)
        const uvV = UV[jv1][i][1] - UV[jv0][i][1]
        const tw = dot(b, dv) * (uvV >= 0 ? 1 : -1) >= 0 ? 1 : -1
        const c = opts.colorAt ? opts.colorAt(i, j) : WHITE
        this.vertex(P[j][i], n, UV[j][i], t, tw, c)
      }
    }
    for (let j = 0; j < nv - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        if (opts.keepQuad && !opts.keepQuad(i, j)) continue
        const a = base + j * nu + i
        const b = a + 1
        const c = a + nu + 1
        const d = a + nu
        if (!flip) {
          this.tri(a, b, c)
          this.tri(a, c, d)
        } else {
          this.tri(a, c, b)
          this.tri(a, d, c)
        }
      }
    }
  }

  /** Rounded box centred at c with full size s and corner radius r; `seg` subdivisions per face. */
  roundedBox(c: V3, s: V3, r: number, seg: number = 6, color: RGBA = WHITE, uvScale: number = 0.05, arcSegs: number = 4): void {
    const hx = s[0] / 2 - r
    const hy = s[1] / 2 - r
    const hz = s[2] / 2 - r
    // 6 faces of a cube in [-1,1]^3: (normal axis, u axis, v axis) chosen so u × v = outward
    const faces: [V3, V3, V3][] = [
      [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
      [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
      [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ]
    // Face parameter in [-2,2]: |p| ≤ 1 is the flat face, 1 < |p| ≤ 2 bends 90° round the edge.
    const arcN = r > 0 ? Math.max(1, arcSegs) : 1
    const params: number[] = []
    // map: values in [-1,1]; arc region of the face maps to the rounded corner.
    for (let k = 0; k <= arcN; k++) params.push(-1 - 1 + k / arcN) // -2..-1 → arc
    for (let k = 1; k < seg; k++) params.push(-1 + (2 * k) / seg) // flat interior
    for (let k = 0; k <= arcN; k++) params.push(1 + k / arcN) // 1..2 → arc
    const halfs: V3 = [hx, hy, hz]
    for (const [nA, uA, vA] of faces) {
      const P: V3[][] = []
      const UV: [number, number][][] = []
      for (const pv of params) {
        const row: V3[] = []
        const uvRow: [number, number][] = []
        for (const pu of params) {
          // point on an "extended cube": flat part maps to the box face, arc part bends around
          const fu = clamp(pu, -1, 1)
          const fv = clamp(pv, -1, 1)
          const au = (Math.abs(pu) - 1) * (pu < 0 ? -1 : 1) // -1..1 beyond face
          const av = (Math.abs(pv) - 1) * (pv < 0 ? -1 : 1)
          const eu = Math.abs(pu) > 1 ? au : 0
          const ev = Math.abs(pv) > 1 ? av : 0
          // inner point on the core box
          const q: V3 = [0, 0, 0]
          for (let k = 0; k < 3; k++) q[k] = (nA[k] + uA[k] * fu + vA[k] * fv) * halfs[k]
          // direction from core: cube-sphere mapping so neighbouring faces share their seams
          const d = norm(add(add(nA, scale(uA, eu)), scale(vA, ev)))
          const p = add(add(c, q), scale(d, r))
          row.push(p)
          // planar uv by dominant axes
          uvRow.push([dot(p, uA) * uvScale, dot(p, vA) * uvScale])
        }
        P.push(row)
        UV.push(uvRow)
      }
      // normals for a rounded box are exact: direction from the clamped core point
      const nOv = (i: number, j: number, _n: V3): V3 => {
        const p = P[j][i]
        const qq: V3 = [
          clamp(p[0] - c[0], -hx, hx) + c[0],
          clamp(p[1] - c[1], -hy, hy) + c[1],
          clamp(p[2] - c[2], -hz, hz) + c[2],
        ]
        const dd = sub(p, qq)
        const l = Math.sqrt(dot(dd, dd))
        return l > 1e-6 ? scale(dd, 1 / l) : nA
      }
      this.grid(P, UV, {colorAt: () => color, normalOverride: nOv})
    }
  }

  /** A tube of radius r swept along polyline pts (smooth frames), optional end caps. */
  tube(pts: V3[], r: number | number[], sides: number = 12, caps: boolean = true, color: RGBA = WHITE): void {
    const n = pts.length
    const radii = typeof r === "number" ? pts.map(() => r) : r
    const P: V3[][] = []
    const UV: [number, number][][] = []
    let up: V3 = [0, 1, 0]
    let len = 0
    for (let j = 0; j < n; j++) {
      const t = norm(sub(pts[Math.min(n - 1, j + 1)], pts[Math.max(0, j - 1)]))
      if (Math.abs(dot(t, up)) > 0.95) up = [1, 0, 0]
      const bx = norm(cross(up, t))
      const by = cross(t, bx)
      up = by
      if (j > 0) len += Math.sqrt(dot(sub(pts[j], pts[j - 1]), sub(pts[j], pts[j - 1])))
      const row: V3[] = []
      const uvRow: [number, number][] = []
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2
        const d = add(scale(bx, Math.cos(a)), scale(by, Math.sin(a)))
        row.push(add(pts[j], scale(d, radii[j])))
        uvRow.push([i / sides, len * 0.05])
      }
      P.push(row)
      UV.push(uvRow)
    }
    // rows along the path (v), columns around (u): frame (bx, by, t) is right-handed, so
    // dPu × dPv points outward — no flip.
    this.grid(P, UV, {
      colorAt: () => color,
      normalOverride: (i, j) => norm(sub(P[j][i], pts[j])),
    })
    if (caps) {
      for (const end of [0, n - 1]) {
        const t = norm(end === 0 ? sub(pts[0], pts[1]) : sub(pts[n - 1], pts[n - 2]))
        const center = this.vertex(pts[end], t, [0.5, 0.5], [1, 0, 0], 1, color)
        const ring: number[] = []
        for (let i = 0; i <= sides; i++) ring.push(this.vertex(P[end][i], t, [0.5, 0.5], [1, 0, 0], 1, color))
        for (let i = 0; i < sides; i++) {
          const a = ring[i]
          const b = ring[i + 1]
          const nrm = cross(sub(P[end][i + 1], pts[end]), sub(P[end][i], pts[end]))
          if (dot(nrm, t) >= 0) this.tri(center, b, a)
          else this.tri(center, a, b)
        }
      }
    }
  }

  /** Surface of revolution about +Y through `c`: profile [radius, y] pairs from bottom to top. */
  lathe(c: V3, profile: [number, number][], sides: number = 24, color: RGBA = WHITE): void {
    const P: V3[][] = []
    const UV: [number, number][][] = []
    for (let j = 0; j < profile.length; j++) {
      const [rr, y] = profile[j]
      const row: V3[] = []
      const uvRow: [number, number][] = []
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2
        row.push([c[0] + Math.cos(a) * rr, c[1] + y, c[2] - Math.sin(a) * rr])
        uvRow.push([i / sides, y * 0.05])
      }
      P.push(row)
      UV.push(uvRow)
    }
    this.grid(P, UV, {colorAt: () => color})
  }

  /** Build the RenderMesh. */
  build(withTangents: boolean = true): RenderMesh {
    const layout: any[] = [
      {name: "position", components: 3},
      {name: "normal", components: 3, normalized: true},
    ]
    if (withTangents) layout.push({name: "tangent", components: 4})
    layout.push({name: "texture0", components: 2})
    layout.push({name: "color", components: 4})
    const mb = new MeshBuilder(layout)
    mb.topology = MeshTopology.Triangles
    mb.indexType = MeshIndexType.UInt16
    const nV = this.vertexCount
    const stride = 3 + 3 + (withTangents ? 4 : 0) + 2 + 4
    const data: number[] = new Array(nV * stride)
    let o = 0
    for (let i = 0; i < nV; i++) {
      data[o++] = this.pos[i * 3]
      data[o++] = this.pos[i * 3 + 1]
      data[o++] = this.pos[i * 3 + 2]
      data[o++] = this.nrm[i * 3]
      data[o++] = this.nrm[i * 3 + 1]
      data[o++] = this.nrm[i * 3 + 2]
      if (withTangents) {
        data[o++] = this.tan[i * 4]
        data[o++] = this.tan[i * 4 + 1]
        data[o++] = this.tan[i * 4 + 2]
        data[o++] = this.tan[i * 4 + 3]
      }
      data[o++] = this.uv[i * 2]
      data[o++] = this.uv[i * 2 + 1]
      data[o++] = this.col[i * 4]
      data[o++] = this.col[i * 4 + 1]
      data[o++] = this.col[i * 4 + 2]
      data[o++] = this.col[i * 4 + 3]
    }
    mb.appendVerticesInterleaved(data)
    mb.appendIndices(this.idx)
    mb.updateMesh()
    return mb.getMesh()
  }
}

function sub3uv(a: [number, number], b: [number, number]): number {
  return a[0] - b[0]
}

/** Create a child SceneObject with a RenderMeshVisual showing `kit` with `material`. */
export function addMeshObject(
  parent: SceneObject,
  name: string,
  kit: MeshKit,
  material: Material,
  shadow: MeshShadowMode = MeshShadowMode.None,
): SceneObject {
  if (kit.vertexCount > 65535) {
    throw new Error(name + ": " + kit.vertexCount + " vertices exceeds UInt16 indices")
  }
  const so = global.scene.createSceneObject(name)
  so.setParent(parent)
  const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  let mesh: RenderMesh
  try {
    mesh = kit.build(true)
  } catch (e) {
    print("StageMeshKit: tangent layout rejected (" + e + "), building without tangents")
    mesh = kit.build(false)
  }
  rmv.mesh = mesh
  if (material) rmv.mainMaterial = material
  rmv.meshShadowMode = shadow
  return so
}
