/**
 * GhostInstruments — procedural meshes for the ghost attending's instruments and sleeves
 * (plain module; MeshBuilder via GhostMeshKit). Real sizes in cm.
 *
 * Owns the geometry and the local frames each piece is built in:
 *  - Mayo-Hegar needle driver (~14.7 cm): built as two halves that pivot at the box lock.
 *    Driver frame: +X along the shaft toward the jaw tip (tip at x = 0), +Y = jaw opening
 *    direction, +Z = through the jaws (the needle's tangent at the clamp). Each half's mesh is
 *    relative to the box-lock pivot at driver (-2.25, 0, 0). Half "A" = upper jaw (+Y) and the
 *    lower (-Y) ring; half "B" mirrors it.
 *  - Adson tissue forceps (~12.4 cm): two spring arms joined at the butt. Forceps frame: +X
 *    toward the tips (tips at x = 0), arms open along ±Y, broad along Z. Each arm's mesh is
 *    relative to the butt pivot at forceps (-12, 0, 0).
 *  - 3/8-circle curved needle: circle centre at the origin in the local YZ plane (axis +X), tip
 *    at (0, 0, R) travelling toward +Y; body for α ∈ [-135°, 0] at (0, R sin α, R cos α).
 *  - Gown sleeve + gloved forearm: origin at the wrist, +Z back toward the elbow, +Y dorsal.
 * Must not: create scene objects or materials (the controller does that).
 */
import {MeshKit, smoothPath, smoothProfile} from "./GhostMeshKit"

export const DRIVER_PIVOT_X = -2.25
export const FORCEPS_PIVOT_X = -12.0
export const NEEDLE_ARC_DEG = 135

function v(x: number, y: number, z: number): vec3 {
  return new vec3(x, y, z)
}

/** One half of the Mayo-Hegar needle driver. s = +1 → half A (upper jaw, lower ring). */
export function buildDriverHalf(s: number): RenderMesh {
  const k = new MeshKit()
  const P = (x: number, y: number, z: number) => v(x - DRIVER_PIVOT_X, y, z)
  // Jaw: short, tapering from the box lock to a blunt tip; gripping faces meet at y = 0.
  const jawX = [0.0, -0.25, -0.7, -1.2, -1.7, -2.25]
  const jawH = jawX.map((x) => 0.055 + 0.065 * (-x / 2.25)) // half height
  const jawW = jawX.map((x) => 0.095 + 0.115 * (-x / 2.25)) // half width
  const jawPath = jawX.map((x, i) => P(x, s * (jawH[i] + 0.004), 0))
  k.sweep(jawPath, {halfUp: jawH, halfSide: jawW, up: vec3.up(), sides: 16, power: 3.2, capStart: true, capEnd: false})
  // Serrations on the jaw face: fine transverse ridges (catch the rim light).
  for (let i = 0; i < 7; i++) {
    const x = -0.15 - i * 0.26
    const h = 0.055 + 0.065 * (-x / 2.25)
    k.box(P(x, s * (h * 2 + 0.006), 0), v(0.03, 0.012, 0.09 + 0.1 * (-x / 2.25)))
  }
  // Box lock (outer box on A, inner tongue on B) + screw heads.
  if (s > 0) {
    k.box(P(DRIVER_PIVOT_X, 0, 0), v(0.44, 0.27, 0.29))
    k.cylinder(P(DRIVER_PIVOT_X, 0, 0.3), vec3.forward(), 0.13, 0.025, 14)
    k.cylinder(P(DRIVER_PIVOT_X, 0, -0.3), vec3.forward(), 0.13, 0.025, 14)
  } else {
    k.box(P(DRIVER_PIVOT_X, 0, 0), v(0.4, 0.24, 0.2))
  }
  // Shank: from the back of the box lock to the ring, crossing to the opposite side.
  const shankCtrl = [P(-2.6, 0, 0), P(-4.6, -s * 0.13, 0), P(-8.0, -s * 0.38, 0), P(-10.6, -s * 0.6, 0), P(-12.6, -s * 0.76, 0)]
  const per = 5
  const shank = smoothPath(shankCtrl, per)
  k.sweep(shank, {
    halfUp: smoothProfile([0.15, 0.14, 0.13, 0.125, 0.12], per),
    halfSide: smoothProfile([0.19, 0.17, 0.155, 0.145, 0.14], per),
    up: vec3.up(),
    sides: 14,
    power: 3.0,
    capStart: true,
    capEnd: true,
  })
  // Ratchet: a toothed bar on the inner side of the shank, offset in z so the two interlock.
  const rz = s * 0.075
  k.box(P(-10.75, -s * 0.43, rz), v(0.62, 0.075, 0.07))
  for (let i = 0; i < 4; i++) {
    const x = -11.2 + i * 0.3
    const c = P(x, -s * 0.31, rz)
    const a = (s * 35 * Math.PI) / 180
    const ax = v(Math.cos(a), Math.sin(a), 0)
    const ay = v(-Math.sin(a), Math.cos(a), 0)
    k.box(c, v(0.08, 0.09, 0.07), ax, ay, vec3.forward())
  }
  // Finger ring (slightly oval) in the XY plane.
  const ring: vec3[] = []
  const rc = P(-13.5, -s * 1.25, 0)
  for (let i = 0; i < 30; i++) {
    const t = (i / 30) * Math.PI * 2
    ring.push(rc.add(v(Math.cos(t) * 0.98, Math.sin(t) * 1.08, 0)))
  }
  k.sweep(ring, {halfUp: [0.16], halfSide: [0.2], up: vec3.forward(), sides: 10, power: 2.4, loop: true})
  return k.finish()
}

