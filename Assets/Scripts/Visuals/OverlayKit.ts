/**
 * OverlayKit — shared building blocks for the holographic overlays on and around the wound
 * (plain module, not a component).
 *
 * Owns:
 *  - HoloMat: a clone of Materials/Overlay/OverlayHolo.mat (custom premultiplied-alpha shader with
 *    procedural modes: fresnel bead, glow sprite, ring, ribbon, rounded glass panel, glossy thread)
 *    plus its colour, coverage and level. Tint-compatible (material / setLevel / getLevel / setColor).
 *  - Procedural meshes (MeshBuilder): quads with mode-specific UVs, UV spheres, swept tubes,
 *    arched ribbons and the ruler comb.
 *  - FacingSprites: keeps glow sprites turned to the eye and pulled toward it along the line of
 *    sight, so a halo never sinks into the skin it sits on.
 * Must not: hold app state or decide when anything shows.
 *
 * Colour convention: rgb = emitted light (additive part), coverage = how much the background is
 * covered (0 = pure additive glow, 1 = opaque). Black never carries information.
 */
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"

let HOLO_MATERIAL: Material | null = null
try {
  HOLO_MATERIAL = requireAsset("../../Materials/Overlay/OverlayHolo.mat") as Material
} catch (e) {
  HOLO_MATERIAL = null
}
let holoWarned = false

/** A usable clone of the overlay material, or null (logs one error) when the asset/pass is missing. */
function cloneHoloMaterial(): Material | null {
  try {
    if (HOLO_MATERIAL && !isNull(HOLO_MATERIAL) && HOLO_MATERIAL.mainPass) {
      const m = HOLO_MATERIAL.clone()
      if (m && m.mainPass) return m
    }
  } catch (e) {
    // fall through to the single warning below
  }
  if (!holoWarned) {
    holoWarned = true
    print("[Overlay] ERROR: Materials/Overlay/OverlayHolo.mat is missing or has no shader pass — overlay visuals are hidden.")
  }
  return null
}

export enum HoloMode {
  /** 3D body: white-hot core facing the eye, coloured fresnel rim. shape = (rimPower, coreWhite, rimGain, rimCoverage) */
  Bead = 0,
  /** Sprite, uv in [-1,1]. shape = (falloff, coreWhite, coreRadius, alphaShare) */
  Glow = 1,
  /** Sprite, uv in [-1,1]. shape = (radius, lineHalfWidth, glowWidth, lineWhite) */
  Ring = 2,
  /** Strip, u along [0,1], v across [-1,1]. shape = (reveal, acrossSharpness, endTaper, headGlow) */
  Ribbon = 3,
  /** Panel, uv = cm from centre. panel = (halfW, halfH, corner, border); shape = (fill, glowCm, fillCoverage, sheen) */
  Panel = 4,
  /** 3D body, glossy lit. shape = (lightDir xyz, shininess) */
  Gloss = 5,
}

export const HOLO_CYAN = new vec4(0.5, 0.91, 1.0, 1) // #7FE8FF
export const HOLO_ICE = new vec4(0.75, 0.96, 1.0, 1) // #BFF4FF
export const HOLO_GREEN = new vec4(0.36, 1.0, 0.54, 1) // #5CFF8A
export const HOLO_CORAL = new vec4(1.0, 0.42, 0.42, 1) // #FF6B6B

export interface HoloOptions {
  coverage?: number
  shape?: vec4
  panel?: vec4
  twoSided?: boolean
  depthTest?: boolean
}

/** A cloned OverlayHolo material plus colour/coverage/level. 0 = invisible, 1 = full. */
export class HoloMat {
  /** Null when the overlay material is unavailable (visuals are then skipped, levels still tracked). */
  readonly material: Material | null
  private color: vec4
  private coverage: number
  private level = 1
  private gain = 1

  constructor(mode: HoloMode, color: vec4, opts: HoloOptions = {}) {
    this.material = cloneHoloMaterial()
    if (this.material) {
      const pass = this.material.mainPass as any
      pass.holoMode = mode
      if (opts.shape) pass.shapeParams = opts.shape
      if (opts.panel) pass.panelParams = opts.panel
      pass.twoSided = opts.twoSided ?? true
      pass.depthTest = opts.depthTest ?? true
      pass.depthWrite = false
    }
    this.color = color
    this.coverage = opts.coverage ?? 0
    this.apply()
  }

  /** 0 = invisible, 1 = full colour. */
  setLevel(k: number): void {
    this.level = Math.max(0, Math.min(1, k))
    this.apply()
  }

  getLevel(): number {
    return this.level
  }

  /** rgb = colour, w = intensity multiplier. */
  setColor(c: vec4): void {
    this.color = c
    this.apply()
  }

  getColor(): vec4 {
    return this.color
  }

  setCoverage(a: number): void {
    this.coverage = a
    this.apply()
  }

  /** Extra brightness multiplier for pulses / breathing (does not change the level). */
  setGain(g: number): void {
    this.gain = Math.max(0, g)
    this.apply()
  }

  setShape(v: vec4): void {
    if (this.material) (this.material.mainPass as any).shapeParams = v
  }

