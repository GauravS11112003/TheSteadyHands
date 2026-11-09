/**
 * GhostPreviewUserHand — PreviewUserHand: a visible gloved right hand for the Lens Studio preview
 * and demo video, so viewers can see who is pinching the pad / dragging the needle.
 *
 * Owns:
 *  - A duplicated SIK right hand model (no HandVisual, posed by GhostHandRig) wearing a solid
 *    nitrile-glove material.
 *  - Following whichever SIK interactor is active (MouseInteractor in preview, or the LEAF test
 *    interactor): the pinch point (thumb–index pad midpoint) sits on the interactor's hit point,
 *    ~0.5 cm toward the eye; the hand approaches from the user's side and below.
 *  - Pose: an open pre-pinch while hovering, closing into a pinch while triggering (~120 ms),
 *    smooth follow during drags, slide-out and hide after ~1.5 s with no target.
 * Must not: affect interaction — no colliders, no interactor, read-only on SIK state. Editor only:
 *  disables itself on device (global.deviceInfoSystem.isEditor() is false).
 */
import {InteractionManager} from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager"
import {Interactor, InteractorInputType} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {GhostHandRig, HandPose, fp, lerpHandPose} from "./GhostHandRig"
import {Pose, basisQuat, smooth01} from "./GhostMath"

@component
export class PreviewUserHand extends BaseScriptComponent {
  @input
  @hint("Duplicated SIK RightHandModel (Skin + RightHandRig + RightHandMeshFull), child of this object")
  handModel: SceneObject
  @input
  @allowUndefined
  @hint("Solid nitrile-glove material (lit PBR, light blue-white)")
  gloveMaterial: Material
  @input
  @hint("Hand scale (1 = SIK model, ~22 cm wrist to fingertip)")
  handScale: number = 0.9
  @input
  @hint("Pinch point offset from the hit point toward the eye (cm)")
  eyeOffsetCm: number = 0.5
  @input
  @hint("Seconds to close / open the pinch")
  pinchEaseSec: number = 0.12
  @input
  @hint("Follow smoothing time constant (s); lower = tighter")
  followSec: number = 0.06
  @input
  @hint("Hide after this many seconds with no hovered / triggered target")
  hideAfterSec: number = 1.5
  @input
  @hint("Seconds for the hand to slide in / out")
  slideSec: number = 0.25
  @input
  @hint("Cast a shadow onto the drape / skin")
  castShadow: boolean = true

  private rig: GhostHandRig | null = null
  private eye: WorldCameraFinderProvider | null = null
  private openPose: HandPose
  private pinchPose: HandPose
  private openPinchModel = vec3.zero()
  private closedPinchModel = vec3.zero()

  private pos = vec3.zero()
  private rot = quat.quatIdentity()
  private hasPose = false
  private pinch = 0
  private shown = 0
  private lastActive = -1000
  private lastTarget: vec3 | null = null
  private dragPlane: {p: vec3; n: vec3} | null = null
  private wasTriggering = false

  onAwake(): void {
    const editor = (global as any).deviceInfoSystem && global.deviceInfoSystem.isEditor()
    if (!editor || !this.handModel) {
      if (this.handModel) this.handModel.enabled = false
      return
    }
    this.applyMaterial(this.handModel)
    this.rig = new GhostHandRig(this.handModel, true)
    this.rig.setScale(this.handScale)
    this.buildPoses()
    this.handModel.enabled = false
    this.createEvent("OnStartEvent").bind(() => {
      try {
        this.eye = WorldCameraFinderProvider.getInstance()
      } catch (e) {
        this.eye = null
      }
    })
    // Late update: read the interactors after SIK has updated them this frame.
    this.createEvent("LateUpdateEvent").bind(() => this.tick())
  }

  // ── poses ─────────────────────────────────────────────────────────────────