/** One arm of the Adson forceps. s = +1 → arm at +Y (carries the butt block). */
export function buildForcepsArm(s: number): RenderMesh {
  const k = new MeshKit()
  const P = (x: number, y: number, z: number) => v(x - FORCEPS_PIVOT_X, y, z)
  const xs = [-12.25, -11.0, -9.0, -6.5, -4.4, -3.6, -2.0, -0.6, 0.0]
  const ys = [0.07, 0.22, 0.42, 0.5, 0.44, 0.36, 0.18, 0.075, 0.05]
  const halfT = [0.065, 0.065, 0.065, 0.065, 0.062, 0.058, 0.052, 0.046, 0.044]
  const halfW = [0.32, 0.36, 0.43, 0.46, 0.44, 0.17, 0.12, 0.08, 0.06]
  const per = 4
  const path = smoothPath(
    xs.map((x, i) => P(x, s * ys[i], 0)),
    per,
  )
  k.sweep(path, {
    halfUp: smoothProfile(halfT, per),
    halfSide: smoothProfile(halfW, per),
    up: vec3.up(),
    sides: 14,
    power: 4.0,
    capStart: true,
    capEnd: true,
  })
  // Grip ridges on the outer face.
  for (let i = 0; i < 12; i++) {
    const x = -8.3 + i * 0.3
    const t = (x + 9.0) / 2.5
    const y = 0.42 + (0.5 - 0.42) * Math.min(1, Math.max(0, t)) - (x > -6.5 ? ((x + 6.5) / 2.1) * 0.06 : 0)
    k.box(P(x, s * (y + 0.07), 0), v(0.045, 0.028, 0.4))
  }
  // Fine serrations at the tips (inner face).
  for (let i = 0; i < 6; i++) {
    const x = -0.12 - i * 0.14
    const y = 0.05 + (0.075 - 0.05) * (-x / 0.6)
    k.box(P(x, s * (y - 0.045), 0), v(0.025, 0.014, 0.055))
  }
  if (s > 0) {
    // Butt: the welded spring end joining both arms.
    k.box(P(-12.35, 0, 0), v(0.16, 0.13, 0.32))
  }
  return k.finish()
}

/** 3/8-circle needle of radius R (cm), wire radius rw, centre at the origin. */
export function buildNeedle(R: number, rw: number): RenderMesh {
  const k = new MeshKit()
  const n = 40
  const path: vec3[] = []
  const radii: number[] = []
  for (let i = 0; i <= n; i++) {
    const aDeg = -NEEDLE_ARC_DEG + (NEEDLE_ARC_DEG * i) / n
    const a = (aDeg * Math.PI) / 180
    path.push(v(0, R * Math.sin(a), R * Math.cos(a)))
    let r = rw
    if (aDeg < -127) r = rw * 1.25 // swage
    const tipSpan = 28
    if (aDeg > -tipSpan) r = Math.max(0.0025, rw * Math.pow(-aDeg / tipSpan, 0.75))
    radii.push(r)
  }
  k.sweep(path, {halfUp: radii, halfSide: radii, up: vec3.right(), sides: 8, capStart: true, capEnd: true})
  return k.finish()
}

/** Needle-local point at arc angle α (degrees; 0 = tip, -135 = swage end). */
export function needlePoint(R: number, aDeg: number): vec3 {
  const a = (aDeg * Math.PI) / 180
  return v(0, R * Math.sin(a), R * Math.cos(a))
}

/** Needle-local unit tangent (direction of travel) at arc angle α (degrees). */
export function needleTangent(aDeg: number): vec3 {
  const a = (aDeg * Math.PI) / 180
  return v(0, Math.cos(a), -Math.sin(a))
}

/** Gloved forearm + gown sleeve. Origin at the wrist, +Z toward the elbow, +Y dorsal. */
export function buildSleeve(): RenderMesh {
  const k = new MeshKit()
  const zs = [-2.0, 0, 2, 4, 6, 7.0, 7.7, 8.4, 10, 14, 18, 22, 26, 30, 34]
  const hx = [2.2, 2.7, 2.8, 2.95, 3.1, 3.45, 3.5, 3.25, 3.95, 4.25, 4.45, 4.6, 4.75, 4.85, 4.9]
  const hy = [1.45, 1.8, 1.9, 2.05, 2.2, 2.6, 2.65, 2.45, 3.25, 3.5, 3.7, 3.85, 4.0, 4.1, 4.15]
  const path = zs.map((z) => v(0, 0, z))
  k.sweep(path, {
    halfUp: hy,
    halfSide: hx,
    up: vec3.up(),
    sides: 28,
    power: 2.2,
    capStart: false,
    capEnd: false,
    modulate: (th, i) => (i >= 8 ? 1 + 0.055 * Math.sin(5 * th + i * 1.3) * Math.min(1, (i - 7) / 3) : 1),
  })
  return k.finish()
}
