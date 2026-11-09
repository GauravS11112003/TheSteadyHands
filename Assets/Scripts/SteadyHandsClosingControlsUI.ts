/**
 * SteadyHandsClosingControlsUI — the controls on the left of the pad, tilted toward the user.
 *
 * Owns two views at the same spot (only one shows at a time):
 *  - Rehearse: the 3 cm "Ready to close" button (SceneObject "ReadyToCloseButton").
 *  - Closing: the needle counter ("NeedleCounter") on a frosted holographic glass plate with a cyan
 *    edge glow — large count digits (~3 cm) with the pulsing red missing-needle alert beside them,
 *    + and − as 3 cm buttons below ("NeedlePlusButton", "NeedleMinusButton"), and a green-edged
 *    "Close" beneath them, set ~2 cm further apart ("CloseButton").
 *  - While "N missing" shows: marching coral chevrons from the counter toward the Mayo instrument
 *    tray (where the needle count happens), a coral pulse ring on the alert and one on the tray.
 * UI Kit Buttons keep their interaction; only their RoundedRectangle visuals are restyled.
 *
 * API (Channel A — SteadyHandsMain drives it):
 *   setMode("rehearse" | "closing" | "hidden"), setNeedleCount(n), showMissing(text), hideMissing()
 *   Events: onReadyToClose, onPlus, onMinus, onClose
 *   Readable: mode, countDisplay, alertDisplay (+ alertText / alertIcon components).
 * Must not: count needles or decide whether Close succeeds — passive view only.
 */
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexAlign, FlexDirection, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {GradientParameters} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {HOLO_CORAL, HoloMat, HoloMode, MeshKit, easeOutCubic, meshObject, unitFlatSprite, unitSprite} from "./Visuals/OverlayKit"
import {HoloPanel, PANEL_CYAN} from "./Visuals/OverlayPanel"

const ICON_ADD: Texture = requireAsset("../Icons/add.png") as Texture
const ICON_REMOVE: Texture = requireAsset("../Icons/remove.png") as Texture
const ICON_CHECK: Texture = requireAsset("../Icons/check_circle.png") as Texture
const ICON_SKIP: Texture = requireAsset("../Icons/skip_next.png") as Texture
const ICON_WARNING: Texture = requireAsset("../Icons/warning.png") as Texture
const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material

// ── Typography: the single source of truth for text size + weight ────────────
// `Component.Text.size` is the glyph EM-SQUARE height (em cm = size / 43.886), calibrated for
// the SnapOS system font at 110 cm. Pick a role, never a raw number.
const FONT_SIZE_SCALE = 1.0
type TextRole =
  | "Title1" | "Title2" | "HeadlineXL" | "Headline1" | "Headline2"
  | "Subheadline" | "Button" | "Callout" | "Body" | "Caption"
const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Title1: {size: 105, weight: 700},
  Title2: {size: 93, weight: 700},
  HeadlineXL: {size: 62, weight: 700},
  Headline1: {size: 54, weight: 700},
  Headline2: {size: 48, weight: 700},
  Subheadline: {size: 41, weight: 700},
  Button: {size: 39, weight: 500},
  Callout: {size: 39, weight: 700},
  Body: {size: 39, weight: 500},
  Caption: {size: 38, weight: 500},
}
function roleSize(role: TextRole, distanceCm: number = 110): number {
  return TYPE_SCALE[role].size * FONT_SIZE_SCALE * (distanceCm / 110)
}
function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = roleSize(role, distanceCm)
  ;(t as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}
/** Role distance that makes a role's capitals about `capCm` tall (cap ≈ 0.7 em). */
function distanceForCapHeight(role: TextRole, capCm: number): number {
  const sizeNeeded = (capCm / 0.7) * 43.886
  return (110 * sizeNeeded) / (TYPE_SCALE[role].size * FONT_SIZE_SCALE)
}

const LAYOUT_Z_LIFT = 0.02
const CONTENT_Z = 0.6

export type ControlsMode = "rehearse" | "closing" | "hidden"
type ButtonLook = "neutral" | "accept" | "ready"

function grad(top: vec4, bottom: vec4): GradientParameters {
  return {
    enabled: true,
    type: "Linear",
    start: new vec2(0, 1),
    end: new vec2(0, -1),
    stop0: {enabled: true, percent: 0, color: top},
    stop1: {enabled: true, percent: 1, color: bottom},
  }
}

