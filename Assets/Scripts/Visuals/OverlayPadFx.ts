/**
 * OverlayPadFx — every holographic overlay drawn on the skin around the wound (plain class, owned
 * by SteadyHandsPadController).
 *
 * Owns:
 *  - Bite marks: per bite a holder "Bite_i" with exact-position holders "DotNear"/"DotFar"; each
 *    dot is a 2 mm fresnel bead, a camera-facing halo and a soft light pool on the skin; a faint
 *    arched light line joins the pair across the cut. Reveal = A→B cascade (35 ms stagger,
 *    overshoot pop) behind a light sweep along the incision; then a slow travelling shimmer.
 *  - The holographic ruler (mm / half-cm / cm ticks) drawn on with a sweep on the far side of the cut.
 *  - The Closed sequence: bites turn green A→B (~70 ms stagger) with a ring pop each, a green
 *    sweep runs along the incision, then everything fades (inside the pad's fade window).
 *  - Pinch markers (ring + crisp ripples + spark burst + light pillar + core bead) and the hover reticle.
 *  - The ghost attending's leftover interrupted suture: violet-blue monofilament arcing over the
 *    wound from the far puncture to the near one, knot + cut tails to one side, glowing punctures.
 * Must not: decide when anything shows (SteadyHandsMain via the pad controller does that) or touch
 * the skin visuals (PadVisual / CutLine_6cm belong to the stage).
 *
 * Frame: pad-local, origin = pad centre, +Y up, skin top at y = topY, +Z toward the user.
 */
import {P2} from "../SteadyHandsMath"
import {
  FacingSprites,
  HoloMat,
  HoloMode,
  MeshKit,
  clamp01,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  holder,
  meshObject,
  unitBead,
  unitFlatSprite,
  unitSprite,
} from "./OverlayKit"

export interface PadFxConfig {
  pad: SceneObject
  topY: number
  biteMarksRoot: SceneObject
  pinchMarkerA: SceneObject
  pinchMarkerB: SceneObject
  ghostStitchRoot: SceneObject
  dotColor: vec4
  ringColor: vec4
  dotDiameterCm: number
  edgeOffsetCm: number
}

/** Height of the overlays above the skin, cm (0.4 mm: clear of the skin mesh, reads as "on" it). */
const LIFT = 0.04
const STAGGER = 0.035
const RULER_OFFSET = 1.05
const UP = new vec3(0, 1, 0)
/** Deep luminous cyan used for glows that must read on light skin. */
const DEEP = new vec4(0.06, 0.62, 0.9, 1)

/** Several materials faded together, each keeping its own relative weight. */
class MatGroup {
  private mats: HoloMat[] = []
  private level = 1
  add(m: HoloMat): HoloMat {
    this.mats.push(m)
    m.setLevel(this.level)
    return m
  }
  setLevel(k: number): void {
    this.level = Math.max(0, Math.min(1, k))
    for (const m of this.mats) m.setLevel(this.level)
  }
  getLevel(): number {
    return this.level
  }
}

interface BiteFx {
  root: SceneObject
  beads: SceneObject[]
  halos: SceneObject[]
  pools: SceneObject[]
  line: SceneObject
  /** Bite centre on the cut (pad-local, overlay height). */
  centre: vec3
  /** Close-sequence time this bite turned green (-1 = not yet). */
  greenAt: number
  pop: SceneObject | null
  popMat: HoloMat | null
}

interface Spark {
  anchor: SceneObject
  dir: vec3
  speed: number
}

interface MarkerFx {
  root: SceneObject
  ring: SceneObject
  ripples: SceneObject[]
  rippleMats: HoloMat[]
  pillar: SceneObject
  core: SceneObject
  group: MatGroup
  ringMat: HoloMat
  pillarMat: HoloMat
  sparks: Spark[]
  sparkMat: HoloMat
  t: number
}

export class OverlayPadFx {
  private cfg: PadFxConfig
  private facing = new FacingSprites()
  private fxRoot: SceneObject

  // bite marks
  readonly dotTint: HoloMat
  private haloMat: HoloMat
  private poolMat: HoloMat
  private lineMat: HoloMat
  private rulerMat: HoloMat
  private sweepMat: HoloMat
  private flareMat: HoloMat
  private guideMat: HoloMat
  private lineMesh: RenderMesh
  private bites: BiteFx[] = []
  private markRoot: SceneObject | null = null
  private ruler: SceneObject | null = null
  private sweepFlat: SceneObject | null = null
  private sweepFlare: SceneObject | null = null
  private sweepFlareAnchor: SceneObject | null = null
  private guide: SceneObject | null = null
  private markA: vec3 = vec3.zero()
  private markB: vec3 = vec3.zero()
  private revealT = -1
  private closeT = -1
  private closeStagger = 0.07
  private greenBeadMat: HoloMat
  private greenHaloMat: HoloMat
  private greenPoolMat: HoloMat
  private greenLineMat: HoloMat
  private greenSweepMat: HoloMat
  private greenFlareMat: HoloMat
  private biteLevel = 1
  private time = 0

