/**
 * SteadyHandsLeafHelpers — shared helpers for The Steady Hands LEAF scenarios.
 *
 * Owns: finding the SteadyHandsMain controller, frame-polling waits, tagged evidence logging
 * (every assertion prints "[SH-LEAF][<scenario>][<tag>] <label> actual=… expected=… OK|FAIL"
 * before it asserts, so the log carries the real values even when a step fails), and the
 * geometry helpers tests need (cross-section view cm → world, pad-local → world, stitch paths).
 *
 * Read-only with respect to the Lens: it never writes Lens state.
 */
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, nextFrame, sleep} from "Leaf.lspkg/Utils/common/Utils"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {SteadyHandsMain} from "../../Scripts/SteadyHandsMain"

export type Tag = "real-input" | "method-call" | "no-input"

export interface V2 {
  x: number
  y: number
}

export function getMain(): SteadyHandsMain {
  const so = findSceneObjectByName("SteadyHands")
  if (!so) throw new Error('SceneObject "SteadyHands" not found')
  const main = so.getComponent(SteadyHandsMain.getTypeName()) as SteadyHandsMain
  if (!main) throw new Error('SteadyHandsMain component not found on "SteadyHands"')
  return main
}

export function mustFind(name: string): SceneObject {
  const so = findSceneObjectByName(name)
  if (!so) throw new Error(`SceneObject "${name}" not found`)
  return so
}

export function textComp(name: string): Text {
  const t = mustFind(name).getComponent("Component.Text") as Text
  if (!t) throw new Error(`No Text component on "${name}"`)
  return t
}

/** A Text is "showing" when the component is enabled and its SceneObject is enabled in the hierarchy. */
export function textShowing(t: Text): boolean {
  return !isNull(t) && t.enabled && t.getSceneObject().isEnabledInHierarchy
}

export function fmtV(v: vec3 | vec4 | null | undefined, d: number = 3): string {
  if (!v) return "null"
  const anyV = v as any
  const parts = [anyV.x, anyV.y, anyV.z]
  if (anyV.w !== undefined) parts.push(anyV.w)
  return "(" + parts.map((n: number) => n.toFixed(d)).join(", ") + ")"
}

/** World position of the device camera (the user's eye; the preview camera in Interactive Preview). */
export function eyeWorld(): vec3 {
  return WorldCameraFinderProvider.getInstance().getWorldPosition()
}

export function summary(): string {
  try {
    return getMain().stateSummary()
  } catch (e) {
    return `<no summary: ${e}>`
  }
}

/** Poll every frame until cond() is true; throws with the Lens state on timeout. Returns ms waited. */
export async function waitFor(label: string, cond: () => boolean, timeoutMs: number = 10000): Promise<number> {
  const t0 = getTime()
  while (!cond()) {
    if ((getTime() - t0) * 1000 > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for: ${label}. state=${summary()}`)
    }
    await nextFrame()
  }
  return Math.round((getTime() - t0) * 1000)
}

export {sleep, nextFrame}

/**
 * LEAF can start a scenario well after the Lens started (seen: 0.05 s … 21 s). Scenarios that
 * must watch the ghost demo from its beginning call this: if the demo is not still playing with
 * the stitch not yet placed, it restarts the flow with the Lens's own restart() (logged as a
 * method-call SETUP step, not an assertion), then waits for the fresh demo.
 */
export async function ensureFreshRehearse(main: SteadyHandsMain, ev: Evidence): Promise<void> {
  await waitFor("phase = rehearse", () => main.phase === "rehearse", 8000)
  if (main.ghostDemoState === "playing" && !main.ghostStitchPlaced) {
    ev.note("setup: scenario started during the opening ghost demo; observing it as-is")
    return
  }
  ev.note(
    `setup [method-call]: scenario started late (ghostDemoState=${main.ghostDemoState}, stitchPlaced=${main.ghostStitchPlaced}); calling restart() to replay Rehearse from the start`,
  )
  main.restart()
  await waitFor("fresh ghost demo playing", () => main.phase === "rehearse" && main.ghostDemoState === "playing", 3000)
}

/** Tagged, logged assertions. */
export class Evidence {
  constructor(private scenario: string) {}

  private line(tag: Tag, label: string, body: string, ok: boolean): void {
    print(`[SH-LEAF][${this.scenario}][${tag}] ${label}: ${body} ${ok ? "OK" : "FAIL"}`)
  }

  note(msg: string): void {
    print(`[SH-LEAF][${this.scenario}][note] ${msg}`)
  }

  noteEye(): void {
    this.note(`eye (device camera) world position = ${fmtV(eyeWorld(), 2)}`)
  }

  eq(tag: Tag, label: string, actual: any, expected: any): void {
    const ok = actual === expected
    this.line(tag, label, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`, ok)
    expect(actual, `[${tag}] ${label}`).toBe(expected)
  }

  near(tag: Tag, label: string, actual: number, expected: number, tol: number): void {
    const ok = Math.abs(actual - expected) <= tol
    this.line(tag, label, `actual=${actual.toFixed(4)} expected=${expected}±${tol}`, ok)
    expect(ok, `[${tag}] ${label}: ${actual} not within ${tol} of ${expected}`).toBe(true)
  }

  between(tag: Tag, label: string, actual: number, lo: number, hi: number): void {
    const ok = actual >= lo && actual <= hi
    this.line(tag, label, `actual=${actual.toFixed(4)} expected in [${lo}, ${hi}]`, ok)
    expect(ok, `[${tag}] ${label}: ${actual} not in [${lo}, ${hi}]`).toBe(true)
  }

  truthy(tag: Tag, label: string, cond: boolean, detail: string = ""): void {
    this.line(tag, label, `${cond}${detail ? " (" + detail + ")" : ""}`, cond)
    expect(cond, `[${tag}] ${label}${detail ? ": " + detail : ""}`).toBe(true)
  }
}

