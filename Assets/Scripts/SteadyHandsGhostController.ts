/**
 * SteadyHandsGhostController — the ghost attending placing one interrupted stitch on the pad.
 *
 * Owns:
 *  - The ghost's look: two life-size holographic hands (duplicated SIK skinned hand models,
 *    posed from code by GhostHandRig) holding procedural instruments (Mayo-Hegar needle driver,
 *    Adson forceps, 3/8-circle needle, suture thread — GhostInstruments / GhostThread), with
 *    gloved forearms + gown sleeves that fade out with distance. All share the GhostHologram
 *    shader (ice-cyan fresnel, translucent, scan shimmer) faded through one GhostGlow
 *    (`tints[0]`, Tint-compatible).
 *  - The choreography (all timings are inputs): the attending reaches in from the far side;
 *    the forceps evert the far wound edge; the driver sets the needle tip perpendicular on the
 *    entry (field (0,1,-0.5)) and pronates so the needle follows its curve to the exit (field
 *    (0,1,+0.5)); the forceps take the tip and pull the needle through along its curve; the
 *    thread tightens; both hands withdraw to the far side while fading (~1 s).
 *  - Telling the pad and the 3× cross-section when the needle enters / exits.
 * Contracts: GhostHand_Driver's origin is the needle tip; GhostHand_Forceps' origin is the
 *  forceps tips; both are disabled when the demo is not playing. `tints[0].getLevel()` is 1
 *  while the hands are shown and falls to 0 over fadeOutSec at the end.
 * Must not: change the flow phase — SteadyHandsMain starts/stops the demo and listens for done.
 * Coordinates: this object sits at the SurgicalField origin (field space); skin at y = 1,
 *  cut along X at z = 0, +Z toward the user, the attending stands at -Z.
 */
import {SteadyHandsCrossSectionController} from "./SteadyHandsCrossSectionController"
import {SteadyHandsPadController} from "./SteadyHandsPadController"
import {GhostHandRig, HandPose, fp, lerpHandPose} from "./Visuals/GhostHandRig"
import {GhostGlow, NO_CLIP, clipPlaneAbove} from "./Visuals/GhostHologram"
import {
  DRIVER_PIVOT_X,
  FORCEPS_PIVOT_X,
  buildDriverHalf,
  buildForcepsArm,
  buildNeedle,
  buildSleeve,
  needlePoint,
  needleTangent,
} from "./Visuals/GhostInstruments"
import {DEG, Pose, basisQuat, catmull, clamp01, lerpN, phase, smooth01, v3} from "./Visuals/GhostMath"
import {GhostThread, bezier2, bezier3} from "./Visuals/GhostThread"

export type GhostState = "idle" | "playing" | "done" | "stopped"

const SKIN_Y = 1.0
const ENTRY = new vec3(0, SKIN_Y, -0.5)
const EXIT = new vec3(0, SKIN_Y, 0.5)
/** Clamp point on the needle: degrees behind the tip (3/8 circle = 135°). */
const CLAMP_DEG = -122
/** Where the forceps take the needle when pulling it through (degrees behind the tip). */
const GRASP_DEG = -10