  // pinch markers + reticle
  private markers: MarkerFx[] = []
  private reticle: SceneObject
  private reticleMat: HoloMat
  private reticleDotMat: HoloMat
  private reticleTarget: vec3 | null = null

  // ghost stitch
  readonly ghostEntry: SceneObject
  readonly ghostExit: SceneObject
  readonly ghostThread: SceneObject
  private punctureMat: HoloMat
  private punctureHaloMat: HoloMat
  private threadMat: HoloMat
  private threadT = -1
  private entryT = -1
  private exitT = -1

  constructor(cfg: PadFxConfig) {
    this.cfg = cfg
    this.fxRoot = holder(cfg.pad, "OverlayFx")
    const c = cfg.dotColor

    // ── bite-mark materials (shared by every bite; dotTint is the master level) ──
    // On the bright skin glows must TINT (coverage) rather than add, or they wash out to white.
    const D = DEEP
    this.dotTint = new HoloMat(HoloMode.Bead, new vec4(c.x, c.y, c.z, 1), {
      coverage: 1,
      shape: new vec4(1.3, 0.55, 0.45, 0.9),
      twoSided: false,
    })
    // Halo = soft ring of light just outside the bead (leaves the bead itself uncovered).
    this.haloMat = new HoloMat(HoloMode.Ring, new vec4(D.x, D.y, D.z, 0.75), {
      coverage: 0.42,
      shape: new vec4(0.3, 0.001, 0.26, 0),
    })
    this.poolMat = new HoloMat(HoloMode.Glow, new vec4(D.x, D.y, D.z, 0.55), {
      coverage: 0.4,
      shape: new vec4(3.6, 0, 0, 1),
    })
    this.lineMat = new HoloMat(HoloMode.Ribbon, new vec4(D.x, D.y, D.z, 0.9), {
      coverage: 0.7,
      shape: new vec4(1.1, 1.1, 0.16, 0),
    })
    this.rulerMat = new HoloMat(HoloMode.Ribbon, new vec4(0.12, 0.7, 0.95, 0.95), {
      coverage: 0.78,
      shape: new vec4(0, 0.6, 0.002, 1.2),
    })
    this.sweepMat = new HoloMat(HoloMode.Glow, new vec4(0.45, 0.95, 1, 1.0), {
      coverage: 0.45,
      shape: new vec4(3.0, 0.5, 0.25, 1),
    })
    this.flareMat = new HoloMat(HoloMode.Glow, new vec4(0.55, 0.95, 1, 1.0), {
      coverage: 0.25,
      shape: new vec4(7.0, 0.8, 0.12, 1),
    })
    this.guideMat = new HoloMat(HoloMode.Ribbon, new vec4(D.x, D.y, D.z, 1), {
      coverage: 0.6,
      shape: new vec4(0, 1.0, 0.04, 1.5),
    })
    this.lineMesh = this.buildLineMesh(cfg.edgeOffsetCm * 2)

    // ── Closed: the same marks in success green (#5CFF8A), swapped in bite by bite ──
    const G = new vec4(0.12, 0.85, 0.36, 1)
    this.greenBeadMat = new HoloMat(HoloMode.Bead, new vec4(0.3, 1.0, 0.5, 1), {
      coverage: 1,
      shape: new vec4(1.3, 0.6, 0.5, 0.9),
      twoSided: false,
    })
    this.greenHaloMat = new HoloMat(HoloMode.Ring, new vec4(G.x, G.y, G.z, 0.8), {coverage: 0.45, shape: new vec4(0.3, 0.001, 0.28, 0)})
    this.greenPoolMat = new HoloMat(HoloMode.Glow, new vec4(G.x, G.y, G.z, 0.6), {coverage: 0.42, shape: new vec4(3.4, 0, 0, 1)})
    this.greenLineMat = new HoloMat(HoloMode.Ribbon, new vec4(G.x, G.y, G.z, 1), {coverage: 0.75, shape: new vec4(1.1, 1.1, 0.16, 0)})
    this.greenSweepMat = new HoloMat(HoloMode.Glow, new vec4(0.45, 1, 0.6, 1.1), {coverage: 0.45, shape: new vec4(3.0, 0.5, 0.25, 1)})
    this.greenFlareMat = new HoloMat(HoloMode.Glow, new vec4(0.55, 1, 0.65, 1.1), {coverage: 0.25, shape: new vec4(7.0, 0.8, 0.12, 1)})

    // ── pinch markers ──
    for (const m of [cfg.pinchMarkerA, cfg.pinchMarkerB]) {
      if (m) {
        this.markers.push(this.buildMarker(m, cfg.ringColor))
        m.enabled = false
      }
    }

    // ── hover reticle ──
    const rc = cfg.ringColor
    this.reticleMat = new HoloMat(HoloMode.Ring, new vec4(0.1, 0.72, 1, 0.9), {
      coverage: 0.6,
      shape: new vec4(0.72, 0.06, 0.08, 0.2),
    })
    this.reticleDotMat = new HoloMat(HoloMode.Glow, new vec4(0.1, 0.72, 1, 1), {
      coverage: 0.6,
      shape: new vec4(9, 0.4, 0.25, 1),
    })
    this.reticle = holder(cfg.pad, "PinchReticle")
    const rr = meshObject(this.reticle, "ReticleRing", unitFlatSprite(), this.reticleMat)
    rr.getTransform().setLocalScale(new vec3(0.42, 1, 0.42))
    const rd = meshObject(this.reticle, "ReticleDot", unitFlatSprite(), this.reticleDotMat)
    rd.getTransform().setLocalScale(new vec3(0.12, 1, 0.12))
    this.reticle.enabled = false

    // ── ghost stitch ──
    this.punctureMat = new HoloMat(HoloMode.Bead, new vec4(0.55, 0.5, 1, 1), {
      coverage: 1,
      shape: new vec4(1.2, 0.9, 0.6, 0.8),
      twoSided: false,
    })
    this.punctureHaloMat = new HoloMat(HoloMode.Ring, new vec4(0.3, 0.32, 1, 0.5), {
      coverage: 0.5,
      shape: new vec4(0.28, 0.001, 0.24, 0),
    })
    // Violet-blue monofilament, glossy, lit from the OR spotlight above/behind the user.
    this.threadMat = new HoloMat(HoloMode.Gloss, new vec4(0.46, 0.4, 1.0, 1), {
      coverage: 1,
      shape: new vec4(0.1, 1.0, 0.75, 48),
      twoSided: false,
    })
    const off = cfg.edgeOffsetCm
    this.ghostEntry = this.buildPuncture(cfg.ghostStitchRoot, "GhostEntry", new vec3(0, LIFT, -off))
    this.ghostExit = this.buildPuncture(cfg.ghostStitchRoot, "GhostExit", new vec3(0, LIFT, off))
    this.ghostThread = this.buildThread(cfg.ghostStitchRoot, off)
    this.clearGhost()
  }

