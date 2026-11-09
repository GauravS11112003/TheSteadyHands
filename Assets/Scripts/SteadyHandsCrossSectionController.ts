/**
 * SteadyHandsCrossSectionController — the floating 3x skin cross-section above the pad.
 *
 * Owns:
 *  - The visuals under the authored "Fold" child: a procedural 3D tissue block (epidermis, dermis,
 *    fat, fascia, muscle; the wound as a V-cleft) inside a holographic frame, the projection link
 *    down to the wound, the ideal-arc guide (dashed arc, entry/exit targets, 90° guide), the
 *    ghost needle trace, the user's glowing thread trail and the pass/fail feedback.
 *  - Unfolding / folding as a holographic scan-in / scan-out ("Fold" is enabled while shown and
 *    disabled when folded away; this unit-scale root never scales).
 *  - The practice needle (authored "PracticeNeedle"): a 2 cm grab-zone collider + SIK
 *    Interactable on the needle TIP. While pinched, the interactor ray is projected onto this
 *    section's plane (z = 0 of this root) and the tip follows; on release the path (view cm) is
 *    emitted.
 *
 * Expects @inputs: Fold root, PracticeNeedle, the labels UI module, the XSection materials and
 * detail textures, optionally the pad (wound anchor).
 * Must not: score the stitch or advance the flow — SteadyHandsMain scores the emitted path
 * with SteadyHandsMath and calls showResult()/resetNeedle().
 * Local frame: x right, y up, z toward the viewer; skin surface at y = SURFACE_Y; cut at x = CUT_X.
 * "Fold" carries a small presentation tilt/yaw so the block's top and side read as volume; the
 * stitch is drawn in Fold's x/y plane and the drag is measured in this root's x/y plane.
 */
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractorEvent} from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import {Interactor} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {P2, StitchGeometry, dist, distanceToIdealArc, idealStitchGeometry, scoreStitchPath} from "./SteadyHandsMath"
import {CalloutSpec, SteadyHandsCrossSectionUI} from "./SteadyHandsCrossSectionUI"
import {Tint} from "./SteadyHandsVisuals"
import {V3, alphaMaterial, glowMaterial} from "./Visuals/XSectionGeom"
import {LayerInfo, TissueBlock, buildTissue} from "./Visuals/XSectionTissue"
import {
  Box,
  GlowPiece,
  NEEDLE_SPAN,
  XSThread,
  buildAngleGuide,
  buildDashedArc,
  buildDot,
  buildFrame,
  buildGrabRing,
  buildLeader,
  buildNeedle,
  buildPill,
  buildPlatform,
  buildProtractor,
  buildResultBadge,
  buildToleranceBand,
  buildScanRing,
  buildSparkle,
  buildTarget,
  buildWoundLink,
} from "./Visuals/XSectionFx"

/** Diagram layout invariants (view cm). The section is 18 x 6 cm. */
const SECTION_W = 18
const SECTION_H = 6
const SURFACE_Y = 1.2
const CUT_X = -1.5
const BLOCK_BOTTOM = -3
const BLOCK_DEPTH = 5
const NEEDLE_Z = 0.3
const D2R = Math.PI / 180

const GREEN = new vec4(0.36, 1.0, 0.54, 1)
const CORAL = new vec4(1.0, 0.42, 0.42, 1)
const CYAN = new vec4(0.5, 0.91, 1.0, 1)
const GHOST = new vec4(0.42, 0.88, 1.0, 1)
const MINT: [number, number, number] = [0.45, 1.0, 0.72]
const AMBER: [number, number, number] = [1.0, 0.78, 0.28]
const CORAL3: [number, number, number] = [1.0, 0.42, 0.42]

interface Reveal {
  name: string
  apply: (k: number) => void
  unfold: (t: number) => number
  fold: (t: number) => number
  cur: number
  from: number
}

interface Trace {
  t: number
  sec: number
  done?: () => void
  doneFired: boolean
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
function smooth01(x: number): number {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}
function easeOutBack(x: number): number {
  const t = clamp01(x)
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
function easeInOutQuad(x: number): number {
  const t = clamp01(x)
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}
function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - clamp01(x), 3)
}

