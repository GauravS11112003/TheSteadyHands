/**
 * Done criterion 1 — "On start, the ghost hands place one stitch on the pad and the 3×
 * cross-section shows above it."  No input: watches the Lens from start to the end of the demo.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {Evidence, ensureFreshRehearse, fmtV, getMain, mustFind, nextFrame, textShowing, textsUnder, waitFor} from "./SteadyHandsLeafHelpers"

const ID = "c1-ghost-stitch-and-cross-section"

@component
export class SteadyHandsC1GhostDemoScenario extends Scenario {
  async run(): Promise<void> {
    const ev = new Evidence(ID)
    const main = getMain()
    const T = "no-input"

    await ensureFreshRehearse(main, ev)
    ev.note(`observing from: ${main.stateSummary()}`)

    const driver = mustFind("GhostHand_Driver")
    const forceps = mustFind("GhostHand_Forceps")
    const stitchRoot = mustFind("GhostStitch")
    const ghostEntry = mustFind("GhostEntry")
    const ghostExit = mustFind("GhostExit")
    const ghostThread = mustFind("GhostThread")
    const fold = mustFind("Fold")
    const cs = mustFind("CrossSection")
    const pad = mustFind("SuturePad")

    ev.eq(T, "ghostDemoState at rehearse start", main.ghostDemoState, "playing")
    ev.eq(T, "crossSectionVisible at rehearse start", main.crossSectionVisible, true)
    ev.eq(T, "Fold (cross-section diagram) enabled at rehearse start", fold.isEnabledInHierarchy, true)

    // Sample the whole demo.
    const ghost: any = main.ghost
    const tints: any[] = ghost && ghost.tints ? ghost.tints : []
    const t0 = getTime()
    let sawDriver = false
    let sawForceps = false
    let minDriverToEntry = Infinity
    let maxFoldY = 0
    let stitchAtMs = -1
    let csVisibleWhenStitched = false
    let maxLevel = 0
    let fadeStartMs = -1
    const entryWorld = () => ghostEntry.getTransform().getWorldPosition()
    while (main.ghostDemoState === "playing" && getTime() - t0 < 12) {
      if (driver.isEnabledInHierarchy) {
        sawDriver = true
        minDriverToEntry = Math.min(minDriverToEntry, driver.getTransform().getWorldPosition().distance(entryWorld()))
      }
      if (forceps.isEnabledInHierarchy) sawForceps = true
      maxFoldY = Math.max(maxFoldY, fold.getTransform().getLocalScale().y)
      if (stitchAtMs < 0 && main.ghostStitchOnPad) {
        stitchAtMs = Math.round((getTime() - t0) * 1000)
        csVisibleWhenStitched = main.crossSectionVisible && fold.isEnabledInHierarchy
      }
      if (tints.length > 0) {
        const lv = tints[0].getLevel()
        maxLevel = Math.max(maxLevel, lv)
        if (stitchAtMs >= 0 && fadeStartMs < 0 && maxLevel > 0.99 && lv < 0.98) {
          fadeStartMs = Math.round((getTime() - t0) * 1000)
        }
      }
      await nextFrame()
    }
    const demoEndMs = Math.round((getTime() - t0) * 1000)
    ev.note(
      `demo: stitchAt=${stitchAtMs}ms fadeStart=${fadeStartMs}ms end=${demoEndMs}ms minDriverToEntry=${minDriverToEntry.toFixed(3)}cm maxFoldY=${maxFoldY.toFixed(3)}`,
    )

    ev.truthy(T, "ghost needle driver visible during the demo", sawDriver)
    ev.truthy(T, "ghost forceps visible during the demo", sawForceps)
    ev.between(T, "ghost driver tip reaches the stitch entry on the pad (cm)", minDriverToEntry, 0, 1.0)
    ev.truthy(T, "ghost stitch appeared on the pad during the demo", stitchAtMs >= 0, `at ${stitchAtMs} ms`)
    ev.truthy(T, "cross-section showing when the stitch was placed", csVisibleWhenStitched)
    ev.between(T, "cross-section fully unfolded (Fold local scale y)", maxFoldY, 0.98, 1.2)
    ev.eq(T, "ghostDemoState after the demo", main.ghostDemoState, "done")
    ev.eq(T, "ghostStitchPlaced", main.ghostStitchPlaced, true)
    ev.eq(T, "ghostStitchOnPad after the ghost faded", main.ghostStitchOnPad, true)
    ev.eq(T, "ghost driver hidden after the fade", driver.isEnabledInHierarchy, false)
    ev.eq(T, "ghost forceps hidden after the fade", forceps.isEnabledInHierarchy, false)
    if (fadeStartMs >= 0) {
      ev.between(T, "ghost fade-out duration (s)", (demoEndMs - fadeStartMs) / 1000, 0.6, 1.6)
    } else {
      ev.note("ghost tint level not readable; fade duration not measured")
    }

    // Exactly one stitch, on the pad's top surface, across the cut (far-side entry, near-side exit).
    let entries = 0
    let exits = 0
    for (let i = 0; i < stitchRoot.getChildrenCount(); i++) {
      const c = stitchRoot.getChild(i)
      if (c.name === "GhostEntry" && c.enabled) entries++
      if (c.name === "GhostExit" && c.enabled) exits++
    }
    ev.eq(T, "ghost stitch entry dots on the pad", entries, 1)
    ev.eq(T, "ghost stitch exit dots on the pad", exits, 1)
    ev.eq(T, "ghost thread shown", ghostThread.isEnabledInHierarchy, true)
    const padT = pad.getTransform()
    const eL = padT.getInvertedWorldTransform().multiplyPoint(entryWorld())
    const xL = padT.getInvertedWorldTransform().multiplyPoint(ghostExit.getTransform().getWorldPosition())
    ev.note(`ghost stitch pad-local: entry=${fmtV(eL)} exit=${fmtV(xL)}`)
    ev.between(T, "ghost entry height above pad top (cm)", eL.y - 0.5, 0, 0.2)
    ev.between(T, "ghost exit height above pad top (cm)", xL.y - 0.5, 0, 0.2)
    ev.truthy(T, "ghost entry on the far side of the cut", eL.z < 0, `z=${eL.z.toFixed(3)}`)
    ev.truthy(T, "ghost exit on the near side of the cut", xL.z > 0, `z=${xL.z.toFixed(3)}`)
    ev.truthy(T, "ghost stitch inside the 15x10 pad", Math.abs(eL.x) <= 7.5 && Math.abs(xL.x) <= 7.5 && Math.abs(eL.z) <= 5 && Math.abs(xL.z) <= 5)

    // The 3× cross-section floats directly above the pad.
    const csW = cs.getTransform().getWorldPosition()
    const padTopW = padT.getWorldTransform().multiplyPoint(new vec3(0, 0.5, 0))
    ev.note(`cross-section world=${fmtV(csW)} pad top centre world=${fmtV(padTopW)}`)
    ev.near(T, "cross-section x offset from pad centre (cm)", csW.x - padTopW.x, 0, 0.5)
    ev.near(T, "cross-section z offset from pad centre (cm)", csW.z - padTopW.z, 0, 0.5)
    ev.between(T, "cross-section height above the pad top (cm)", csW.y - padTopW.y, 13, 17)
    ev.eq(T, "crossSectionVisible after the demo", main.crossSectionVisible, true)
    ev.eq(T, "Fold still enabled after the demo", fold.isEnabledInHierarchy, true)

    const badge = textsUnder(cs).filter((t) => t.text === "3×")
    ev.eq(T, '"3×" badge labels on the cross-section', badge.length, 1)
    ev.truthy(T, '"3×" badge showing', badge.length > 0 && textShowing(badge[0]))

    // Practice opens once the ghost is done.
    await waitFor("practice enabled", () => main.crossSection.practiceEnabled, 3000)
    ev.eq(T, "PracticeNeedle enabled after the demo", mustFind("PracticeNeedle").isEnabledInHierarchy, true)
    ev.eq(T, "phase after the demo", main.phase, "rehearse")
  }
}
