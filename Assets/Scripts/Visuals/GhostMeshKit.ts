/**
 * GhostMeshKit — procedural mesh helpers for the ghost attending's instruments, sleeves and
 * thread (plain module, runtime MeshBuilder).
 *
 * Owns: a MeshKit wrapper (position + normal layout, auto-wound triangles so faces always
 * point along their normals) with sweeps of a rounded (super-ellipse) cross-section along a
 * 3D path, oriented boxes and capped ends.
 * Must not: hold scene state or materials.
 */

export interface SweepOpts {
  /** Half size of the section along the frame's "up" axis, per path point. */
  halfUp: number[]
  /** Half size of the section along the frame's "side" axis, per path point. */
  halfSide: number[]
  /** Up reference (section axis); a single vector or one per path point. */
  up: vec3 | vec3[]
  /** Segments around the section. */
  sides: number
  /** Super-ellipse exponent: 2 = ellipse, 4+ = rounded rectangle. */
  power?: number
  capStart?: boolean
  capEnd?: boolean
  /** Path is a closed loop (rings). */
  loop?: boolean
  /** Optional radial modulation (θ, i) → multiplier, e.g. sleeve folds. */
  modulate?: (theta: number, i: number) => number
}

export class MeshKit {
  readonly builder: MeshBuilder
  private count = 0
  private idx: number[] = []
  private verts: number[] = []

  constructor() {
    this.builder = new MeshBuilder([
      {name: "position", components: 3},
      {name: "normal", components: 3, normalized: true},
    ])
    this.builder.topology = MeshTopology.Triangles
    this.builder.indexType = MeshIndexType.UInt16
  }

  get vertexCount(): number {
    return this.count
  }

  vert(p: vec3, n: vec3): number {
    const nn = n.length > 1e-6 ? n.normalize() : vec3.up()
    this.verts.push(p.x, p.y, p.z, nn.x, nn.y, nn.z)
    return this.count++
  }

  private pos(i: number): vec3 {
    return new vec3(this.verts[i * 6], this.verts[i * 6 + 1], this.verts[i * 6 + 2])
  }

  private nrm(i: number): vec3 {
    return new vec3(this.verts[i * 6 + 3], this.verts[i * 6 + 4], this.verts[i * 6 + 5])
  }