  // ── per-frame ───────────────────────────────────────────────────────────

  update(dt: number): void {
    this.time += dt
    this.updateBites(dt)
    this.updateMarkers(dt)
    this.updateReticle(dt)
    this.updateGhost(dt)
    this.facing.update()
  }

  // ── bite marks ──────────────────────────────────────────────────────────

  get biteCount(): number {
    return this.bites.length
  }

  /** Build the bites (exact dot positions) and start the reveal cascade. */
  showBites(a: P2, b: P2, centres: P2[]): void {
    this.clearBites()
    const cfg = this.cfg
    const dx = b.x - a.x
    const dz = b.y - a.y
    const len = Math.max(1e-4, Math.sqrt(dx * dx + dz * dz))
    // Perpendicular to the incision, in the pad plane (same convention as before: DotNear = +p).
    const px = -dz / len
    const pz = dx / len
    const y = cfg.topY + LIFT
    const d = cfg.dotDiameterCm
    const off = cfg.edgeOffsetCm
    const lineRot = quat.lookAt(new vec3(px, 0, pz), UP) // local +Z → far→near across the cut
    for (let i = 0; i < centres.length; i++) {
      const c = centres[i]
      const bite = holder(cfg.biteMarksRoot, `Bite_${i + 1}`)
      const near = holder(bite, "DotNear", new vec3(c.x + px * off, y, c.y + pz * off))
      const far = holder(bite, "DotFar", new vec3(c.x - px * off, y, c.y - pz * off))
      const fx: BiteFx = {
        root: bite,
        beads: [],
        halos: [],
        pools: [],
        line: null as any,
        centre: new vec3(c.x, y, c.y),
        greenAt: -1,
        pop: null,
        popMat: null,
      }
      for (const dot of [near, far]) {
        const bead = meshObject(dot, "Bead", unitBead(), this.dotTint, new vec3(0, d * 0.25, 0))
        bead.getTransform().setLocalScale(vec3.zero())
        const pool = meshObject(dot, "Pool", unitFlatSprite(), this.poolMat, new vec3(0, -0.01, 0))
        pool.getTransform().setLocalScale(vec3.zero())
        const halo = meshObject(dot, "Halo", unitSprite(), this.haloMat)
        halo.getTransform().setLocalScale(vec3.zero())
        this.facing.add(halo, 0.4)
        fx.beads.push(bead)
        fx.pools.push(pool)
        fx.halos.push(halo)
      }
      const line = meshObject(bite, "Line", this.lineMesh, this.lineMat, new vec3(c.x - px * off, y, c.y - pz * off))
      line.getTransform().setLocalRotation(lineRot)
      line.getTransform().setLocalScale(new vec3(1, 1, 0.001))
      fx.line = line
      this.bites.push(fx)
    }

    // Ruler on the far side of the cut (the side whose normal points away from the user, -Z).
    const sideSign = pz <= 0 ? 1 : -1 // +1: ruler on +p side, -1: on -p side
    const sx = px * sideSign
    const sz = pz * sideSign
    this.markRoot = holder(this.fxRoot, "MarkFx")
    const frameRot = quat.lookAt(new vec3(px, 0, pz), UP) // local X → A→B, local Z → +p
    this.ruler = meshObject(
      this.markRoot,
      "Ruler",
      this.buildRulerMesh(len, sideSign),
      this.rulerMat,
      new vec3(a.x + sx * RULER_OFFSET, cfg.topY + 0.03, a.y + sz * RULER_OFFSET),
    )
    this.ruler.getTransform().setLocalRotation(frameRot)
    this.rulerMat.setShape(new vec4(0, 0.7, 0.002, 1.2))

    // Light sweep: a glowing streak + flare travelling A → B, leaving a fading guide line.
    const gk = new MeshKit()
    gk.strip([new vec3(0, 0, 0), new vec3(len, 0, 0)], new vec3(0, 0, 1), 0.035)
    this.guide = meshObject(this.markRoot, "SweepGuide", gk.build(), this.guideMat, new vec3(a.x, cfg.topY + 0.05, a.y))
    this.guide.getTransform().setLocalRotation(frameRot)
    this.guideMat.setShape(new vec4(0, 1.0, 0.04, 1.5))
    this.guideMat.setGain(1)
    this.sweepFlat = meshObject(this.markRoot, "SweepStreak", unitFlatSprite(), this.sweepMat, new vec3(a.x, cfg.topY + 0.06, a.y))
    this.sweepFlat.getTransform().setLocalRotation(frameRot)
    this.sweepFlat.getTransform().setLocalScale(new vec3(0.7, 1, 0.2))
    this.sweepFlareAnchor = holder(this.markRoot, "SweepFlareAnchor", new vec3(a.x, cfg.topY + 0.08, a.y))
    this.sweepFlare = meshObject(this.sweepFlareAnchor, "SweepFlare", unitSprite(), this.flareMat)
    this.sweepFlare.getTransform().setLocalScale(new vec3(0.32, 0.32, 1))
    this.facing.add(this.sweepFlare, 0.45)

    this.markA = new vec3(a.x, cfg.topY + 0.06, a.y)
    this.markB = new vec3(b.x, cfg.topY + 0.06, b.y)
    this.revealT = 0
    this.setBiteLevel(1)
    // One frame of layout so the first rendered frame already shows the sweep at A.
    this.updateBites(0)
  }