  private buildPoses(): void {
    const rig = this.rig
    const base: HandPose = {
      thumb: {abd: 30, flex: 20, roll: 30, mcp: 10, ip: 10},
      index: fp(0, 18, 22, 10),
      mid: fp(-2, 40, 55, 25),
      ring: fp(-4, 52, 65, 30),
      pinky: fp(-7, 58, 70, 35),
      cup: 6,
    }
    const pinchBase: HandPose = {
      thumb: base.thumb,
      index: fp(0, 34, 42, 18),
      mid: fp(-2, 50, 65, 30),
      ring: fp(-4, 60, 75, 35),
      pinky: fp(-7, 65, 80, 40),
      cup: 8,
    }
    // Open pre-pinch: thumb pad ~3 cm from the index pad; closed: pads touching (bone gap ~1.5 cm).
    rig.apply(base)
    const wantOpen = rig.fingerPad("index").add(rig.crossDir(140).uniformScale(3.0 / this.handScale))
    this.openPose = rig.solveThumbTo(base, wantOpen, 0)
    this.openPinchModel = vec3.lerp(rig.thumbPad(), rig.fingerPad("index"), 0.5)
    rig.apply(pinchBase)
    const wantClosed = rig.fingerPad("index").add(rig.crossDir(140).uniformScale(1.5 / this.handScale))
    this.pinchPose = rig.solveThumbTo(pinchBase, wantClosed, 0)
    this.closedPinchModel = vec3.lerp(rig.thumbPad(), rig.fingerPad("index"), 0.5)
    rig.apply(this.openPose)
  }

  // ── per frame ─────────────────────────────────────────────────────────────

  private tick(): void {
    if (!this.rig) return
    const dt = Math.min(0.1, Math.max(0, getDeltaTime()))
    const now = getTime()
    const it = this.pickInteractor()
    const triggering = !!it && it.isTriggering
    let target: vec3 | null = it ? this.targetPoint(it, triggering) : null
    if (target) {
      this.lastActive = now
      this.lastTarget = target
    } else if (now - this.lastActive < this.hideAfterSec) {
      target = this.lastTarget
    }
    this.wasTriggering = triggering

    const want = target ? 1 : 0
    const step = dt / Math.max(0.02, this.slideSec)
    this.shown = want > this.shown ? Math.min(1, this.shown + step) : Math.max(0, this.shown - step)
    if (this.shown <= 0 && !target) {
      if (this.handModel.enabled) this.handModel.enabled = false
      this.hasPose = false
      return
    }
    if (!this.handModel.enabled) this.handModel.enabled = true

    // Pinch amount eases toward the trigger state.
    const pStep = dt / Math.max(0.02, this.pinchEaseSec)
    const pWant = triggering ? 1 : 0
    this.pinch = pWant > this.pinch ? Math.min(1, this.pinch + pStep) : Math.max(0, this.pinch - pStep)
    const k = smooth01(this.pinch)

    const goal = target ?? this.lastTarget ?? this.pos
    const desired = this.handPoseAt(goal)
    // Slide in/out from the user's side and below.
    const away = this.awayDir(goal).uniformScale(10 * (1 - smooth01(this.shown)))
    const goalPos = desired.p.add(away)
    if (!this.hasPose) {
      this.pos = goalPos
      this.rot = desired.q
      this.hasPose = true
    } else {
      const a = 1 - Math.exp(-dt / Math.max(0.01, this.followSec))
      this.pos = vec3.lerp(this.pos, goalPos, a)
      this.rot = quat.slerp(this.rot, desired.q, a)
    }

    this.rig.apply(lerpHandPose(this.openPose, this.pinchPose, k))
    const pinchModel = vec3.lerp(this.openPinchModel, this.closedPinchModel, k)
    const frame = new Pose(pinchModel, this.rig.handFrameModel.q)
    this.rig.placeModel(this.toParent(new Pose(this.pos, this.rot)), frame)
  }