  /** Triangle wound so its face normal agrees with the vertex normals (CCW seen from outside). */
  tri(a: number, b: number, c: number): void {
    const pa = this.pos(a)
    const face = this.pos(b).sub(pa).cross(this.pos(c).sub(pa))
    const avg = this.nrm(a).add(this.nrm(b)).add(this.nrm(c))
    if (face.dot(avg) >= 0) this.idx.push(a, b, c)
    else this.idx.push(a, c, b)
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c)
    this.tri(a, c, d)
  }

  /** Sweep a rounded section along `path`. Returns the first vertex index of the rings. */
  sweep(path: vec3[], o: SweepOpts): number {
    const n = path.length
    const sides = Math.max(3, o.sides)
    const pw = o.power ?? 2
    const loop = !!o.loop
    const frames = sweepFrames(path, o.up, loop)
    // Unit section (super-ellipse) + 2D normals.
    const sec: number[][] = []
    for (let k = 0; k < sides; k++) {
      const th = (k / sides) * Math.PI * 2
      const c = Math.cos(th)
      const s = Math.sin(th)
      const e = 2 / pw
      sec.push([Math.sign(c) * Math.pow(Math.abs(c), e), Math.sign(s) * Math.pow(Math.abs(s), e), th])
    }
    const start = this.count
    for (let i = 0; i < n; i++) {
      const f = frames[i]
      const a = o.halfUp[Math.min(i, o.halfUp.length - 1)]
      const b = o.halfSide[Math.min(i, o.halfSide.length - 1)]
      for (let k = 0; k < sides; k++) {
        const m = o.modulate ? o.modulate(sec[k][2], i) : 1
        const u = sec[k][0] * a * m
        const v = sec[k][1] * b * m
        // 2D normal from neighbours on the section.
        const kp = sec[(k + 1) % sides]
        const km = sec[(k + sides - 1) % sides]
        const tu = (kp[0] - km[0]) * a
        const tv = (kp[1] - km[1]) * b
        let nu = tv
        let nv = -tu
        if (nu * u + nv * v < 0) {
          nu = -nu
          nv = -nv
        }
        const p = path[i].add(f.up.uniformScale(u)).add(f.side.uniformScale(v))
        const nn = f.up.uniformScale(nu).add(f.side.uniformScale(nv))
        this.vert(p, nn)
      }
    }
    const segs = loop ? n : n - 1
    for (let i = 0; i < segs; i++) {
      const i2 = (i + 1) % n
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides
        this.quad(start + i * sides + k, start + i * sides + k2, start + i2 * sides + k2, start + i2 * sides + k)
      }
    }
    if (!loop && o.capStart) this.cap(start, sides, path[0], frames[0].t.uniformScale(-1))
    if (!loop && o.capEnd) this.cap(start + (n - 1) * sides, sides, path[n - 1], frames[n - 1].t)
    return start
  }

  /** Flat cap over a ring of `sides` vertices starting at `ring`. */
  private cap(ring: number, sides: number, center: vec3, normal: vec3): void {
    const c = this.vert(center, normal)
    const ids: number[] = []
    for (let k = 0; k < sides; k++) ids.push(this.vert(this.pos(ring + k), normal))
    for (let k = 0; k < sides; k++) this.tri(c, ids[k], ids[(k + 1) % sides])
  }

  /** Oriented box: centre, half extents along the given (orthonormal) axes. */
  box(center: vec3, half: vec3, ax: vec3 = vec3.right(), ay: vec3 = vec3.up(), az: vec3 = vec3.forward()): void {
    const faces: [vec3, vec3, vec3, number, number, number][] = [
      [ax, ay, az, half.x, half.y, half.z],
      [ax.uniformScale(-1), ay, az, half.x, half.y, half.z],
      [ay, az, ax, half.y, half.z, half.x],
      [ay.uniformScale(-1), az, ax, half.y, half.z, half.x],
      [az, ax, ay, half.z, half.x, half.y],
      [az.uniformScale(-1), ax, ay, half.z, half.x, half.y],
    ]
    for (const [n, u, v, hn, hu, hv] of faces) {
      const c = center.add(n.uniformScale(hn))
      const a = this.vert(c.add(u.uniformScale(-hu)).add(v.uniformScale(-hv)), n)
      const b = this.vert(c.add(u.uniformScale(hu)).add(v.uniformScale(-hv)), n)
      const d = this.vert(c.add(u.uniformScale(hu)).add(v.uniformScale(hv)), n)
      const e = this.vert(c.add(u.uniformScale(-hu)).add(v.uniformScale(hv)), n)
      this.quad(a, b, d, e)
    }
  }

  /** Short cylinder (screw heads, pins) along `axis`. */
  cylinder(center: vec3, axis: vec3, radius: number, halfLen: number, sides: number = 12): void {
    const ax = axis.normalize()
    const p0 = center.sub(ax.uniformScale(halfLen))
    const p1 = center.add(ax.uniformScale(halfLen))
    const up = Math.abs(ax.y) < 0.9 ? vec3.up() : vec3.right()
    this.sweep([p0, p1], {halfUp: [radius], halfSide: [radius], up, sides, capStart: true, capEnd: true})
  }

  finish(): RenderMesh {
    this.builder.appendVerticesInterleaved(this.verts)
    this.builder.appendIndices(this.idx)
    this.builder.updateMesh()
    return this.builder.getMesh()
  }
}

export interface Frame {
  t: vec3
  up: vec3
  side: vec3
}

/** Tangent frames along a path with a per-point (or global) up reference. */
export function sweepFrames(path: vec3[], up: vec3 | vec3[], loop: boolean): Frame[] {
  const n = path.length
  const out: Frame[] = []
  for (let i = 0; i < n; i++) {
    let prev = i > 0 ? path[i - 1] : loop ? path[n - 1] : path[i]
    let next = i < n - 1 ? path[i + 1] : loop ? path[0] : path[i]
    let t = next.sub(prev)
    if (t.length < 1e-6) t = vec3.forward()
    t = t.normalize()
    const ref = Array.isArray(up) ? up[Math.min(i, up.length - 1)] : up
    let u = ref.sub(t.uniformScale(ref.dot(t)))
    if (u.length < 1e-5) u = Math.abs(t.y) < 0.9 ? vec3.up() : vec3.right()
    u = u.normalize()
    out.push({t, up: u, side: t.cross(u).normalize()})
  }
  return out
}

/** Points along a quadratic/cubic-ish smooth path through control points (Catmull-Rom). */
export function smoothPath(ctrl: vec3[], perSeg: number): vec3[] {
  const out: vec3[] = []
  const n = ctrl.length
  for (let i = 0; i < n - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)]
    const p1 = ctrl[i]
    const p2 = ctrl[i + 1]
    const p3 = ctrl[Math.min(n - 1, i + 2)]
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push(new vec3(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z)))
    }
  }
  out.push(ctrl[n - 1])
  return out
}

/** Linear resample of a per-control-point profile onto a smoothPath output. */
export function smoothProfile(values: number[], perSeg: number): number[] {
  const out: number[] = []
  for (let i = 0; i < values.length - 1; i++) {
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg
      const u = t * t * (3 - 2 * t)
      out.push(values[i] + (values[i + 1] - values[i]) * u)
    }
  }
  out.push(values[values.length - 1])
  return out
}