  setBiteLevel(k: number): void {
    this.biteLevel = Math.max(0, Math.min(1, k))
    this.dotTint.setLevel(this.biteLevel)
    this.haloMat.setLevel(this.biteLevel)
    this.poolMat.setLevel(this.biteLevel)
    this.lineMat.setLevel(this.biteLevel)
    this.rulerMat.setLevel(this.biteLevel)
    this.greenBeadMat.setLevel(this.biteLevel)
    this.greenHaloMat.setLevel(this.biteLevel)
    this.greenPoolMat.setLevel(this.biteLevel)
    this.greenLineMat.setLevel(this.biteLevel)
  }

  /**
   * Closed: bites turn green one after another A → B with a ring pop each, chased by a green
   * sweep. Returns the stagger (s) so the caller can sync sound. The fade itself is driven by
   * setBiteLevel from the pad controller's fade window.
   */
  startCloseSequence(): number {
    const n = this.bites.length
    this.closeStagger = n > 1 ? Math.min(0.07, 0.7 / (n - 1)) : 0.07
    this.closeT = 0
    for (const fx of this.bites) {
      fx.greenAt = -1
      if (!fx.pop) {
        fx.popMat = new HoloMat(HoloMode.Ring, new vec4(0.2, 1, 0.45, 1), {coverage: 0.5, shape: new vec4(0.8, 0.05, 0.09, 0.4)})
        fx.pop = meshObject(fx.root, "GreenPop", unitFlatSprite(), fx.popMat, fx.centre.add(new vec3(0, 0.01, 0)))
        fx.pop.getTransform().setLocalScale(new vec3(0.001, 1, 0.001))
        fx.popMat.setLevel(0)
      }
    }
    if (this.sweepFlat && this.sweepFlare) {
      setMat(this.sweepFlat, this.greenSweepMat)
      setMat(this.sweepFlare, this.greenFlareMat)
      this.sweepFlat.enabled = true
      this.sweepFlare.enabled = true
    }
    return this.closeStagger
  }

  clearBites(): void {
    for (const b of this.bites) b.root.destroy()
    this.bites = []
    if (this.markRoot) this.markRoot.destroy()
    this.markRoot = null
    this.ruler = null
    this.sweepFlat = null
    this.sweepFlare = null
    this.sweepFlareAnchor = null
    this.guide = null
    this.revealT = -1
    this.closeT = -1
    this.facing.prune()
    this.setBiteLevel(1)
  }

