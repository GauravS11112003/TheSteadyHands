/**
 * SteadyHandsPadController — the suture pad stand-in: pinch input + everything drawn on the pad.
 *
 * Owns:
 *  - The pad's collider + SIK Interactable (on this unit-scale wrapper, named "SuturePad"),
 *    and reporting each pinch as a pad-local point on the pad's top surface.
 *  - A hover reticle that follows where the pinch would land (targets highlight when aimed at).
 *  - The two pinch markers, the ghost attending's demo stitch, the bite marks (pairs of ~2 mm
 *    glowing cyan beads 5 mm either side of the marked line, joined by a faint light line) and the
 *    holographic ruler — all built and animated by Visuals/OverlayPadFx.
 *
 * Expects @inputs: the authored PinchMarker_A / PinchMarker_B / BiteMarks / GhostStitch
 * SceneObjects under this pad.
 * Must not: decide the flow (when pinches count, how many bites) — SteadyHandsMain does that.
 * Pad-local frame: origin = pad centre, +Y up, top surface at y = padSizeCm.y / 2, cut along X.
 */
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractorEvent} from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import {Interactor} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import animate, {CancelFunction} from "SpectaclesInteractionKit.lspkg/Utils/animate"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {P2, bitePositions} from "./SteadyHandsMath"
import {HoloMat, easeInOutCubic} from "./Visuals/OverlayKit"
import {OverlayPadFx} from "./Visuals/OverlayPadFx"

let CLOSE_TICKS: AudioTrackAsset | null = null
try {
  CLOSE_TICKS = requireAsset("../VFX/OverlayCloseTicks.wav") as AudioTrackAsset
} catch (e) {
  CLOSE_TICKS = null
}

/** Shortest Closed sequence: green cascade (~0.8 s) overlapping the fade; stays inside C5's 0.4–1.6 s window. */
const CLOSE_SEQUENCE_SEC = 1.25
/** Marks hold full brightness this long while they turn green, then fade. */
const CLOSE_HOLD_SEC = 0.55

