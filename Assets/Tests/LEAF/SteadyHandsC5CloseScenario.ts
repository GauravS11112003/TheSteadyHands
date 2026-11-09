/**
 * Done criterion 5 — "At zero, Close fades the marks and 'Closed' glows green."
 * REAL INPUT: UI Kit buttons via stock LEAF triggers, after reaching Close via real pinches.
 *
 * Parameters (per registered id):
 *   path = "direct"        Close straight away with 0 needles out.
 *          "after-missing" + + − Close (1 missing), − back to 0 (alert must stay), then Close.
 *   id   = scenario id used in the evidence log
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {Evidence, fmtV, getMain, mustFind, nextFrame, textComp, textShowing, waitFor} from "./SteadyHandsLeafHelpers"
import {reachCloseWithRealInput, tapAndExpectCount} from "./SteadyHandsLeafFlows"
import {SteadyHandsLeafInteractor} from "./SteadyHandsLeafInteractor"

@component
export class SteadyHandsC5CloseScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const path = config?.get("path") ?? "direct"
    const ev = new Evidence(config?.get("id") ?? `c5-close-${path}`)
    const T = "real-input"
    const main = getMain()
    ev.noteEye()
    const ix = new SteadyHandsLeafInteractor()

    await reachCloseWithRealInput(ix, main, ev)

    if (path === "after-missing") {
      await tapAndExpectCount(ix, main, ev, "NeedlePlusButton", 1)
      await tapAndExpectCount(ix, main, ev, "NeedlePlusButton", 2)
      await tapAndExpectCount(ix, main, ev, "NeedleMinusButton", 1)
      await ix.tapButton("CloseButton")
      await waitFor("1 missing alert", () => main.alertVisible, 1500)
      ev.eq(T, "alert before going back to zero", main.controls.alertDisplay, "1 missing")
      await tapAndExpectCount(ix, main, ev, "NeedleMinusButton", 0)
      ev.eq(T, "alert stays at zero until Close is pressed again", main.controls.alertDisplay, "1 missing")
      ev.eq(T, "still not closed at zero before Close", main.isClosed, false)
    }
    ev.eq(T, "needlesOut before the final Close", main.needlesOut, 0)

    // Sample the fade and the glow from the moment Close is pressed.
    const dotTint: any = (main.pad as any).dotTint
    const closed = textComp("ClosedLabelText")
    const count = textComp("SutureCountText")
    const closedCue0 = main.audio.playCount("closed")
    const levels: number[] = []
    const alphas: number[] = []
    let sampling = true
    const ue = this.createEvent("UpdateEvent")
    const t0 = {v: -1}
    ue.bind(() => {
      if (!sampling || !main.isClosed) return
      if (t0.v < 0) t0.v = getTime()
      levels.push(main.pad.biteMarkCount > 0 && dotTint ? dotTint.getLevel() : 0)
      alphas.push(textShowing(closed) ? closed.textFill.color.w : 0)
    })

    await ix.tapButton("CloseButton")
    await waitFor("closed", () => main.isClosed, 1500)
    await waitFor("marks cleared", () => main.biteMarkCount === 0, 3000)
    const fadeMs = Math.round((getTime() - t0.v) * 1000)
    for (let i = 0; i < 30; i++) await nextFrame()
    sampling = false
    ue.enabled = false

    const mid = levels.filter((k) => k > 0.02 && k < 0.98)
    ev.note(
      `fade: ${levels.length} samples, ${mid.length} mid-fade (0<k<1), first=${levels.length ? levels[0].toFixed(3) : "-"}; marks cleared ~${fadeMs} ms after Close was seen; glow alpha samples first=${alphas.length ? alphas[0].toFixed(3) : "-"} max=${Math.max(0, ...alphas).toFixed(3)} last=${alphas.length ? alphas[alphas.length - 1].toFixed(3) : "-"}`,
    )
    ev.eq(T, "alertVisible", main.alertVisible, false)
    ev.eq(T, "alert label hidden", main.controls.alertDisplay, "")
    ev.eq(T, "isClosed", main.isClosed, true)
    ev.eq(T, "phase", main.phase, "closed")
    ev.eq(T, "closedVisible", main.closedVisible, true)
    ev.truthy(T, "marks faded (several intermediate levels, not an instant cut)", mid.length >= 3, `${mid.length} mid-fade frames`)
    ev.between(T, "marks fade time (s)", fadeMs / 1000, 0.4, 1.6)
    ev.eq(T, "bite marks gone after the fade", main.biteMarkCount, 0)
    ev.eq(T, "biteMarksVisible", main.biteMarksVisible, false)
    ev.eq(T, "Bite_* objects left under BiteMarks", mustFind("BiteMarks").getChildrenCount(), 0)
    ev.eq(T, "pinch marker A hidden", mustFind("PinchMarker_A").isEnabledInHierarchy, false)
    ev.eq(T, "pinch marker B hidden", mustFind("PinchMarker_B").isEnabledInHierarchy, false)
    ev.eq(T, "suture count label hidden", textShowing(count), false)
    ev.eq(T, "closing controls hidden", mustFind("NeedleCounter").isEnabledInHierarchy, false)

    const c = closed.textFill.color
    ev.truthy(T, '"Closed" label showing', textShowing(closed))
    ev.eq(T, '"Closed" label text', closed.text, "Closed")
    ev.truthy(T, '"Closed" is green', c.y > 0.9 && c.x < 0.6 && c.z < 0.7, fmtV(c))
    ev.truthy(T, '"Closed" glow outline on', closed.outlineSettings.enabled)
    const early = alphas.slice(0, 8)
    ev.note(`"Closed" alpha, first 8 frames: ${early.map((a) => a.toFixed(3)).join(", ")}`)
    ev.truthy(
      T,
      '"Closed" glows in (low alpha early, bright later)',
      alphas.length > 8 && Math.min(...early) < 0.5 && Math.max(...alphas) >= 0.75,
      `minEarly=${Math.min(...early).toFixed(3)} max=${Math.max(...alphas).toFixed(3)}`,
    )
    ev.between(T, '"Closed" glow alpha now', c.w, 0.55, 1.0)
    ev.eq(T, '"closed" cue played', main.audio.playCount("closed"), closedCue0 + 1)
  }
}