  private updateBites(dt: number): void {
    if (this.revealT < 0) return
    this.revealT += dt
    const t = this.revealT
    const n = this.bites.length
    const d = this.cfg.dotDiameterCm
    const fade = this.biteLevel
    const shrink = 0.55 + 0.45 * fade

    // Sweep head: passes bite i at t_i = 0.08 + i * STAGGER.
    const tStart = 0.08 - STAGGER
    const tEnd = 0.08 + n * STAGGER
    const f = clamp01((t - tStart) / Math.max(0.01, tEnd - tStart))
    if (this.closeT >= 0) this.closeT += dt
    if (this.closeT < 0 && this.sweepFlat && this.sweepFlareAnchor && this.guide) {
      const head = this.markA.add(this.markB.sub(this.markA).uniformScale(f))
      this.sweepFlat.getTransform().setLocalPosition(head)
      this.sweepFlareAnchor.getTransform().setLocalPosition(new vec3(head.x, head.y + 0.02, head.z))
      const on = t < tStart ? 0 : t < tEnd ? 1 : Math.max(0, 1 - (t - tEnd) / 0.18)
      const swell = 0.75 + 0.25 * Math.sin(Math.PI * f)
      this.sweepMat.setLevel(on * fade)
      this.flareMat.setLevel(on * fade)
      this.sweepFlat.getTransform().setLocalScale(new vec3(1.15 * swell, 1, 0.3))
      this.sweepFlare.getTransform().setLocalScale(new vec3(0.55 * swell, 0.55 * swell, 1))
      this.guideMat.setShape(new vec4(f < 1 ? f : 1.1, 1.0, 0.04, f < 1 ? 1.5 : 0))
      const guideFade = t < tEnd + 0.1 ? 1 : Math.max(0, 1 - (t - tEnd - 0.1) / 0.6)
      this.guideMat.setLevel(guideFade * 0.85 * fade)
      const sweepDone = t > tEnd + 0.8
      this.sweepFlat.enabled = !sweepDone
      this.sweepFlare.enabled = !sweepDone
      this.guide.enabled = !sweepDone
    }

    // Closed: green sweep chasing the cascade A → B.
    const ct = this.closeT
    const cs = this.closeStagger
    if (ct >= 0 && this.sweepFlat && this.sweepFlareAnchor && this.sweepFlare) {
      const span = Math.max(0.05, cs * Math.max(1, n - 1) + 0.12)
      const g = clamp01((ct - 0.02) / span)
      const head = this.markA.add(this.markB.sub(this.markA).uniformScale(g))
      this.sweepFlat.getTransform().setLocalPosition(head)
      this.sweepFlareAnchor.getTransform().setLocalPosition(new vec3(head.x, head.y + 0.02, head.z))
      const on = ct < span ? 1 : Math.max(0, 1 - (ct - span) / 0.2)
      const swell = 0.8 + 0.3 * Math.sin(Math.PI * g)
      this.greenSweepMat.setLevel(on)
      this.greenFlareMat.setLevel(on)
      this.sweepFlat.getTransform().setLocalScale(new vec3(1.2 * swell, 1, 0.32))
      this.sweepFlare.getTransform().setLocalScale(new vec3(0.6 * swell, 0.6 * swell, 1))
    }

    // Ruler draws on just behind the sweep.
    const rr = easeInOutCubic((t - 0.12) / 0.6)
    this.rulerMat.setShape(new vec4(rr < 1 ? rr : 1.1, 0.7, 0.002, rr < 1 ? 1.4 : 0))

    // Bites pop in A → B, then shimmer with a slow wave travelling along the incision.
    const breath = 0.9 + 0.1 * Math.sin((this.time * 2 * Math.PI) / 2.8)
    this.haloMat.setGain(breath)
    this.poolMat.setGain(0.92 + 0.08 * Math.sin((this.time * 2 * Math.PI) / 2.8 + 1.2))
    for (let i = 0; i < n; i++) {
      const fx = this.bites[i]
      const tau = t - (0.08 + i * STAGGER)
      // Closed: turn this bite green at its turn in the cascade, with a pop.
      let gp = 0
      if (ct >= 0) {
        const tg = ct - i * cs
        if (tg >= 0 && fx.greenAt < 0) {
          fx.greenAt = ct
          for (const b of fx.beads) setMat(b, this.greenBeadMat)
          for (const h of fx.halos) setMat(h, this.greenHaloMat)
          for (const p of fx.pools) setMat(p, this.greenPoolMat)
          setMat(fx.line, this.greenLineMat)
        }
        if (fx.greenAt >= 0) {
          const tp = ct - fx.greenAt
          gp = Math.exp(-tp / 0.12) * clamp01(tp / 0.03)
          if (fx.pop && fx.popMat) {
            const k = clamp01(tp / 0.4)
            const ps = 0.25 + 0.75 * easeOutCubic(k)
            fx.pop.getTransform().setLocalScale(new vec3(ps, 1, ps))
            fx.popMat.setLevel((1 - k) * (1 - k) * fade)
          }
        }
      }
      const pop = (tau <= 0 ? 0 : easeOutBack(tau / 0.3, 2.6)) * (1 + 0.55 * gp)
      const r = (d / 2) * pop * shrink
      const flash = (tau <= 0 ? 0 : easeOutCubic(tau / 0.1) * (1 + 2.2 * Math.exp(-tau / 0.18))) * (1 + 1.4 * gp)
      const wave = 1 + 0.1 * Math.sin((this.time * 2 * Math.PI) / 2.6 - i * 0.45)
      const h = 0.42 * flash * wave * shrink
      const pool = (tau <= 0 ? 0 : easeOutCubic(tau / 0.4)) * 0.36 * shrink
      for (const bead of fx.beads) bead.getTransform().setLocalScale(new vec3(r, r, r))
      for (const halo of fx.halos) halo.getTransform().setLocalScale(new vec3(h, h, 1))
      for (const p of fx.pools) p.getTransform().setLocalScale(new vec3(pool, 1, pool))
      const lt = easeInOutCubic((tau - 0.05) / 0.25)
      fx.line.getTransform().setLocalScale(new vec3(1, 1, Math.max(0.001, lt)))
    }
  }