/** Glass-button palettes: [default top, default bottom, hover top, hover bottom, border, border hover]. */
const LOOKS: Record<ButtonLook, vec4[]> = {
  neutral: [
    new vec4(0.1, 0.3, 0.38, 0.92),
    new vec4(0.03, 0.12, 0.17, 0.92),
    new vec4(0.16, 0.44, 0.54, 0.95),
    new vec4(0.05, 0.2, 0.27, 0.95),
    new vec4(0.4, 0.88, 1.0, 1),
    new vec4(0.75, 0.97, 1.0, 1),
  ],
  accept: [
    new vec4(0.08, 0.34, 0.18, 0.92),
    new vec4(0.02, 0.14, 0.07, 0.92),
    new vec4(0.13, 0.48, 0.26, 0.95),
    new vec4(0.04, 0.22, 0.11, 0.95),
    new vec4(0.36, 1.0, 0.54, 1),
    new vec4(0.7, 1.0, 0.78, 1),
  ],
  ready: [
    new vec4(0.1, 0.32, 0.4, 0.92),
    new vec4(0.03, 0.13, 0.18, 0.92),
    new vec4(0.16, 0.46, 0.56, 0.95),
    new vec4(0.05, 0.21, 0.28, 0.95),
    new vec4(0.5, 0.92, 1.0, 1),
    new vec4(0.8, 0.98, 1.0, 1),
  ],
}

