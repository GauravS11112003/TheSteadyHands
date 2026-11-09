/**
 * SteadyHandsCrossSectionUI — every label on the floating 3x cross-section.
 *
 * Owns: the "<viewScale>×" badge (the ONE Text under CrossSection with that text), the message
 * line (watch / your turn / green or red result), the Entry / Exit / 90° tags, and the layer
 * callout names (Epidermis, Dermis, Subcutaneous fat, Fascia, Muscle) placed beside the leader
 * lines the controller draws. Positions come from the controller (section-local cm).
 *
 * API (called by SteadyHandsCrossSectionController / SteadyHandsMain):
 *   build(layout)          — create the labels once (OnStart)
 *   setMessage(text)       — neutral message
 *   setResult(pass, text)  — green (pass) or coral (fail) message
 *   setReveal(k)           — 0..1 staggered fade used by the scan-in / fold-away
 *   setReadout(text, c, k) — compact score readout ("0.8 mm · 88°") near the exit; k = 0 hides it
 * Must not: hold flow state or decide results. Passive view.
 */

// ── Typography: the single source of truth for text size + weight ────────────
// `Component.Text.size` is the glyph EM-SQUARE height (em cm = size / 43.886), calibrated
// for the SnapOS system font at 110 cm. This section floats ~71 cm from the eye, so roles
// are applied at that distance to keep the same visual size.
const FONT_SIZE_SCALE = 1.0
type TextRole = "Title1" | "Title2" | "HeadlineXL" | "Headline1" | "Headline2" | "Subheadline" | "Button" | "Callout" | "Body" | "Caption"
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
function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110, weight?: number): void {
  t.size = roleSize(role, distanceCm)
  ;(t as Text & {weight?: number}).weight = weight ?? TYPE_SCALE[role].weight
}

export type LabelAlign = "left" | "center" | "right"

export interface LabelSpot {
  pos: vec3
  align: LabelAlign
}

export interface CalloutSpec {
  name: string
  detail: string
  pos: vec3
  color: vec4
}

export interface CrossSectionLabelLayout {
  viewScale: number
  badge: LabelSpot
  message: LabelSpot
  messageWidth: number
  entry: LabelSpot
  exit: LabelSpot
  angle: LabelSpot
  readout: LabelSpot
  callouts: CalloutSpec[]
}

interface Revealed {
  text: Text
  base: vec4
  order: number
}