// ── geometry ───────────────────────────────────────────────────────────────

/** Cross-section view cm (section-local x/y on its z = 0 plane) → world. */
export function sectionToWorld(main: SteadyHandsMain, p: V2): vec3 {
  const t = main.crossSection.getSceneObject().getTransform()
  return t.getWorldTransform().multiplyPoint(new vec3(p.x, p.y, 0))
}

/** World → cross-section view cm. */
export function worldToSection(main: SteadyHandsMain, w: vec3): V2 {
  const t = main.crossSection.getSceneObject().getTransform()
  const l = t.getInvertedWorldTransform().multiplyPoint(w)
  return {x: l.x, y: l.y}
}

/** Pad-local (x along the cut, z toward the user) on the pad's top surface → world. */
export function padTopToWorld(main: SteadyHandsMain, x: number, z: number): vec3 {
  return main.pad.localToWorld(new vec3(x, main.pad.topY, z))
}

/** Geometry of the ideal stitch, read from the Lens (view cm). */
export interface StitchG {
  entry: V2
  exit: V2
  center: V2
  radius: number
  viewScale: number
}

export function stitchGeometry(main: SteadyHandsMain): StitchG {
  const g = main.crossSection.geometry
  return {
    entry: {x: g.entry.x, y: g.entry.y},
    exit: {x: g.exit.x, y: g.exit.y},
    center: {x: g.center.x, y: g.center.y},
    radius: g.radius,
    viewScale: g.viewScale,
  }
}

/** Real mm → view cm at the section's drawing scale. */
export function mmToView(mm: number, g: StitchG): number {
  return (mm * g.viewScale) / 10
}

/** The ideal semicircle entry → exit through the bottom (independent of the Lens's own helper). */
export function arcPath(g: StitchG, n: number, verticalExtraView: number = 0): V2[] {
  const out: V2[] = []
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (Math.PI * i) / n
    out.push({x: g.center.x + Math.cos(a) * g.radius, y: g.center.y + Math.sin(a) * (g.radius + verticalExtraView)})
  }
  return out
}

/** Straight line entry → exit. */
export function straightLine(g: StitchG, n: number): V2[] {
  const out: V2[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    out.push({x: g.entry.x + (g.exit.x - g.entry.x) * t, y: g.entry.y + (g.exit.y - g.entry.y) * t})
  }
  return out
}

/**
 * A path whose entry chord (entry → first point 1.2 mm real under the surface) gives the
 * requested entry angle under the Lens's documented measure (chord angle + the ideal arc's
 * chord bias at that depth), then follows the ideal arc to the exit. Stays within ~0.5 mm
 * of the arc, so only the angle decides pass/fail.
 */
export function angledEntryPath(g: StitchG, entryAngleDeg: number, n: number): V2[] {
  const d = mmToView(1.2, g)
  const r = g.radius
  const idealDx = r - Math.sqrt(Math.max(0, r * r - d * d))
  const idealDeg = (Math.atan2(d, idealDx) * 180) / Math.PI
  const chordDeg = entryAngleDeg - (90 - idealDeg)
  const dx = d / Math.tan((chordDeg * Math.PI) / 180)
  const out: V2[] = [{x: g.entry.x, y: g.entry.y}, {x: g.entry.x + dx, y: g.center.y - d}]
  // Continue on the arc from just below that depth to the exit.
  const a0 = Math.PI + Math.asin(Math.min(1, (d * 1.15) / r))
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((2 * Math.PI - a0) * i) / n
    out.push({x: g.center.x + Math.cos(a) * r, y: g.center.y + Math.sin(a) * r})
  }
  return out
}

/** Read the add-blend colour a Tint wrote to its material (rgb pre-multiplied by alpha × level). */
export function tintColor(tint: any): vec4 | null {
  if (!tint || !tint.material) return null
  return tint.material.mainPass.baseColor as vec4
}

/** Count enabled children of a SceneObject. */
export function enabledChildren(so: SceneObject): number {
  let n = 0
  for (let i = 0; i < so.getChildrenCount(); i++) if (so.getChild(i).enabled) n++
  return n
}

/** All Text components under a root (depth-first). */
export function textsUnder(root: SceneObject): Text[] {
  const out: Text[] = []
  const walk = (so: SceneObject) => {
    const t = so.getComponent("Component.Text") as Text
    if (t) out.push(t)
    for (let i = 0; i < so.getChildrenCount(); i++) walk(so.getChild(i))
  }
  walk(root)
  return out
}
