/**
 * SteadyHandsPadLabelsUI — the text that lives on and around the suture pad.
 *
 * Owns three labels, each built under its own authored anchor so a human can move it:
 *  - Prompt    ("Pinch both ends of the incision.")  — just above the pad's far edge.
 *  - Count     ("6.0 cm → 11 sutures")               — ~2 cm in front of the cut, near side, ~1 cm tall.
 *  - Closed    ("Closed", glowing green + check)     — just above the cut.
 * Every label is crisp light text on a slim two-layer holographic glass panel (Visuals/OverlayPanel)
 * that faces the user (its anchor's authored tilt), placed by a FlexLayout, and eases in/out.
 * "Closed" also rolls a soft green ring wave across the field and fires a particle burst
 * (Assets/VFX/OverlayClosedBurst.graphVfx) along the incision. Its glow-in waits
 * `closedDelaySec` so the bite marks can turn green first (the text is enabled immediately).
 *
 * API: showPrompt(text) / hidePrompt(), showCount(text) / fadeOutCount(sec) / hideCount(),
 *      showClosed() / hideClosed(); readable promptShown, countShown, closedShown, countText.
 * Must not: compute counts or decide when labels show — SteadyHandsMain does that.
 */
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexAlign, FlexDirection, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import animate, {CancelFunction} from "SpectaclesInteractionKit.lspkg/Utils/animate"
import {HOLO_GREEN, HoloMat, HoloMode, easeOutBack, easeOutCubic, holder, meshObject, unitFlatSprite, unitSprite} from "./Visuals/OverlayKit"
import {HoloPanel, PANEL_CYAN, PanelStyle} from "./Visuals/OverlayPanel"

const ICON_CHECK: Texture = requireAsset("../Icons/check_circle.png") as Texture
const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material
let BURST_ASSET: VFXAsset | null = null
try {
  BURST_ASSET = requireAsset("../VFX/OverlayClosedBurst.graphVfx") as VFXAsset
} catch (e) {
  BURST_ASSET = null
}

// ── Typography: the single source of truth for text size + weight ────────────
// `Component.Text.size` is the glyph EM-SQUARE height (em cm = size / 43.886), calibrated for
// the SnapOS system font at 110 cm. Roles are applied at 110 cm here on purpose: the pad is
// ~80 cm away and the brief asks for ~1 cm tall text, which HeadlineXL at 110 gives.
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

const LAYOUT_Z_LIFT = 0.02
const TEXT_Z = 0.06
const PAD_X = 0.75
const PAD_Y = 0.3

const PANEL_GREEN: PanelStyle = {
  edge: new vec4(0.36, 1.0, 0.54, 1.1),
  glass: new vec4(0.03, 0.18, 0.08, 1.0),
  glassCoverage: 0.7,
  corner: 0.6,
  border: 0.04,
  glow: 0.3,
  depth: 0.2,
}

/** One label: container (flex) → panel + item → text, with its own ease-in/out state. */
interface Label {
  container: SceneObject
  panel: HoloPanel
  text: Text
  color: vec4
  basePos: vec3
  shown: boolean
  /** 0 → 1 while showing, 1 → 0 while hiding. */
  k: number
  dir: number
  speed: number
  extraW: number
}

