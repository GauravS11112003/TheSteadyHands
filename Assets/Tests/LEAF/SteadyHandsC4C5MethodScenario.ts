/**
 * Done criteria 4 + 5 — METHOD-CALL control: incrementNeedles ×2, decrementNeedles, pressClose
 * (1 missing + chime), decrementNeedles ×2 (floor at 0), pressClose (closed, marks fade).
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {Evidence, getMain, textComp, textShowing, waitFor} from "./SteadyHandsLeafHelpers"

const ID = "c4c5-method-needles-and-close"

@component
export class SteadyHandsC4C5MethodScenario extends Scenario {
  async run(): Promise<void> {
    const ev = new Evidence(ID)
    const T = "method-call"
    const main = getMain()
    await waitFor("rehearse", () => main.phase === "rehearse", 8000)
    main.pressReadyToClose()
    main.markIncisionLocal(-3, 0, 3, 0)
    ev.eq(T, "setup: phase close", main.phase, "close")

    const chimes0 = main.mismatchChimeCount
    main.incrementNeedles()
    main.incrementNeedles()
    main.decrementNeedles()
    ev.eq(T, "+ + −: needlesOut", main.needlesOut, 1)
    ev.eq(T, "+ + −: count display", main.controls.countDisplay, "1")
    main.pressClose()
    ev.eq(T, "Close with 1 out: alertVisible", main.alertVisible, true)
    ev.eq(T, "Close with 1 out: alertText", main.alertText, "1 missing")
    ev.eq(T, "Close with 1 out: alert label", main.controls.alertDisplay, "1 missing")
    ev.eq(T, "Close with 1 out: chime", main.mismatchChimeCount, chimes0 + 1)
    ev.eq(T, "Close with 1 out: not closed", main.isClosed, false)

    main.incrementNeedles()
    main.pressClose()
    ev.eq(T, "Close with 2 out: alertText", main.alertText, "2 missing")

    main.decrementNeedles()
    main.decrementNeedles()
    main.decrementNeedles()
    ev.eq(T, "− below zero: needlesOut floors at 0", main.needlesOut, 0)
    ev.eq(T, "− below zero: count display", main.controls.countDisplay, "0")
    ev.eq(T, "alert stays until Close at zero", main.alertVisible, true)

    main.pressClose()
    ev.eq(T, "Close at zero: isClosed", main.isClosed, true)
    ev.eq(T, "Close at zero: phase", main.phase, "closed")
    ev.eq(T, "Close at zero: alert hidden", main.alertVisible, false)
    ev.eq(T, "Close at zero: closedVisible", main.closedVisible, true)
    ev.truthy(T, 'Close at zero: "Closed" label showing', textShowing(textComp("ClosedLabelText")))
    await waitFor("marks faded", () => main.biteMarkCount === 0, 3000)
    ev.eq(T, "marks gone after the fade", main.biteMarksVisible, false)
  }
}
