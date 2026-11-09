/**
 * GhostThread — a dynamic suture tube that follows a polyline every frame (plain class).
 *
 * Owns: one MeshBuilder with a fixed vertex/index budget (points × sides); `setPath` resamples
 * the given polyline to that many points and rewrites the vertices with parallel-transport
 * frames (no twisting). Bounded per-frame update — no rebuilds.
 * Must not: decide where the thread goes (the controller passes the path).
 */

export class GhostThread {
  readonly mesh: RenderMesh
  private builder: MeshBuilder
  private readonly n: number
  private readonly sides: number
  private radius: number
  private cosT: number[] = []
  private sinT: number[] = []

  constructor(points: number, sides: number, radius: number) {
    this.n = Math.max(2, points)
    this.sides = Math.max(3, sides)
    this.radius = radius
    for (let k = 0; k < this.sides; k++) {
      const th = (k / this.sides) * Math.PI * 2
      this.cosT.push(Math.cos(th))
      this.sinT.push(Math.sin(th))
    }
    this.builder = new MeshBuilder([
      {name: "position", components: 3},
      {name: "normal", components: 3, normalized: true},
    ])
    this.builder.topology = MeshTopology.Triangles
    this.builder.indexType = MeshIndexType.UInt16
    const verts: number[] = []
    for (let i = 0; i < this.n * this.sides; i++) verts.push(0, 0, i * 0.001, 0, 1, 0)
    this.builder.appendVerticesInterleaved(verts)
    const idx: number[] = []
    for (let i = 0; i < this.n - 1; i++) {
      for (let k = 0; k < this.sides; k++) {
        const k2 = (k + 1) % this.sides
        const a = i * this.sides + k
        const b = i * this.sides + k2
        const c = (i + 1) * this.sides + k2
        const d = (i + 1) * this.sides + k
        // (b - a) runs around the ring, (c - a) along the path: CCW seen from outside.
        idx.push(a, b, c, a, c, d)
      }
    }
    this.builder.appendIndices(idx)
    this.builder.updateMesh()
    this.mesh = this.builder.getMesh()
  }

  /** Rewrite the tube along `pts` (local space of the visual). Needs ≥ 2 distinct points. */
  setPath(pts: vec3[]): void {
    if (pts.length < 2) return
    const res = resample(pts, this.n)
    let up = vec3.up()
    for (let i = 0; i < this.n; i++) {
      const prev = res[Math.max(0, i - 1)]
      const next = res[Math.min(this.n - 1, i + 1)]
      let t = next.sub(prev)
      t = t.length > 1e-6 ? t.normalize() : vec3.forward()
      let u = up.sub(t.uniformScale(up.dot(t)))
      if (u.length < 1e-4) u = Math.abs(t.y) < 0.9 ? vec3.up() : vec3.right()
      u = u.normalize()
      up = u
      const side = t.cross(u)
      const taper = i === 0 || i === this.n - 1 ? 0.6 : 1
      for (let k = 0; k < this.sides; k++) {
        const nrm = u.uniformScale(this.cosT[k]).add(side.uniformScale(this.sinT[k]))
        const p = res[i].add(nrm.uniformScale(this.radius * taper))
        this.builder.setVertexInterleaved(i * this.sides + k, [p.x, p.y, p.z, nrm.x, nrm.y, nrm.z])
      }
    }
    this.builder.updateMesh()
  }
}

/** Resample a polyline to exactly n points evenly spaced by arc length. */
export function resample(pts: vec3[], n: number): vec3[] {
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distance(pts[i - 1]))
  const total = cum[cum.length - 1]
  const out: vec3[] = []
  if (total < 1e-6) {
    for (let i = 0; i < n; i++) out.push(pts[0].add(new vec3(0, 0, i * 1e-4)))
    return out
  }
  let j = 0
  for (let i = 0; i < n; i++) {
    const s = (total * i) / (n - 1)
    while (j < cum.length - 2 && cum[j + 1] < s) j++
    const seg = Math.max(1e-6, cum[j + 1] - cum[j])
    const u = Math.min(1, Math.max(0, (s - cum[j]) / seg))
    out.push(vec3.lerp(pts[j], pts[j + 1], u))
  }
  return out
}

/** Quadratic Bezier sampled into `count` points (a sagging thread span). */
export function bezier2(a: vec3, c: vec3, b: vec3, count: number): vec3[] {
  const out: vec3[] = []
  for (let i = 0; i <= count; i++) {
    const t = i / count
    const u = 1 - t
    out.push(a.uniformScale(u * u).add(c.uniformScale(2 * u * t)).add(b.uniformScale(t * t)))
  }
  return out
}

/** Cubic Bezier sampled into `count` points. */
export function bezier3(a: vec3, c1: vec3, c2: vec3, b: vec3, count: number): vec3[] {
  const out: vec3[] = []
  for (let i = 0; i <= count; i++) {
    const t = i / count
    const u = 1 - t
    out.push(
      a
        .uniformScale(u * u * u)
        .add(c1.uniformScale(3 * u * u * t))
        .add(c2.uniformScale(3 * u * t * t))
        .add(b.uniformScale(t * t * t)),
    )
  }
  return out
}