@component
export class SteadyHandsClosingControlsUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SteadyHandsClosingControlsUI – Ready to close + needle counter</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("Size of the +, − and the height of every button, cm (brief: 3 cm)")
  @widget(new SliderWidget(2, 6, 0.25))
  buttonSizeCm: number = 3
  @input
  @hint("Height of the needle count digits, cm (brief: about 3 cm)")
  @widget(new SliderWidget(1.5, 5, 0.25))
  countHeightCm: number = 3
  @input
  @hint("Extra gap above Close so it isn't hit by accident, cm (brief: about 2 cm)")
  @widget(new SliderWidget(0, 5, 0.25))
  closeExtraGapCm: number = 2
  @input
  @hint("Label on the Rehearse skip button")
  readyLabel: string = "Ready to close"
  @input("vec4", "{1,0.42,0.42,1}")
  @hint("Missing-needle alert colour (red)")
  @widget(new ColorWidget())
  alertColor: vec4
  @input
  @hint("Caption under the count")
  countCaption: string = "needles out"
  @input("vec3", "{2,-8.6,0}")
  @hint("Offset of the Rehearse 'Ready to close' button inside the controls, cm (keeps it clear of the ghost's hand)")
  readyOffsetCm: vec3
  @input("vec3", "{-55,12.3,-5}")
  @hint("Top of the Mayo instrument tray in SurgicalField coordinates, cm (the missing-needle hint points there)")
  trayTopField: vec3
  @ui.group_end

  private _onReadyToClose = new Event<void>()
  private _onPlus = new Event<void>()
  private _onMinus = new Event<void>()
  private _onClose = new Event<void>()
  get onReadyToClose(): PublicApi<void> {
    return this._onReadyToClose.publicApi()
  }
  get onPlus(): PublicApi<void> {
    return this._onPlus.publicApi()
  }
  get onMinus(): PublicApi<void> {
    return this._onMinus.publicApi()
  }
  get onClose(): PublicApi<void> {
    return this._onClose.publicApi()
  }

  /** Current mode (readable by tests). */
  mode: ControlsMode = "hidden"

  private rehearseRoot: SceneObject
  private closingRoot: SceneObject
  private plate: HoloPanel
  private countText: Text
  private countGlowMat: HoloMat
  private countPop = 1
  private alertText: Text
  private alertIcon: Image
  private alertGlow: SceneObject
  private alertGlowMat: HoloMat
  private alertPulse: SceneObject
  private alertPulseMat: HoloMat
  private trayHint: SceneObject
  private chevrons: {so: SceneObject; mat: HoloMat}[] = []
  private trayRings: {so: SceneObject; mat: HoloMat}[] = []
  private trayMark: SceneObject
  private countRowH = 4.7
  private closingLaidOut = false
  private pendingCount = 0
  private time = 0
  private alertT = -1
  private showT = 0

  /** Text currently shown in the count (readable by tests). */
  get countDisplay(): string {
    return this.countText ? this.countText.text : ""
  }
  /** Alert text and visibility (readable by tests). */
  get alertDisplay(): string {
    return this.alertText && this.alertText.enabled ? this.alertText.text : ""
  }

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    this.buildRehearse()
    this.buildClosing()
    this.applyMode()
    this.createEvent("UpdateEvent").bind(() => this.update(getDeltaTime()))
  }

  setMode(mode: ControlsMode): void {
    if (mode === "closing" && this.mode !== "closing") this.showT = 0
    this.mode = mode
    this.applyMode()
  }

  setNeedleCount(n: number): void {
    if (n !== this.pendingCount) this.countPop = 0
    this.pendingCount = n
    if (this.countText) this.countText.text = `${n}`
  }

  showMissing(text: string): void {
    this.alertText.text = text
    this.alertText.enabled = true
    this.alertIcon.enabled = true
    this.alertGlow.enabled = true
    if (this.alertT < 0) this.alertT = 0
    else this.alertT = Math.min(this.alertT, 0.05)
    this.aimTrayHint()
    this.trayHint.enabled = true
    this.alertPulse.enabled = true
    this.trayMark.enabled = true
  }

  hideMissing(): void {
    this.alertText.enabled = false
    this.alertIcon.enabled = false
    this.alertGlow.enabled = false
    this.alertT = -1
    if (this.trayHint) this.trayHint.enabled = false
    if (this.alertPulse) this.alertPulse.enabled = false
    if (this.trayMark) this.trayMark.enabled = false
    if (this.plate) {
      this.plate.setEdge(PANEL_CYAN.edge)
      this.plate.setEdgeGain(1)
    }
  }

  // ── per-frame ────────────────────────────────────────────────────────────

  private update(dt: number): void {
    this.time += dt
    // Count digits: soft cyan bloom that breathes, a quick flare when the count changes.
    this.countPop = Math.min(1, this.countPop + dt / 0.35)
    if (this.countGlowMat) {
      const flare = 1 + 0.9 * (1 - easeOutCubic(this.countPop))
      this.countGlowMat.setGain((0.85 + 0.15 * Math.sin(this.time * 2.2)) * flare)
    }
    // Closing panel eases in.
    if (this.mode === "closing" && this.plate) {
      this.showT = Math.min(1, this.showT + dt / 0.35)
      this.plate.setLevel(easeOutCubic(this.showT))
    }
    // Red alert pulses (alpha + glow + coral plate edge); its colour stays red.
    if (this.alertT >= 0) {
      this.alertT += dt
      const p = 0.5 + 0.5 * Math.sin(this.alertT * 2 * Math.PI * 1.2)
      const c = this.alertColor
      this.alertText.textFill.color = new vec4(c.x, c.y, c.z, 0.7 + 0.3 * p)
      const ic = (this.alertIcon.mainMaterial.mainPass as any)
      ic.baseColor = new vec4(c.x, c.y, c.z, 0.7 + 0.3 * p)
      const flash = Math.exp(-this.alertT / 0.35)
      this.alertGlowMat.setGain(0.45 + 0.55 * p + 1.2 * flash)
      if (this.plate) {
        this.plate.setEdge(new vec4(HOLO_CORAL.x, HOLO_CORAL.y, HOLO_CORAL.z, 1))
        this.plate.setEdgeGain(0.7 + 0.5 * p + flash)
      }
      // Coral pulse ring on the alert (one ring per beat).
      const beat = (this.alertT * 1.2) % 1
      const ps = 0.9 + 1.5 * easeOutCubic(beat)
      this.alertPulse.getTransform().setLocalScale(new vec3(ps, ps, 1))
      this.alertPulseMat.setLevel((1 - beat) * (1 - beat))
      // Chevrons march toward the tray.
      for (let i = 0; i < this.chevrons.length; i++) {
        const v = (((this.alertT * 1.5 - i * 0.2) % 1) + 1) % 1
        const b = Math.sin(Math.PI * v)
        const ch = this.chevrons[i]
        ch.so.getTransform().setLocalPosition(new vec3(0.6 + i * 1.5 + 0.45 * v, 0, 0))
        ch.mat.setLevel(Math.min(1, this.alertT / 0.2) * (0.35 + 0.65 * b * b))
      }
      // Expanding coral rings on the tray itself.
      for (let i = 0; i < this.trayRings.length; i++) {
        const v = (((this.alertT * 0.8 - i * 0.5) % 1) + 1) % 1
        const rs = 2.5 + 6 * easeOutCubic(v)
        this.trayRings[i].so.getTransform().setLocalScale(new vec3(rs, 1, rs))
        this.trayRings[i].mat.setLevel((1 - v) * (1 - v))
      }
    }
  }

  // ── construction ───────────────────────────────────────────────────────

  private applyMode(): void {
    this.rehearseRoot.enabled = this.mode === "rehearse"
    // The counter must stay enabled until its first layout pass, then follow the mode.
    this.closingRoot.enabled = this.mode === "closing" || !this.closingLaidOut
  }

  private buildRehearse(): void {
    this.rehearseRoot = this.obj(this.sceneObject, "RehearseControls", this.readyOffsetCm ?? new vec3(2, -8.6, 0))
    const w = Math.max(9.5, this.readyLabel.length * 0.5 + 3)
    this.addLabeledButton(this.rehearseRoot, "ReadyToCloseButton", this.readyLabel, ICON_SKIP, w, this.buttonSizeCm, "ready", () =>
      this._onReadyToClose.invoke(),
    )
  }

  private buildClosing(): void {
    const b = this.buttonSizeCm
    const panelW = Math.max(11, b * 2 + 5)
    const countRowH = this.countHeightCm / 0.7 + 0.4
    this.countRowH = countRowH
    this.closingRoot = this.obj(this.sceneObject, "NeedleCounter")

    // Glass plate FIRST so the Canvas hierarchy DFS paints it behind the content.
    this.plate = new HoloPanel(this.closingRoot, "CounterPlate", panelW, 16, {
      edge: PANEL_CYAN.edge,
      glass: new vec4(0.05, 0.15, 0.2, 1.3),
      glassCoverage: 0.78,
      corner: 1.1,
      border: 0.05,
      glow: 0.35,
      depth: 0.3,
    })
    const content = this.obj(this.closingRoot, "Content", new vec3(0, 0, CONTENT_Z))
    const col = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    col.autoDiscoverItemsOnStart = false // children are registered explicitly via addItems()
    col.onInitialized.add(() => {
      col.width = panelW
      col.height = -1
      col.direction = FlexDirection.Column
      col.alignItems = FlexAlign.Center
      col.justifyContent = FlexJustify.Start
      col.rowGap = 1.0
      col.paddingTop = 1.0
      col.paddingBottom = 1.2
      col.paddingLeft = 1.0
      col.paddingRight = 1.0
    })
    col.onLayoutComplete.add((r) => {
      this.plate.setSize(r.containerWidth, r.containerHeight)
      if (this.trayHint) {
        // Starts above the alert and runs along the plate's top edge toward the tray (stays in view).
        this.trayHint.getTransform().setLocalPosition(new vec3(r.containerWidth / 2 - 2.0, r.containerHeight / 2 + 1.0, CONTENT_Z))
      }
      if (!this.closingLaidOut) {
        this.closingLaidOut = true
        this.applyMode()
      }
    })

    // Row 1: big count (+ caption) with the red alert beside it.
    this.flexChild(content, {w: panelW - 2, h: countRowH}, (rowObj) => {
      const row = this.flexBox(rowObj, "CountRow", FlexDirection.Row, panelW - 2, countRowH, {
        gap: 0.6,
        justify: FlexJustify.Center,
        align: FlexAlign.Center,
      })
      this.flexChild(row, {w: 3.6, h: countRowH}, (countCell) => {
        // Holographic bloom behind the digits.
        this.countGlowMat = new HoloMat(HoloMode.Glow, new vec4(0.1, 0.6, 0.85, 0.75), {coverage: 0, shape: new vec4(3.0, 0, 0, 0)})
        const glow = meshObject(countCell, "CountGlow", unitSprite(), this.countGlowMat, new vec3(0, 0.3, -0.1))
        glow.getTransform().setLocalScale(new vec3(2.6, 2.6, 1))
        const stack = this.flexBox(countCell, "CountStack", FlexDirection.Column, 3.6, countRowH, {
          gap: 0,
          justify: FlexJustify.Center,
          align: FlexAlign.Stretch,
        })
        this.flexChild(stack, {w: 3.6, h: countRowH - 1.0}, (c) => {
          this.countText = this.text(c, `${this.pendingCount}`, "Title1", distanceForCapHeight("Title1", this.countHeightCm), 3.6, new vec4(0.94, 0.99, 1, 1))
          this.countText.dropshadowSettings.enabled = true
          this.countText.dropshadowSettings.fill.color = new vec4(0.2, 0.75, 1, 0.35)
          this.countText.dropshadowSettings.offset = new vec2(0, -0.06)
        })
        this.flexChild(stack, {w: 3.6, h: 0.9}, (c) => {
          this.text(c, this.countCaption, "Caption", 80, 3.6, new vec4(0.7, 0.92, 1, 0.75))
        })
      })
      this.flexChild(row, {w: 5.2, h: countRowH}, (alertCell) => {
        this.alertGlowMat = new HoloMat(HoloMode.Glow, new vec4(HOLO_CORAL.x, HOLO_CORAL.y * 0.6, HOLO_CORAL.z * 0.6, 0.55), {
          coverage: 0.25,
          shape: new vec4(2.4, 0, 0, 1),
        })
        this.alertGlow = meshObject(alertCell, "AlertGlow", unitSprite(), this.alertGlowMat, new vec3(0, 0, -0.1))
        this.alertGlow.getTransform().setLocalScale(new vec3(3.2, 1.4, 1))
        this.alertPulseMat = new HoloMat(HoloMode.Ring, new vec4(HOLO_CORAL.x, HOLO_CORAL.y * 0.75, HOLO_CORAL.z * 0.75, 1), {
          coverage: 0.35,
          shape: new vec4(0.8, 0.05, 0.1, 0.3),
        })
        this.alertPulse = meshObject(alertCell, "AlertPulse", unitSprite(), this.alertPulseMat, new vec3(-2.1, 0, -0.05))
        const alertRow = this.flexBox(alertCell, "MissingAlert", FlexDirection.Row, 5.2, 1.6, {
          gap: 0.3,
          justify: FlexJustify.Start,
          align: FlexAlign.Center,
        })
        this.flexChild(alertRow, {w: 1.0, h: 1.0}, (c) => {
          this.alertIcon = this.image(c, ICON_WARNING, 1.0, this.alertColor)
        })
        this.flexChild(alertRow, {w: 3.9, h: 1.4}, (c) => {
          this.alertText = this.text(c, "2 missing", "Callout", 110, 3.9, this.alertColor, HorizontalAlignment.Left)
        })
      })
    })

    // Row 2: + and − as square buttons.
    this.flexChild(content, {w: b * 2 + 1.2, h: b}, (rowObj) => {
      const row = this.flexBox(rowObj, "StepperRow", FlexDirection.Row, b * 2 + 1.2, b, {
        gap: 1.2,
        justify: FlexJustify.Center,
        align: FlexAlign.Center,
      })
      this.flexChild(row, {w: b, h: b}, (c) => this.addIconButton(c, "NeedlePlusButton", ICON_ADD, b, () => this._onPlus.invoke()))
      this.flexChild(row, {w: b, h: b}, (c) => this.addIconButton(c, "NeedleMinusButton", ICON_REMOVE, b, () => this._onMinus.invoke()))
    })

    // Row 3: Close, set apart by an extra gap so it isn't pinched by accident.
    const closeItem = this.flexChild(content, {w: 8, h: b}, (c) =>
      this.addLabeledButton(c, "CloseButton", "Close", ICON_CHECK, 8, b, "accept", () => this._onClose.invoke()),
    )
    ;(closeItem.getComponent(FlexItem.getTypeName()) as FlexItem).marginTop = this.closeExtraGapCm

    this.buildTrayHint()
    this.hideMissingInitial()
  }

  /** Coral chevrons (pointing along local +X, aimed at the tray on show) + rings on the tray top. */
  private buildTrayHint(): void {
    this.trayHint = this.obj(this.closingRoot, "TrayHint", new vec3(-6, 3, CONTENT_Z))
    const k = new MeshKit()
    const arm = (a: vec3, b: vec3, hw: number) => {
      const d = b.sub(a)
      const nrm = new vec3(-d.y, d.x, 0).normalize().uniformScale(hw)
      k.quad(a.add(b).uniformScale(0.5), d.uniformScale(0.5), nrm, 0, -1, 1, 1)
    }
    arm(new vec3(-0.5, 0.66, 0), new vec3(0.3, 0, 0), 0.13)
    arm(new vec3(-0.5, -0.66, 0), new vec3(0.3, 0, 0), 0.13)
    const mesh = k.build()
    for (let i = 0; i < 5; i++) {
      const mat = new HoloMat(HoloMode.Ribbon, new vec4(0.95, 0.24, 0.24, 1.0), {
        coverage: 0.92,
        shape: new vec4(1.1, 0.9, 0.18, 0),
        depthTest: false, // a UI hint: never hidden by the patient's body behind the plate
      })
      const so = meshObject(this.trayHint, `Chevron${i + 1}`, mesh, mat, new vec3(0.6 + i * 1.5, 0, 0))
      this.chevrons.push({so, mat})
    }
    this.trayMark = this.obj(this.closingRoot, "TrayPulse")
    for (let i = 0; i < 2; i++) {
      const mat = new HoloMat(HoloMode.Ring, new vec4(HOLO_CORAL.x, HOLO_CORAL.y * 0.7, HOLO_CORAL.z * 0.7, 1), {
        coverage: 0.4,
        shape: new vec4(0.9, 0.025, 0.05, 0.3),
        depthTest: false,
      })
      const so = meshObject(this.trayMark, `TrayRing${i + 1}`, unitFlatSprite(), mat)
      this.trayRings.push({so, mat})
    }
  }

  /** Point the chevrons at the tray (projected into the panel plane) and drop the rings on the tray top. */
  private aimTrayHint(): void {
    const field = this.sceneObject.getParent()
    if (!field || !this.trayHint) return
    const trayWorld = field.getTransform().getWorldTransform().multiplyPoint(this.trayTopField ?? new vec3(-55, 12.3, -5))
    const inv = this.closingRoot.getTransform().getInvertedWorldTransform()
    const local = inv.multiplyPoint(trayWorld)
    const start = this.trayHint.getTransform().getLocalPosition()
    let dx = local.x - start.x
    let dy = local.y - start.y
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1e-3) {
      dx = -1
      dy = 0
    }
    this.trayHint.getTransform().setLocalRotation(quat.angleAxis(Math.atan2(dy, dx), vec3.forward()))
    const mt = this.trayMark.getTransform()
    mt.setWorldPosition(trayWorld.add(field.getTransform().up.uniformScale(0.3)))
    mt.setWorldRotation(field.getTransform().getWorldRotation())
  }

  private hideMissingInitial(): void {
    this.alertText.enabled = false
    this.alertIcon.enabled = false
    this.alertGlow.enabled = false
    this.alertPulse.enabled = false
    this.trayHint.enabled = false
    this.trayMark.enabled = false
  }

  // ── helpers (Layout Composition helpers from /specs-build-ui) ──────────────

  private obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    if (position) so.getTransform().setLocalPosition(position)
    return so
  }

  private flexBox(
    parent: SceneObject,
    name: string,
    direction: FlexDirection,
    width: number,
    height: number,
    opts: {gap: number; justify: FlexJustify; align: FlexAlign},
  ): SceneObject {
    const container = this.obj(parent, name, new vec3(0, 0, LAYOUT_Z_LIFT))
    const flex = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.autoDiscoverItemsOnStart = false // children are registered explicitly via addItems()
    flex.onInitialized.add(() => {
      flex.width = width
      flex.height = height
      flex.direction = direction
      if (direction === FlexDirection.Row) flex.columnGap = opts.gap
      else flex.rowGap = opts.gap
      flex.justifyContent = opts.justify
      flex.alignItems = opts.align
    })
    return container
  }

  private flexChild(parent: SceneObject, size: {w?: number; h?: number; grow?: number}, builder: (c: SceneObject) => void): SceneObject {
    const child = this.obj(parent, "Item", new vec3(0, 0, LAYOUT_Z_LIFT))
    const item = child.createComponent(FlexItem.getTypeName()) as FlexItem
    if (size.w !== undefined && size.w > 0) item.overrideWidth = size.w
    if (size.h !== undefined && size.h > 0) item.overrideHeight = size.h
    item.flexGrow = size.grow ?? 0
    item.flexShrink = 0
    builder(child)
    const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (parentFlex) parentFlex.addItems([item])
    return child
  }

  private text(
    parent: SceneObject,
    value: string,
    role: TextRole,
    distanceCm: number,
    widthCm: number,
    color: vec4,
    align: HorizontalAlignment = HorizontalAlignment.Center,
  ): Text {
    const so = this.obj(parent, "Label", new vec3(0, 0, 0.05))
    const t = so.createComponent("Component.Text") as Text
    t.text = value
    t.depthTest = true
    applyTextRole(t, role, distanceCm)
    t.horizontalAlignment = align
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCm / 2, widthCm / 2, -1.2, 1.2)
    t.textFill.color = color
    return t
  }

  private image(parent: SceneObject, tex: Texture, sizeCm: number, color: vec4): Image {
    const so = this.obj(parent, "Icon", new vec3(0, 0, 0.05))
    const img = so.createComponent("Component.Image") as Image
    const mat = imageMaterial.clone()
    mat.mainPass.baseTex = tex
    mat.mainPass.baseColor = color
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
    img.clearMaterials()
    img.addMaterial(mat)
    so.getTransform().setLocalScale(new vec3(sizeCm, sizeCm, 1))
    return img
  }

  /** Restyle a UI Kit button's rounded-rect visual as tinted holographic glass with a luminous edge. */
  private styleButton(btn: Button, look: ButtonLook): void {
    btn.onInitialized.add(() => {
      const vis = btn.visual as any
      if (!vis || !("defaultGradient" in vis)) return
      const p = LOOKS[look]
      try {
        vis.transparencyEnabled = true
        vis.defaultBaseType = "Gradient"
        vis.hoveredBaseType = "Gradient"
        vis.triggeredBaseType = "Gradient"
        vis.defaultGradient = grad(p[0], p[1])
        vis.hoveredGradient = grad(p[2], p[3])
        vis.triggeredGradient = grad(p[3], p[2])
        vis.defaultHasBorder = true
        vis.hoveredHasBorder = true
        vis.triggeredHasBorder = true
        vis.defaultBorderSize = 0.09
        vis.hoveredBorderSize = 0.12
        vis.triggeredBorderSize = 0.14
        vis.defaultBorderType = "Color"
        vis.hoveredBorderType = "Color"
        vis.triggeredBorderType = "Color"
        vis.borderDefaultColor = p[4]
        vis.borderHoveredColor = p[5]
        vis.borderTriggeredColor = p[5]
      } catch (e) {
        print(`[Overlay] button restyle skipped on ${btn.sceneObject.name}: ${e}`)
      }
    })
  }

  /** Button whose whole face is one ElementContent (icon + label) — the sanctioned single-child case. */
  private addLabeledButton(
    parent: SceneObject,
    name: string,
    label: string,
    icon: Texture,
    widthCm: number,
    heightCm: number,
    look: ButtonLook,
    onClick: () => void,
  ): Button {
    const so = this.obj(parent, name)
    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(widthCm, heightCm, 1)
    const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
    ec.text = label
    ec.leadingIcon = icon
    ec.textSize = roleSize("Subheadline")
    ec.spacing = 0.5
    btn.onInitialized.add(() => {
      btn.size = new vec3(widthCm, heightCm, 1)
    })
    this.styleButton(btn, look)
    btn.onTriggerUp.add(onClick)
    return btn
  }

  /** Icon-only square button (+ / −). */
  private addIconButton(parent: SceneObject, name: string, icon: Texture, sizeCm: number, onClick: () => void): Button {
    const so = this.obj(parent, name)
    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(sizeCm, sizeCm, 1)
    const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
    ec.leadingIcon = icon
    ec.iconLayout = "left"
    btn.onInitialized.add(() => {
      btn.size = new vec3(sizeCm, sizeCm, 1)
    })
    this.styleButton(btn, "neutral")
    btn.onTriggerUp.add(onClick)
    return btn
  }
}
