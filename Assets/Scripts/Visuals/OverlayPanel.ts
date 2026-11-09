/**
 * OverlayPanel — a slim holographic glass panel (plain class) used behind labels and controls.
 *
 * Owns two layers so the panel has real depth:
 *  - Glass (back, z = -depth): dark tinted glass fill with a top sheen and a soft outer glow.
 *  - Frame (front, z = 0): a crisp luminous edge line with a faint halo, slightly inset.
 * Both are procedural (OverlayHolo panel mode: rounded-rect SDF), so any size stays crisp.
 * Must not: lay out content or own text — the UI modules put their content in front of it.
 */
import {HoloMat, HoloMode, MeshKit, holder, meshObject} from "./OverlayKit"

export interface PanelStyle {
  /** Edge colour (rgb, w = intensity). */
  edge: vec4
  /** Glass tint (rgb, w = brightness of the fill light). */
  glass: vec4
  /** How much the glass covers what is behind it (contrast for light text), 0..1. */
  glassCoverage: number
  corner: number
  border: number
  /** Outer glow width, cm. */
  glow: number
  /** Gap between the glass and the frame, cm. */
  depth: number
}

export const PANEL_CYAN: PanelStyle = {
  edge: new vec4(0.35, 0.88, 1.0, 1.0),
  glass: new vec4(0.05, 0.16, 0.22, 1.0),
  glassCoverage: 0.72,
  corner: 0.45,
  border: 0.035,
  glow: 0.22,
  depth: 0.18,
}

const GLOW_MARGIN = 0.9

export class HoloPanel {
  readonly root: SceneObject
  private glass: SceneObject
  private frame: SceneObject
  private glassMat: HoloMat
  private frameMat: HoloMat
  private style: PanelStyle
  private w = 0
  private h = 0
  private level = 1

  constructor(parent: SceneObject, name: string, w: number, h: number, style: PanelStyle = PANEL_CYAN, localPos: vec3 = vec3.zero()) {
    this.style = style
    this.root = holder(parent, name, localPos)
    const g = style.glass
    this.glassMat = new HoloMat(HoloMode.Panel, new vec4(g.x, g.y, g.z, 1), {
      coverage: style.glassCoverage,
      shape: new vec4(g.w, style.glow * 1.4, 1, 0.9),
    })
    const e = style.edge
    this.frameMat = new HoloMat(HoloMode.Panel, e, {
      coverage: 0.9,
      shape: new vec4(0, style.glow, 0, 0),
    })
    this.glass = holder(this.root, name + "Glass", new vec3(0, 0, -style.depth))
    this.frame = holder(this.root, name + "Frame", new vec3(0, 0, 0))
    this.setSize(w, h)
  }

  get width(): number {
    return this.w
  }

  get height(): number {
    return this.h
  }

  setSize(w: number, h: number): void {
    if (Math.abs(w - this.w) < 0.02 && Math.abs(h - this.h) < 0.02) return
    this.w = w
    this.h = h
    const s = this.style
    this.rebuild(this.glass, this.glassMat, w / 2, h / 2, s.corner, 0.001)
    // Frame sits a hair inside the glass so the two edges separate with parallax.
    this.rebuild(this.frame, this.frameMat, w / 2 - 0.06, h / 2 - 0.06, Math.max(0.05, s.corner - 0.06), s.border)
  }

  setLevel(k: number): void {
    this.level = Math.max(0, Math.min(1, k))
    this.glassMat.setLevel(this.level)
    this.frameMat.setLevel(this.level)
    this.root.enabled = this.level > 0.001
  }

  getLevel(): number {
    return this.level
  }

  /** Edge colour (rgb, w = intensity) — e.g. green for Closed, coral for an alert. */
  setEdge(c: vec4): void {
    this.frameMat.setColor(c)
  }

  /** Multiplies the edge brightness (pulses). */
  setEdgeGain(g: number): void {
    this.frameMat.setGain(g)
  }

  private rebuild(so: SceneObject, mat: HoloMat, hx: number, hy: number, corner: number, border: number): void {
    for (let i = so.getChildrenCount() - 1; i >= 0; i--) so.getChild(i).destroy()
    const k = new MeshKit()
    const mx = hx + GLOW_MARGIN
    const my = hy + GLOW_MARGIN
    k.quad(vec3.zero(), new vec3(mx, 0, 0), new vec3(0, my, 0), -mx, -my, mx, my)
    mat.setPanel(new vec4(hx, hy, Math.min(corner, Math.min(hx, hy)), border))
    meshObject(so, "Mesh", k.build(), mat)
  }
}