  setPanel(v: vec4): void {
    if (this.material) (this.material.mainPass as any).panelParams = v
  }

  private apply(): void {
    if (!this.material) return
    const c = this.color
    const k = this.level * this.gain * c.w
    this.material.mainPass.baseColor = new vec4(c.x * k, c.y * k, c.z * k, Math.min(1, this.coverage * this.level))
  }
}

// ── meshes ───────────────────────────────────────────────────────────────────

const LAYOUT = [
  {name: "position", components: 3},
  {name: "normal", components: 3, normalized: true},
  {name: "texture0", components: 2},
]

/** Small MeshBuilder wrapper: position + normal + uv0, indexed triangles. */
export class MeshKit {
  private b: MeshBuilder
  private n = 0

  constructor() {
    this.b = new MeshBuilder(LAYOUT)
    this.b.topology = MeshTopology.Triangles
    this.b.indexType = MeshIndexType.UInt16
  }

  vert(p: vec3, nrm: vec3, u: number, v: number): number {
    this.b.appendVerticesInterleaved([p.x, p.y, p.z, nrm.x, nrm.y, nrm.z, u, v])
    return this.n++
  }

  tri(a: number, b: number, c: number): void {
    this.b.appendIndices([a, b, c])
  }

  /** Quad centred at c spanning ±ax, ±ay; front face = ax × ay. uv (u0,v0) at -ax-ay, (u1,v1) at +ax+ay. */
  quad(c: vec3, ax: vec3, ay: vec3, u0: number, v0: number, u1: number, v1: number): void {
    const nrm = ax.cross(ay).normalize()
    const a = this.vert(c.sub(ax).sub(ay), nrm, u0, v0)
    const b = this.vert(c.add(ax).sub(ay), nrm, u1, v0)
    const d = this.vert(c.add(ax).add(ay), nrm, u1, v1)
    const e = this.vert(c.sub(ax).add(ay), nrm, u0, v1)
    this.tri(a, b, d)
    this.tri(a, d, e)
  }

  /** Strip through `pts` with half-width `hw` along `side` (one vector for the whole strip). u = arc length 0..1, v = -1..1. */
  strip(pts: vec3[], side: vec3, hw: number, u0: number = 0, u1: number = 1): void {
    let total = 0
    const acc: number[] = [0]
    for (let i = 1; i < pts.length; i++) {
      total += pts[i].distance(pts[i - 1])
      acc.push(total)
    }
    const s = side.normalize().uniformScale(hw)
    const base = this.n
    for (let i = 0; i < pts.length; i++) {
      const t = pts[Math.min(pts.length - 1, i + 1)].sub(pts[Math.max(0, i - 1)]).normalize()
      const nrm = t.cross(side).normalize()
      const u = u0 + (u1 - u0) * (total > 0 ? acc[i] / total : 0)
      this.vert(pts[i].sub(s), nrm, u, -1)
      this.vert(pts[i].add(s), nrm, u, 1)
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2
      this.tri(a, a + 2, a + 3)
      this.tri(a, a + 3, a + 1)
    }
  }

  /** UV sphere (normals outward, CCW from outside). */
  sphere(c: vec3, r: number, slices: number = 14, stacks: number = 9): void {
    const base = this.n
    for (let i = 0; i <= stacks; i++) {
      const th = (Math.PI * i) / stacks
      for (let j = 0; j <= slices; j++) {
        const ph = (2 * Math.PI * j) / slices
        const nrm = new vec3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph))
        this.vert(c.add(nrm.uniformScale(r)), nrm, j / slices, i / stacks)
      }
    }
    const row = slices + 1
    for (let i = 0; i < stacks; i++) {
      for (let j = 0; j < slices; j++) {
        const a = base + i * row + j
        const b = a + row
        this.tri(a, a + 1, b)
        this.tri(a + 1, b + 1, b)
      }
    }
  }

  /** Tube of radius r swept along pts (parallel-transport frames, normals outward, open ends). */
  tube(pts: vec3[], r: number | ((i: number) => number), sides: number = 8): void {
    if (pts.length < 2) return
    const base = this.n
    const rad = (i: number) => (typeof r === "number" ? r : r(i))
    const t0 = pts[1].sub(pts[0]).normalize()
    const ref = Math.abs(t0.y) < 0.9 ? vec3.up() : vec3.right()
    let nrm = t0.cross(ref).normalize()
    let total = 0
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) total += pts[i].distance(pts[i - 1])
      const t = pts[Math.min(pts.length - 1, i + 1)].sub(pts[Math.max(0, i - 1)]).normalize()
      // parallel transport: remove the tangent component from the previous normal
      nrm = nrm.sub(t.uniformScale(nrm.dot(t))).normalize()
      const bin = t.cross(nrm).normalize()
      for (let k = 0; k <= sides; k++) {
        const a = (2 * Math.PI * k) / sides
        const dir = nrm.uniformScale(Math.cos(a)).add(bin.uniformScale(Math.sin(a)))
        this.vert(pts[i].add(dir.uniformScale(rad(i))), dir, k / sides, total)
      }
    }
    const row = sides + 1
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const a = base + i * row + k
        const b = a + row
        this.tri(a, a + 1, b)
        this.tri(a + 1, b + 1, b)
      }
    }
  }

  build(): RenderMesh {
    this.b.updateMesh()
    return this.b.getMesh()
  }
}

