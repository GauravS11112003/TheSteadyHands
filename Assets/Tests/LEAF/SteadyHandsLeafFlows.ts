/**
 * SteadyHandsLeafFlows — multi-step REAL-INPUT flows shared by several scenarios.
 */
import {SteadyHandsMain} from "../../Scripts/SteadyHandsMain"
import {Evidence, Tag, mustFind, waitFor} from "./SteadyHandsLeafHelpers"
import {SteadyHandsLeafInteractor} from "./SteadyHandsLeafInteractor"

/** Pinch "Ready to close", then pinch the pad at CutEnd_Left and CutEnd_Right → Close step. */
export async function reachCloseWithRealInput(
  ix: SteadyHandsLeafInteractor,
  main: SteadyHandsMain,
  ev: Evidence,
  tag: Tag = "real-input",
): Promise<void> {
  if (main.phase !== "mark") {
    await waitFor(
      "Ready to close live",
      () => main.phase === "rehearse" && mustFind("ReadyToCloseButton").isEnabledInHierarchy,
      8000,
    )
    await ix.tapButton("ReadyToCloseButton")
    await waitFor("phase = mark", () => main.phase === "mark", 2000)
  } else {
    ev.note("setup: already in the mark phase (Rehearse ended by a passing stitch); skipping Ready to close")
  }
  const pad = ix.findEnabled("SuturePad")
  await ix.pinchAt(pad, mustFind("CutEnd_Left").getTransform().getWorldPosition())
  await ix.pinchAt(ix.findEnabled("SuturePad"), mustFind("CutEnd_Right").getTransform().getWorldPosition())
  await waitFor("phase = close", () => main.phase === "close", 2000)
  ev.eq(tag, "setup: marked 6.0 cm → 11 sutures", main.countLabelText, "6.0 cm → 11 sutures")
  ev.eq(tag, "setup: 11 bite marks", main.biteMarkCount, 11)
  ev.eq(tag, "setup: needle counter shown", mustFind("NeedleCounter").isEnabledInHierarchy, true)
}

/** Tap a closing-control button and wait until the needle count reads `expect`. */
export async function tapAndExpectCount(
  ix: SteadyHandsLeafInteractor,
  main: SteadyHandsMain,
  ev: Evidence,
  button: string,
  expect: number,
  tag: Tag = "real-input",
): Promise<void> {
  await ix.tapButton(button)
  await waitFor(`${button} → needlesOut ${expect}`, () => main.needlesOut === expect, 1500)
  ev.eq(tag, `${button}: needlesOut`, main.needlesOut, expect)
  ev.eq(tag, `${button}: big count reads`, main.controls.countDisplay, `${expect}`)
}
