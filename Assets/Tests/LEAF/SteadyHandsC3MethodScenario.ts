/**
 * Done criterion 3 — METHOD-CALL control: pressReadyToClose(), markIncisionLocal() for exactly
 * 6.0 cm and 3.0 cm, a slightly-off 6.0 cm pinch, and computeSutureCount() spot checks.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {Evidence, getMain, textComp, textShowing, waitFor} from "./SteadyHandsLeafHelpers"

const ID = "c3-method-mark-6cm-and-3cm"

@component
export class SteadyHandsC3MethodScenario extends Scenario {
  async run(): Promise<void> {
    const ev = new Evidence(ID)
    const T = "method-call"
    const main = getMain()
    await waitFor("rehearse", () => main.phase === "rehearse", 8000)

    main.pressReadyToClose()
    ev.eq(T, "pressReadyToClose: phase", main.phase, "mark")
    ev.eq(T, "pressReadyToClose: rehearseEndReason", main.rehearseEndReason, "skip")
    ev.eq(T, "pressReadyToClose: promptVisible", main.promptVisible, true)

    main.markIncisionLocal(-3, 0, 3, 0)
    ev.note(`after 6.0 cm: ${main.stateSummary()}`)
    ev.near(T, "6.0 cm: markedLengthCm", main.markedLengthCm, 6.0, 0.001)
    ev.eq(T, "6.0 cm: sutureCount", main.sutureCount, 11)
    ev.eq(T, "6.0 cm: biteMarkCount", main.biteMarkCount, 11)
    ev.eq(T, "6.0 cm: countLabelText", main.countLabelText, "6.0 cm → 11 sutures")
    ev.eq(T, "6.0 cm: SutureCountText", textComp("SutureCountText").text, "6.0 cm → 11 sutures")

    main.markIncisionLocal(-1.5, 0, 1.5, 0)
    ev.note(`after 3.0 cm: ${main.stateSummary()}`)
    ev.near(T, "3.0 cm: markedLengthCm", main.markedLengthCm, 3.0, 0.001)
    ev.eq(T, "3.0 cm: sutureCount", main.sutureCount, 5)
    ev.eq(T, "3.0 cm: biteMarkCount", main.biteMarkCount, 5)
    ev.eq(T, "3.0 cm: countLabelText", main.countLabelText, "3.0 cm → 5 sutures")
    ev.truthy(T, "3.0 cm: SutureCountText showing", textShowing(textComp("SutureCountText")))
    ev.eq(T, "3.0 cm: SutureCountText", textComp("SutureCountText").text, "3.0 cm → 5 sutures")

    main.markIncisionLocal(-2.9, 0.2, 3.1, -0.15)
    ev.note(`after slightly-off 6.0 cm: ${main.stateSummary()}`)
    ev.eq(T, "slightly-off pinch (6.01 cm): sutureCount", main.sutureCount, 11)
    ev.eq(T, "slightly-off pinch: countLabelText", main.countLabelText, "6.0 cm → 11 sutures")

    ev.eq(T, "computeSutureCount(6.0)", main.computeSutureCount(6.0), 11)
    ev.eq(T, "computeSutureCount(3.0)", main.computeSutureCount(3.0), 5)
    ev.eq(T, "computeSutureCount(5.8)", main.computeSutureCount(5.8), 11)
    ev.eq(T, "computeSutureCount(6.2)", main.computeSutureCount(6.2), 11)
  }
}