@component
export class SteadyHandsPadController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SteadyHandsPadController – suture pad, pinches, bite marks</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("Authored holder for the first pinch marker (child of this pad)")
  pinchMarkerA: SceneObject
  @input
  @hint("Authored holder for the second pinch marker (child of this pad)")
  pinchMarkerB: SceneObject
  @input
  @hint("Authored root the bite marks are built under (on the pad's top surface)")
  biteMarksRoot: SceneObject
  @input
  @hint("Authored root for the ghost attending's demo stitch (pad centre, top surface)")
  ghostStitchRoot: SceneObject
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input("vec3", "{15,1,10}")
  @hint("Pad size in cm (width X, thickness Y, depth Z) — the skin top is at y = thickness / 2")
  padSizeCm: vec3
  @input("vec4", "{0.35,0.9,1,1}")
  @hint("Bite-mark bead colour (luminous ice-cyan reads on the additive display)")
  @widget(new ColorWidget())
  dotColor: vec4
  @input("vec4", "{0.62,0.95,1,1}")
  @hint("Pinch-marker / reticle colour")
  @widget(new ColorWidget())
  ringColor: vec4
  @input
  @hint("Distance of each bite dot from the cut edge, cm (brief: 5 mm)")
  @widget(new SliderWidget(0.2, 1.0, 0.05))
  edgeOffsetCm: number = 0.5
  @input
  @hint("Bite-mark bead diameter, mm (brief: about 2 mm)")
  @widget(new SliderWidget(1, 5, 0.5))
  dotDiameterMm: number = 2
  @input
  @hint("Debug: wireframe the pad collider")
  debugColliders: boolean = false
  @ui.group_end

  private interactable: Interactable
  private collider: ColliderComponent
  private _onPadPinched = new Event<vec3>()
  /** Fires with the pad-local point (top surface) of every pinch while pinching is enabled. */
  get onPadPinched(): PublicApi<vec3> {
    return this._onPadPinched.publicApi()
  }

  private pinchEnabled = false
  private hoverInteractor: Interactor | null = null
  private fx: OverlayPadFx | null = null
  private fadeCancel: CancelFunction | null = null
  private ticks: AudioComponent | null = null
  private ticksStop: DelayedCallbackEvent | null = null

  /** Master level of the bite marks (1 = shown, fades to 0 on Close). Readable by tests. */
  get dotTint(): HoloMat | null {
    return this.fx ? this.fx.dotTint : null
  }

  /** Number of bite pairs currently built on the pad. */
  get biteMarkCount(): number {
    return this.fx ? this.fx.biteCount : 0
  }

  /** True while bite marks are on the pad and not faded out. */
  biteMarksVisible = false

  /** Top surface height in pad-local cm. */
  get topY(): number {
    return this.padSizeCm.y / 2
  }

  onAwake(): void {
    const so = this.getSceneObject()
    this.collider = so.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = this.padSizeCm
    this.collider.shape = shape
    this.collider.fitVisual = false
    this.collider.debugDrawEnabled = this.debugColliders
    this.interactable = so.createComponent(Interactable.getTypeName()) as Interactable

    try {
      this.fx = new OverlayPadFx({
      pad: so,
      topY: this.topY,
      biteMarksRoot: this.biteMarksRoot,
      pinchMarkerA: this.pinchMarkerA,
      pinchMarkerB: this.pinchMarkerB,
      ghostStitchRoot: this.ghostStitchRoot,
      dotColor: this.dotColor,
      ringColor: this.ringColor,
      dotDiameterCm: this.dotDiameterMm / 10,
      edgeOffsetCm: this.edgeOffsetCm,
      })
    } catch (e) {
      this.fx = null
      print(`[Overlay] ERROR: pad overlays disabled — ${e}`)
    }

    if (CLOSE_TICKS) {
      // Rising ticks baked at 70 ms spacing (one per bite turning green on Close).
      this.ticks = so.createComponent("Component.AudioComponent") as AudioComponent
      this.ticks.audioTrack = CLOSE_TICKS
      this.ticks.volume = 0.55
    }

    this.createEvent("OnStartEvent").bind(() => {
      this.interactable.onHoverEnter.add((e: InteractorEvent) => {
        this.hoverInteractor = e.interactor
      })
      this.interactable.onHoverExit.add(() => {
        this.hoverInteractor = null
        if (this.fx) this.fx.setReticle(null)
      })
      this.interactable.onTriggerStart.add((e: InteractorEvent) => this.handlePinch(e))
    })
    this.createEvent("UpdateEvent").bind(() => {
      this.updateReticle()
      if (this.fx) this.fx.update(getDeltaTime())
    })
  }

  /** Allow or ignore pinches (only the Mark step listens). */
  setPinchEnabled(on: boolean): void {
    this.pinchEnabled = on
    if (!on && this.fx) this.fx.setReticle(null)
  }

  /** World point → pad-local point. */
  worldToLocal(world: vec3): vec3 {
    return this.getTransform().getInvertedWorldTransform().multiplyPoint(world)
  }

  /** Pad-local point → world point. */
  localToWorld(local: vec3): vec3 {
    return this.getTransform().getWorldTransform().multiplyPoint(local)
  }

  /** Feed a pinch directly (tests / scripted demos). Same path as a real pinch. */
  pinchAtLocal(x: number, z: number): void {
    if (!this.pinchEnabled) return
    this._onPadPinched.invoke(this.clampToPad(new vec3(x, this.topY, z)))
  }

  /** Feed a pinch at a world point (projected onto the pad's top surface). */
  pinchAtWorld(world: vec3): void {
    const l = this.worldToLocal(world)
    this.pinchAtLocal(l.x, l.z)
  }

  /** Ring + ripple + light pillar where end `index` was pinched (pops in). */
  showPinchMarker(index: number, local: vec3): void {
    if (this.fx) this.fx.showMarker(index, local)
  }

  hidePinchMarkers(): void {
    if (this.fx) this.fx.hideMarkers()
  }

  /** Build `count` evenly spaced bites between pad-local points a → b (x/z in P2.x/P2.y). */
  showBiteMarks(a: P2, b: P2, count: number): void {
    this.cancelFade()
    if (this.fx) this.fx.showBites(a, b, bitePositions(a, b, count))
    this.biteMarksVisible = count > 0
  }

  /**
   * Closed: the bites turn green A → B (ring pop + rising tick each), a green sweep runs along
   * the incision, then the bite marks + pinch markers + ruler fade out and are cleared. The
   * master level (dotTint) holds at 1 while they turn green, then eases 1 → 0.
   */
  fadeBiteMarks(seconds: number, done?: () => void): void {
    this.cancelFade()
    const total = Math.max(seconds, CLOSE_SEQUENCE_SEC)
    const hold = Math.min(CLOSE_HOLD_SEC, total * 0.45)
    if (this.fx && this.fx.biteCount > 0) {
      const stagger = this.fx.startCloseSequence()
      this.playTicks(this.fx.biteCount, stagger)
    }
    this.fadeCancel = animate({
      duration: Math.max(0.01, total),
      easing: "linear",
      update: (u) => {
        if (!this.fx) return
        const t = u * total
        const k = t <= hold ? 1 : 1 - easeInOutCubic((t - hold) / Math.max(0.01, total - hold))
        this.fx.setBiteLevel(k)
        this.fx.setMarkerLevel(k)
      },
      ended: () => {
        this.fadeCancel = null
        this.clearMarks()
        this.hidePinchMarkers()
        if (done) done()
      },
    })
  }

  clearBiteMarks(): void {
    this.cancelFade()
    this.clearMarks()
  }

  /** Ghost attending's stitch on the pad: entry puncture (far side), exit puncture (near side), thread. */
  showGhostStitch(stage: "entry" | "exit", color: vec4): void {
    if (this.fx) this.fx.showGhost(stage, color)
  }

  clearGhostStitch(): void {
    if (this.fx) this.fx.clearGhost()
  }

  /** True if the ghost's demo stitch is fully drawn on the pad. */
  get ghostStitchShown(): boolean {
    if (!this.fx) return false
    return this.ghostStitchRoot.enabled && this.fx.ghostExit.enabled && this.fx.ghostThread.enabled
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** One tick per bite: play the baked rising arpeggio and cut it after `count` ticks. */
  private playTicks(count: number, stagger: number): void {
    if (!this.ticks) return
    try {
      if (this.ticks.isPlaying()) this.ticks.stop(false)
      this.ticks.play(1)
      if (!this.ticksStop) {
        this.ticksStop = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
        this.ticksStop.bind(() => {
          if (this.ticks && this.ticks.isPlaying()) this.ticks.stop(true)
        })
      }
      // The baked file has 16 ticks at 70 ms; stop after this incision's count.
      if (Math.abs(stagger - 0.07) < 0.005 && count < 16) this.ticksStop.reset(count * 0.07 + 0.06)
    } catch (e) {
      // audio is optional polish
    }
  }

  private cancelFade(): void {
    if (this.fadeCancel) {
      this.fadeCancel()
      this.fadeCancel = null
    }
  }

  private clearMarks(): void {
    if (this.fx) {
      this.fx.clearBites()
      this.fx.setMarkerLevel(1)
    }
    this.biteMarksVisible = false
  }

  private clampToPad(p: vec3): vec3 {
    const hx = this.padSizeCm.x / 2
    const hz = this.padSizeCm.z / 2
    return new vec3(Math.max(-hx, Math.min(hx, p.x)), this.topY, Math.max(-hz, Math.min(hz, p.z)))
  }

  /** Where a pinch from this interactor lands on the pad's top surface (pad-local), or null. */
  private landingPoint(interactor: Interactor): vec3 | null {
    const hit = interactor.targetHitInfo
    if (hit && hit.hit && hit.interactable === this.interactable) {
      return this.clampToPad(this.worldToLocal(hit.hit.position))
    }
    // Fallback: intersect the interactor ray with the pad's top plane.
    const o = interactor.startPoint
    const dir = interactor.direction
    if (o && dir) {
      const lo = this.worldToLocal(o)
      const lt = this.worldToLocal(o.add(dir))
      const ld = lt.sub(lo)
      if (Math.abs(ld.y) > 1e-5) {
        const t = (this.topY - lo.y) / ld.y
        if (t > 0) return this.clampToPad(lo.add(ld.uniformScale(t)))
      }
    }
    return null
  }

  private handlePinch(e: InteractorEvent): void {
    if (!this.pinchEnabled) return
    const p = this.landingPoint(e.interactor) ?? new vec3(0, this.topY, 0)
    this._onPadPinched.invoke(p)
  }

  private updateReticle(): void {
    if (!this.pinchEnabled || !this.hoverInteractor) return
    const p = this.landingPoint(this.hoverInteractor)
    if (this.fx) this.fx.setReticle(p)
  }
}
