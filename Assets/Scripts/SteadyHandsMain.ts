/**
 * SteadyHandsMain — the flow controller for The Steady Hands: rehearse → mark → close.
 *
 * Owns ALL flow state (single source of truth) and exposes it as readable public fields so
 * tests (LEAF) and the Inspector can see exactly where the flow is:
 *   phase, ghostDemoState, ghostStitchPlaced, crossSectionVisible, practiceResult,
 *   practiceAttempts, lastStitch*, rehearseEndReason, promptVisible, promptText, pinchCount,
 *   markedLengthCm, sutureCount, biteMarkCount, biteMarksVisible, countLabelText,
 *   needlesOut, alertVisible, alertText, mismatchChimeCount, isClosed, closedVisible.
 * Public actions (same paths the UI uses): pressReadyToClose(), submitPracticePath(flat),
 *   pinchPadAt(world), pinchPadLocal(x, z), markIncisionLocal(x1, z1, x2, z2),
 *   incrementNeedles(), decrementNeedles(), pressClose(), restartMarking(), restart().
 * Pure math lives in SteadyHandsMath (sutureCountForLength, scoreStitchPath, ...).
 *
 * Expects @inputs: the pad, cross-section and ghost controllers, the three UI modules, audio.
 * Must not: build visuals or UI text itself — it pushes state into the views and listens to
 * their events (Channel A).
 */
import {SteadyHandsAudioController} from "./SteadyHandsAudioController"
import {SteadyHandsClosingControlsUI} from "./SteadyHandsClosingControlsUI"
import {SteadyHandsCrossSectionController} from "./SteadyHandsCrossSectionController"
import {SteadyHandsCrossSectionUI} from "./SteadyHandsCrossSectionUI"
import {SteadyHandsGhostController} from "./SteadyHandsGhostController"
import {
  P2,
  StitchScore,
  clampNeedles,
  dist,
  formatCountLabel,
  formatMissing,
  idealArcPath,
  pathFromFlat,
  pathToFlat,
  scoreStitchPath,
  straightPath,
  sutureCountForLength,
} from "./SteadyHandsMath"
import {SteadyHandsPadController} from "./SteadyHandsPadController"
import {SteadyHandsPadLabelsUI} from "./SteadyHandsPadLabelsUI"

export type Phase = "starting" | "rehearse" | "mark" | "close" | "closed"

/** A second pinch closer than this to the first is treated as re-pinching the first end. */
const MIN_MARK_CM = 1.0