@component
export class SteadyHandsGhostController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SteadyHandsGhostController – ghost attending demo stitch</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("GhostHand_Driver root (origin = needle tip; disabled when idle)")
  driverHand: SceneObject
  @input
  @hint("GhostHand_Forceps root (origin = forceps tips; disabled when idle)")
  forcepsHand: SceneObject
  @input
  @hint("Duplicated SIK right hand model (Skin + RightHandRig + RightHandMeshFull) under GhostHand_Driver")
  @allowUndefined
  rightHandModel: SceneObject
  @input
  @hint("Duplicated SIK left hand model (Skin + LeftHandRig + LeftHandMeshFull) under GhostHand_Forceps")
  @allowUndefined
  leftHandModel: SceneObject
  @input
  @hint("GhostHologram_Hand material (hands, sleeves, thread)")
  @allowUndefined
  handMaterial: Material
  @input
  @hint("GhostHologram_Instrument material (brighter, more specular)")
  @allowUndefined
  instrumentMaterial: Material
  @input
  @allowUndefined
  @hint("GhostHalo material (additive bloom shell, inflated along normals)")
  haloMaterial: Material
  @input
  @hint("Pad controller (draws the ghost's stitch on the pad)")
  pad: SteadyHandsPadController
  @input
  @hint("Cross-section controller (draws the 3x ghost trace)")
  crossSection: SteadyHandsCrossSectionController
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Look</span>')
  @ui.group_start("Look")
  @input("vec4", "{0.18,0.77,1,1}")
  @hint("Hologram core colour (ice cyan); alpha = overall strength")
  @widget(new ColorWidget())
  ghostColor: vec4
  @input
  @hint("Hand scale (1 = SIK model, ~22 cm wrist to fingertip)")
  @widget(new SliderWidget(0.7, 1.1, 0.01))
  handScale: number = 0.88
  @input
  @hint("Faint cast shadows from the hands and instruments onto the drape/skin (preview depth cue)")
  castShadows: boolean = true
  @input
  @hint("Density of those shadows (keep low: it's a hologram)")
  @widget(new SliderWidget(0, 1, 0.01))
  shadowDensity: number = 0.22
  @input
  @hint("Driver shaft tilt (deg): raises the hand side so the instrument is not flat on the drape")
  @widget(new SliderWidget(0, 35, 1))
  driveTiltDeg: number = 18
  @input
  @hint("Needle radius (cm). 3/8 circle; 0.65 → ~1.2 cm chord")
  @widget(new SliderWidget(0.55, 1.1, 0.01))
  needleRadius: number = 0.65
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Timeline (s at demoSpeed 1)</span>')
  @ui.group_start("Timeline")
  @input
  @hint("Playback speed of the demo (1 = default pace)")
  @widget(new SliderWidget(0.1, 3, 0.05))
  demoSpeed: number = 1.0
  @input
  @hint("Fade-in while reaching in from the far side")
  fadeInSec: number = 0.7
  @input
  @hint("Instruments arrive over the wound")
  tReach: number = 1.5
  @input
  @hint("Forceps have everted the far wound edge")
  tEvert: number = 2.0
  @input
  @hint("Needle tip pierces the entry point (pad + cross-section start)")
  tEntry: number = 2.6
  @input
  @hint("Needle tip emerges at the exit point (stitch placed on the pad)")
  tExit: number = 4.4
  @input
  @hint("Driver releases the needle")
  tRelease: number = 4.75
  @input
  @hint("Forceps grasp the needle tip")
  tGrasp: number = 5.15
  @input
  @hint("Needle pulled through along its curve")
  tPulled: number = 6.35
  @input
  @hint("Thread drawn tight")
  tTight: number = 7.2
  @input
  @hint("Hands start withdrawing to the far side (fade begins)")
  tWithdraw: number = 7.6
  @input
  @hint("Seconds for the ghost to fade out while withdrawing (brief: about 1 s)")
  @widget(new SliderWidget(0.2, 3, 0.1))
  fadeOutSec: number = 1.0
  @ui.group_end


  /** idle → playing → done (or stopped if Rehearse was skipped). */
  state: GhostState = "idle"
  /** True once the ghost's stitch is fully placed on the pad. */
  stitchPlaced = false
  /** Faders; tints[0] drives every ghost material (tests read tints[0].getLevel()). */
  tints: GhostGlow[] = []

  private glow: GhostGlow
  private handMat: Material
  private handDepthMat: Material
  private sleeveMat: Material
  private instMat: Material
  private needleMat: Material
  private threadMat: Material
  private handHalo: Material | null = null
  private instHalo: Material | null = null
  private needleHalo: Material | null = null

  private rigR: GhostHandRig | null = null
  private rigL: GhostHandRig | null = null
  private driverObj: SceneObject
  private driverHalfA: SceneObject
  private driverHalfB: SceneObject
  private forcepsObj: SceneObject
  private forcepsArmA: SceneObject
  private forcepsArmB: SceneObject
  private needleObj: SceneObject
  private threadObj: SceneObject
  private thread: GhostThread
  private sleeveR: SceneObject
  private sleeveL: SceneObject

  private ready = false
  private playing = false
  private elapsed = 0
  private done: (() => void) | null = null
  private entryFired = false
  private exitFired = false

  // Derived needle geometry (field space).
  private R = 0.65
  private h = 0.4
  private C0 = vec3.zero()
  private C1 = vec3.zero()
  private phiExit = 140
  private graspInNeedle: Pose = Pose.identity()
  /** Drive plane tilt about the cut-perpendicular axis through the wound centre (hand side up). */
  private tilt: Pose = Pose.identity()
  /** Left hand model frame (model space) and where it sits in the forceps frame (pencil grip fit). */
  private leftFitModel: Pose = Pose.identity()
  private leftFitTarget: Pose = Pose.identity()
  /** Right wrist frame in the driver frame (palm grip). */
  private rightWrist: Pose = Pose.identity()
  /** Solved pencil-grip hand pose (thumb pinched onto the index across the forceps). */
  private forcepsPose_: HandPose = FORCEPS_POSE
  /** Solved palm grip on the needle driver (fingers wrapped on the shanks, thumb along them). */
  private driverPose_: HandPose = DRIVER_POSE
  private driverInNeedle: Pose = Pose.identity()

  onAwake(): void {
    this.glow = new GhostGlow(this.ghostColor)
    this.tints = [this.glow]
    this.computeNeedleGeometry()
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
    this.ready = !!(this.handMaterial && this.instrumentMaterial && this.driverHand && this.forcepsHand)
    if (!this.ready) {
      print("[SteadyHandsGhostController] ERROR: handMaterial / instrumentMaterial / hand roots not wired — timeline runs without visuals")
      this.setVisible(false)
      return
    }
    this.handMat = this.glow.add(this.handMaterial)
    // Depth-only pre-pass so each translucent hand shows just its front surface (no x-ray tangle).
    this.handDepthMat = this.handMaterial.clone()
    const dp = this.handDepthMat.mainPass
    dp.colorMask = new vec4b(false, false, false, false)
    dp.depthWrite = true
    dp.depthTest = true
    // Push the pre-pass depth back a hair so the colour pass never z-fights its own skin.
    dp.polygonOffset = new vec2(1.0, 6.0)
    this.sleeveMat = this.glow.add(this.handMaterial)
    this.instMat = this.glow.add(this.instrumentMaterial, 1.0, false)
    this.needleMat = this.glow.add(this.instrumentMaterial, 1.0, false)
    this.threadMat = this.glow.add(this.handMaterial, 1.0)
    const sp = this.sleeveMat.mainPass as any
    sp.fadeNear = 14.0
    sp.fadeFar = 30.0
    sp.interior = 0.14
    sp.rimColor = new vec3(0.4, 0.88, 1.0)
    const hp = this.handMat.mainPass as any
    hp.fadeNear = 22.0
    hp.fadeFar = 40.0
    // Saturated cyan (#2EC4FF core) so the hands separate from pale skin; bright cyan rim, little white.
    hp.interior = 0.3
    hp.rimColor = new vec3(0.4, 0.88, 1.0)
    hp.rimIntensity = 1.9
    hp.rimPower = 2.0
    hp.edgeGlow = 0.3
    hp.opacity = 0.6
    const tp = this.threadMat.mainPass as any
    tp.interior = 0.6
    tp.rimIntensity = 1.6
    tp.opacity = 0.7
    tp.fadeNear = 7.0
    tp.fadeFar = 16.0
    // Instruments: same family, brighter and more specular (set here so the asset needs no tuning).
    const ip = this.instMat.mainPass as any
    // Edge-lit chrome: bright interior, hot rims and twin speculars (dark chrome vanishes on additive).
    ip.coreColor = new vec3(0.6, 0.9, 1.0)
    ip.rimColor = new vec3(0.55, 0.92, 1.0)
    ip.interior = 0.42
    ip.specular = 1.6
    ip.rimIntensity = 2.4
    ip.rimPower = 1.7
    ip.edgeGlow = 0.9
    ip.opacity = 0.6
    ip.shimmer = 0.3
    const np = this.needleMat.mainPass as any
    np.coreColor = new vec3(0.7, 0.94, 1.0)
    np.interior = 0.7
    np.specular = 1.8
    np.rimIntensity = 2.2
    np.edgeGlow = 1.0
    np.opacity = 0.7

    if (this.haloMaterial) {
      this.handHalo = this.glow.add(this.haloMaterial, 1.0, false)
      this.instHalo = this.glow.add(this.haloMaterial, 1.0, false)
      this.needleHalo = this.glow.add(this.haloMaterial, 1.0, false)
      const hh = this.handHalo.mainPass as any
      hh.haloWidth = 0.35
      hh.haloColor = new vec3(0.18, 0.77, 1.0)
      hh.haloIntensity = 0.6
      hh.fadeNear = 22.0
      hh.fadeFar = 40.0
      const ih = this.instHalo.mainPass as any
      ih.haloWidth = 0.12
      ih.haloIntensity = 0.85
      ih.haloColor = new vec3(0.35, 0.85, 1.0)
      const nh = this.needleHalo.mainPass as any
      nh.haloWidth = 0.07
      nh.haloIntensity = 1.0
      nh.haloColor = new vec3(0.5, 0.9, 1.0)
    }
    this.buildGeometry()
    this.applyHandMaterial(this.rightHandModel)
    this.applyHandMaterial(this.leftHandModel)
    if (this.rightHandModel) {
      this.rigR = new GhostHandRig(this.rightHandModel, true)
      this.rigR.setScale(this.handScale)
      this.fitPalmGrip(this.rigR)
    }
    if (this.leftHandModel) {
      this.rigL = new GhostHandRig(this.leftHandModel, false)
      this.rigL.setScale(this.handScale)
      this.fitPencilGrip(this.rigL)
    }
    this.setVisible(false)
  }

  /** Run the demo once. `done` fires after the ghost has faded out. */
  play(done?: () => void): void {
    this.stop()
    this.state = "playing"
    this.stitchPlaced = false
    this.entryFired = false
    this.exitFired = false
    this.safe("pad.clearGhostStitch", () => this.pad.clearGhostStitch())
    this.done = done ?? null
    this.elapsed = 0
    this.playing = true
    this.setVisible(true)
    this.evaluate(0)
  }

  /** Abort the demo immediately (ghost vanishes; the pad stitch is left to the caller). */
  stop(): void {
    if (this.playing) {
      this.playing = false
      this.done = null
      this.state = "stopped"
    }
    this.safe("crossSection.stopGhostTrace", () => this.crossSection.stopGhostTrace())
    this.setVisible(false)
  }

  private warned: {[k: string]: boolean} = {}

  /** Call into another controller without letting its failure stop the ghost. */
  private safe(label: string, fn: () => void): void {
    try {
      if (fn) fn()
    } catch (e) {
      if (!this.warned[label]) {
        this.warned[label] = true
        print(`[SteadyHandsGhostController] WARN ${label} failed: ${e}`)
      }
    }
  }

  private get totalSec(): number {
    return this.tWithdraw + this.fadeOutSec
  }

  private onUpdate(): void {
    if (!this.playing) return
    const speed = Math.max(0.05, this.demoSpeed)
    this.elapsed += getDeltaTime() * speed
    if (this.elapsed >= this.totalSec) {
      this.evaluate(this.totalSec)
      this.playing = false
      this.setVisible(false)
      this.state = "done"
      const cb = this.done
      this.done = null
      if (cb) cb()
      return
    }
    this.evaluate(this.elapsed)
  }

  // ── choreography ─────────────────────────────────────────────────────────

  private evaluate(t: number): void {
    const speed = Math.max(0.05, this.demoSpeed)
    // Fade: in while reaching, out while withdrawing. Level stays exactly 1 in between.
    let level = 1
    if (t < this.fadeInSec) level = smooth01(t / this.fadeInSec)
    else if (t > this.tWithdraw) level = 1 - smooth01((t - this.tWithdraw) / Math.max(0.05, this.fadeOutSec))
    this.glow.setLevel(level)
    if (this.ready) this.evaluateVisuals(t)
    else if (this.driverHand) {
      // Unwired fallback: keep the roots' contract (driver origin = needle tip) without visuals.
      this.driverHand.getTransform().setLocalPosition(this.needlePose(t).point(needlePoint(this.R, 0)))
    }

    // Hooks.
    if (!this.entryFired && t >= this.tEntry) {
      this.entryFired = true
      this.safe("pad.showGhostStitch", () => this.pad.showGhostStitch("entry", this.ghostColor))
      this.safe("crossSection.playGhostTrace", () => this.crossSection.playGhostTrace((this.tExit - this.tEntry) / speed))
    }
    if (!this.exitFired && t >= this.tExit) {
      this.exitFired = true
      this.safe("pad.showGhostStitch", () => this.pad.showGhostStitch("exit", this.ghostColor))
      this.stitchPlaced = true
    }
  }

  private evaluateVisuals(t: number): void {
    this.updateWorldParams()
    const needle = this.needlePose(t)
    const driver = this.driverPose(t, needle)
    const forceps = this.forcepsPose(t, needle)

    // Roots: driver origin = needle tip; forceps origin = forceps tips.
    const tip = needle.point(needlePoint(this.R, 0))
    this.driverHand.getTransform().setLocalPosition(tip)
    this.driverHand.getTransform().setLocalRotation(quat.quatIdentity())
    this.forcepsHand.getTransform().setLocalPosition(forceps.p)
    this.forcepsHand.getTransform().setLocalRotation(quat.quatIdentity())

    this.place(this.needleObj, needle, tip)
    this.place(this.driverObj, driver, tip)
    this.place(this.forcepsObj, forceps, forceps.p)

    // Jaws / tines.
    const jawOpen = phase(t, this.tExit + 0.05, this.tRelease) * 11 - phase(t, this.tWithdraw, this.tWithdraw + 0.4) * 6
    this.setDriverOpen(jawOpen)
    this.setForcepsOpen(this.forcepsOpening(t))

    // Hands.
    if (this.rigR) {
      const wristR = driver.mul(this.rightWrist)
      this.rigR.placeModel(this.relative(wristR, tip))
      this.rigR.apply(this.driverHandPose(t))
      this.placeSleeve(this.sleeveR, this.rigR, wristR, v3(-27, 17, -27), tip)
    }
    if (this.rigL) {
      const fitL = forceps.mul(this.leftFitTarget)
      this.rigL.placeModel(this.relative(fitL, forceps.p), this.leftFitModel)
      const wristL = this.rigL.wrist ? this.wristFieldPose(this.rigL) : fitL
      this.rigL.apply(this.forcepsHandPose(t))
      this.placeSleeve(this.sleeveL, this.rigL, wristL, v3(27, 17, -25), forceps.p)
    }

    this.updateThread(t, needle, tip)
  }

  /** Needle tip angle φ (deg) → needle pose; centre slides C0 → C1 over the first 70°. */
  private needleAt(phiDeg: number, center: vec3): Pose {
    return this.tilt.mul(new Pose(center, quat.angleAxis(-(180 + phiDeg) * DEG, vec3.right())))
  }

  private driveCenter(phiDeg: number): vec3 {
    const w = smooth01(phiDeg / 70)
    return vec3.lerp(this.C0, this.C1, w)
  }

  /** Needle pose for a given tip position and φ (pre-entry flight). */
  private needleFromTip(tipPos: vec3, phiDeg: number): Pose {
    const b = (180 + phiDeg) * DEG
    const tipU = this.tilt.inverse().point(tipPos)
    const c = tipU.sub(v3(0, this.R * Math.sin(b), this.R * Math.cos(b)))
    return this.needleAt(phiDeg, c)
  }

  private needlePose(t: number): Pose {
    const R = this.R
    if (t <= this.tEntry) {
      // Flight in from the far side, ending perpendicular on the entry point.
      const keysT = [0, this.tReach, this.tEntry - 0.4, this.tEntry]
      const tips = [v3(-5, 14, -24), v3(0.2, 2.6, -1.1), v3(0, 1.32, -0.53), ENTRY]
      const phis = [-48, -16, -3, 0]
      let i = 0
      while (i < keysT.length - 2 && t > keysT[i + 1]) i++
      const u = clamp01((t - keysT[i]) / Math.max(1e-4, keysT[i + 1] - keysT[i]))
      const e = u * u * (3 - 2 * u)
      const p = catmull(tips[Math.max(0, i - 1)], tips[i], tips[i + 1], tips[Math.min(3, i + 2)], e)
      const phi = lerpN(phis[i], phis[i + 1], e)
      return this.needleFromTip(p, phi)
    }
    const phiOut = this.phiExit + 8
    if (t <= this.tGrasp) {
      // Drive: pronate so the needle follows its curve to the exit, a little past it.
      const u = clamp01((t - this.tEntry) / Math.max(1e-3, this.tExit - this.tEntry))
      const e = u < 1 ? smoothDrive(u) : 1
      let phi = this.phiExit * e
      if (t > this.tExit) phi = this.phiExit + 8 * phase(t, this.tExit, this.tExit + 0.3)
      return this.needleAt(phi, this.driveCenter(phi))
    }
    // Pull-through about C1 (the needle follows its own curve), then lift with the forceps.
    const pullEnd = phiOut + NEEDLE_PULL_DEG
    const phi = lerpN(phiOut, pullEnd, phase(t, this.tGrasp + 0.1, this.tPulled))
    let pose = this.needleAt(phi, this.C1)
    if (t > this.tPulled) {
      const k = phase(t, this.tPulled, this.tTight)
      const lift = v3(0.6, 3.4, 2.6).uniformScale(k)
      const turn = quat.angleAxis(-30 * k * DEG, vec3.right())
      const pivot = pose.point(needlePoint(R, GRASP_DEG))
      const q = turn.multiply(pose.q)
      const p = pivot.add(lift).add(turn.multiplyVec3(pose.p.sub(pivot)))
      pose = new Pose(p, q)
      if (t > this.tWithdraw) {
        const w = phase(t, this.tWithdraw, this.tWithdraw + this.fadeOutSec * 1.3)
        pose = new Pose(pose.p.add(v3(4, 7, -13).uniformScale(w)), pose.q)
      }
    }
    return pose
  }

  /** Driver: rides on the needle until release, then backs off and withdraws. */
  private driverPose(t: number, needle: Pose): Pose {
    if (t <= this.tRelease) return needle.mul(this.driverInNeedle)
    const atRelease = this.needleAt(this.phiExit + 8, this.C1).mul(this.driverInNeedle)
    const k = phase(t, this.tRelease, this.tGrasp + 0.5)
    const back = v3(-2.5, 3.0, -1.5).uniformScale(k)
    const turn = quat.angleAxis(55 * k * DEG, vec3.right())
    let pose = new Pose(atRelease.p.add(back), turn.multiply(atRelease.q))
    if (t > this.tWithdraw) {
      const w = phase(t, this.tWithdraw, this.tWithdraw + this.fadeOutSec * 1.3)
      pose = new Pose(pose.p.add(v3(-4, 7, -14).uniformScale(w)), pose.q)
    }
    return pose
  }

  /** Forceps: evert the far edge, then take the needle tip and follow it out. */
  private forcepsPose(t: number, needle: Pose): Pose {
    // Edge grasp orientation: tips down toward the wound from the attending's left, tines
    // straddling the far lip (opening along Z).
    const qEdge = basisQuat(v3(-0.5, -0.62, 0.6), v3(0, 0.5, 1))
    const qFar = basisQuat(v3(-0.55, -0.45, 0.7), v3(0, 0.6, 1))
    const graspAt = this.needleAt(this.phiExit + 8, this.C1).mul(this.graspInNeedle)
    if (t <= this.tExit) {
      const keysT = [0, this.tReach, this.tEvert - 0.35, this.tEvert]
      const tips = [v3(9, 14, -22), v3(1.2, 2.7, -1.5), v3(0.9, 1.02, -0.17), v3(0.9, 1.14, -0.24)]
      let i = 0
      while (i < keysT.length - 2 && t > keysT[i + 1]) i++
      const u = clamp01((t - keysT[i]) / Math.max(1e-4, keysT[i + 1] - keysT[i]))
      const e = u * u * (3 - 2 * u)
      const p = catmull(tips[Math.max(0, i - 1)], tips[i], tips[i + 1], tips[Math.min(3, i + 2)], e)
      const q = quat.slerp(qFar, qEdge, smooth01(t / Math.max(1e-3, this.tReach)))
      // Eversion: roll the tips outward a touch while holding the edge.
      const ev = phase(t, this.tEvert - 0.35, this.tEvert) * 10
      return new Pose(p, quat.angleAxis(ev * DEG, vec3.right()).multiply(q))
    }
    if (t <= this.tGrasp) {
      // Let go of the edge, lift, and move over to the emerging needle tip.
      const held = new Pose(v3(0.9, 1.14, -0.24), quat.angleAxis(10 * DEG, vec3.right()).multiply(qEdge))
      const lifted = new Pose(v3(1.0, 2.4, 0.1), quat.slerp(held.q, graspAt.q, 0.5))
      const preGrasp = new Pose(graspAt.p.add(graspAt.dir(v3(-1.0, 0, 0))), graspAt.q)
      const k1 = phase(t, this.tExit, this.tExit + 0.3)
      const k2 = phase(t, this.tExit + 0.25, this.tGrasp - 0.12)
      const k3 = phase(t, this.tGrasp - 0.15, this.tGrasp)
      let pose = Pose.lerp(held, lifted, k1)
      pose = Pose.lerp(pose, preGrasp, k2)
      return Pose.lerp(pose, graspAt, k3)
    }
    // Follow the needle's tip exactly, but only part of its roll: the wrist turns ~30% with the
    // curve and the rest is the needle rolling in the tines (keeps the hand upright and visible).
    const nG = this.needleAt(this.phiExit + 8, this.C1)
    const rel = needle.q.multiply(nG.q.invert())
    const q = quat.slerp(quat.quatIdentity(), rel, FORCEPS_FOLLOW).multiply(graspAt.q)
    return new Pose(needle.point(needlePoint(this.R, GRASP_DEG)), q)
  }

  /** Tine opening (deg per arm): open on approach, closed on the edge / needle. */
  private forcepsOpening(t: number): number {
    const open = 2.2
    if (t < this.tEvert - 0.35) return open
    if (t < this.tExit) return open * (1 - phase(t, this.tEvert - 0.35, this.tEvert - 0.15))
    if (t < this.tGrasp) return open * phase(t, this.tExit, this.tExit + 0.15) * (1 - phase(t, this.tGrasp - 0.08, this.tGrasp))
    if (t > this.tWithdraw + 0.2) return open * 0.4 * phase(t, this.tWithdraw + 0.2, this.tWithdraw + 0.6)
    return 0
  }

  // ── grips & hand poses ───────────────────────────────────────────────────

  private driverHandPose(t: number): HandPose {
    const relaxed = lerpHandPose(this.driverPose_, OPEN_POSE, 0.3)
    const k = phase(t, 0, this.tReach) * (1 - phase(t, this.tWithdraw, this.totalSec))
    return lerpHandPose(relaxed, this.driverPose_, k)
  }

  private forcepsHandPose(t: number): HandPose {
    const relaxed = lerpHandPose(this.forcepsPose_, OPEN_POSE, 0.3)
    const k = phase(t, 0, this.tReach) * (1 - phase(t, this.tWithdraw, this.totalSec))
    return lerpHandPose(relaxed, this.forcepsPose_, k)
  }

  // ── thread ───────────────────────────────────────────────────────────────

  private updateThread(t: number, needle: Pose, tip: vec3): void {
    const R = this.R
    const swage = needle.point(needlePoint(R, -135))
    const out = needle.dir(needleTangent(-135)).uniformScale(-1)
    const tight = phase(t, this.tPulled, this.tTight)
    // Free tail on the far side: long while the needle is driven, drawn short as it tightens.
    const tailLen = lerpN(9, 2.6, phase(t, this.tGrasp, this.tTight))
    const tailEnd = ENTRY.add(v3(-0.6 - tailLen * 0.15, 0.05, -tailLen))
    const tailCtl = ENTRY.add(v3(-0.2, 0.9 * (1 - tight) + 0.25, -tailLen * 0.35))
    let pts: vec3[]
    const swageBelow = swage.y < SKIN_Y - 0.01
    const pulledThrough = t > this.tGrasp && !swageBelow && swage.z > 0.2
    if (t < this.tEntry || (!swageBelow && !pulledThrough)) {
      // Thread trails from the swage, curving down onto the drape on the far side.
      const a = swage
      const c1 = swage.add(out.uniformScale(1.6))
      const end = v3(swage.x - 1.5, SKIN_Y + 0.1, Math.min(swage.z - 9, -9))
      const c2 = end.add(v3(0.5, 3.5, 3))
      pts = bezier3(a, c1, c2, end, 40)
    } else if (swageBelow) {
      // Swage under the skin: thread follows the needle's track back to the entry.
      const tr = [swage, swage.add(out.uniformScale(0.25)), ENTRY.add(v3(0, -0.15, 0.05)), ENTRY]
      pts = bezier3(tr[0], tr[1], tr[2], tr[3], 6)
      pts = pts.concat(bezier2(ENTRY, tailCtl, tailEnd, 24).slice(1))
      pts.reverse()
    } else {
      // Through both bites: tail → entry → (under the skin) → exit → needle.
      const tail = bezier2(tailEnd, tailCtl, ENTRY, 18)
      const under = bezier2(ENTRY, v3(0, SKIN_Y - 0.9, 0), EXIT, 8).slice(1)
      const sag = v3(0, -1.2 * (1 - tight), 0)
      const mid = vec3.lerp(EXIT, swage, 0.5).add(sag).add(v3(0, 0.6, 0))
      const toNeedle = bezier3(EXIT, EXIT.add(v3(0, 0.6, 0.15)), mid, swage, 18).slice(1)
      pts = tail.concat(under).concat(toNeedle)
    }
    this.thread.setPath(pts)
    this.place(this.threadObj, Pose.identity(), tip)
  }

  // ── placement helpers ────────────────────────────────────────────────────

  /** Set a root child's local transform from a field-space pose (roots have no rotation). */
  private place(so: SceneObject, fieldPose: Pose, rootPos: vec3): void {
    const tr = so.getTransform()
    tr.setLocalPosition(fieldPose.p.sub(rootPos))
    tr.setLocalRotation(fieldPose.q)
  }

  private relative(fieldPose: Pose, rootPos: vec3): Pose {
    return new Pose(fieldPose.p.sub(rootPos), fieldPose.q)
  }

  private placeSleeve(sleeve: SceneObject, rig: GhostHandRig, wrist: Pose, elbow: vec3, rootPos: vec3): void {
    const zDir = elbow.sub(wrist.p).normalize()
    const dorsal = wrist.dir(vec3.up())
    const q = basisQuat(dorsal.cross(zDir), dorsal)
    const start = wrist.p.add(wrist.dir(v3(SLEEVE_OFFSET.x, SLEEVE_OFFSET.y, SLEEVE_OFFSET.z)))
    this.place(sleeve, new Pose(start, q), rootPos)
  }

  private setDriverOpen(deg: number): void {
    const a = (Math.max(0, deg) * 0.5 * Math.PI) / 180
    this.driverHalfA.getTransform().setLocalRotation(quat.angleAxis(a, vec3.forward()))
    this.driverHalfB.getTransform().setLocalRotation(quat.angleAxis(-a, vec3.forward()))
  }

  private setForcepsOpen(deg: number): void {
    const a = (Math.max(0, deg) * Math.PI) / 180
    this.forcepsArmA.getTransform().setLocalRotation(quat.angleAxis(a, vec3.forward()))
    this.forcepsArmB.getTransform().setLocalRotation(quat.angleAxis(-a, vec3.forward()))
  }

  private updateWorldParams(): void {
    const wt = this.getSceneObject().getTransform()
    const centerW = wt.getWorldTransform().multiplyPoint(v3(0, SKIN_Y, 0))
    const upW = wt.getWorldRotation().multiplyVec3(vec3.up())
    this.glow.setParam("fadeCenter", centerW)
    const clip = clipPlaneAbove(centerW.add(upW.uniformScale(0.005)), upW)
    ;(this.needleMat.mainPass as any).clipPlane = clip
    ;(this.threadMat.mainPass as any).clipPlane = clip
    if (this.needleHalo) (this.needleHalo.mainPass as any).clipPlane = clip
    ;(this.handMat.mainPass as any).clipPlane = NO_CLIP
  }

  /**
   * Pencil grip: find the pinch point between the thumb and index pads and the first web space on
   * the posed left hand, and map them onto the forceps (pinch on the grip ridges, web toward the
   * butt, thumb → index across the tines).
   */
  private fitPencilGrip(rig: GhostHandRig): void {
    rig.apply(FORCEPS_POSE)
    const indexPad = rig.fingerPad("index")
    const wantT = indexPad.add(rig.crossDir(PENCIL_PINCH_DEG).uniformScale(PENCIL_PAD_GAP / this.handScale))
    this.forcepsPose_ = rig.solveThumbTo(FORCEPS_POSE, wantT, 0)
    const tp = rig.thumbPad()
    const ip = rig.fingerPad("index")
    const web = vec3.lerp(rig.posedPoint("thumb-1"), rig.posedPoint("index-0"), 0.5)
    const pinch = vec3.lerp(tp, ip, 0.5)
    this.leftFitModel = new Pose(pinch, basisQuat(pinch.sub(web), ip.sub(tp)))
    const roll = quat.angleAxis(PENCIL_ROLL_DEG * DEG, vec3.right())
    this.leftFitTarget = new Pose(PENCIL_AT, roll)
  }

  /**
   * Palm (thenar) grip: the instrument lies diagonally across the palm (heel → index base), the
   * middle/ring/little fingers wrap the shanks, the index lies along them to the box lock and the
   * thumb rests on the radial side. The wrist frame is analytic (driver frame); fingers are solved.
   */
  private fitPalmGrip(rig: GhostHandRig): void {
    this.rightWrist = palmGripWrist()
    const root = rig.rootPoseForWrist(this.rightWrist)
    const m = (x: number, y: number, z: number) => rig.toModel(root, v3(x, y, z))
    let pose = DRIVER_POSE
    pose = rig.solveFingerWrap(pose, "mid", m(-12.5, 0, 0), m(-3.0, 0, 0), 1.3, 85)
    pose = rig.solveFingerWrap(pose, "ring", m(-13.5, 0, 0), m(-3.0, 0, 0), 1.3, 85)
    pose = rig.solveFingerWrap(pose, "pinky", m(-14.5, 0.8, 0), m(-3.0, 0, 0), 1.3, 85)
    pose = rig.solveThumbTo(pose, m(-6.5, 0, 0), 1.0)
    this.driverPose_ = pose
  }

  /** Wrist frame (X fingers, Y dorsal) of a placed rig, in field space. */
  private wristFieldPose(rig: GhostHandRig): Pose {
    const ga = this.getSceneObject().getTransform()
    const p = ga.getInvertedWorldTransform().multiplyPoint(rig.wrist.getTransform().getWorldPosition())
    const qm = ga.getWorldRotation().invert().multiply(rig.model.getTransform().getWorldRotation())
    return new Pose(p, qm.multiply(rig.handFrameModel.q))
  }

  private setVisible(on: boolean): void {
    if (this.driverHand) this.driverHand.enabled = on
    if (this.forcepsHand) this.forcepsHand.enabled = on
  }

  // ── construction ─────────────────────────────────────────────────────────

  private computeNeedleGeometry(): void {
    const R = Math.max(0.52, this.needleRadius)
    this.R = R
    const o = v3(0, SKIN_Y, 0)
    const rz = quat.angleAxis(-this.driveTiltDeg * DEG, vec3.forward())
    this.tilt = new Pose(o.sub(rz.multiplyVec3(o)), rz)
    this.h = Math.sqrt(R * R - 0.25)
    this.C0 = v3(0, SKIN_Y, -0.5 + R)
    this.C1 = v3(0, SKIN_Y + this.h, 0)
    const bx = Math.atan2(-this.h, 0.5) / DEG + 360
    this.phiExit = bx - 180
    // Driver jaws clamp the needle CLAMP_DEG behind the tip; jaw tip 0.25 cm past the needle.
    // Backhand loading: the needle travels toward the driver's -Z (palm side in the tripod grip).
    const pc = needlePoint(R, CLAMP_DEG)
    const outward = pc.normalize()
    this.driverInNeedle = new Pose(pc.add(v3(0.25, 0, 0)), basisQuat(vec3.right(), outward))
    // Forceps take the needle near the tip, tines across the wire, approaching from above/+x.
    const phiG = this.phiExit + 8
    const nG = this.needleAt(phiG, this.C1)
    const pG = nG.point(needlePoint(R, GRASP_DEG))
    const wire = nG.dir(needleTangent(GRASP_DEG))
    let xf = v3(-0.55, -0.75, 0.35)
    xf = xf.sub(wire.uniformScale(xf.dot(wire))).normalize()
    const zf = wire
    const yf = zf.cross(xf)
    const fieldGrasp = new Pose(pG, basisQuat(xf, yf))
    this.graspInNeedle = nG.inverse().mul(fieldGrasp)
  }

  private buildGeometry(): void {
    // Driver.
    this.driverObj = this.child(this.driverHand, "GhostNeedleDriver")
    this.driverHalfA = this.meshChild(this.driverObj, "DriverHalfA", buildDriverHalf(1), this.instMat, v3(DRIVER_PIVOT_X, 0, 0), this.instHalo)
    this.driverHalfB = this.meshChild(this.driverObj, "DriverHalfB", buildDriverHalf(-1), this.instMat, v3(DRIVER_PIVOT_X, 0, 0), this.instHalo)
    // Needle + thread.
    this.needleObj = this.child(this.driverHand, "GhostNeedle")
    this.meshChild(this.needleObj, "NeedleMesh", buildNeedle(Math.max(0.52, this.needleRadius), 0.036), this.needleMat, vec3.zero(), this.needleHalo)
    this.thread = new GhostThread(72, 6, 0.034)
    this.threadObj = this.child(this.driverHand, "GhostSuture")
    this.addVisual(this.threadObj, this.thread.mesh, this.threadMat)
    // Forceps.
    this.forcepsObj = this.child(this.forcepsHand, "GhostForceps")
    this.forcepsArmA = this.meshChild(this.forcepsObj, "ForcepsArmA", buildForcepsArm(1), this.instMat, v3(FORCEPS_PIVOT_X, 0, 0), this.instHalo)
    this.forcepsArmB = this.meshChild(this.forcepsObj, "ForcepsArmB", buildForcepsArm(-1), this.instMat, v3(FORCEPS_PIVOT_X, 0, 0), this.instHalo)
    // Sleeves.
    const sleeveMesh = buildSleeve()
    this.sleeveR = this.child(this.driverHand, "GhostSleeveR")
    this.addVisual(this.sleeveR, sleeveMesh, this.sleeveMat, 9995)
    this.sleeveL = this.child(this.forcepsHand, "GhostSleeveL")
    this.addVisual(this.sleeveL, sleeveMesh, this.sleeveMat, 9995)
  }

  private child(parent: SceneObject, name: string): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    return so
  }

  private meshChild(parent: SceneObject, name: string, mesh: RenderMesh, mat: Material, pos: vec3, halo: Material | null = null): SceneObject {
    const so = this.child(parent, name)
    so.getTransform().setLocalPosition(pos)
    const rmv = this.addVisual(so, mesh, mat)
    if (halo) rmv.addMaterial(halo)
    return so
  }

  private addVisual(so: SceneObject, mesh: RenderMesh, mat: Material, order: number = 9990): RenderMeshVisual {
    const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = mesh
    rmv.mainMaterial = mat
    rmv.setRenderOrder(order)
    this.shadowSetup(rmv)
    return rmv
  }

  private shadowSetup(rmv: RenderMeshVisual): void {
    if (!this.castShadows) return
    rmv.meshShadowMode = MeshShadowMode.Caster
    rmv.shadowDensity = this.shadowDensity
    rmv.shadowColor = new vec4(0.05, 0.12, 0.16, 0.0)
  }

  private applyHandMaterial(model: SceneObject): void {
    if (!model) return
    const visit = (so: SceneObject) => {
      const rmvs = so.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]
      for (const r of rmvs) {
        r.clearMaterials()
        r.addMaterial(this.handDepthMat)
        r.addMaterial(this.handMat)
        if (this.handHalo) r.addMaterial(this.handHalo)
        r.setRenderOrder(9999)
        this.shadowSetup(r)
      }
      for (let i = 0; i < so.getChildrenCount(); i++) visit(so.getChild(i))
    }
    visit(model)
  }
}