  /** Unit arch across the cut along +Z from 0 to `span`, rising a little over the wound. */
  private buildLineMesh(span: number): RenderMesh {
    const pts: vec3[] = []
    const N = 12
    for (let i = 0; i <= N; i++) {
      const s = i / N
      const z = span * s
      const yv = 0.07 * Math.sin(Math.PI * s) + 0.0
      pts.push(new vec3(0, yv, z))
    }
    const k = new MeshKit()
    k.strip(pts, new vec3(1, 0, 0), 0.022)
    return k.build()
  }

  /** Ruler comb in its local frame: x 0..len along the cut, ticks toward local ±Z (away from the cut). */
  private buildRulerMesh(len: number, sideSign: number): RenderMesh {
    const k = new MeshKit()
    // Base line.
    k.quad(new vec3(len / 2, 0, 0), new vec3(len / 2 + 0.03, 0, 0), new vec3(0, 0, -0.02), 0, -1, 1, 1)
    const nTicks = Math.floor(len * 10 + 1e-4)
    for (let i = 0; i <= nTicks; i++) {
      const x = i * 0.1
      const cm = i % 10 === 0
      const half = !cm && i % 5 === 0
      const tl = cm ? 0.36 : half ? 0.24 : 0.13
      const tw = cm ? 0.022 : half ? 0.016 : 0.011
      const u = Math.max(0.003, Math.min(0.997, x / Math.max(0.01, len)))
      // Tick from the line outward (away from the cut); v runs across the tick's width.
      const zc = sideSign * (tl / 2)
      k.quad(new vec3(x, 0.001, zc), new vec3(0, 0, -tl / 2), new vec3(tw, 0, 0), u, -1, u, 1)
    }
    return k.build()
  }

  // ── pinch markers ───────────────────────────────────────────────────────

  get markerLevels(): MatGroup[] {
    return this.markers.map((m) => m.group)
  }

  showMarker(index: number, local: vec3): void {
    const m = this.markers[index]
    if (!m) return
    m.root.getTransform().setLocalPosition(new vec3(local.x, this.cfg.topY + 0.05, local.z))
    m.root.enabled = true
    m.t = 0
    m.group.setLevel(1)
    this.updateMarker(m, 0)
  }

  hideMarkers(): void {
    for (const m of this.markers) m.root.enabled = false
  }

  setMarkerLevel(k: number): void {
    for (const m of this.markers) m.group.setLevel(k)
  }

  private buildMarker(root: SceneObject, rc: vec4): MarkerFx {
    const group = new MatGroup()
    const ringMat = group.add(
      new HoloMat(HoloMode.Ring, new vec4(0.08, 0.7, 1, 1), {coverage: 0.75, shape: new vec4(0.62, 0.07, 0.09, 0.35)}),
    )
    const ring = meshObject(root, "Ring", unitFlatSprite(), ringMat)
    const rippleMats: HoloMat[] = []
    const ripples: SceneObject[] = []
    for (let i = 0; i < 2; i++) {
      // Ripple 1 is crisp and fast (thin bright line), ripple 2 soft and wide.
      const crisp = i === 0
      const rm = group.add(
        new HoloMat(HoloMode.Ring, new vec4(crisp ? 0.35 : 0.1, crisp ? 0.9 : 0.72, 1, crisp ? 1.1 : 0.85), {
          coverage: crisp ? 0.7 : 0.45,
          shape: crisp ? new vec4(0.86, 0.022, 0.035, 0.6) : new vec4(0.8, 0.05, 0.09, 0.2),
        }),
      )
      rippleMats.push(rm)
      ripples.push(meshObject(root, `Ripple${i + 1}`, unitFlatSprite(), rm))
    }
    const pillarMat = group.add(
      new HoloMat(HoloMode.Ribbon, new vec4(0.2, 0.8, 1, 0.9), {coverage: 0.45, shape: new vec4(1.1, 1.4, 0.5, 0)}),
    )
    const pillarAnchor = holder(root, "PillarAnchor")
    const pk = new MeshKit()
    // u runs 0.5 (base) → 1 (top) so only the top end tapers away.
    pk.quad(new vec3(0, 0.6, 0), new vec3(0, 0.6, 0), new vec3(-0.05, 0, 0), 0.5, -1, 1, 1)
    const pillar = meshObject(pillarAnchor, "Pillar", pk.build(), pillarMat)
    this.facing.add(pillar, 0.0, true)
    const coreMat = group.add(
      new HoloMat(HoloMode.Bead, new vec4(0.1, 0.78, 1, 1), {coverage: 1, shape: new vec4(1.3, 0.6, 0.5, 0.9), twoSided: false}),
    )
    const core = meshObject(root, "Core", unitBead(), coreMat, new vec3(0, 0.04, 0))
    // Tiny spark burst: a few glints thrown outward and up from the pinch point.
    const sparkMat = group.add(
      new HoloMat(HoloMode.Glow, new vec4(0.6, 0.97, 1, 1.2), {coverage: 0.3, shape: new vec4(6, 0.9, 0.3, 1)}),
    )
    const sparks: Spark[] = []
    const N_SPARK = 8
    for (let i = 0; i < N_SPARK; i++) {
      const a = (2 * Math.PI * (i + 0.35 * (i % 2))) / N_SPARK
      const anchor = holder(root, `SparkAnchor${i + 1}`)
      const sp = meshObject(anchor, "Spark", unitSprite(), sparkMat)
      sp.getTransform().setLocalScale(new vec3(0.06, 0.06, 1))
      this.facing.add(sp, 0.05)
      sparks.push({anchor, dir: new vec3(Math.cos(a), 0.55 + 0.35 * (i % 3) / 2, Math.sin(a)), speed: 1.6 + 0.5 * (i % 3)})
    }
    return {root, ring, ripples, rippleMats, pillar, core, group, ringMat, pillarMat, sparks, sparkMat, t: -1}
  }

