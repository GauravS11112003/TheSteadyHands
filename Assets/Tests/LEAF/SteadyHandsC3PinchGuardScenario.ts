/**
 * Done criterion 3 (input reach + guard) — REAL INPUT on "SuturePad":
 *  1. LEAF's stock trigger (aims at the pad's centre) — records where an un-aimed pinch lands.
 *  2. The same stock trigger again — a second pinch < 1 cm from the first must move the first
 *     marker, not finish the mark.
 *  3. An aimed pinch 0.6 cm away — still < 1 cm: moves marker A again.
 *  4. An aimed pinch 4.0 cm from that point — finishes: 4.0 cm → 7 sutures.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {Evidence, fmtV, getMain, mustFind, padTopToWorld, textComp, textShowing, waitFor} from "./SteadyHandsLeafHelpers"
import {SteadyHandsLeafInteractor} from "./SteadyHandsLeafInteractor"

const ID = "c3-pad-pinch-guard-and-stock-trigger"

@component
export class SteadyHandsC3PinchGuardScenario extends Scenario {
  async run(): Promise<void> {
    const ev = new Evidence(ID)
    const T = "real-input"
    const main = getMain()
    ev.noteEye()
    const ix = new SteadyHandsLeafInteractor()

    await waitFor("Ready to close live", () => main.phase === "rehearse" && mustFind("ReadyToCloseButton").isEnabledInHierarchy, 8000)
    await ix.tapButton("ReadyToCloseButton")
    await waitFor("phase = mark", () => main.phase === "mark", 2000)

    const padT = mustFind("SuturePad").getTransform()
    const markerA = () => padT.getInvertedWorldTransform().multiplyPoint(mustFind("PinchMarker_A").getTransform().getWorldPosition())

    // 1) Stock LEAF trigger on the pad.
    let pad = ix.findEnabled("SuturePad")
    await ix.trigger(pad)
    await waitFor("first stock pinch registered", () => main.pinchCount === 1, 2000)
    const p0 = markerA()
    ev.note(`stock LEAF trigger landed at pad-local ${fmtV(p0)} (marker A)`)
    ev.eq(T, "stock trigger: pinchCount", main.pinchCount, 1)
    ev.truthy(T, "stock trigger lands on the pad top, near the centre", Math.abs(p0.x) < 1 && Math.abs(p0.z) < 1, fmtV(p0))

    // 2) Same stock trigger again: same spot (< 1 cm) → treated as re-pinching end A.
    pad = ix.findEnabled("SuturePad")
    const pinchCues = main.audio.playCount("pinch")
    await ix.trigger(pad)
    await waitFor("second stock pinch handled", () => main.audio.playCount("pinch") > pinchCues, 2000)
    ev.eq(T, "second stock pinch < 1 cm: pinchCount stays 1", main.pinchCount, 1)
    ev.eq(T, "no bite marks yet", main.biteMarkCount, 0)
    ev.eq(T, "prompt still showing", textShowing(textComp("PromptText")), true)

    // 3) Aimed pinch 0.6 cm away: still < 1 cm → marker A moves there.
    const p1x = p0.x + 0.6
    const p1z = p0.z
    pad = ix.findEnabled("SuturePad")
    await ix.pinchAt(pad, padTopToWorld(main, p1x, p1z))
    const a1 = markerA()
    ev.note(`after the 0.6 cm re-pinch marker A is at ${fmtV(a1)}`)
    ev.eq(T, "0.6 cm re-pinch: pinchCount stays 1", main.pinchCount, 1)
    ev.near(T, "0.6 cm re-pinch: marker A moved (x)", a1.x, p1x, 0.05)
    ev.near(T, "0.6 cm re-pinch: marker A moved (z)", a1.z, p1z, 0.05)
    ev.eq(T, "still no bite marks", main.biteMarkCount, 0)

    // 4) Aimed pinch 4.0 cm from the moved end → finishes the mark from the MOVED point.
    pad = ix.findEnabled("SuturePad")
    await ix.pinchAt(pad, padTopToWorld(main, p1x + 4.0, p1z))
    ev.note(`state after marking: ${main.stateSummary()}`)
    ev.eq(T, "pinchCount", main.pinchCount, 2)
    ev.near(T, "markedLengthCm measured from the moved end", main.markedLengthCm, 4.0, 0.02)
    ev.eq(T, "sutureCount for 4.0 cm", main.sutureCount, 7)
    ev.eq(T, "biteMarkCount for 4.0 cm", main.biteMarkCount, 7)
    ev.eq(T, "countLabelText", main.countLabelText, "4.0 cm → 7 sutures")
    ev.eq(T, "SutureCountText label text", textComp("SutureCountText").text, "4.0 cm → 7 sutures")
  }
}