/** Fraction of the needle's roll the forceps hand follows while pulling it through. */
const FORCEPS_FOLLOW = 0.3

/** Degrees the forceps turn the needle about its centre to pull it fully through. */
const NEEDLE_PULL_DEG = 142

/** Slow-in, steady, slow-out drive (the needle should look pushed, not swung). */
function smoothDrive(u: number): number {
  const c = clamp01(u)
  return c * c * (3 - 2 * c) * 0.7 + c * 0.3
}

/** Sleeve start relative to the wrist frame (X fingers, Y dorsal). */
const SLEEVE_OFFSET = new vec3(-0.5, 0.2, 0)

/**
 * Palm grip wrist frame in the driver frame (+X to the jaws, +Y jaw opening, +Z through the jaws).
 * The palm faces PALM_DIR (chosen so the 150° drive runs from ~65° supination to ~85° pronation);
 * the fingers cross the shaft at PALM_YAW_DEG so they can wrap it; the palm centre rests on the
 * shank at PALM_CONTACT_X.
 */
const PALM_DIR = new vec3(0, 0.5, -0.866)
const PALM_YAW_DEG = -22
const PALM_CONTACT_X = -13.5
/** Palm-centre distance from the wrist along the fingers, and palm thickness (bone → skin), cm. */
const PALM_CENTRE_CM = 5.5
const PALM_DEPTH_CM = 1.5