  private updateMarkers(dt: number): void {
    for (const m of this.markers) {
      if (!m.root.enabled || m.t < 0) continue
      m.t += dt
      this.updateMarker(m, m.t)
    }
  }

  private updateMarker(m: MarkerFx, t: number): void {
    const pop = easeOutBack(t / 0.35, 2.4)
    const breath = 1 + 0.05 * Math.sin(this.time * 2.4)
    const rs = 0.7 * Math.max(0.001, pop) * breath
    m.ring.getTransform().setLocalScale(new vec3(rs, 1, rs))
    m.ringMat.setGain(1 + 1.2 * Math.exp(-t / 0.2))
    for (let i = 0; i < m.ripples.length; i++) {
      const tau = t - i * 0.12
      const dur = i === 0 ? 0.45 : 0.8
      const k = clamp01(tau / dur)
      const s = (i === 0 ? 0.35 : 0.3) + (i === 0 ? 1.25 : 1.7) * easeOutCubic(k)
      m.ripples[i].getTransform().setLocalScale(new vec3(s, 1, s))
      m.rippleMats[i].setGain(tau < 0 ? 0 : (1 - k) * (1 - k))
      m.ripples[i].enabled = tau < dur + 0.05
    }
    const sk = clamp01(t / 0.42)
    for (const sp of m.sparks) {
      const dist = sp.speed * 0.42 * (1 - (1 - sk) * (1 - sk)) * 0.5
      sp.anchor.getTransform().setLocalPosition(new vec3(sp.dir.x * dist, 0.05 + sp.dir.y * dist, sp.dir.z * dist))
      sp.anchor.enabled = t < 0.45
    }
    m.sparkMat.setGain((1 - sk) * (1 - sk))
    const grow = easeOutCubic(t / 0.3)
    m.pillar.getTransform().setLocalScale(new vec3(1, Math.max(0.001, grow), 1))
    m.pillarMat.setGain((0.55 + 0.9 * Math.exp(-t / 0.3)) * (0.92 + 0.08 * Math.sin(this.time * 3.1)))
    const cr = 0.08 * Math.max(0.001, pop) * (1 + 0.8 * Math.exp(-t / 0.12))
    m.core.getTransform().setLocalScale(new vec3(cr, cr, cr))
  }

  // ── hover reticle ───────────────────────────────────────────────────────

  /** Where the pinch would land (pad-local), or null to hide. */
  setReticle(p: vec3 | null): void {
    if (!p) {
      this.reticle.enabled = false
      this.reticleTarget = null
      return
    }
    const target = new vec3(p.x, this.cfg.topY + 0.04, p.z)
    if (!this.reticle.enabled || !this.reticleTarget) {
      this.reticle.getTransform().setLocalPosition(target)
    }
    this.reticleTarget = target
    this.reticle.enabled = true
  }

  private updateReticle(dt: number): void {
    if (!this.reticle.enabled || !this.reticleTarget) return
    const tr = this.reticle.getTransform()
    const cur = tr.getLocalPosition()
    const k = 1 - Math.exp(-dt * 30)
    tr.setLocalPosition(cur.add(this.reticleTarget.sub(cur).uniformScale(k)))
    const s = 1 + 0.06 * Math.sin(this.time * 5)
    tr.setLocalScale(new vec3(s, 1, s))
    this.reticleMat.setGain(0.85 + 0.15 * Math.sin(this.time * 5))
  }

  // ── ghost stitch ────────────────────────────────────────────────────────

  showGhost(stage: "entry" | "exit", color: vec4): void {
    this.punctureHaloMat.setColor(new vec4(color.x * 0.3, color.y * 0.32, color.z, 0.5))
    this.punctureMat.setLevel(1)
    this.punctureHaloMat.setLevel(1)
    this.cfg.ghostStitchRoot.enabled = true
    if (!this.ghostEntry.enabled) this.entryT = 0
    this.ghostEntry.enabled = true
    if (stage === "exit") {
      if (!this.ghostExit.enabled) this.exitT = 0
      if (!this.ghostThread.enabled) this.threadT = 0
      this.ghostExit.enabled = true
      this.ghostThread.enabled = true
    }
    this.updateGhost(0)
  }

