/**
 * Done criterion 2 (red) — "… red otherwise." Two red attempts through REAL input:
 *  1. LEAF's stock DefaultLeafInteractor.drag() on "PracticeNeedle": a straight drag along the
 *     section's surface direction (what a naive drag does).
 *  2. A ray sweep straight from Entry to Exit along the skin surface (skims, 0° entry).
 * After each: red needle + message, still in Rehearse, no prompt, needle resets after ~1 s.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {withTimeout} from "Leaf.lspkg/Utils/common/Utils"
import {
  Evidence,
  fmtV,
  getMain,
  mustFind,
  sectionToWorld,
  stitchGeometry,
  straightLine,
  textComp,
  textShowing,
  tintColor,
  waitFor,
} from "./SteadyHandsLeafHelpers"
import {SteadyHandsLeafInteractor} from "./SteadyHandsLeafInteractor"

const ID = "c2-red-stitch-straight-drags"

@component
export class SteadyHandsC2RedDragScenario extends Scenario {
  async run(): Promise<void> {
    const ev = new Evidence(ID)
    const T = "real-input"
    const main = getMain()
    ev.noteEye()
    const ix = new SteadyHandsLeafInteractor()
    const g = stitchGeometry(main)

    await waitFor("practice needle live", () => main.phase === "rehearse" && main.crossSection.practiceEnabled, 15000)

    const checkRed = async (label: string) => {
      const nc = tintColor((main.crossSection as any).needleTint)
      const msg = (main.crossSectionLabels as any).messageText as Text
      const mc = msg ? msg.textFill.color : null
      ev.note(
        `${label}: result=${main.practiceResult} dev=${main.lastStitchDeviationMm.toFixed(3)}mm angle=${main.lastStitchEntryAngleDeg.toFixed(2)}deg endErr=${main.lastStitchEndErrorMm.toFixed(3)}mm reason="${main.lastStitchReason}" needle=${fmtV(nc)} message="${msg ? msg.text : "?"}"`,
      )
      ev.eq(T, `${label}: practiceResult`, main.practiceResult, "fail")
      ev.truthy(T, `${label}: needle red`, !!nc && nc.x > 0.9 && nc.y < 0.5, fmtV(nc))
      ev.truthy(T, `${label}: message red`, !!mc && mc.x > mc.y && mc.x > mc.z, fmtV(mc))
      ev.eq(T, `${label}: phase stays rehearse`, main.phase, "rehearse")
      ev.eq(T, `${label}: no pinch prompt`, main.promptVisible, false)
      ev.eq(T, `${label}: PromptText not showing`, textShowing(textComp("PromptText")), false)
      const resetMs = await waitFor(`${label}: needle reset`, () => main.crossSection.practiceEnabled, 3000)
      ev.between(T, `${label}: needle resets after about 1 s (s)`, resetMs / 1000, 0.7, 1.6)
      const np = mustFind("PracticeNeedle").getTransform().getLocalPosition()
      ev.truthy(T, `${label}: needle back at entry`, Math.abs(np.x - g.entry.x) < 0.01 && Math.abs(np.y - g.entry.y) < 0.01, fmtV(np))
    }

    // 1) Stock LEAF drag: per-frame vector along the section's local +X (the skin surface direction).
    const needle = ix.findEnabled("PracticeNeedle")
    const right = main.crossSection.getSceneObject().getTransform().right
    const n0 = main.practiceAttempts
    let stockDragError = ""
    try {
      await withTimeout(ix.drag(needle, right.uniformScale(0.05), 900), 8000, "stock LEAF drag timed out")
    } catch (e) {
      stockDragError = `${e}`
    }
    ev.note(`stock LEAF drag finished${stockDragError ? " with error: " + stockDragError : ""}`)
    await waitFor("stock drag scored", () => main.practiceAttempts === n0 + 1, 3000)
    ev.eq(T, "stock LEAF drag produced one scored attempt", main.practiceAttempts, n0 + 1)
    await checkRed("stock LEAF drag")

    // 2) Ray sweep straight from Entry to Exit along the surface.
    const n1 = main.practiceAttempts
    const needle2 = ix.findEnabled("PracticeNeedle")
    await ix.sweepDrag(
      needle2,
      sectionToWorld(main, g.entry),
      straightLine(g, 40).map((p) => sectionToWorld(main, p)),
    )
    await waitFor("straight sweep scored", () => main.practiceAttempts === n1 + 1, 3000)
    ev.eq(T, "straight sweep: reason", main.lastStitchReason, "off the arc")
    ev.near(T, "straight sweep: max deviation (real mm) = arc radius 5 mm", main.lastStitchDeviationMm, 5.0, 0.15)
    ev.between(T, "straight sweep: entry angle (deg)", main.lastStitchEntryAngleDeg, 0, 1)
    await checkRed("straight entry-to-exit sweep")
    ev.eq(T, "crossSectionVisible after two reds", main.crossSectionVisible, true)
  }
}