@component
export class SteadyHandsMain extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SteadyHandsMain – rehearse → mark → close</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("Suture pad controller (pinches, bite marks, ghost stitch)")
  pad: SteadyHandsPadController
  @input
  @hint("3x cross-section controller (practice needle)")
  crossSection: SteadyHandsCrossSectionController
  @input
  @hint("Labels on the 3x cross-section")
  crossSectionLabels: SteadyHandsCrossSectionUI
  @input
  @hint("Ghost attending demo")
  ghost: SteadyHandsGhostController
  @input
  @hint("Controls left of the pad (Ready to close, needle counter, Close)")
  controls: SteadyHandsClosingControlsUI
  @input
  @hint("Prompt, suture count and Closed labels on the pad")
  padLabels: SteadyHandsPadLabelsUI
  @input
  @hint("Sound cues")
  audio: SteadyHandsAudioController
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("Spacing between bites and from each end, cm (brief: 5 mm → 6.0 cm gives 11)")
  @widget(new SliderWidget(0.3, 1.0, 0.05))
  biteSpacingCm: number = 0.5
  @input
  @hint("Practice stitch: max distance from the ideal arc at REAL size, mm (brief: 1.5 mm)")
  @widget(new SliderWidget(0.5, 5, 0.1))
  stitchToleranceMm: number = 1.5
  @input
  @hint("Practice stitch: max entry-angle error from 90°, degrees (brief: 15°)")
  @widget(new SliderWidget(5, 45, 1))
  angleToleranceDeg: number = 15
  @input
  @hint("Seconds before the needle resets after a red stitch (brief: about 1 s)")
  @widget(new SliderWidget(0.2, 3, 0.1))
  retryDelaySec: number = 1.0
  @input
  @hint("Seconds the green result stays before Rehearse clears")
  @widget(new SliderWidget(0.2, 3, 0.1))
  passHoldSec: number = 1.2
  @input
  @hint("Seconds for the bite marks and count to fade after a successful Close")
  @widget(new SliderWidget(0.2, 3, 0.1))
  marksFadeSec: number = 0.8
  @ui.group_end

  // ── readable flow state (public for tests) ───────────────────────────────
  phase: Phase = "starting"
  ghostDemoState: string = "idle"
  /** Latched true once the ghost's stitch is fully placed on the pad during this Rehearse. */
  ghostStitchPlaced = false
  crossSectionVisible = false
  practiceResult: "none" | "pass" | "fail" = "none"
  practiceAttempts = 0
  lastStitchDeviationMm = 0
  lastStitchEntryAngleDeg = 0
  lastStitchEndErrorMm = 0
  lastStitchReason = ""
  rehearseEndReason: "" | "stitch" | "skip" = ""
  promptVisible = false
  promptText = ""
  pinchCount = 0
  markedLengthCm = 0
  sutureCount = 0
  countLabelText = ""
  needlesOut = 0
  alertVisible = false
  alertText = ""
  mismatchChimeCount = 0
  closeAttempts = 0
  isClosed = false
  closedVisible = false

  private firstPinch: vec3 | null = null
  private token = 0

  /** Bite pairs currently on the pad. */
  get biteMarkCount(): number {
    return this.pad ? this.pad.biteMarkCount : 0
  }
  get biteMarksVisible(): boolean {
    return this.pad ? this.pad.biteMarksVisible : false
  }
  /** True while the ghost's stitch is drawn on the pad. */
  get ghostStitchOnPad(): boolean {
    return this.pad ? this.pad.ghostStitchShown : false
  }

  onAwake(): void {
    const missing: string[] = []
    if (!this.pad) missing.push("pad")
    if (!this.crossSection) missing.push("crossSection")
    if (!this.crossSectionLabels) missing.push("crossSectionLabels")
    if (!this.ghost) missing.push("ghost")
    if (!this.controls) missing.push("controls")
    if (!this.padLabels) missing.push("padLabels")
    if (!this.audio) missing.push("audio")
    if (missing.length > 0) {
      print(`[SteadyHands] ERROR: @input not wired: ${missing.join(", ")} — check the Phase B wiring.`)
      return
    }
    this.createEvent("OnStartEvent").bind(() => {
      this.controls.onReadyToClose.add(() => this.pressReadyToClose())
      this.controls.onPlus.add(() => this.incrementNeedles())
      this.controls.onMinus.add(() => this.decrementNeedles())
      this.controls.onClose.add(() => this.pressClose())
      this.pad.onPadPinched.add((p: vec3) => this.onPadPinched(p))
      this.crossSection.onPracticePath.add((path: P2[]) => this.onPracticePath(path))
      // Rehearse starts on its own, once the UI modules have initialised.
      this.after(0.4, () => this.startRehearse())
    })
  }

  // ── Rehearse ─────────────────────────────────────────────────────────────

  startRehearse(): void {
    this.token++
    this.phase = "rehearse"
    this.ghostStitchPlaced = false
    this.practiceResult = "none"
    this.practiceAttempts = 0
    this.rehearseEndReason = ""
    this.resetMarkingState()
    this.isClosed = false
    this.closedVisible = false
    this.padLabels.hideClosed()
    this.padLabels.hidePrompt()
    this.padLabels.hideCount()
    this.promptVisible = false
    this.pad.setPinchEnabled(false)
    this.pad.clearBiteMarks()
    this.pad.hidePinchMarkers()
    this.controls.hideMissing()
    this.controls.setMode("rehearse")

    this.crossSection.resetNeedle()
    this.crossSection.setPracticeEnabled(false)
    this.crossSection.unfold()
    this.crossSectionVisible = true
    this.crossSectionLabels.setMessage(this.crossSectionLabels.watchText)

    this.ghostDemoState = "playing"
    const t = this.token
    this.ghost.play(() => {
      if (t !== this.token) return
      this.ghostDemoState = "done"
      this.ghostStitchPlaced = this.ghost.stitchPlaced
      if (this.phase === "rehearse") this.beginPractice()
    })
    this.after(0.1, () => this.pollGhost(t))
    this.log("rehearse started")
  }

  private pollGhost(t: number): void {
    if (t !== this.token || this.phase !== "rehearse") return
    if (this.ghost.stitchPlaced) this.ghostStitchPlaced = true
    if (!this.ghostStitchPlaced) this.after(0.1, () => this.pollGhost(t))
  }

  private beginPractice(): void {
    this.crossSection.resetNeedle()
    this.crossSection.setPracticeEnabled(true)
    this.crossSectionLabels.setMessage("Your turn: drag the needle from Entry to Exit")
    this.log("practice enabled")
  }

  /** Score a practice path (view cm). Same path the needle drag uses. */
  private onPracticePath(path: P2[]): void {
    if (this.phase !== "rehearse") return
    const s = this.scorePath(path)
    this.practiceAttempts++
    this.lastStitchDeviationMm = s.maxDeviationMm
    this.lastStitchEntryAngleDeg = s.entryAngleDeg
    this.lastStitchEndErrorMm = s.endErrorMm
    this.lastStitchReason = s.reason
    this.crossSection.showPath(path)
    this.crossSection.freezeNeedle()
    const t = this.token
    if (s.pass) {
      this.practiceResult = "pass"
      this.crossSection.showResult(true)
      this.crossSectionLabels.setResult(
        true,
        `Good stitch: within ${s.maxDeviationMm.toFixed(1)} mm, entry ${Math.round(s.entryAngleDeg)}°`,
      )
      this.audio.play("stitchGood")
      this.log(`practice PASS dev=${s.maxDeviationMm.toFixed(2)}mm angle=${s.entryAngleDeg.toFixed(1)}`)
      this.after(this.passHoldSec, () => {
        if (t === this.token) this.endRehearse("stitch")
      })
    } else {
      this.practiceResult = "fail"
      this.crossSection.showResult(false)
      this.crossSectionLabels.setResult(false, this.failMessage(s))
      this.audio.play("stitchMiss")
      this.log(`practice FAIL (${s.reason}) dev=${s.maxDeviationMm.toFixed(2)}mm angle=${s.entryAngleDeg.toFixed(1)}`)
      this.after(this.retryDelaySec, () => {
        if (t !== this.token || this.phase !== "rehearse") return
        this.crossSection.resetNeedle()
        this.crossSection.setPracticeEnabled(true)
        this.crossSectionLabels.setMessage("Try again: Entry to Exit along the arc")
      })
    }
  }

  private failMessage(s: StitchScore): string {
    if (s.reason === "missed exit") return `Missed the exit by ${s.endErrorMm.toFixed(1)} mm. Try again`
    if (s.reason === "off the arc") return `${s.maxDeviationMm.toFixed(1)} mm off the arc. Try again`
    if (s.reason === "entry angle") return `Entry ${Math.round(s.entryAngleDeg)}°, aim for 90°. Try again`
    return "Drag from Entry to Exit. Try again"
  }

  /** "Ready to close" (or a green stitch) clears Rehearse and shows the pinch prompt. */
  pressReadyToClose(): void {
    if (this.phase !== "rehearse") return
    this.audio.play("click")
    this.endRehearse("skip")
  }

  private endRehearse(reason: "stitch" | "skip"): void {
    if (this.phase !== "rehearse") return
    this.token++
    this.rehearseEndReason = reason
    this.ghost.stop()
    this.ghostDemoState = this.ghost.state
    this.pad.clearGhostStitch()
    this.crossSection.fold()
    this.crossSectionVisible = false
    this.controls.setMode("hidden")
    this.log(`rehearse ended (${reason})`)
    this.startMarking()
  }

  // ── Mark ────────────────────────────────────────────────────────────────

  private startMarking(): void {
    this.phase = "mark"
    this.resetMarkingState()
    this.pad.clearBiteMarks()
    this.pad.hidePinchMarkers()
    this.pad.setPinchEnabled(true)
    this.padLabels.hideCount()
    this.padLabels.hideClosed()
    this.padLabels.showPrompt()
    this.promptVisible = true
    this.promptText = this.padLabels.promptText
    this.controls.setMode("hidden")
    this.log("marking: waiting for two pinches")
  }

  private resetMarkingState(): void {
    this.firstPinch = null
    this.pinchCount = 0
    this.markedLengthCm = 0
    this.sutureCount = 0
    this.countLabelText = ""
    this.needlesOut = 0
    this.alertVisible = false
    this.alertText = ""
    this.controls.setNeedleCount(0)
  }

  /** A pinch on the pad (pad-local point on the top surface). */
  private onPadPinched(p: vec3): void {
    if (this.phase !== "mark") return
    this.audio.play("pinch")
    if (!this.firstPinch) {
      this.firstPinch = p
      this.pinchCount = 1
      this.pad.showPinchMarker(0, p)
      this.log(`pinch 1 at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`)
      return
    }
    const a: P2 = {x: this.firstPinch.x, y: this.firstPinch.z}
    const b: P2 = {x: p.x, y: p.z}
    const len = dist(a, b)
    if (len < MIN_MARK_CM) {
      // Too close to the first end — treat it as re-pinching that end.
      this.firstPinch = p
      this.pad.showPinchMarker(0, p)
      this.log("pinch too close to the first end; moved the first marker")
      return
    }
    this.pinchCount = 2
    this.pad.showPinchMarker(1, p)
    this.finishMarking(a, b, len)
  }

  private finishMarking(a: P2, b: P2, len: number): void {
    this.markedLengthCm = Math.round(len * 1000) / 1000
    this.sutureCount = sutureCountForLength(len, this.biteSpacingCm)
    this.pad.showBiteMarks(a, b, this.sutureCount)
    this.countLabelText = formatCountLabel(len, this.sutureCount)
    this.padLabels.showCount(this.countLabelText)
    this.padLabels.hidePrompt()
    this.promptVisible = false
    this.pad.setPinchEnabled(false)
    this.needlesOut = 0
    this.alertVisible = false
    this.alertText = ""
    this.controls.setNeedleCount(0)
    this.controls.hideMissing()
    this.controls.setMode("closing")
    this.phase = "close"
    this.log(`marked ${len.toFixed(2)} cm → ${this.sutureCount} sutures (${this.biteMarkCount} bite marks)`)
  }

  // ── Close ───────────────────────────────────────────────────────────────

  /** "+" — a needle was opened. */
  incrementNeedles(): void {
    if (this.phase !== "close") return
    this.needlesOut = clampNeedles(this.needlesOut + 1)
    this.controls.setNeedleCount(this.needlesOut)
    this.audio.play("click")
    this.log(`needles out: ${this.needlesOut}`)
  }

  /** "−" — a needle came back. Never below 0. */
  decrementNeedles(): void {
    if (this.phase !== "close") return
    this.needlesOut = clampNeedles(this.needlesOut - 1)
    this.controls.setNeedleCount(this.needlesOut)
    this.audio.play("click")
    this.log(`needles out: ${this.needlesOut}`)
  }

  /** "Close" — checked against zero. */
  pressClose(): void {
    if (this.phase !== "close") return
    this.closeAttempts++
    if (this.needlesOut > 0) {
      this.alertVisible = true
      this.alertText = formatMissing(this.needlesOut)
      this.controls.showMissing(this.alertText)
      this.audio.play("mismatch")
      this.mismatchChimeCount++
      this.log(`close blocked: ${this.alertText}`)
      return
    }
    this.alertVisible = false
    this.alertText = ""
    this.controls.hideMissing()
    this.controls.setMode("hidden")
    this.pad.fadeBiteMarks(this.marksFadeSec)
    this.padLabels.fadeOutCount(this.marksFadeSec)
    this.padLabels.showClosed()
    this.closedVisible = true
    this.isClosed = true
    this.phase = "closed"
    this.audio.play("closed")
    this.log("closed")
  }

  // ── test / demo entry points (same code paths as the real input) ───────────

  /** Pinch at a world point; it lands where it hits the pad's top surface. */
  pinchPadAt(world: vec3): void {
    this.pad.pinchAtWorld(world)
  }

  /** Pinch at a pad-local point (x along the cut, z toward the user), cm from the pad centre. */
  pinchPadLocal(x: number, z: number): void {
    this.pad.pinchAtLocal(x, z)
  }

  /** Mark an incision between two pad-local points (re-enters Mark if needed). */
  markIncisionLocal(x1: number, z1: number, x2: number, z2: number): void {
    if (this.phase !== "mark") this.restartMarking()
    this.pinchPadLocal(x1, z1)
    this.pinchPadLocal(x2, z2)
  }

  /** Go (back) to the Mark step: clears marks, count, alert and Closed. */
  restartMarking(): void {
    if (this.phase === "rehearse") {
      this.endRehearse("skip")
      return
    }
    this.token++
    this.isClosed = false
    this.closedVisible = false
    this.startMarking()
  }

  /** Start the whole flow again from Rehearse. */
  restart(): void {
    this.ghost.stop()
    this.startRehearse()
  }

  /** Submit a practice path as [x0, y0, x1, y1, ...] in cross-section view cm. */
  submitPracticePath(flat: number[]): void {
    this.onPracticePath(pathFromFlat(flat))
  }

  /** The ideal arc as a flat path (view cm) — passes by construction. */
  idealPracticePath(): number[] {
    return pathToFlat(idealArcPath(this.crossSection.geometry, 40))
  }

  /** A straight entry→exit path (view cm) — fails (off the arc, 0° entry). */
  straightPracticePath(): number[] {
    return pathToFlat(straightPath(this.crossSection.geometry, 12))
  }

  /** Pure scoring of a flat path with the current tolerances (does not change state). */
  scorePracticePath(flat: number[]): StitchScore {
    return this.scorePath(pathFromFlat(flat))
  }

  /** Pure suture count for a length with the current spacing. */
  computeSutureCount(lengthCm: number): number {
    return sutureCountForLength(lengthCm, this.biteSpacingCm)
  }

  /** One-line state dump for logs and tests. */
  stateSummary(): string {
    return JSON.stringify({
      phase: this.phase,
      ghostDemoState: this.ghostDemoState,
      ghostStitchPlaced: this.ghostStitchPlaced,
      crossSectionVisible: this.crossSectionVisible,
      practiceResult: this.practiceResult,
      promptVisible: this.promptVisible,
      pinchCount: this.pinchCount,
      markedLengthCm: this.markedLengthCm,
      sutureCount: this.sutureCount,
      biteMarkCount: this.biteMarkCount,
      countLabelText: this.countLabelText,
      needlesOut: this.needlesOut,
      alertVisible: this.alertVisible,
      alertText: this.alertText,
      mismatchChimeCount: this.mismatchChimeCount,
      isClosed: this.isClosed,
      closedVisible: this.closedVisible,
    })
  }

  // ── internals ────────────────────────────────────────────────────────────

  private scorePath(path: P2[]): StitchScore {
    return scoreStitchPath(path, this.crossSection.geometry, this.stitchToleranceMm, this.angleToleranceDeg)
  }

  private after(seconds: number, fn: () => void): void {
    const ev = this.createEvent("DelayedCallbackEvent")
    ev.bind(() => fn())
    ev.reset(seconds)
  }

  private log(msg: string): void {
    print(`[SteadyHands] ${msg} | phase=${this.phase}`)
  }
}