  clearGhost(): void {
    this.ghostEntry.enabled = false
    this.ghostExit.enabled = false
    this.ghostThread.enabled = false
    this.entryT = -1
    this.exitT = -1
    this.threadT = -1
  }

  private updateGhost(dt: number): void {
    if (this.entryT >= 0) {
      this.entryT += dt
      this.popPuncture(this.ghostEntry, this.entryT)
    }
    if (this.exitT >= 0) {
      this.exitT += dt
      this.popPuncture(this.ghostExit, this.exitT)
    }
    if (this.threadT >= 0) {
      this.threadT += dt
      this.threadMat.setLevel(easeOutCubic(this.threadT / 0.35))
    }
  }

  private popPuncture(p: SceneObject, t: number): void {
    const bead = p.getChild(0)
    const halo = p.getChild(1).getChild(0)
    const r = 0.05 * Math.max(0.001, easeOutBack(t / 0.3, 2.4))
    bead.getTransform().setLocalScale(new vec3(r, r, r))
    const h = 0.3 * (1 + 1.4 * Math.exp(-t / 0.18)) * (0.94 + 0.06 * Math.sin(this.time * 2.2))
    halo.getTransform().setLocalScale(new vec3(h, h, 1))
  }

  private buildPuncture(root: SceneObject, name: string, pos: vec3): SceneObject {
    const p = holder(root, name, pos)
    const bead = meshObject(p, "Puncture", unitBead(), this.punctureMat)
    bead.getTransform().setLocalScale(new vec3(0.05, 0.05, 0.05))
    const anchor = holder(p, "HaloAnchor")
    const halo = meshObject(anchor, "PunctureHalo", unitSprite(), this.punctureHaloMat)
    halo.getTransform().setLocalScale(new vec3(0.3, 0.3, 1))
    this.facing.add(halo, 0.25)
    return p
  }

  /**
   * Interrupted suture, GhostStitch-local (skin at y = 0): the thread surfaces at the far puncture,
   * arcs over the wound, is tied in a small knot beside the near puncture and dives back in;
   * two short cut tails splay from the knot.
   */
  private buildThread(root: SceneObject, off: number): SceneObject {
    const so = holder(root, "GhostThread")
    const k = new MeshKit()
    const R = 0.03
    const knot = new vec3(0.07, 0.085, off * 0.72)
    const ctrl = [
      new vec3(0, -0.08, -off),
      new vec3(0, 0.0, -off * 0.98),
      new vec3(0.005, 0.07, -off * 0.78),
      new vec3(0.015, 0.125, -off * 0.38),
      new vec3(0.03, 0.14, 0.0),
      new vec3(0.045, 0.125, off * 0.38),
      knot,
      new vec3(0.035, 0.05, off * 0.9),
      new vec3(0, -0.08, off),
    ]
    k.tube(catmull(ctrl, 6), R, 8)
    // Knot: three snug throws.
    k.sphere(knot, 0.05, 10, 7)
    k.sphere(knot.add(new vec3(0.045, 0.012, -0.03)), 0.042, 10, 7)
    k.sphere(knot.add(new vec3(-0.035, 0.008, 0.035)), 0.04, 10, 7)
    // Cut tails.
    k.tube(catmull([knot, knot.add(new vec3(0.14, 0.04, -0.05)), knot.add(new vec3(0.34, 0.07, -0.1))], 4), R * 0.95, 6)
    k.tube(catmull([knot, knot.add(new vec3(0.12, 0.03, 0.08)), knot.add(new vec3(0.28, 0.05, 0.2))], 4), R * 0.95, 6)
    meshObject(so, "Monofilament", k.build(), this.threadMat)
    return so
  }
}

/** Catmull-Rom through the control points (`sub` samples per span, ends included). */
function catmull(p: vec3[], sub: number): vec3[] {
  const out: vec3[] = []
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)]
    const p1 = p[i]
    const p2 = p[i + 1]
    const p3 = p[Math.min(p.length - 1, i + 2)]
    for (let s = 0; s < sub; s++) {
      const t = s / sub
      const t2 = t * t
      const t3 = t2 * t
      out.push(
        p1
          .uniformScale(2)
          .add(p2.sub(p0).uniformScale(t))
          .add(p0.uniformScale(2).sub(p1.uniformScale(5)).add(p2.uniformScale(4)).sub(p3).uniformScale(t2))
          .add(p1.uniformScale(3).sub(p0).sub(p2.uniformScale(3)).add(p3).uniformScale(t3))
          .uniformScale(0.5),
      )
    }
  }
  out.push(p[p.length - 1])
  return out
}

/** Swap the material of a visual built by meshObject (bite colour change). */
function setMat(so: SceneObject, mat: HoloMat): void {
  if (!so || isNull(so) || !mat.material) return
  const rmv = so.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
  if (rmv) rmv.mainMaterial = mat.material
}