/** Child SceneObject with a RenderMeshVisual. */
export function meshObject(parent: SceneObject, name: string, mesh: RenderMesh, mat: HoloMat, localPos: vec3 = vec3.zero()): SceneObject {
  const so = global.scene.createSceneObject(name)
  so.setParent(parent)
  so.getTransform().setLocalPosition(localPos)
  const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  rmv.mesh = mesh
  if (mat.material) rmv.mainMaterial = mat.material
  else rmv.enabled = false
  return so
}

/** Empty holder SceneObject. */
export function holder(parent: SceneObject, name: string, localPos: vec3 = vec3.zero()): SceneObject {
  const so = global.scene.createSceneObject(name)
  so.setParent(parent)
  so.getTransform().setLocalPosition(localPos)
  return so
}

// Cached unit meshes (built once, shared by every visual).
let spriteMesh: RenderMesh | null = null
let flatSpriteMesh: RenderMesh | null = null
let beadMesh: RenderMesh | null = null

/** 2×2 cm sprite in the XY plane facing +Z, uv in [-1,1]. Scale it to size. */
export function unitSprite(): RenderMesh {
  if (!spriteMesh) {
    const k = new MeshKit()
    k.quad(vec3.zero(), new vec3(1, 0, 0), new vec3(0, 1, 0), -1, -1, 1, 1)
    spriteMesh = k.build()
  }
  return spriteMesh
}

/** 2×2 cm sprite lying in the XZ plane facing +Y, uv in [-1,1]. */
export function unitFlatSprite(): RenderMesh {
  if (!flatSpriteMesh) {
    const k = new MeshKit()
    k.quad(vec3.zero(), new vec3(1, 0, 0), new vec3(0, 0, -1), -1, -1, 1, 1)
    flatSpriteMesh = k.build()
  }
  return flatSpriteMesh
}

/** Sphere of radius 1 cm. */
export function unitBead(): RenderMesh {
  if (!beadMesh) {
    const k = new MeshKit()
    k.sphere(vec3.zero(), 1, 16, 10)
    beadMesh = k.build()
  }
  return beadMesh
}

// ── camera-facing sprites ────────────────────────────────────────────────────

interface Facing {
  so: SceneObject
  anchor: SceneObject
  pull: number
  yawOnly: boolean
}

/**
 * Keeps sprites (children of an anchor) facing the eye. Each sprite is moved `pull` cm from its
 * anchor toward the eye along the line of sight, so it reads at the same screen spot but sits in
 * front of the surface it marks. yawOnly sprites (light pillars) stay upright around the anchor's up.
 */
export class FacingSprites {
  private items: Facing[] = []
  private cam: Transform | null = null

  add(so: SceneObject, pull: number, yawOnly: boolean = false): void {
    this.items.push({so, anchor: so.getParent(), pull, yawOnly})
  }

  /** Drop entries whose objects were destroyed. */
  prune(): void {
    this.items = this.items.filter((f) => !isNull(f.so) && !isNull(f.anchor))
  }

  update(): void {
    if (!this.cam) {
      try {
        this.cam = WorldCameraFinderProvider.getInstance().getTransform()
      } catch (e) {
        return
      }
      if (!this.cam) return
    }
    const eye = this.cam.getWorldPosition()
    const camUp = this.cam.up
    let dead = false
    for (const f of this.items) {
      if (isNull(f.so) || isNull(f.anchor)) {
        dead = true
        continue
      }
      if (!f.so.isEnabledInHierarchy) continue
      const at = f.anchor.getTransform()
      const a = at.getWorldPosition()
      const toEye = eye.sub(a)
      const dist = toEye.length
      if (dist < 1e-3) continue
      const dir = toEye.uniformScale(1 / dist)
      const t = f.so.getTransform()
      if (f.yawOnly) {
        const up = at.up
        const flat = dir.sub(up.uniformScale(dir.dot(up)))
        if (flat.length < 1e-4) continue
        t.setWorldPosition(a.add(dir.uniformScale(f.pull)))
        t.setWorldRotation(quat.lookAt(flat.normalize(), up))
      } else {
        t.setWorldPosition(a.add(dir.uniformScale(f.pull)))
        t.setWorldRotation(quat.lookAt(dir, camUp))
      }
    }
    if (dead) this.prune()
  }
}

// ── easing ───────────────────────────────────────────────────────────────────

export function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t))
}

export function easeOutCubic(t: number): number {
  const c = clamp01(t)
  return 1 - Math.pow(1 - c, 3)
}

export function easeInOutCubic(t: number): number {
  const c = clamp01(t)
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2
}

/** Overshoot pop: 0 → ~1.15 → 1. */
export function easeOutBack(t: number, s: number = 2.2): number {
  const c = clamp01(t) - 1
  return 1 + c * c * ((s + 1) * c + s)
}