  /** The interactor to follow: one that is triggering, else one hovering a target. Hands excluded. */
  private pickInteractor(): Interactor | null {
    let im: InteractionManager
    try {
      im = InteractionManager.getInstance()
    } catch (e) {
      return null
    }
    const all = im.getInteractorsByType(InteractorInputType.All)
    let hover: Interactor | null = null
    for (const it of all) {
      if (!it || (it.inputType & InteractorInputType.BothHands) !== 0) continue
      let active = false
      try {
        active = it.isActive()
      } catch (e) {
        active = false
      }
      if (!active) continue
      if (it.isTriggering) return it
      if (!hover && !isNull(it.currentInteractable)) hover = it
    }
    return hover
  }

  /** World point the user is acting on (hit point; ray ∩ drag plane while dragging). */
  private targetPoint(it: Interactor, triggering: boolean): vec3 | null {
    let p: vec3 | null = null
    try {
      const hi = it.targetHitInfo
      if (hi && hi.hit) p = hi.hit.position
    } catch (e) {
      p = null
    }
    const o = it.startPoint
    const d = it.direction
    if (triggering) {
      if (!this.wasTriggering || !this.dragPlane) {
        const anchor = p ?? (isNull(it.currentInteractable) ? null : it.endPoint)
        this.dragPlane = anchor && d ? {p: anchor, n: d.uniformScale(-1).normalize()} : null
      }
      if (this.dragPlane && o && d) {
        // Follow the ray across the plane the drag started on (smooth over gaps in hits).
        const denom = d.dot(this.dragPlane.n)
        if (Math.abs(denom) > 1e-5) {
          const s = this.dragPlane.p.sub(o).dot(this.dragPlane.n) / denom
          if (s > 0) {
            const onPlane = o.add(d.uniformScale(s))
            p = p ? vec3.lerp(onPlane, p, 0.5) : onPlane
          }
        }
      }
    } else {
      this.dragPlane = null
    }
    if (!p && !isNull(it.currentInteractable)) p = it.endPoint
    return p
  }

  /** Hand pose (world) whose pinch point sits at `target`, pulled toward the eye a touch. */
  private handPoseAt(target: vec3): Pose {
    const eyePos = this.eye ? this.eye.getWorldPosition() : vec3.zero()
    const right = this.eye ? this.eye.right() : vec3.right()
    const up = this.eye ? this.eye.up() : vec3.up()
    const toEye = eyePos.sub(target).normalize()
    const pinchAt = target.add(toEye.uniformScale(this.eyeOffsetCm))
    // Right shoulder ~16 cm right, ~30 cm below the eye: the forearm comes from the user's side.
    const shoulder = eyePos.add(right.uniformScale(16)).add(up.uniformScale(-30))
    const fingers = pinchAt.sub(shoulder).normalize()
    // Semi-pronated: back of the hand up and a little outward (to the right).
    const dorsal = up.uniformScale(0.85).add(right.uniformScale(0.45)).add(toEye.uniformScale(0.2))
    return new Pose(pinchAt, basisQuat(fingers, dorsal))
  }

  /** Direction the hand slides in from / out to: toward the user and down. */
  private awayDir(target: vec3): vec3 {
    const eyePos = this.eye ? this.eye.getWorldPosition() : vec3.zero()
    const up = this.eye ? this.eye.up() : vec3.up()
    return eyePos.sub(target).normalize().uniformScale(0.6).add(up.uniformScale(-0.8)).normalize()
  }

  /** World pose → the model parent's space. */
  private toParent(world: Pose): Pose {
    const parent = this.handModel.getParent()
    if (!parent) return world
    const pt = parent.getTransform()
    const inv = pt.getInvertedWorldTransform()
    const qp = pt.getWorldRotation().invert()
    return new Pose(inv.multiplyPoint(world.p), qp.multiply(world.q))
  }

  private applyMaterial(root: SceneObject): void {
    const visit = (so: SceneObject) => {
      const rmvs = so.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]
      for (const r of rmvs) {
        if (this.gloveMaterial) {
          r.clearMaterials()
          r.addMaterial(this.gloveMaterial)
        }
        if (this.castShadow) {
          r.meshShadowMode = MeshShadowMode.Caster
          r.shadowDensity = 0.55
        }
      }
      for (let i = 0; i < so.getChildrenCount(); i++) visit(so.getChild(i))
    }
    visit(root)
  }
}
