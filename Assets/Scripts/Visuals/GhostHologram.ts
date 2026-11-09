/**
 * GhostHologram — Tint-compatible fader for the ghost attending's hologram materials
 * (plain class; same setLevel/getLevel/setColor API as SteadyHandsVisuals.Tint so tests and
 * Main can read `ghost.tints[0].getLevel()`).
 *
 * Owns: a set of cloned GhostHologram materials (Assets/Shaders/Ghost/GhostHologram) and the
 * shared fade level / core colour pushed into their `level` / `coreColor` parameters, plus
 * helpers for the world-space fade sphere and the skin clip plane.
 * Must not: decide timing — the controller calls setLevel.
 */

export class GhostGlow {
  readonly materials: Material[] = []
  private gains: number[] = []
  private tintColor: boolean[] = []
  private level = 1
  private color: vec4

  constructor(color: vec4) {
    this.color = color
  }

  /** Clone `base`, register the clone and return it. gain scales the level for this material. */
  add(base: Material, gain: number = 1, followColor: boolean = true): Material {
    const m = base.clone()
    this.materials.push(m)
    this.gains.push(gain)
    this.tintColor.push(followColor)
    this.applyOne(this.materials.length - 1)
    return m
  }

  /** 0 = invisible, 1 = full glow. */
  setLevel(k: number): void {
    this.level = Math.max(0, Math.min(1, k))
    for (let i = 0; i < this.materials.length; i++) this.applyOne(i)
  }

  getLevel(): number {
    return this.level
  }

  /** Core colour (rgb); alpha scales the overall strength. */
  setColor(c: vec4): void {
    this.color = c
    for (let i = 0; i < this.materials.length; i++) this.applyOne(i)
  }

  /** Set a raw shader parameter on every registered material. */
  setParam(name: string, value: any): void {
    for (const m of this.materials) (m.mainPass as any)[name] = value
  }

  private applyOne(i: number): void {
    const pass = this.materials[i].mainPass as any
    pass.level = this.level * this.gains[i] * Math.max(0, Math.min(1, this.color.w))
    if (this.tintColor[i]) pass.coreColor = new vec3(this.color.x, this.color.y, this.color.z)
  }
}

/** Plane (n.xyz, d) in world space keeping points with dot(n, p) + d ≥ 0. */
export function clipPlaneAbove(pointWorld: vec3, normalWorld: vec3): vec4 {
  const n = normalWorld.normalize()
  return new vec4(n.x, n.y, n.z, -n.dot(pointWorld))
}

export const NO_CLIP = new vec4(0, 0, 0, 0)