function palmGripWrist(): Pose {
  const P = PALM_DIR.normalize()
  const S = P.cross(vec3.right()).normalize()
  const a = PALM_YAW_DEG * DEG
  const xh = vec3.right().uniformScale(Math.cos(a)).add(S.uniformScale(Math.sin(a)))
  const yh = P.uniformScale(-1)
  const w = v3(PALM_CONTACT_X, 0, 0).sub(xh.uniformScale(PALM_CENTRE_CM)).add(yh.uniformScale(PALM_DEPTH_CM))
  return new Pose(w, basisQuat(xh, yh))
}

/** Pencil grip: pinch point on the forceps (forceps frame) and roll of the hand about the forceps. */
const PENCIL_AT = new vec3(-5.6, 0, 0)
const PENCIL_ROLL_DEG = 0
/** Thumb-pad to index-pad distance (bone centres, cm) when pinching the forceps arms. */
const PENCIL_PAD_GAP = 2.3
/** Direction from the index pad to the thumb pad (hand cross-section degrees, 0 dorsal → 180 palmar). */
const PENCIL_PINCH_DEG = 135

const OPEN_POSE: HandPose = {
  thumb: {abd: 15, flex: 5, roll: 10, mcp: 5, ip: 5},
  index: fp(0, 12, 12, 6),
  mid: fp(0, 14, 16, 8),
  ring: fp(0, 16, 18, 8),
  pinky: fp(0, 18, 20, 10),
  cup: 4,
}

const DRIVER_POSE: HandPose = {
  thumb: {abd: 30, flex: 20, roll: 30, mcp: 10, ip: 15},
  index: fp(-6, 28, 34, 12),
  mid: fp(0, 35, 50, 20),
  ring: fp(-3, 48, 62, 20),
  pinky: fp(-7, 55, 70, 35),
  cup: 8,
}

const FORCEPS_POSE: HandPose = {
  thumb: {abd: 40, flex: 30, roll: 45, mcp: 15, ip: 15},
  index: fp(0, 42, 38, 12),
  mid: fp(-2, 52, 55, 22),
  ring: fp(-5, 66, 75, 38),
  pinky: fp(-9, 70, 78, 42),
  cup: 10,
}
