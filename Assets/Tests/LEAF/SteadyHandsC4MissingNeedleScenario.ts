/**
 * Done criterion 4 — "Pressing + twice, − once, then Close shows the red alert, the chime and
 * '1 missing'." REAL INPUT: stock LEAF triggers on the UI Kit buttons NeedlePlusButton,
 * NeedleMinusButton and CloseButton (after reaching Close via real pinches).
 * Also: the alert stays when Close is pressed again with a needle still out.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {Evidence, fmtV, getMain, mustFind, sleep, textShowing, waitFor} from "./SteadyHandsLeafHelpers"
import {reachCloseWithRealInput, tapAndExpectCount} from "./SteadyHandsLeafFlows"
import {SteadyHandsLeafInteractor} from "./SteadyHandsLeafInteractor"

const ID = "c4-plus-plus-minus-close-1-missing"

@component
export class SteadyHandsC4MissingNeedleScenario extends Scenario {
  async run(): Promise<void> {
    const ev = new Evidence(ID)
    const T = "real-input"
    const main = getMain()
    ev.noteEye()
    const ix = new SteadyHandsLeafInteractor()

    await reachCloseWithRealInput(ix, main, ev)
    ev.eq(T, "needle count starts at 0", main.controls.countDisplay, "0")
    ev.eq(T, "no alert before Close", main.controls.alertDisplay, "")

    await tapAndExpectCount(ix, main, ev, "NeedlePlusButton", 1)
    await tapAndExpectCount(ix, main, ev, "NeedlePlusButton", 2)
    await tapAndExpectCount(ix, main, ev, "NeedleMinusButton", 1)

    const chimes0 = main.mismatchChimeCount
    const cue0 = main.audio.playCount("mismatch")
    const cueSo = mustFind("Cue_mismatch")
    const cue = cueSo.getComponent("Component.AudioComponent") as AudioComponent
    let sawPlaying = false
    const unsub = this.createEvent("UpdateEvent")
    unsub.bind(() => {
      if (cue && cue.isPlaying()) sawPlaying = true
    })
    await ix.tapButton("CloseButton")
    await waitFor("alert after Close", () => main.alertVisible, 1500)
    await sleep(100)
    unsub.enabled = false

    ev.eq(T, "alertVisible", main.alertVisible, true)
    ev.eq(T, "alertText", main.alertText, "1 missing")
    ev.eq(T, "alert label text on the counter", main.controls.alertDisplay, "1 missing")
    const alertText = (main.controls as any).alertText as Text
    const alertIcon = (main.controls as any).alertIcon as Image
    const ac = alertText.textFill.color
    ev.truthy(T, "alert label showing", textShowing(alertText))
    ev.truthy(T, "alert label is red", ac.x > 0.9 && ac.y < 0.6 && ac.z < 0.6, fmtV(ac))
    ev.truthy(T, "warning icon showing", alertIcon.enabled && alertIcon.getSceneObject().isEnabledInHierarchy)
    ev.eq(T, "mismatchChimeCount +1", main.mismatchChimeCount, chimes0 + 1)
    ev.eq(T, "mismatch cue requested once", main.audio.playCount("mismatch"), cue0 + 1)
    ev.truthy(T, "mismatch chime has an audio track", !!cue && !isNull(cue.audioTrack), cue && cue.audioTrack ? cue.audioTrack.name : "none")
    ev.truthy(T, "mismatch chime AudioComponent was playing", sawPlaying)
    ev.eq(T, "big count still reads 1", main.controls.countDisplay, "1")
    ev.eq(T, "not closed", main.isClosed, false)
    ev.eq(T, "phase", main.phase, "close")
    ev.eq(T, "Closed label not showing", main.closedVisible, false)
    ev.eq(T, "bite marks still on the pad", main.biteMarkCount, 11)

    // The alert stays when Close is pressed again with a needle still out.
    await ix.tapButton("CloseButton")
    await sleep(150)
    ev.eq(T, "second Close with 1 out: alert still showing", main.controls.alertDisplay, "1 missing")
    ev.eq(T, "second Close with 1 out: chime again", main.mismatchChimeCount, chimes0 + 2)
    ev.eq(T, "second Close with 1 out: still not closed", main.isClosed, false)
  }
}