@component
export class SteadyHandsPadLabelsUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SteadyHandsPadLabelsUI – prompt, suture count, Closed</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("Anchor just above the pad's far edge, tilted to face the user")
  promptAnchor: SceneObject
  @input
  @hint("Anchor ~2 cm in front of the cut on the near side, tilted to face the user")
  countAnchor: SceneObject
  @input
  @hint("Anchor just above the cut, tilted to face the user")
  closedAnchor: SceneObject
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("Prompt shown when Rehearse ends")
  promptText: string = "Pinch both ends of the incision."
  @input
  @hint("Word shown when the wound is closed")
  closedText: string = "Closed"
  @input("vec4", "{0.85,0.98,1,1}")
  @hint("Suture-count label colour (light, reads on the additive display)")
  @widget(new ColorWidget())
  countColor: vec4
  @input("vec4", "{0.36,1,0.54,1}")
  @hint("'Closed' glow colour (green #5CFF8A)")
  @widget(new ColorWidget())
  closedColor: vec4
  @input
  @hint("Height of the skin (incision plane) in this object's local frame, cm")
  skinY: number = 1.0
  @input
  @hint("Seconds the 'Closed' glow-in waits so the bite marks can turn green first")
  @widget(new SliderWidget(0, 1.2, 0.05))
  closedDelaySec: number = 0.65
  @ui.group_end

  promptShown = false
  countShown = false
  closedShown = false

  private prompt: Label
  private count: Label
  private closed: Label
  private countFade: CancelFunction | null = null
  private glowT = 0
  private time = 0

  // Closed extras
  private closedIcon: SceneObject
  private closedGlow: SceneObject
  private closedGlowMat: HoloMat
  private waves: SceneObject[] = []
  private waveMats: HoloMat[] = []
  private burst: SceneObject | null = null
  private burstVfx: VFXComponent | null = null
  private closedT = -1
  private closedActive = false
  private burstFired = false

  /** Text currently in the count label. */
  get countText(): string {
    return this.count ? this.count.text.text : ""
  }

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    this.prompt = this.buildLabel(this.promptAnchor, "Prompt", this.promptText, "Headline2", 19, new vec4(0.93, 0.98, 1, 1), PANEL_CYAN)
    this.count = this.buildLabel(this.countAnchor, "SutureCount", "6.0 cm → 11 sutures", "HeadlineXL", 16, this.countColor, PANEL_CYAN)
    this.closed = this.buildClosed()
    this.buildClosedFx()
    this.setVisible(this.prompt, false)
    this.setVisible(this.count, false)
    this.setVisible(this.closed, false)
    this.createEvent("UpdateEvent").bind(() => this.update(getDeltaTime()))
  }

  showPrompt(text?: string): void {
    this.prompt.text.text = text ?? this.promptText
    this.setVisible(this.prompt, true)
    this.promptShown = true
  }

  hidePrompt(): void {
    this.setVisible(this.prompt, false)
    this.promptShown = false
  }

  showCount(text: string): void {
    if (this.countFade) this.countFade()
    this.countFade = null
    this.count.text.text = text
    this.count.color = this.countColor
    this.setVisible(this.count, true)
    this.countShown = true
  }

  fadeOutCount(seconds: number): void {
    if (!this.countShown) return
    if (this.countFade) this.countFade()
    const c = this.countColor
    const lb = this.count
    this.countFade = animate({
      duration: Math.max(0.01, seconds),
      easing: "ease-in-quad",
      update: (t) => {
        lb.color = new vec4(c.x, c.y, c.z, c.w * (1 - t))
        lb.panel.setLevel(1 - t)
        lb.k = 1 - t
        lb.dir = 0
      },
      ended: () => {
        this.countFade = null
        this.hideCount()
      },
    })
  }

  hideCount(): void {
    this.setVisible(this.count, false)
    this.countShown = false
  }

  showClosed(): void {
    const delay = Math.max(0, this.closedDelaySec)
    this.glowT = -delay
    this.closedT = -delay
    this.closedActive = true
    this.burstFired = false
    this.setVisible(this.closed, true)
    this.closedShown = true
    for (const w of this.waves) w.enabled = true
  }

  hideClosed(): void {
    this.setVisible(this.closed, false)
    this.closedShown = false
    this.closedT = -1
    this.closedActive = false
    for (const w of this.waves) w.enabled = false
    this.closedGlow.enabled = false
    if (this.burst) this.burst.enabled = false
  }

  // ── per-frame ────────────────────────────────────────────────────────────

  private update(dt: number): void {
    this.time += dt
    for (const lb of [this.prompt, this.count, this.closed]) this.animateLabel(lb, dt)
    this.pulseClosed(dt)
    this.updateClosedFx(dt)
  }

  /** Ease in (fade + rise + panel), and keep the panel fitted to the text. */
  private animateLabel(lb: Label, dt: number): void {
    if (!lb.shown) return
    if (lb === this.closed && this.glowT < 0) lb.k = 0
    else if (lb.dir !== 0) {
      lb.k = Math.max(0, Math.min(1, lb.k + lb.dir * dt * lb.speed))
    }
    const e = easeOutCubic(lb.k)
    lb.container.getTransform().setLocalPosition(lb.basePos.add(new vec3(0, -0.35 * (1 - e), 0)))
    if (lb !== this.closed) {
      const c = lb.color
      lb.text.textFill.color = new vec4(c.x, c.y, c.z, c.w * e)
    }
    if (lb.dir !== 0 || lb !== this.count || !this.countFade) lb.panel.setLevel(e)
    // Fit the glass to the text: bounding box (text-local cm) → container-local cm.
    const bb = lb.text.getBoundingBox()
    if (bb && bb.right - bb.left > 0.1 && bb.top - bb.bottom > 0.1) {
      const tw = lb.text.getTransform().getWorldTransform()
      const inv = lb.container.getTransform().getInvertedWorldTransform()
      const a = inv.multiplyPoint(tw.multiplyPoint(new vec3(bb.left, bb.bottom, 0)))
      const b = inv.multiplyPoint(tw.multiplyPoint(new vec3(bb.right, bb.top, 0)))
      const left = Math.min(a.x, b.x) - lb.extraW
      const right = Math.max(a.x, b.x)
      const bottom = Math.min(a.y, b.y)
      const top = Math.max(a.y, b.y)
      lb.panel.setSize(right - left + PAD_X * 2, top - bottom + PAD_Y * 2)
      const cx = (left + right) / 2
      const cy = (top + bottom) / 2
      const pt = lb.panel.root.getTransform()
      const p = pt.getLocalPosition()
      if (Math.abs(p.x - cx) > 0.01 || Math.abs(p.y - cy) > 0.01) pt.setLocalPosition(new vec3(cx, cy, p.z))
    }
  }

  private pulseClosed(dt: number): void {
    if (!this.closedShown) return
    this.glowT += dt
    const g = Math.max(0, this.glowT)
    const fadeIn = Math.min(1, g / 0.6)
    const k = fadeIn * (0.8 + 0.2 * Math.sin(g * 3))
    const c = this.closedColor
    const t = this.closed.text
    t.textFill.color = new vec4(c.x, c.y, c.z, c.w * k)
    t.outlineSettings.fill.color = new vec4(c.x * 0.5, c.y * 0.5, c.z * 0.5, 0.6 * k)
    this.closed.panel.setEdgeGain(0.85 + 0.3 * Math.sin(g * 3))
    this.closedGlowMat.setLevel(fadeIn)
    this.closedGlowMat.setGain(0.8 + 0.2 * Math.sin(g * 3))
    const pop = this.glowT < 0 ? 0 : easeOutBack(g / 0.45, 2.2)
    this.closedIcon.getTransform().setLocalScale(new vec3(Math.max(0.001, 1.5 * pop), Math.max(0.001, 1.5 * pop), 1))
  }

  // ── construction ─────────────────────────────────────────────────────────

  private setVisible(lb: Label, on: boolean): void {
    // Containers stay enabled (their FlexLayouts must initialise); only the visuals toggle.
    lb.text.enabled = on
    lb.shown = on
    if (lb === this.closed) {
      this.closedIcon.enabled = on
      if (!on) this.closedGlow.enabled = false
    }
    if (on) {
      lb.k = 0
      lb.dir = 1
      this.animateLabel(lb, 0)
    } else {
      lb.k = 0
      lb.dir = 0
      lb.panel.setLevel(0)
      lb.container.getTransform().setLocalPosition(lb.basePos)
    }
  }

  private newText(parent: SceneObject, name: string, value: string, role: TextRole, widthCm: number, h: number, color: vec4): Text {
    const so = global.scene.createSceneObject(name + "Text")
    so.setParent(parent)
    so.getTransform().setLocalPosition(new vec3(0, 0, TEXT_Z))
    const t = so.createComponent("Component.Text") as Text
    t.text = value
    t.depthTest = true
    applyTextRole(t, role)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCm / 2, widthCm / 2, -h / 2, h / 2)
    t.textFill.color = color
    return t
  }

  /** One centred label on a glass panel, placed by a single-item FlexLayout under the given anchor. */
  private buildLabel(anchor: SceneObject, name: string, value: string, role: TextRole, widthCm: number, color: vec4, style: PanelStyle): Label {
    const host = anchor ?? this.sceneObject
    const container = global.scene.createSceneObject(name)
    container.setParent(host)
    const basePos = new vec3(0, 0, LAYOUT_Z_LIFT)
    container.getTransform().setLocalPosition(basePos)
    const h = roleSize(role) / 43.886 + 0.6
    // Panel FIRST so the Canvas hierarchy pass paints it behind the text.
    const panel = new HoloPanel(container, name + "Panel", widthCm * 0.6, h, style)
    const flex = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.autoDiscoverItemsOnStart = false // the one item is registered explicitly via addItems()
    flex.onInitialized.add(() => {
      flex.width = widthCm
      flex.height = h
      flex.direction = FlexDirection.Column
      flex.justifyContent = FlexJustify.Center
      flex.alignItems = FlexAlign.Center
    })
    const item = global.scene.createSceneObject(name + "Item")
    item.setParent(container)
    item.getTransform().setLocalPosition(new vec3(0, 0, LAYOUT_Z_LIFT))
    const fi = item.createComponent(FlexItem.getTypeName()) as FlexItem
    fi.overrideWidth = widthCm
    fi.overrideHeight = h
    const t = this.newText(item, name, value, role, widthCm, h, color)
    flex.addItems([fi])
    return {container, panel, text: t, color, basePos, shown: false, k: 0, dir: 0, speed: 3.2, extraW: 0}
  }

  /** "Closed": green check + word on a green-edged panel, with a soft green glow behind. */
  private buildClosed(): Label {
    const host = this.closedAnchor ?? this.sceneObject
    const container = global.scene.createSceneObject("ClosedLabel")
    container.setParent(host)
    const basePos = new vec3(0, 0, LAYOUT_Z_LIFT)
    container.getTransform().setLocalPosition(basePos)
    const role: TextRole = "Title2"
    const h = roleSize(role) / 43.886 + 0.6
    const textW = 5.2
    const iconW = 1.9
    const gap = 0.9
    const rowW = iconW + gap + textW
    // Glow sprite and panel FIRST (painted behind).
    this.closedGlowMat = new HoloMat(HoloMode.Glow, new vec4(0.12, 0.7, 0.3, 0.7), {coverage: 0.25, shape: new vec4(2.6, 0, 0, 1)})
    this.closedGlow = meshObject(container, "ClosedGlow", unitSprite(), this.closedGlowMat, new vec3(0, 0, -0.5))
    this.closedGlow.getTransform().setLocalScale(new vec3(6.5, 3.0, 1))
    this.closedGlow.enabled = false
    this.closedGlowMat.setLevel(0)
    const panel = new HoloPanel(container, "ClosedPanel", rowW, h, PANEL_GREEN)
    const flex = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.autoDiscoverItemsOnStart = false
    flex.onInitialized.add(() => {
      flex.width = rowW
      flex.height = h
      flex.direction = FlexDirection.Row
      flex.columnGap = gap
      flex.justifyContent = FlexJustify.Center
      flex.alignItems = FlexAlign.Center
    })
    const iconItem = global.scene.createSceneObject("ClosedIconItem")
    iconItem.setParent(container)
    iconItem.getTransform().setLocalPosition(new vec3(0, 0, LAYOUT_Z_LIFT))
    const ifi = iconItem.createComponent(FlexItem.getTypeName()) as FlexItem
    ifi.overrideWidth = iconW
    ifi.overrideHeight = h
    this.closedIcon = global.scene.createSceneObject("ClosedCheck")
    this.closedIcon.setParent(iconItem)
    this.closedIcon.getTransform().setLocalPosition(new vec3(0, 0, TEXT_Z))
    const img = this.closedIcon.createComponent("Component.Image") as Image
    const mat = imageMaterial.clone()
    mat.mainPass.baseTex = ICON_CHECK
    mat.mainPass.baseColor = new vec4(0.45, 1, 0.6, 1)
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
    img.clearMaterials()
    img.addMaterial(mat)
    this.closedIcon.getTransform().setLocalScale(new vec3(1.5, 1.5, 1))
    const textItem = global.scene.createSceneObject("ClosedLabelItem")
    textItem.setParent(container)
    textItem.getTransform().setLocalPosition(new vec3(0, 0, LAYOUT_Z_LIFT))
    const tfi = textItem.createComponent(FlexItem.getTypeName()) as FlexItem
    tfi.overrideWidth = textW
    tfi.overrideHeight = h
    const t = this.newText(textItem, "ClosedLabel", this.closedText, role, textW, h, this.closedColor)
    t.outlineSettings.enabled = true
    t.outlineSettings.size = 0.12
    t.outlineSettings.fill.color = new vec4(this.closedColor.x * 0.5, this.closedColor.y * 0.5, this.closedColor.z * 0.5, 0.6)
    flex.addItems([ifi, tfi])
    return {container, panel, text: t, color: this.closedColor, basePos, shown: false, k: 0, dir: 0, speed: 2.4, extraW: iconW + gap}
  }

  /** Ring waves on the skin plane + particle burst along the incision (both start disabled). */
  private buildClosedFx(): void {
    // Lives beside PadLabels (outside its UI Canvas) in the same field frame; runtime-only.
    const parent = this.sceneObject.getParent() ?? this.sceneObject
    const fx = holder(parent, "ClosedFx", this.sceneObject.getTransform().getLocalPosition().add(new vec3(0, this.skinY + 0.06, 0)))
    for (let i = 0; i < 2; i++) {
      // Drawn over the drape (no depth test) so the wave rolls across the whole field.
      const m = new HoloMat(HoloMode.Ring, new vec4(HOLO_GREEN.x * 0.55, HOLO_GREEN.y * 0.9, HOLO_GREEN.z * 0.65, 1), {
        coverage: 0.3,
        shape: new vec4(0.92, 0.018, 0.05, 0.3),
        depthTest: false,
      })
      const w = meshObject(fx, `ClosedWave${i + 1}`, unitFlatSprite(), m)
      w.enabled = false
      this.waves.push(w)
      this.waveMats.push(m)
    }
    if (BURST_ASSET) {
      try {
        this.burst = holder(fx, "ClosedBurst", new vec3(0, -0.04, 0))
        this.burstVfx = this.burst.createComponent("Component.VFXComponent") as VFXComponent
        this.burstVfx.asset = BURST_ASSET
        this.burst.enabled = false
      } catch (e) {
        print(`[Overlay] Closed burst VFX unavailable: ${e}`)
        this.burst = null
        this.burstVfx = null
      }
    }
  }

  private fireBurst(): void {
    if (!this.burst || !this.burstVfx) return
    this.burst.enabled = true
    try {
      this.burstVfx.emitting = true
      this.burstVfx.restart()
    } catch (e) {
      // first enable already starts the simulation
    }
  }

  private updateClosedFx(dt: number): void {
    if (!this.closedActive) return
    this.closedT += dt
    const t = this.closedT
    if (t < 0) {
      for (const m of this.waveMats) m.setLevel(0)
      return
    }
    if (!this.burstFired) {
      this.burstFired = true
      this.fireBurst()
    }
    this.closedGlow.enabled = this.closedShown
    for (let i = 0; i < this.waves.length; i++) {
      const tau = t - i * 0.35
      const k = Math.max(0, Math.min(1, tau / 2.2))
      const s = 1.0 + 17 * easeOutCubic(k)
      this.waves[i].getTransform().setLocalScale(new vec3(s, 1, s))
      this.waveMats[i].setLevel(tau < 0 ? 0 : Math.min(1, tau / 0.12) * (1 - k) * (1 - k) * (1 - 0.35 * i))
      this.waves[i].enabled = tau < 2.25
    }
    // One short puff of sparks: emit for 0.18 s, let them fly, then switch the system off.
    if (this.burstVfx && t > 0.18 && this.burstVfx.emitting) this.burstVfx.emitting = false
    if (this.burst && t > 2.4) this.burst.enabled = false
  }
}
