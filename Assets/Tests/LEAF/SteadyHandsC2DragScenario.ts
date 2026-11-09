/**
 * Done criterion 2 (drag) — "Dragging the needle from entry to exit turns my stitch green within
 * 1.5 mm and 15°, red otherwise. Green … clears Rehearse and shows the pinch prompt."
 *
 * REAL INPUT: pinches the SIK Interactable "PracticeNeedle" (2 cm grab zone) and sweeps the
 * interactor ray across the cross-section plane through a designed path, one point per frame,
 * then releases. The Lens projects the ray onto the plane itself (SteadyHandsCrossSectionController
 * cursorLocal), records the path, and scores it on release.
 *
 * Parameters (set per registered id in LeafIndex):
 *   shape  = "ideal" | "bulge" | "angle"
 *   amount = bulge depth in REAL mm (bulge) or the designed entry angle in degrees (angle)
 *   expect = "pass" | "fail"
 *   id     = scenario id used in the evidence log
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {
  Evidence,
  V2,
  angledEntryPath,
  arcPath,
  fmtV,
  getMain,
  mmToView,
  mustFind,
  sectionToWorld,
  stitchGeometry,
  textComp,
  textShowing,
  tintColor,
  waitFor,
} from "./SteadyHandsLeafHelpers"
import {SteadyHandsLeafInteractor} from "./SteadyHandsLeafInteractor"

const PROMPT = "Pinch both ends of the incision."

@component
export class SteadyHandsC2DragScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const shape = config?.get("shape") ?? "ideal"
    const amount = parseFloat(config?.get("amount") ?? "0")
    const want = config?.get("expect") ?? "pass"
    const ev = new Evidence(config?.get("id") ?? `c2-drag-${shape}`)
    const T = "real-input"
    const main = getMain()
    ev.noteEye()
    const ix = new SteadyHandsLeafInteractor()

    const waited = await waitFor(
      "practice needle live (ghost demo over)",
      () => main.phase === "rehearse" && main.crossSection.practiceEnabled,
      15000,
    )
    ev.note(`practice needle became live after ${waited} ms`)
    const needle = ix.findEnabled("PracticeNeedle")
    const g = stitchGeometry(main)

    let path: V2[]
    if (shape === "bulge") path = arcPath(g, 60, mmToView(amount, g))
    else if (shape === "angle") path = angledEntryPath(g, amount, 50)
    else path = arcPath(g, 60)
    ev.note(
      `designed path: shape=${shape} amount=${amount} points=${path.length} entry=(${g.entry.x},${g.entry.y}) exit=(${g.exit.x},${g.exit.y}) r=${g.radius}`,
    )

    const before = main.practiceAttempts
    await ix.sweepDrag(
      needle,
      sectionToWorld(main, g.entry),
      path.map((p) => sectionToWorld(main, p)),
    )
    await waitFor("stitch scored on release", () => main.practiceAttempts === before + 1, 3000)
    const recorded: V2[] = ((main.crossSection as any).path ?? []) as V2[]
    ev.note(
      `scored: result=${main.practiceResult} dev=${main.lastStitchDeviationMm.toFixed(3)}mm angle=${main.lastStitchEntryAngleDeg.toFixed(2)}deg endErr=${main.lastStitchEndErrorMm.toFixed(3)}mm reason="${main.lastStitchReason}" recordedPoints=${recorded.length}`,
    )

    ev.eq(T, "practice attempts after one drag", main.practiceAttempts, before + 1)
    ev.eq(T, "practiceResult", main.practiceResult, want)
    if (shape === "ideal") {
      ev.between(T, "max deviation from the ideal arc (real mm)", main.lastStitchDeviationMm, 0, 0.2)
      ev.near(T, "entry angle (deg)", main.lastStitchEntryAngleDeg, 90, 3)
    } else if (shape === "bulge") {
      ev.near(T, "max deviation equals the designed bulge (real mm)", main.lastStitchDeviationMm, amount, 0.1)
      ev.between(T, "entry angle error stays small (deg)", Math.abs(90 - main.lastStitchEntryAngleDeg), 0, 6)
    } else if (shape === "angle") {
      ev.near(T, "entry angle equals the designed angle (deg)", main.lastStitchEntryAngleDeg, amount, 1.5)
      ev.between(T, "deviation stays inside 1.5 mm (real mm)", main.lastStitchDeviationMm, 0, 1.5)
    }
    ev.between(T, "path ends at the exit (real mm)", main.lastStitchEndErrorMm, 0, 0.3)

    // Visual: needle + trail colour and the result message on the cross-section.
    const nc = tintColor((main.crossSection as any).needleTint)
    const tc = tintColor((main.crossSection as any).trailTint)
    const msg = (main.crossSectionLabels as any).messageText as Text
    const mc = msg ? msg.textFill.color : null
    ev.note(`needle=${fmtV(nc)} trail=${fmtV(tc)} message="${msg ? msg.text : "?"}" messageColor=${fmtV(mc)}`)
    if (want === "pass") {
      ev.truthy(T, "needle turned green", !!nc && nc.y > 0.9 && nc.x < 0.5, fmtV(nc))
      ev.truthy(T, "trail turned green", !!tc && tc.y > 0.9 && tc.x < 0.5, fmtV(tc))
      ev.truthy(T, 'result message starts "Good stitch"', !!msg && msg.text.indexOf("Good stitch") === 0, msg ? msg.text : "")
      ev.truthy(T, "result message green", !!mc && mc.y > mc.x && mc.y > mc.z, fmtV(mc))
      // Green holds briefly, then clears Rehearse and shows the pinch prompt.
      ev.eq(T, "still in rehearse while green shows", main.phase, "rehearse")
      const heldMs = await waitFor("rehearse cleared after green", () => main.phase === "mark", 4000)
      ev.note(`green held ${heldMs} ms before Rehearse cleared`)
      ev.eq(T, "rehearseEndReason", main.rehearseEndReason, "stitch")
      ev.eq(T, "crossSectionVisible", main.crossSectionVisible, false)
      ev.eq(T, "ghost stitch cleared from the pad", main.ghostStitchOnPad, false)
      ev.eq(T, "ReadyToCloseButton hidden", mustFind("ReadyToCloseButton").isEnabledInHierarchy, false)
      ev.eq(T, "promptVisible", main.promptVisible, true)
      ev.eq(T, "promptText", main.promptText, PROMPT)
      const pt = textComp("PromptText")
      ev.truthy(T, "PromptText showing on the pad", textShowing(pt))
      ev.eq(T, "PromptText label text", pt.text, PROMPT)
      await waitFor("cross-section folded away", () => !mustFind("Fold").enabled, 2000)
      ev.eq(T, "Fold disabled (folded away)", mustFind("Fold").enabled, false)
      ev.eq(T, "pad accepts pinches now", (main.pad as any).pinchEnabled, true)
    } else {
      ev.truthy(T, "needle turned red", !!nc && nc.x > 0.9 && nc.y < 0.5, fmtV(nc))
      ev.truthy(T, "trail turned red", !!tc && tc.x > 0.9 && tc.y < 0.5, fmtV(tc))
      ev.truthy(T, 'result message says "Try again"', !!msg && msg.text.indexOf("Try again") >= 0, msg ? msg.text : "")
      ev.truthy(T, "result message red", !!mc && mc.x > mc.y && mc.x > mc.z, fmtV(mc))
      ev.eq(T, "phase stays rehearse after red", main.phase, "rehearse")
      ev.eq(T, "no pinch prompt after red", main.promptVisible, false)
      ev.eq(T, "PromptText not showing", textShowing(textComp("PromptText")), false)
      const resetMs = await waitFor("needle reset for another try", () => main.crossSection.practiceEnabled, 3000)
      ev.between(T, "needle resets after about 1 s (s)", resetMs / 1000, 0.7, 1.6)
      const np = mustFind("PracticeNeedle").getTransform().getLocalPosition()
      ev.near(T, "needle back at entry x (view cm)", np.x, g.entry.x, 0.01)
      ev.near(T, "needle back at entry y (view cm)", np.y, g.entry.y, 0.01)
      ev.eq(T, "crossSectionVisible after red", main.crossSectionVisible, true)
    }
  }
}
