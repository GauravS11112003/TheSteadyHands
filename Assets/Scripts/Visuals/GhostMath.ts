/**
 * GhostMath — small rigid-transform + easing helpers for the ghost attending (plain module).
 *
 * Owns: a Pose (position + rotation) type with compose / inverse / lerp, basis → quat,
 * and the easing curves the choreography uses. All angles in radians unless named *Deg.
 * Must not: touch the scene.
 */

export const DEG = Math.PI / 180

export class Pose {
  constructor(
    public p: vec3,
    public q: quat,
  ) {}

  static identity(): Pose {
    return new Pose(vec3.zero(), quat.quatIdentity())
  }

  /** this ∘ child: child expressed in this pose's frame → parent frame. */
  mul(child: Pose): Pose {
    return new Pose(this.p.add(this.q.multiplyVec3(child.p)), this.q.multiply(child.q))
  }

  inverse(): Pose {
    const qi = this.q.invert()
    return new Pose(qi.multiplyVec3(this.p).uniformScale(-1), qi)
  }

  point(v: vec3): vec3 {
    return this.p.add(this.q.multiplyVec3(v))
  }

  dir(v: vec3): vec3 {
    return this.q.multiplyVec3(v)
  }

  static lerp(a: Pose, b: Pose, t: number): Pose {
    return new Pose(vec3.lerp(a.p, b.p, t), quat.slerp(a.q, b.q, t))
  }
}

/** Rotation whose local X/Y/Z axes map to the given (orthonormalised) x and y directions. */
export function basisQuat(x: vec3, yHint: vec3): quat {
  const X = x.normalize()
  let Y = yHint.sub(X.uniformScale(yHint.dot(X)))
  if (Y.length < 1e-5) Y = Math.abs(X.y) < 0.9 ? vec3.up() : vec3.right()
  Y = Y.normalize()
  const Z = X.cross(Y).normalize()
  const m = new mat3()
  m.column0 = X
  m.column1 = Y
  m.column2 = Z
  return quat.fromRotationMat(m)
}

export function v3(x: number, y: number, z: number): vec3 {
  return new vec3(x, y, z)
}

export function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t))
}

export function smooth01(t: number): number {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}

export function smoother01(t: number): number {
  const c = clamp01(t)
  return c * c * c * (c * (c * 6 - 15) + 10)
}

/** Ease-out with a gentle overshoot (for small settle motions). */
export function easeOutBack(t: number, s: number = 1.2): number {
  const c = clamp01(t) - 1
  return 1 + c * c * ((s + 1) * c + s)
}

/** 0→1 progress of t inside [a, b], smoothed. */
export function phase(t: number, a: number, b: number): number {
  return smoother01((t - a) / Math.max(1e-4, b - a))
}

export function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Pose keyframe track with smooth (C1) interpolation between keys. */
export interface PoseKey {
  t: number
  pose: Pose
}

export function sampleTrack(keys: PoseKey[], t: number): Pose {
  if (keys.length === 0) return Pose.identity()
  if (t <= keys[0].t) return keys[0].pose
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t <= b.t) {
      const u = smoother01((t - a.t) / Math.max(1e-4, b.t - a.t))
      return Pose.lerp(a.pose, b.pose, u)
    }
  }
  return keys[keys.length - 1].pose
}

/** Catmull-Rom through points (uniform), for smooth flight paths. */
export function catmull(p0: vec3, p1: vec3, p2: vec3, p3: vec3, t: number): vec3 {
  const t2 = t * t
  const t3 = t2 * t
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  return new vec3(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z))
}
