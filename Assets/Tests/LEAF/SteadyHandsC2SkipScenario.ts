/**
 * Done criterion 2 (skip) — "… or 'Ready to close' clears Rehearse and shows the pinch prompt."
 * REAL INPUT: stock LEAF trigger on the UI Kit button "ReadyToCloseButton", mid ghost demo.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {Evidence, ensureFreshRehearse, getMain, mustFind, sleep, textComp, textShowing, waitFor} from "./SteadyHandsLeafHelpers"
import {SteadyHandsLeafInteractor} from "./SteadyHandsLeafInteractor"

const ID = "c2-skip-ready-to-close-button"
const PROMPT = "Pinch both ends of the incision."

@component
export class SteadyHandsC2SkipScenario extends Scenario {
  async run(): Promise<void> {
    const ev = new Evidence(ID)
    const T = "real-input"
    const main = getMain()
    ev.noteEye()
    const ix = new SteadyHandsLeafInteractor()

    await ensureFreshRehearse(main, ev)
    await waitFor("Ready to close live", () => mustFind("ReadyToCloseButton").isEnabledInHierarchy, 3000)
    await sleep(1200) // mid ghost demo
    ev.eq(T, "ghost demo still playing when Ready to close is pinched", main.ghostDemoState, "playing")
    ev.eq(T, "controls mode before", main.controls.mode, "rehearse")
    const clicks = main.audio.playCount("click")

    await ix.tapButton("ReadyToCloseButton")
    await waitFor("phase = mark", () => main.phase === "mark", 2000)

    ev.eq(T, "rehearseEndReason", main.rehearseEndReason, "skip")
    ev.eq(T, "phase", main.phase, "mark")
    ev.eq(T, "ghost demo stopped", main.ghostDemoState, "stopped")
    ev.eq(T, "ghost driver hidden", mustFind("GhostHand_Driver").isEnabledInHierarchy, false)
    ev.eq(T, "ghost forceps hidden", mustFind("GhostHand_Forceps").isEnabledInHierarchy, false)
    ev.eq(T, "ghost stitch cleared from the pad", main.ghostStitchOnPad, false)
    ev.eq(T, "crossSectionVisible", main.crossSectionVisible, false)
    ev.eq(T, "practice needle disabled", main.crossSection.practiceEnabled, false)
    ev.eq(T, "controls mode after", main.controls.mode, "hidden")
    ev.eq(T, "ReadyToCloseButton hidden", mustFind("ReadyToCloseButton").isEnabledInHierarchy, false)
    ev.eq(T, "click cue played once", main.audio.playCount("click"), clicks + 1)
    ev.eq(T, "promptVisible", main.promptVisible, true)
    ev.eq(T, "promptText", main.promptText, PROMPT)
    const pt = textComp("PromptText")
    ev.truthy(T, "PromptText showing on the pad", textShowing(pt))
    ev.eq(T, "PromptText label text", pt.text, PROMPT)
    ev.eq(T, "pad accepts pinches now", (main.pad as any).pinchEnabled, true)
    await waitFor("cross-section folded away", () => !mustFind("Fold").enabled, 2000)
    ev.eq(T, "Fold disabled (folded away)", mustFind("Fold").enabled, false)
  }
}