@component
export class SteadyHandsCrossSectionUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SteadyHandsCrossSectionUI – labels on the 3x cross-section</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("Viewing distance used to size the labels, cm (section is ~71 cm from the eye)")
  @widget(new SliderWidget(40, 120, 1))
  viewingDistanceCm: number = 71
  @input
  @hint("Message shown while the ghost attending demonstrates")
  watchText: string = "Watch the attending's stitch"
  @input("vec4", "{0.92,0.98,1,1}")
  @hint("Neutral message colour")
  @widget(new ColorWidget())
  messageColor: vec4
  @input("vec4", "{0.36,1,0.54,1}")
  @hint("Pass (green) message colour")
  @widget(new ColorWidget())
  passColor: vec4
  @input("vec4", "{1,0.42,0.42,1}")
  @hint("Fail (coral) message colour")
  @widget(new ColorWidget())
  failColor: vec4
  @input("vec4", "{0.5,0.91,1,1}")
  @hint("Holographic accent colour (badge, Entry / Exit tags)")
  @widget(new ColorWidget())
  accentColor: vec4
  @ui.group_end

  private messageText: Text | null = null
  private readoutText: Text | null = null
  private readoutBase: vec4 = new vec4(1, 1, 1, 1)
  private readoutK = 0
  private built = false
  private revealed: Revealed[] = []
  private revealK = 1
  private maxOrder = 1

  /** Current message string (readable by tests). */
  get message(): string {
    return this.messageText ? this.messageText.text : ""
  }

  build(o: CrossSectionLabelLayout): void {
    if (this.built) return
    this.built = true
    const root = this.sceneObject
    const dist = this.viewingDistanceCm
    const accent = this.accentColor || new vec4(0.5, 0.91, 1, 1)

    // Badge + message (header row above the block).
    this.text(root, "Badge", `${o.viewScale}×`, "Headline1", dist, o.badge, accent, 0, 3.2)
    this.messageText = this.text(root, "Message", this.watchText, "Body", dist, o.message, this.messageColor, 1, o.messageWidth)

    // Stitch point tags.
    this.text(root, "EntryTag", "Entry", "Caption", dist, o.entry, accent, 2, 2.2, 700)
    this.text(root, "ExitTag", "Exit", "Caption", dist, o.exit, accent, 2, 2.2, 700)
    this.text(root, "AngleTag", "90°", "Caption", dist, o.angle, new vec4(0.75, 0.96, 1, 0.95), 3, 1.6, 600)

    // Score readout (not part of the staggered reveal; shown only after scoring).
    this.readoutText = this.text(root, "ScoreReadout", "", "Callout", dist, o.readout, new vec4(1, 1, 1, 1), 0, 5, 700)
    this.revealed.pop()
    this.readoutText.enabled = false

    // Layer callouts (name + optional detail line).
    let k = 0
    for (const c of o.callouts) {
      const spot: LabelSpot = {pos: c.pos, align: "left"}
      this.text(root, "Callout_" + c.name.replace(/ /g, ""), c.name, "Caption", dist, spot, c.color, 3 + k * 0.6, 5, 700)
      if (c.detail.length > 0) {
        const dspot: LabelSpot = {pos: new vec3(c.pos.x, c.pos.y - 0.42, c.pos.z), align: "left"}
        const dc = new vec4(0.82, 0.95, 1, 0.82)
        const t = this.text(root, "CalloutDetail", c.detail, "Caption", dist, dspot, dc, 3.3 + k * 0.6, 5, 500)
        t.size = t.size * 0.78
      }
      k++
    }
    this.setReveal(this.revealK)
  }

  setMessage(text: string): void {
    if (!this.messageText) return
    this.messageText.text = text
    this.setColor(this.messageText, this.messageColor)
  }

  setResult(pass: boolean, text: string): void {
    if (!this.messageText) return
    this.messageText.text = text
    this.setColor(this.messageText, pass ? this.passColor : this.failColor)
  }

  /** Compact score readout near the exit. k (0..1) fades it; 0 hides it. */
  setReadout(text: string, color: vec4, k: number): void {
    const t = this.readoutText
    if (!t) return
    this.readoutBase = color
    this.readoutK = Math.max(0, Math.min(1, k))
    if (text.length > 0) t.text = text
    t.enabled = this.readoutK > 0.001
    this.applyReadout()
  }

  private applyReadout(): void {
    const t = this.readoutText
    if (!t) return
    const c = this.readoutBase
    t.textFill.color = new vec4(c.x, c.y, c.z, c.w * this.readoutK * this.revealK)
  }

  /** Staggered fade of every label (0 = hidden, 1 = shown). Text stays enabled throughout. */
  setReveal(k: number): void {
    this.revealK = Math.max(0, Math.min(1, k))
    const span = 0.45
    for (const r of this.revealed) {
      const start = (r.order / this.maxOrder) * (1 - span)
      const u = Math.max(0, Math.min(1, (this.revealK - start) / span))
      const a = u * u * (3 - 2 * u)
      r.text.textFill.color = new vec4(r.base.x, r.base.y, r.base.z, r.base.w * a)
    }
    this.applyReadout()
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private setColor(t: Text, c: vec4): void {
    for (const r of this.revealed) {
      if (r.text === t) r.base = c
    }
    this.setReveal(this.revealK)
  }

  private text(
    parent: SceneObject,
    name: string,
    value: string,
    role: TextRole,
    distanceCm: number,
    spot: LabelSpot,
    color: vec4,
    order: number,
    widthCm: number,
    weight?: number,
  ): Text {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    so.getTransform().setLocalPosition(spot.pos)
    const t = so.createComponent("Component.Text") as Text
    t.text = value
    t.depthTest = true
    applyTextRole(t, role, distanceCm, weight)
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    if (spot.align === "left") {
      t.horizontalAlignment = HorizontalAlignment.Left
      t.layoutRect = Rect.create(0, widthCm, -0.6, 0.6)
    } else if (spot.align === "right") {
      t.horizontalAlignment = HorizontalAlignment.Right
      t.layoutRect = Rect.create(-widthCm, 0, -0.6, 0.6)
    } else {
      t.horizontalAlignment = HorizontalAlignment.Center
      t.layoutRect = Rect.create(-widthCm / 2, widthCm / 2, -0.6, 0.6)
    }
    t.textFill.color = color
    // A thin dark-teal outline keeps light text legible over the bright tissue in the preview
    // (on the additive display it simply disappears).
    try {
      t.outlineSettings.enabled = true
      t.outlineSettings.size = 0.06
      t.outlineSettings.fill.color = new vec4(0.02, 0.12, 0.16, 0.85)
    } catch (e) {
      // Outline is cosmetic only.
    }
    this.revealed.push({text: t, base: color, order: order})
    this.maxOrder = Math.max(this.maxOrder, order + 0.6)
    return t
  }
}
