/**
 * SteadyHandsVisuals — small runtime helpers for primitive visuals (plain module, not a component).
 *
 * Owns:
 *  - Creating a leaf visual SceneObject (RenderMeshVisual + cloned material) sized in cm by
 *    fitting the mesh's own AABB, so preset mesh dimensions never leak into callers.
 *  - Tinting / fading a cloned material, either additive ("glow", fades by dimming RGB)
 *    or normal alpha blend.
 *
 * Must not: create colliders (colliders live on unit-scale wrappers owned by controllers),
 * hold any app state, or build UI text (that lives in the *UI.ts modules).
 */

export type BlendKind = "add" | "alpha" | "opaque"

/** A cloned material plus the colour it was created with, so it can be faded and restored. */
export class Tint {
  readonly material: Material
  private base: vec4
  private kind: BlendKind
  private level: number = 1

  constructor(material: Material, base: vec4, kind: BlendKind) {
    this.material = material
    this.base = base
    this.kind = kind
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

  setColor(c: vec4): void {
    this.base = c
    this.apply()
  }

  private apply(): void {
    const c = this.base
    const k = this.level
    if (this.kind === "add") {
      this.material.mainPass.baseColor = new vec4(c.x * c.w * k, c.y * c.w * k, c.z * c.w * k, 1)
    } else {
      this.material.mainPass.baseColor = new vec4(c.x, c.y, c.z, c.w * k)
    }
  }
}

/** Clone a base material and configure blending for the requested kind. */
export function makeTint(baseMaterial: Material, color: vec4, kind: BlendKind): Tint {
  const m = baseMaterial.clone()
  if (kind === "add") {
    m.mainPass.blendMode = BlendMode.Add
    m.mainPass.depthWrite = false
  } else if (kind === "alpha") {
    m.mainPass.blendMode = BlendMode.Normal
    m.mainPass.depthWrite = false
  }
  return new Tint(m, color, kind)
}

/** Per-axis local scale that makes `mesh` measure `sizeCm` (its own AABB → cm). */
export function fitScale(mesh: RenderMesh, sizeCm: vec3): vec3 {
  const ext = mesh.aabbMax.sub(mesh.aabbMin)
  const sx = ext.x > 1e-5 ? sizeCm.x / ext.x : 1
  const sy = ext.y > 1e-5 ? sizeCm.y / ext.y : 1
  const sz = ext.z > 1e-5 ? sizeCm.z / ext.z : 1
  return new vec3(sx, sy, sz)
}

/** Create a child SceneObject with a fitted RenderMeshVisual. */
export function makeVisual(
  parent: SceneObject,
  name: string,
  mesh: RenderMesh,
  tint: Tint,
  sizeCm: vec3,
  localPos: vec3 = vec3.zero(),
): SceneObject {
  const so = global.scene.createSceneObject(name)
  so.setParent(parent)
  const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  rmv.mesh = mesh
  rmv.mainMaterial = tint.material
  const t = so.getTransform()
  t.setLocalPosition(localPos)
  t.setLocalScale(fitScale(mesh, sizeCm))
  return so
}

/**
 * A flat ring (torus preset) lying in the local XZ plane: detects the torus' thin axis and
 * rotates it so the ring's hole faces +Y.
 */
export function makeFlatRing(
  parent: SceneObject,
  name: string,
  torus: RenderMesh,
  tint: Tint,
  diameterCm: number,
  thicknessCm: number,
  localPos: vec3 = vec3.zero(),
): SceneObject {
  const holder = global.scene.createSceneObject(name)
  holder.setParent(parent)
  holder.getTransform().setLocalPosition(localPos)
  const ext = torus.aabbMax.sub(torus.aabbMin)
  const vis = global.scene.createSceneObject(name + "Visual")
  vis.setParent(holder)
  const rmv = vis.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  rmv.mesh = torus
  rmv.mainMaterial = tint.material
  const vt = vis.getTransform()
  if (ext.y <= ext.x && ext.y <= ext.z) {
    vt.setLocalScale(new vec3(diameterCm / ext.x, thicknessCm / ext.y, diameterCm / ext.z))
  } else if (ext.z <= ext.x && ext.z <= ext.y) {
    // Thin along Z → rotate 90° about X so the thin axis becomes Y.
    vt.setLocalRotation(quat.angleAxis(Math.PI / 2, vec3.right()))
    vt.setLocalScale(new vec3(diameterCm / ext.x, diameterCm / ext.y, thicknessCm / ext.z))
  } else {
    vt.setLocalRotation(quat.angleAxis(Math.PI / 2, vec3.forward()))
    vt.setLocalScale(new vec3(thicknessCm / ext.x, diameterCm / ext.y, diameterCm / ext.z))
  }
  return holder
}

/** A thin bar between two local points (box mesh), e.g. a thread across the cut. */
export function makeBar(
  parent: SceneObject,
  name: string,
  box: RenderMesh,
  tint: Tint,
  a: vec3,
  b: vec3,
  thicknessCm: number,
): SceneObject {
  const mid = a.add(b).uniformScale(0.5)
  const d = b.sub(a)
  const len = Math.max(0.001, d.length)
  const so = makeVisual(parent, name, box, tint, new vec3(thicknessCm, thicknessCm, len), mid)
  so.getTransform().setLocalRotation(quat.lookAt(d.normalize(), vec3.up()))
  return so
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function lerpVec(a: vec3, b: vec3, t: number): vec3 {
  return new vec3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t))
}

export function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}