@component
export class SteadyHandsCrossSectionController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SteadyHandsCrossSectionController – 3x skin cross-section + practice needle</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("Authored child that holds the diagram; enabled while shown")
  foldRoot: SceneObject
  @input
  @hint("Authored practice needle (gets the 2 cm grab-zone collider + Interactable)")
  practiceNeedle: SceneObject
  @input
  @hint("Labels UI module for this cross-section")
  labels: SteadyHandsCrossSectionUI
  @input
  @allowUndefined
  @hint("XS_TissueTex: Uber Unlit, vertex colour = Base Color, base texture on (cloned per layer)")
  tissueMaterial: Material
  @input
  @allowUndefined
  @hint("XS_VertexColor: Uber Unlit, vertex colour = Base Color, no texture (glows, chrome, details)")
  vertexColorMaterial: Material
  @input
  @allowUndefined
  @hint("Fallback unlit material (SH_Unlit), used only if the XSection materials are missing")
  unlitMaterial: Material
  @input
  @allowUndefined
  @hint("Skin surface detail texture (epidermis)")
  skinTexture: Texture
  @input
  @allowUndefined
  @hint("Dermis collagen detail texture")
  dermisTexture: Texture
  @input
  @allowUndefined
  @hint("Fat lobule detail texture")
  fatTexture: Texture
  @input
  @allowUndefined
  @hint("Muscle striation detail texture")
  muscleTexture: Texture
  @input
  @allowUndefined
  @hint("The pad (SuturePad): the projection link drops to its top centre")
  woundAnchor: SceneObject
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("Drawing scale of the cross-section (brief: 3x real size)")
  @widget(new SliderWidget(1, 6, 0.5))
  viewScale: number = 3
  @input
  @hint("Diameter of the needle's grab zone, cm (brief: about 2 cm)")
  @widget(new SliderWidget(1, 4, 0.25))
  grabZoneCm: number = 2
  @input("vec4", "{0.9,0.98,1,1}")
  @hint("Practice needle glow + thread colour before scoring")
  @widget(new ColorWidget())
  needleColor: vec4
  @input("vec4", "{0.6,0.9,1,1}")
  @hint("Ghost trace colour (the attending's ideal arc)")
  @widget(new ColorWidget())
  guideColor: vec4
  @input
  @hint("Pass tolerance drawn as the band around the ideal arc, REAL mm (keep = SteadyHandsMain.stitchToleranceMm)")
  toleranceMm: number = 1.5
  @input
  @hint("Entry-angle tolerance drawn on the protractor, degrees (keep = SteadyHandsMain.angleToleranceDeg)")
  angleToleranceDeg: number = 15
  @input
  @hint("Pad top above the anchor's origin, cm (SuturePad: 0.5)")
  woundTopOffset: number = 0.5
  @input
  @hint("Presentation tilt of the block toward the eye, degrees (shows the skin surface)")
  @widget(new SliderWidget(0, 35, 1))
  tiltDeg: number = 18
  @input
  @hint("Presentation yaw, degrees (negative shows the right side face)")
  @widget(new SliderWidget(-35, 35, 1))
  yawDeg: number = -14
  @input
  @hint("Seconds for the holographic scan-in (unfold)")
  @widget(new SliderWidget(0.4, 3, 0.05))
  scanSec: number = 1.5
  @input
  @hint("Seconds to fold the cross-section away")
  @widget(new SliderWidget(0.1, 2, 0.05))
  foldSec: number = 0.7
  @ui.group_end

  private _onPracticePath = new Event<P2[]>()
  /** Fires on needle release with the dragged path (view cm, entry first). */
  get onPracticePath(): PublicApi<P2[]> {
    return this._onPracticePath.publicApi()
  }

  /** True while the section is unfolded (or unfolding). */
  isShown = false
  /** True while the practice needle can be grabbed. */
  practiceEnabled = false

  private geom: StitchGeometry
  private interactable: Interactable
  private dragging = false
  private dragInteractor: Interactor | null = null
  private dragStartCursor: P2 | null = null
  private path: P2[] = []
  private view: V3 = [0, 0, 1]
  private built = false

  // Tints (tests read needleTint / trailTint colours).
  private needleTint: Tint
  private trailTint: Tint
  private trailCoreTint: Tint
  private haloTint: Tint
  private guideTint: Tint
  private ghostTint: Tint
  private ghostGlowTint: Tint
  private ghostThreadTint: Tint
  private ghostThreadGlowTint: Tint

  // Scene pieces.
  private tissue: TissueBlock | null = null
  private reveals: Reveal[] = []
  private scanRing: GlowPiece | null = null
  private platform: GlowPiece | null = null
  private link: GlowPiece | null = null
  private reticle: GlowPiece | null = null
  private linkDots: {piece: GlowPiece; from: vec3; to: vec3; phase: number}[] = []
  private dashes: SceneObject[] = []
  private needleVisual: SceneObject
  private needleStub: SceneObject | null = null
  private grabRing: GlowPiece | null = null
  private ghostHolder: SceneObject
  private trail: XSThread | null = null
  private ghostThread: XSThread | null = null
  private sparkle: GlowPiece | null = null
  private comet: GlowPiece | null = null
  private leaders: GlowPiece[] = []

  // Animation state.
  private mode: "hidden" | "unfolding" | "shown" | "folding" = "hidden"
  private modeT = 0
  private foldDone: (() => void) | undefined
  private trace: Trace | null = null
  private ghostFadeT = -1
  private hover = false
  private pulseT = 0
  private needleAngle = 0
  private resultFx: {pass: boolean; t: number; pts: P2[]} | null = null
  private linkLevel = 0

  // Scoring visuals.
  private band: GlowPiece | null = null
  private bandComet: GlowPiece | null = null
  private bandLevel = 0
  private bandTarget = 0
  private bandSweepT = -1
  private bandSwept = false
  private protractor: {root: SceneObject; frame: GlowPiece; needle: GlowPiece} | null = null
  private badgePass: GlowPiece | null = null
  private badgeFail: GlowPiece | null = null
  private angleGuide: GlowPiece | null = null
  private resultUi: {t: number; pass: boolean; angleDeg: number; readout: string} | null = null
  private overlayFade = 1

  /** Ideal stitch geometry in view cm (entry/exit/centre/radius). */
  get geometry(): StitchGeometry {
    return this.geom
  }

  onAwake(): void {
    this.geom = idealStitchGeometry(SURFACE_Y, CUT_X, 0.5, this.viewScale)
    const ft = this.foldRoot.getTransform()
    const q = quat.angleAxis(this.tiltDeg * D2R, vec3.right()).multiply(quat.angleAxis(this.yawDeg * D2R, vec3.up()))
    ft.setLocalRotation(q)
    ft.setLocalScale(vec3.one())
    ft.setLocalPosition(vec3.zero())
    const v = q.invert().multiplyVec3(new vec3(0, 0, 1))
    this.view = [v.x, v.y, v.z]

    this.buildInteraction()
    try {
      if (!this.tissueMaterial || !this.vertexColorMaterial) throw new Error("tissueMaterial / vertexColorMaterial not wired")
      this.buildVisuals()
      this.built = true
    } catch (e) {
      print(`[CrossSection] ERROR building visuals: ${e} — check the XSection material @inputs.`)
      this.buildFallbackTints()
    }
    if (!this.needleTint) this.buildFallbackTints()
    this.setNeedleTip(this.geom.entry)
    this.practiceNeedle.enabled = false
    try {
      this.applyAll(0)
    } catch (e) {
      print(`[CrossSection] initial hide failed: ${e}`)
    }
    this.foldRoot.enabled = false

    this.createEvent("OnStartEvent").bind(() => {
      if (this.built) {
        try {
          this.buildWoundLink()
        } catch (e) {
          print(`[CrossSection] wound link skipped: ${e}`)
        }
      }
      const ui = this.labels as any
      if (ui && typeof ui.build === "function") {
        try {
          ui.build(this.labelLayout())
        } catch (e) {
          print(`[CrossSection] labels build failed: ${e}`)
        }
      }
      this.applyAll(this.mode === "hidden" ? 0 : 1)
      this.interactable.onHoverEnter.add(() => (this.hover = true))
      this.interactable.onHoverExit.add(() => (this.hover = false))
      this.interactable.onTriggerStart.add((e: InteractorEvent) => this.beginDrag(e))
      this.interactable.onTriggerEnd.add(() => this.endDrag())
      this.interactable.onTriggerEndOutside.add(() => this.endDrag())
      this.interactable.onTriggerCanceled.add(() => this.endDrag())
    })
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  // ── public API (called by SteadyHandsMain / ghost) ─────────────────────────

  unfold(done?: () => void): void {
    this.isShown = true
    this.foldRoot.enabled = true
    this.foldRoot.getTransform().setLocalScale(vec3.one())
    this.mode = "unfolding"
    this.modeT = 0
    this.bandTarget = 0
    this.bandLevel = 0
    this.bandSwept = false
    this.bandSweepT = -1
    this.hideResultUi()
    this.applyUnfold(0)
    if (done) this.after(Math.max(0.05, this.scanSec), done)
  }

  fold(done?: () => void): void {
    this.isShown = false
    this.setPracticeEnabled(false)
    this.stopGhostTrace()
    if (this.mode === "hidden" || !this.foldRoot.enabled) {
      this.mode = "hidden"
      this.foldRoot.enabled = false
      if (done) done()
      return
    }
    for (const r of this.reveals) r.from = r.cur
    this.mode = "folding"
    this.modeT = 0
    this.foldDone = done
  }

  /** Ghost needle traces the ideal arc entry → exit over `sec`, leaving the guide trace. */
  playGhostTrace(sec: number, done?: () => void): void {
    this.trace = {t: 0, sec: Math.max(0.05, sec), done: done, doneFired: false}
    this.ghostFadeT = -1
    for (const d of this.dashes) d.enabled = false
    if (this.guideTint) this.guideTint?.setLevel(1)
    if (this.ghostHolder) {
      this.ghostHolder.enabled = true
      this.ghostTint?.setLevel(1)
      this.ghostGlowTint?.setLevel(0.85)
      this.ghostThreadTint?.setLevel(1)
      this.ghostThreadGlowTint?.setLevel(0.8)
    }
    this.updateTrace(0)
  }

  /** Stop any ghost trace (e.g. when "Ready to close" skips Rehearse). */
  stopGhostTrace(): void {
    this.trace = null
    this.ghostFadeT = -1
    if (this.ghostHolder) this.ghostHolder.enabled = false
    if (this.ghostThread) this.ghostThread.clear()
  }

  /** Show the needle and let the user grab it (on), or hide it entirely (off). */
  setPracticeEnabled(on: boolean): void {
    this.practiceEnabled = on
    this.practiceNeedle.enabled = on
    this.interactable.enabled = on
    if (!on) {
      this.dragging = false
      this.dragInteractor = null
    } else {
      // The guide stays up for the user's own try even if the ghost trace was skipped.
      for (const d of this.dashes) d.enabled = true
      // Show the pass zone; sweep a comet along it the first time each Rehearse.
      this.bandTarget = 1
      if (!this.bandSwept) {
        this.bandSwept = true
        this.bandSweepT = 0
      }
      if (this.guideTint && !this.trace) this.guideTint?.setLevel(0.8)
    }
  }

  /** Keep the needle visible where it was released, but not grabbable (while a result shows). */
  freezeNeedle(): void {
    this.practiceEnabled = false
    this.dragging = false
    this.dragInteractor = null
    this.interactable.enabled = false
    this.practiceNeedle.enabled = true
  }

  /** Draw a scored path as the trail and park the needle tip at its end (view cm). */
  showPath(path: P2[]): void {
    if (path.length === 0) return
    this.path = path.slice()
    this.setNeedleTip(path[path.length - 1])
    this.orientNeedleFromPath(true)
    this.updateTrail()
  }

  /** Colour the needle + trail green (pass) or red (fail), with a pulse / sparkle or shake. */
  showResult(pass: boolean): void {
    const c = pass ? GREEN : CORAL
    this.needleTint?.setColor(c)
    this.trailTint?.setColor(c)
    this.startResultUi(pass)
    if (this.sparkle) this.sparkle.tint.setColor(pass ? new vec4(0.7, 1.0, 0.78, 1) : CORAL)
    if (this.comet) this.comet.tint.setColor(pass ? new vec4(0.75, 1.0, 0.82, 1) : CORAL)
    this.resultFx = {pass: pass, t: 0, pts: this.path.slice()}
  }

  /** Put the needle back at the entry point and clear the trail. */
  resetNeedle(): void {
    this.dragging = false
    this.dragInteractor = null
    this.path = []
    this.setNeedleTip(this.geom.entry)
    this.needleAngle = 0
    if (this.needleVisual) this.needleVisual.getTransform().setLocalRotation(quat.angleAxis(0, vec3.forward()))
    this.clearTrail()
    this.needleTint?.setColor(this.needleColor)
    this.trailTint?.setColor(this.needleColor)
    this.endResultFx()
    this.hideResultUi()
  }

  /** True while the user is holding the needle. */
  get isDragging(): boolean {
    return this.dragging
  }

  // ── drag handling ──────────────────────────────────────────────────────

  private beginDrag(e: InteractorEvent): void {
    if (!this.practiceEnabled) return
    this.dragging = true
    this.dragInteractor = e.interactor
    this.dragStartCursor = this.cursorLocal(e.interactor)
    this.path = [{x: this.geom.entry.x, y: this.geom.entry.y}]
    this.clearTrail()
    this.needleTint?.setColor(this.needleColor)
    this.trailTint?.setColor(this.needleColor)
    this.endResultFx()
    this.hideResultUi()
  }

  private endDrag(): void {
    if (!this.dragging) return
    this.dragging = false
    this.dragInteractor = null
    const p = this.path.slice()
    this._onPracticePath.invoke(p)
  }

  private onUpdate(): void {
    const dt = Math.min(0.05, getDeltaTime())
    this.updateTimeline(dt)
    this.updateAmbient(dt)
    if (this.trace) {
      this.trace.t += dt
      this.updateTrace(this.trace.t)
    } else if (this.ghostFadeT >= 0) {
      this.updateGhostFade(dt)
    }
    this.updateResultFx(dt)
    this.updateScoringVisuals(dt)

    if (!this.dragging || !this.dragInteractor) return
    if (!this.dragInteractor.isTriggering) {
      this.endDrag()
      return
    }
    const cur = this.cursorLocal(this.dragInteractor)
    if (!cur) return
    if (!this.dragStartCursor) this.dragStartCursor = cur
    // Relative drag: the tip starts exactly at the entry point wherever the grab zone was pinched.
    const tip = {
      x: this.clamp(this.geom.entry.x + (cur.x - this.dragStartCursor.x), -SECTION_W / 2, SECTION_W / 2),
      y: this.clamp(this.geom.entry.y + (cur.y - this.dragStartCursor.y), -SECTION_H / 2, SECTION_H / 2),
    }
    this.setNeedleTip(tip)
    const last = this.path[this.path.length - 1]
    if (dist(last, tip) >= 0.03) {
      this.path.push(tip)
      this.updateTrail()
    }
    this.orientNeedleFromPath(false)
  }

  /** Interactor ray → this section's plane, in section-local view cm. */
  private cursorLocal(interactor: Interactor): P2 | null {
    const t = this.getTransform()
    const o = interactor.startPoint
    const d = interactor.direction
    let hit: vec3 | null = null
    if (o && d) {
      const n = t.forward
      const denom = d.dot(n)
      if (Math.abs(denom) > 1e-6) {
        const s = t.getWorldPosition().sub(o).dot(n) / denom
        if (s > 0) hit = o.add(d.uniformScale(s))
      }
    }
    if (!hit) hit = interactor.planecastPoint
    if (!hit) return null
    const l = t.getInvertedWorldTransform().multiplyPoint(hit)
    return {x: l.x, y: l.y}
  }

  private setNeedleTip(p: P2): void {
    this.practiceNeedle.getTransform().setLocalPosition(new vec3(p.x, p.y, NEEDLE_Z))
  }

  /** Point the needle body along the travel direction (tip leads, body trails on its circle). */
  private orientNeedleFromPath(snap: boolean): void {
    if (!this.needleVisual || this.path.length < 2) return
    const tip = this.path[this.path.length - 1]
    let back: P2 | null = null
    for (let i = this.path.length - 2; i >= 0; i--) {
      if (dist(this.path[i], tip) >= 0.35) {
        back = this.path[i]
        break
      }
    }
    if (!back) return
    const target = Math.atan2(tip.y - back.y, tip.x - back.x) + Math.PI / 2
    let d = target - this.needleAngle
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    this.needleAngle += snap ? d : d * Math.min(1, getDeltaTime() * 14)
    this.needleVisual.getTransform().setLocalRotation(quat.angleAxis(this.needleAngle, vec3.forward()))
  }

  private updateTrail(): void {
    if (this.trail) this.trail.setPath(this.path, (p) => this.deviationColor(p))
    // Once the needle has travelled, the trail IS the thread; the swaged stub only shows at rest.
    if (this.needleStub) this.needleStub.enabled = this.path.length < 2
  }

  private clearTrail(): void {
    if (this.trail) this.trail.clear()
    if (this.needleStub) this.needleStub.enabled = true
  }

  private clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v))
  }

  private after(seconds: number, fn: () => void): void {
    const ev = this.createEvent("DelayedCallbackEvent")
    ev.bind(() => fn())
    ev.reset(seconds)
  }

  // ── timeline: scan-in / fold-away ───────────────────────────────────────

  private applyAll(k: number): void {
    for (const r of this.reveals) {
      r.cur = k
      r.apply(k)
    }
    if (this.scanRing) this.scanRing.so.enabled = false
    this.labelReveal(k)
  }

  /** Labels live under the (initially disabled) Fold: call them only once their script is live. */
  private labelReveal(k: number): void {
    const l = this.labels as any
    if (l && typeof l.setReveal === "function") l.setReveal(k)
  }

  private applyUnfold(t: number): void {
    this.overlayFade = 1
    for (const r of this.reveals) {
      r.cur = r.unfold(t)
      r.apply(r.cur)
    }
    const U = this.scanSec
    this.labelReveal(clamp01((t - 0.62 * U) / (0.38 * U)))
    if (this.scanRing) {
      const y0 = BLOCK_BOTTOM - 0.15
      const y1 = SURFACE_Y + 0.25
      const u = clamp01((t - 0.1 * U) / (0.62 * U))
      const lvl = smooth01(u / 0.08) * (1 - smooth01((t - 0.72 * U) / (0.2 * U)))
      this.scanRing.so.enabled = lvl > 0.01
      this.scanRing.so.getTransform().setLocalPosition(new vec3(0, y0 + (y1 - y0) * easeInOutQuad(u), 0))
      this.scanRing.tint.setLevel(lvl)
    }
  }

  private applyFold(t: number): void {
    this.overlayFade = 1 - smooth01(t / (0.3 * this.foldSec))
    for (const r of this.reveals) {
      r.cur = r.from * r.fold(t)
      r.apply(r.cur)
    }
    const F = this.foldSec
    this.labelReveal(1 - smooth01(t / (0.3 * F)))
    if (this.scanRing) {
      const y0 = SURFACE_Y + 0.25
      const y1 = BLOCK_BOTTOM - 0.15
      const u = clamp01((t - 0.05 * F) / (0.75 * F))
      const lvl = smooth01(u / 0.1) * (1 - smooth01((u - 0.8) / 0.2))
      this.scanRing.so.enabled = lvl > 0.01
      this.scanRing.so.getTransform().setLocalPosition(new vec3(0, y0 + (y1 - y0) * easeInOutQuad(u), 0))
      this.scanRing.tint.setLevel(lvl)
    }
  }

  private updateTimeline(dt: number): void {
    if (this.mode === "unfolding") {
      this.modeT += dt
      this.applyUnfold(this.modeT)
      if (this.modeT >= this.scanSec + 0.05) {
        this.mode = "shown"
        this.applyAll(1)
      }
    } else if (this.mode === "folding") {
      this.modeT += dt
      this.applyFold(this.modeT)
      if (this.modeT >= this.foldSec) {
        this.mode = "hidden"
        this.foldRoot.enabled = false
        this.foldRoot.getTransform().setLocalPosition(vec3.zero())
        const d = this.foldDone
        this.foldDone = undefined
        if (d) d()
      }
    }
  }

  /** Grab-zone pulse, link pulses, guide breathing. */
  private updateAmbient(dt: number): void {
    this.pulseT += dt
    if (this.grabRing && this.practiceNeedle.enabled) {
      const live = this.practiceEnabled && !this.dragging
      const target = !live ? 0.25 : this.hover ? 1 : 0.55 + 0.15 * Math.sin(this.pulseT * 3.2)
      const cur = this.grabRing.tint.getLevel()
      this.grabRing.tint.setLevel(cur + (target - cur) * Math.min(1, dt * 10))
      const s = (this.hover && live ? 1.12 : 1) * (1 + (live ? 0.05 * Math.sin(this.pulseT * 3.2) : 0))
      const tr = this.grabRing.so.getTransform()
      tr.setLocalScale(new vec3(s, s, s))
      tr.setLocalRotation(quat.angleAxis(this.pulseT * 0.35, vec3.forward()))
    }
    // Light pulses travelling up the projection link.
    for (const d of this.linkDots) {
      const u = (this.pulseT / 2.6 + d.phase) % 1
      d.piece.so.getTransform().setLocalPosition(vec3.lerp(d.from, d.to, u))
      d.piece.tint.setLevel(this.linkLevel * Math.sin(Math.PI * u) * 0.9)
    }
  }

  // ── ghost trace ─────────────────────────────────────────────────────────

  private ghostPose(phi: number): {pos: vec3; angle: number} {
    const g = this.geom
    return {
      pos: new vec3(g.center.x + Math.cos(phi) * g.radius, g.center.y + Math.sin(phi) * g.radius, NEEDLE_Z),
      angle: phi + Math.PI,
    }
  }

  private updateTrace(t: number): void {
    const tr = this.trace
    if (!tr) return
    const g = this.geom
    const u = clamp01(t / tr.sec)
    const e = easeInOutQuad(u)
    const pull = Math.max(0, t - tr.sec)
    const PULL_SEC = 0.6
    const phi = pull > 0 ? 2 * Math.PI + 1.3 * easeOutCubic(pull / PULL_SEC) : Math.PI + Math.PI * e
    if (this.ghostHolder) {
      const p = this.ghostPose(phi)
      const ht = this.ghostHolder.getTransform()
      ht.setLocalPosition(p.pos)
      ht.setLocalRotation(quat.angleAxis(p.angle, vec3.forward()))
    }
    // Dashes appear as the tip passes them.
    for (let i = 0; i < this.dashes.length; i++) this.dashes[i].enabled = (i + 0.5) / this.dashes.length <= e + 1e-3
    // Thread drawn behind the ghost tip along the arc.
    if (this.ghostThread) {
      const end = Math.min(2 * Math.PI, phi)
      const n = Math.max(2, Math.ceil(((end - Math.PI) / Math.PI) * 40))
      const pts: P2[] = []
      for (let i = 0; i <= n; i++) {
        const a = Math.PI + ((end - Math.PI) * i) / n
        pts.push({x: g.center.x + Math.cos(a) * g.radius, y: g.center.y + Math.sin(a) * g.radius})
      }
      if (pull > 0) {
        const tip = this.ghostPose(phi).pos
        pts.push({x: tip.x, y: tip.y})
      }
      if (end > Math.PI + 0.02) this.ghostThread.setPath(pts)
    }
    if (u >= 1 && !tr.doneFired) {
      tr.doneFired = true
      for (const d of this.dashes) d.enabled = true
      if (tr.done) tr.done()
    }
    if (pull > 0) {
      const k = 1 - smooth01(pull / PULL_SEC)
      this.ghostTint?.setLevel(k)
      this.ghostGlowTint?.setLevel(0.85 * k)
      this.guideTint?.setLevel(0.8 + 0.2 * k)
    }
    if (pull >= PULL_SEC) {
      this.trace = null
      if (this.ghostHolder) this.ghostHolder.enabled = false
      this.ghostFadeT = 0
    }
  }

  /** After the ghost leaves, its thread fades so the user's own thread reads clearly. */
  private updateGhostFade(dt: number): void {
    this.ghostFadeT += dt
    const k = 1 - smooth01(this.ghostFadeT / 0.8)
    this.ghostThreadTint?.setLevel(k)
    this.ghostThreadGlowTint?.setLevel(0.8 * k)
    if (k <= 0) {
      this.ghostFadeT = -1
      if (this.ghostThread) this.ghostThread.clear()
    }
  }

  // ── result feedback ─────────────────────────────────────────────────────

  private updateResultFx(dt: number): void {
    const fx = this.resultFx
    if (!fx) return
    fx.t += dt
    const t = fx.t
    if (fx.pass) {
      // Comet runs the thread, then the sparkle blooms at its end.
      const run = 0.5
      if (this.comet && fx.pts.length >= 2) {
        const u = clamp01(t / run)
        const p = this.pointAlong(fx.pts, easeInOutQuad(u))
        this.comet.so.enabled = t < run + 0.25
        this.comet.so.getTransform().setLocalPosition(new vec3(p.x, p.y, NEEDLE_Z + 0.05))
        this.comet.tint.setLevel(t < run ? 1 : 1 - smooth01((t - run) / 0.25))
      }
      if (this.sparkle && fx.pts.length >= 1) {
        const s0 = run - 0.05
        const v = clamp01((t - s0) / 0.7)
        const end = fx.pts[fx.pts.length - 1]
        this.sparkle.so.enabled = t > s0 && v < 1
        const tr = this.sparkle.so.getTransform()
        tr.setLocalPosition(new vec3(end.x, end.y, NEEDLE_Z + 0.08))
        const sc = 0.35 + 1.0 * easeOutCubic(v)
        tr.setLocalScale(new vec3(sc, sc, sc))
        tr.setLocalRotation(quat.angleAxis(0.6 * v, vec3.forward()))
        this.sparkle.tint.setLevel(1 - smooth01((v - 0.25) / 0.75))
      }
      if (t > 1.4) this.endResultFx()
    } else {
      // Shake the whole diagram (decaying), blink the thread glow.
      const sh = t < 0.5 ? 0.22 * Math.sin(t * 2 * Math.PI * 9) * Math.exp(-t * 6) : 0
      this.foldRoot.getTransform().setLocalPosition(new vec3(sh, 0, 0))
      if (t > 0.65) this.endResultFx()
    }
  }

  private endResultFx(): void {
    this.resultFx = null
    if (this.comet) this.comet.so.enabled = false
    if (this.sparkle) this.sparkle.so.enabled = false
    if (this.foldRoot) this.foldRoot.getTransform().setLocalPosition(vec3.zero())
  }

  private pointAlong(pts: P2[], f: number): P2 {
    let L = 0
    for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i])
    let d = L * f
    for (let i = 1; i < pts.length; i++) {
      const s = dist(pts[i - 1], pts[i])
      if (d <= s && s > 1e-6) {
        const u = d / s
        return {x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u}
      }
      d -= s
    }
    return pts[pts.length - 1]
  }

  // ── scoring visuals ───────────────────────────────────────────────────

  /** Pass tolerance in view cm (REAL mm × viewScale). */
  private tolView(): number {
    return (this.toleranceMm * this.viewScale) / 10
  }

  private badgeSpot(): vec3 {
    return new vec3(this.geom.exit.x + 0.95, SURFACE_Y + 1.55, 0.35)
  }

  /** Mint inside the tolerance, amber past 70 % of it, coral outside. */
  private deviationColor(p: P2): [number, number, number] {
    const u = distanceToIdealArc(p, this.geom) / Math.max(1e-4, this.tolView())
    const a = smooth01((u - 0.62) / 0.16)
    const b = smooth01((u - 0.94) / 0.12)
    const mix = (x: [number, number, number], y: [number, number, number], t: number): [number, number, number] => [
      x[0] + (y[0] - x[0]) * t,
      x[1] + (y[1] - x[1]) * t,
      x[2] + (y[2] - x[2]) * t,
    ]
    return mix(mix(MINT, AMBER, a), CORAL3, b)
  }

  private uiReadout(text: string, c: vec4, k: number): void {
    const l = this.labels as any
    if (l && typeof l.setReadout === "function") l.setReadout(text, c, k)
  }

  private startResultUi(pass: boolean): void {
    let readout = "—"
    let angleDeg = 0
    if (this.path.length >= 2) {
      const s = scoreStitchPath(this.path, this.geom, this.toleranceMm, this.angleToleranceDeg)
      angleDeg = s.entryAngleDeg
      const dev = isFinite(s.maxDeviationMm) ? s.maxDeviationMm.toFixed(1) : "—"
      readout = `${dev} mm · ${Math.round(s.entryAngleDeg)}°`
    }
    this.resultUi = {t: 0, pass: pass, angleDeg: angleDeg, readout: readout}
    const angleOk = Math.abs(90 - angleDeg) <= this.angleToleranceDeg
    if (this.protractor) {
      this.protractor.root.enabled = true
      this.protractor.needle.tint.setColor(angleOk ? GREEN : CORAL)
      this.protractor.needle.so.getTransform().setLocalRotation(quat.angleAxis(-Math.PI / 2, vec3.forward()))
    }
    if (this.badgePass) this.badgePass.so.enabled = false
    if (this.badgeFail) this.badgeFail.so.enabled = false
    this.uiReadout(readout, pass ? new vec4(0.55, 1, 0.68, 1) : new vec4(1, 0.55, 0.52, 1), 0)
  }

  private hideResultUi(): void {
    this.resultUi = null
    if (this.protractor) this.protractor.root.enabled = false
    if (this.badgePass) this.badgePass.so.enabled = false
    if (this.badgeFail) this.badgeFail.so.enabled = false
    if (this.angleGuide && this.isShown && this.mode === "shown") this.angleGuide.tint.setLevel(1)
    this.uiReadout("", new vec4(1, 1, 1, 1), 0)
  }

  /** Tolerance band (+ one comet sweep), protractor, badge and readout animation. */
  private updateScoringVisuals(dt: number): void {
    const fade = this.mode === "hidden" ? 0 : this.overlayFade
    // Band eases toward its target; the comet sweeps entry → exit once.
    if (this.band) {
      const k = Math.min(1, dt * 4)
      this.bandLevel += (this.bandTarget - this.bandLevel) * k
      const lvl = this.bandLevel * fade
      this.band.so.enabled = lvl > 0.01
      this.band.tint.setLevel(lvl)
    }
    if (this.bandComet) {
      if (this.bandSweepT >= 0 && this.mode !== "hidden") {
        this.bandSweepT += dt
        const u = clamp01((this.bandSweepT - 0.15) / 0.9)
        const g = this.geom
        const phi = Math.PI + Math.PI * easeInOutQuad(u)
        this.bandComet.so.enabled = true
        this.bandComet.so.getTransform().setLocalPosition(new vec3(g.center.x + Math.cos(phi) * g.radius, g.center.y + Math.sin(phi) * g.radius, 0.32))
        this.bandComet.tint.setLevel(Math.sin(Math.PI * u) * fade)
        if (u >= 1) {
          this.bandSweepT = -1
          this.bandComet.so.enabled = false
        }
      } else {
        this.bandComet.so.enabled = false
      }
    }
    const r = this.resultUi
    if (!r) return
    r.t += dt
    const t = r.t
    if (this.protractor) {
      const kp = easeOutBack(t / 0.35)
      const s = Math.max(0.01, 0.35 + 0.65 * kp)
      this.protractor.root.getTransform().setLocalScale(new vec3(s, s, s))
      const lv = smooth01(t / 0.2) * fade
      this.protractor.frame.tint.setLevel(lv)
      this.protractor.needle.tint.setLevel(lv)
      const e = easeOutCubic((t - 0.12) / 0.45)
      const target = (-r.angleDeg * Math.PI) / 180
      const ang = -Math.PI / 2 + (target + Math.PI / 2) * (t < 0.12 ? 0 : e)
      this.protractor.needle.so.getTransform().setLocalRotation(quat.angleAxis(ang, vec3.forward()))
    }
    if (this.angleGuide) this.angleGuide.tint.setLevel(1 - 0.75 * smooth01(t / 0.3))
    const badge = r.pass ? this.badgePass : this.badgeFail
    if (badge) {
      const u = (t - 0.22) / 0.38
      badge.so.enabled = u > 0
      const s = Math.max(0.01, easeOutBack(u))
      badge.so.getTransform().setLocalScale(new vec3(s, s, s))
      badge.tint.setLevel(smooth01(u / 0.5) * fade)
    }
    this.uiReadout("", r.pass ? new vec4(0.55, 1, 0.68, 1) : new vec4(1, 0.55, 0.52, 1), smooth01((t - 0.35) / 0.25) * fade)
  }

  // ── construction ───────────────────────────────────────────────────────

  private buildInteraction(): void {
    const so = this.practiceNeedle
    // Collider on the unit-scale needle object (origin = needle tip): a sphere = the 2 cm grab zone.
    const collider = so.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createSphereShape()
    shape.radius = this.grabZoneCm / 2
    collider.shape = shape
    collider.fitVisual = false
    this.interactable = so.createComponent(Interactable.getTypeName()) as Interactable
    this.interactable.enableInstantDrag = true
    this.interactable.keepHoverOnTrigger = true
  }

  /** Minimal Tints so the API (and tests reading tint colours) still work without materials. */
  private buildFallbackTints(): void {
    // Prefer the plain unlit material: it always has a pass (an unsaved XSection material may not).
    const candidates = [this.unlitMaterial, this.vertexColorMaterial, this.tissueMaterial].filter((m) => !!m)
    let base: Material | null = null
    for (const m of candidates) {
      try {
        glowMaterial(m).mainPass.baseColor = new vec4(1, 1, 1, 1)
        base = m
        break
      } catch (e) {
        // try the next one
      }
    }
    if (!base) {
      print("[CrossSection] ERROR: no usable material for the needle/trail tints")
      return
    }
    const b = base
    const t = (c: vec4) => new Tint(glowMaterial(b), c, "add")
    this.needleTint = t(this.needleColor)
    this.trailTint = t(this.needleColor)
    this.trailCoreTint = t(new vec4(1, 1, 1, 1))
    this.haloTint = t(CYAN)
    this.guideTint = t(this.guideColor)
    this.ghostTint = t(this.guideColor)
    this.ghostGlowTint = t(this.guideColor)
    this.ghostThreadTint = t(this.guideColor)
    this.ghostThreadGlowTint = t(this.guideColor)
  }

  private blockBox(): Box {
    return {x0: -SECTION_W / 2 - 0.06, x1: SECTION_W / 2 + 0.06, y0: BLOCK_BOTTOM - 0.06, y1: SURFACE_Y + 0.1, z0: -BLOCK_DEPTH - 0.06, z1: 0.08}
  }

  private buildVisuals(): void {
    const fold = this.foldRoot
    const vc = this.vertexColorMaterial
    const view = this.view
    const sc = this.viewScale / 4.5
    const g = this.geom

    // 1) Tissue block.
    this.tissue = buildTissue(
      fold,
      {viewScale: this.viewScale, surfaceY: SURFACE_Y, cutX: CUT_X, width: SECTION_W, bottomY: BLOCK_BOTTOM, depth: BLOCK_DEPTH, view: view},
      {
        tissue: this.tissueMaterial,
        vc: vc,
        skin: this.skinTexture || null,
        dermis: this.dermisTexture || null,
        fat: this.fatTexture || null,
        muscle: this.muscleTexture || null,
      },
    )
    const layers = this.tissue.layers
    const U = () => this.scanSec
    const span = SURFACE_Y - BLOCK_BOTTOM
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]
      const startFrac = clamp01((l.pivotY - BLOCK_BOTTOM) / span)
      const fromTop = layers.length - 1 - i
      this.reveals.push({
        name: l.label,
        cur: 0,
        from: 1,
        apply: (k) => {
          l.so.enabled = k > 0.003
          l.so.getTransform().setLocalScale(new vec3(1, Math.max(0.003, k), 1))
        },
        unfold: (t) => {
          const s0 = (0.1 + 0.62 * startFrac) * U() - 0.04
          const x = (t - s0) / (0.26 * U())
          return x <= 0 ? 0 : easeOutBack(x)
        },
        fold: (t) => {
          const s0 = 0.08 * this.foldSec + fromTop * 0.07 * this.foldSec
          const x = clamp01((t - s0) / (0.36 * this.foldSec))
          return 1 - x * x
        },
      })
    }

    // 2) Holographic framing.
    const box = this.blockBox()
    const frame = buildFrame(fold, vc, box, view)
    this.addFade("Frame", frame, (t) => smooth01((t - 0.55 * U()) / (0.3 * U())), (t) => 1 - smooth01(t / (0.35 * this.foldSec)))
    this.platform = buildPlatform(fold, vc, box, BLOCK_BOTTOM - 0.14)
    this.addFade("Platform", this.platform, (t) => smooth01(t / (0.25 * U())), (t) => 1 - smooth01((t - 0.5 * this.foldSec) / (0.4 * this.foldSec)))
    this.scanRing = buildScanRing(fold, vc, box, view)
    this.scanRing.so.enabled = false

    // Badge pill (outline) around the "<scale>×" text.
    const lay = this.layoutSpots()
    const pill = buildPill(fold, vc, [lay.badge.x, lay.badge.y, lay.badge.z - 0.02], 2.1, 1.0)
    this.addFade("BadgePill", pill, (t) => smooth01((t - 0.62 * U()) / (0.25 * U())), (t) => 1 - smooth01(t / (0.3 * this.foldSec)))

    // Layer callout leaders.
    const callouts = this.calloutSpecs()
    for (let i = 0; i < callouts.length; i++) {
      const c = callouts[i]
      const lp = buildLeader(fold, vc, c.anchor, c.elbow, c.end, c.color)
      this.leaders.push(lp)
      const s0 = 0.66 + 0.05 * i
      this.addFade("Leader" + i, lp, (t) => smooth01((t - s0 * U()) / (0.2 * U())), (t) => 1 - smooth01(t / (0.3 * this.foldSec)))
    }

    // 3) Guide: targets, 90° guide, dashed ideal arc.
    const tE = buildTarget(fold, vc, g.entry.x, g.entry.y, view, 0.9)
    const tX = buildTarget(fold, vc, g.exit.x, g.exit.y, view, 0.9)
    const ag = buildAngleGuide(fold, vc, g.entry.x, g.entry.y, 0.2)
    this.angleGuide = ag
    for (const [n, p] of [
      ["EntryTarget", tE],
      ["ExitTarget", tX],
      ["AngleGuide", ag],
    ] as [string, GlowPiece][]) {
      this.addFade(n, p, (t) => smooth01((t - 0.8 * U()) / (0.2 * U())), (t) => 1 - smooth01(t / (0.3 * this.foldSec)))
    }
    const arc = buildDashedArc(fold, vc, g.center.x, g.center.y, g.radius, 0.22, 15)
    this.guideTint = arc.tint
    this.dashes = arc.dashes
    for (const d of this.dashes) d.enabled = false

    // 4) Ghost needle (hologram twin) + ghost thread.
    const ghostBody = alphaMaterial(vc, false)
    this.ghostTint = new Tint(ghostBody, GHOST, "alpha")
    const ghostGlow = glowMaterial(vc)
    this.ghostGlowTint = new Tint(ghostGlow, this.guideColor, "add")
    const ghostThreadMat = alphaMaterial(vc, false)
    this.ghostThreadTint = new Tint(ghostThreadMat, GHOST, "alpha")
    this.ghostHolder = global.scene.createSceneObject("GhostNeedle")
    this.ghostHolder.setParent(fold)
    const wire = Math.max(0.085, 0.028 * this.viewScale)
    buildNeedle(this.ghostHolder, {R: g.radius, wire: wire, bodyMat: ghostBody, hologram: true, view: view, haloMat: ghostGlow, threadMat: ghostThreadMat})
    this.ghostHolder.enabled = false
    const gtGlow = glowMaterial(vc)
    this.ghostThreadGlowTint = new Tint(gtGlow, this.guideColor, "add")
    this.ghostThread = new XSThread(fold, "GhostThread", ghostThreadMat, gtGlow, 72, 0.05 * Math.max(0.8, sc), 0.26, 0.24, view)
    this.ghostThread.clear()

    // 5) Practice needle: chrome body + glow (needleTint), thread stub + trail (trailTint).
    const chromeMat = vc.clone()
    const needleGlow = glowMaterial(vc)
    this.needleTint = new Tint(needleGlow, this.needleColor, "add")
    // Thread core: normal-blended, white tint, coloured per segment by distance from the ideal
    // arc (mint / amber / coral). trailTint is the thread's overall glow: white while dragging,
    // green on pass, coral on fail (level always 1; LEAF reads its colour).
    const threadMat = alphaMaterial(vc, false)
    this.trailCoreTint = new Tint(threadMat, new vec4(1, 1, 1, 1), "alpha")
    const trailGlow = glowMaterial(vc)
    this.trailTint = new Tint(trailGlow, this.needleColor, "add")
    this.needleVisual = global.scene.createSceneObject("NeedleVisual")
    this.needleVisual.setParent(this.practiceNeedle)
    const pn = buildNeedle(this.needleVisual, {R: g.radius, wire: wire, bodyMat: chromeMat, hologram: false, view: view, haloMat: needleGlow, threadMat: threadMat})
    this.needleStub = pn.thread
    this.grabRing = buildGrabRing(this.practiceNeedle, vc, this.grabZoneCm / 2, CYAN)
    this.haloTint = this.grabRing.tint
    this.haloTint.setLevel(0.55)
    this.trail = new XSThread(fold, "DragTrail", threadMat, trailGlow, 140, 0.058 * Math.max(0.8, sc), 0.3, 0.26, view)
    this.trail.clear()

    // 6) Result feedback.
    this.sparkle = buildSparkle(fold, vc, GREEN)
    this.sparkle.so.enabled = false
    this.comet = buildDot(fold, vc, "PassComet", 0.45, [0, 0, 1], GREEN)
    this.comet.so.enabled = false

    // 7) Scoring made visible: tolerance band, entry protractor, shape-coded badges.
    this.band = buildToleranceBand(fold, vc, g.center.x, g.center.y, g.radius, this.tolView(), 0.2)
    this.band.so.enabled = false
    this.bandComet = buildDot(fold, vc, "BandComet", 0.34, [0, 0, 1], new vec4(0.65, 0.96, 1, 1))
    this.bandComet.so.enabled = false
    this.protractor = buildProtractor(fold, vc, [g.entry.x, g.entry.y, 0.27], Math.max(0.7, 0.28 * this.viewScale), this.angleToleranceDeg)
    this.protractor.root.enabled = false
    const bp = this.badgeSpot()
    this.badgePass = buildResultBadge(fold, vc, true, 0.42, GREEN)
    this.badgeFail = buildResultBadge(fold, vc, false, 0.42, CORAL)
    for (const b of [this.badgePass, this.badgeFail]) {
      b.so.getTransform().setLocalPosition(bp)
      b.so.enabled = false
    }

    let tris = this.tissue.triangles
    print(`[CrossSection] built 3D cross-section: ${layers.length} layers, ~${tris} tissue triangles, viewScale ${this.viewScale}`)
  }

  private addFade(name: string, p: GlowPiece, unfold: (t: number) => number, fold: (t: number) => number): void {
    this.reveals.push({
      name: name,
      cur: 0,
      from: 1,
      apply: (k) => {
        p.so.enabled = k > 0.003
        p.tint.setLevel(k)
      },
      unfold: unfold,
      fold: fold,
    })
  }

  /** Projection link from the wound on the pad up to the block (needs world transforms: OnStart). */
  private buildWoundLink(): void {
    const fold = this.foldRoot
    const inv = fold.getTransform().getInvertedWorldTransform()
    let woundW: vec3
    let ax: vec3
    let ay: vec3
    let az: vec3
    if (this.woundAnchor) {
      const m = this.woundAnchor.getTransform().getWorldTransform()
      woundW = m.multiplyPoint(new vec3(0, this.woundTopOffset, 0))
      ax = m.multiplyDirection(new vec3(1, 0, 0)).normalize()
      ay = m.multiplyDirection(new vec3(0, 1, 0)).normalize()
      az = m.multiplyDirection(new vec3(0, 0, 1)).normalize()
    } else {
      // Fallback: 15 cm straight down in the parent's frame.
      const parent = this.getSceneObject().getParent()
      const lp = this.getTransform().getLocalPosition()
      const pm = parent ? parent.getTransform().getWorldTransform() : mat4.identity()
      woundW = pm.multiplyPoint(new vec3(lp.x, lp.y - 15, lp.z))
      ax = pm.multiplyDirection(new vec3(1, 0, 0)).normalize()
      ay = pm.multiplyDirection(new vec3(0, 1, 0)).normalize()
      az = pm.multiplyDirection(new vec3(0, 0, 1)).normalize()
    }
    const toL = (v: vec3): V3 => [v.x, v.y, v.z]
    const w = inv.multiplyPoint(woundW)
    const dx = inv.multiplyDirection(ax).normalize()
    const dy = inv.multiplyDirection(ay).normalize()
    const dz = inv.multiplyDirection(az).normalize()
    const cornerL: V3 = [-SECTION_W / 2, BLOCK_BOTTOM - 0.14, 0.05]
    const cornerR: V3 = [SECTION_W / 2, BLOCK_BOTTOM - 0.14, 0.05]
    const res = buildWoundLink(fold, this.vertexColorMaterial, {
      wound: toL(w),
      padX: toL(dx),
      padUp: toL(dy),
      padZ: toL(dz),
      cornerL: cornerL,
      cornerR: cornerR,
      sliceLen: SECTION_W / this.viewScale,
      view: this.view,
    })
    this.link = res.link
    this.reticle = res.reticle
    const U = () => this.scanSec
    this.addFade("WoundLink", res.link, (t) => smooth01((t - 0.05 * U()) / (0.3 * U())), (t) => 1 - smooth01((t - 0.4 * this.foldSec) / (0.5 * this.foldSec)))
    this.addFade("WoundReticle", res.reticle, (t) => smooth01(t / (0.2 * U())), (t) => 1 - smooth01((t - 0.5 * this.foldSec) / (0.45 * this.foldSec)))
    // Track the link level for the travelling pulses.
    this.reveals.push({
      name: "LinkPulseLevel",
      cur: 0,
      from: 1,
      apply: (k) => (this.linkLevel = k),
      unfold: (t) => smooth01((t - 0.3 * U()) / (0.3 * U())),
      fold: (t) => 1 - smooth01(t / (0.3 * this.foldSec)),
    })
    const r = 0.6
    const fromL = new vec3(w.x - dx.x * r, w.y - dx.y * r, w.z - dx.z * r)
    const fromR = new vec3(w.x + dx.x * r, w.y + dx.y * r, w.z + dx.z * r)
    const pairs: [vec3, V3, number][] = [
      [fromL, cornerL, 0],
      [fromR, cornerR, 0.5],
    ]
    for (const [from, to, phase] of pairs) {
      const dot = buildDot(fold, this.vertexColorMaterial, "LinkPulse", 0.32, this.view, CYAN)
      this.linkDots.push({piece: dot, from: from, to: new vec3(to[0], to[1], to[2]), phase: phase})
    }
  }

  // ── layout (view cm, Fold-local) ───────────────────────────────────────

  private layoutSpots(): {badge: vec3; message: vec3} {
    const headerY = SURFACE_Y + 2.55
    return {badge: new vec3(-SECTION_W / 2 + 1.05, headerY, 0.3), message: new vec3(-SECTION_W / 2 + 2.6, headerY, 0.3)}
  }

  private calloutSpecs(): {name: string; detail: string; anchor: V3; elbow: V3; end: V3; label: vec3; color: vec4}[] {
    const out: {name: string; detail: string; anchor: V3; elbow: V3; end: V3; label: vec3; color: vec4}[] = []
    if (!this.tissue) return out
    const W2 = SECTION_W / 2
    const ax = W2 - 0.8
    const labelX = W2 + 0.45 + BLOCK_DEPTH * Math.tan(Math.abs(this.yawDeg) * D2R)
    const top = this.tissue.layers.slice().reverse() // top → bottom
    let prevY = Infinity
    for (let i = 0; i < top.length; i++) {
      const l: LayerInfo = top[i]
      const mid = (l.top(ax, 0) + l.bottom(ax, 0)) / 2
      let ly = i === 0 ? mid + 0.45 : Math.min(mid, prevY - 0.8)
      if (l.key === "dermis") ly = Math.min(ly, prevY - 0.8)
      prevY = l.key === "dermis" ? ly - 0.35 : ly
      out.push({
        name: l.label,
        detail: l.key === "dermis" ? "holds the stitch" : "",
        anchor: [ax, mid, 0.14],
        elbow: [W2 + 0.3, ly, 0.14],
        end: [labelX - 0.15, ly, 0.14],
        label: new vec3(labelX, ly, 0.14),
        color: l.legend,
      })
    }
    return out
  }

  private labelLayout() {
    const g = this.geom
    const spots = this.layoutSpots()
    const callouts: CalloutSpec[] = this.calloutSpecs().map((c) => ({name: c.name, detail: c.detail, pos: c.label, color: c.color}))
    return {
      viewScale: this.viewScale,
      badge: {pos: spots.badge, align: "center" as const},
      message: {pos: spots.message, align: "left" as const},
      messageWidth: SECTION_W - 3.2,
      entry: {pos: new vec3(g.entry.x - 0.85, SURFACE_Y + 0.45, 0.3), align: "right" as const},
      exit: {pos: new vec3(g.exit.x + 0.85, SURFACE_Y + 0.45, 0.3), align: "left" as const},
      angle: {pos: new vec3(g.entry.x - 0.55, SURFACE_Y - 0.62, 0.3), align: "right" as const},
      readout: {pos: new vec3(this.badgeSpot().x + 0.62, this.badgeSpot().y, 0.35), align: "left" as const},
      callouts: callouts,
    }
  }
}
