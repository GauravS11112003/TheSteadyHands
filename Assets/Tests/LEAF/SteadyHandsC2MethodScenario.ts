/**
 * Done criterion 2 — METHOD-CALL control. Scores paths through the controller instead of input:
 * pure scoring at the tolerance edges (1.4 / 1.6 mm, 13° / 17°), then submitPracticePath()
 * straight (red) and ideal (green → Rehearse clears → prompt).
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {
  Evidence,
  V2,
  angledEntryPath,
  arcPath,
  getMain,
  mmToView,
  stitchGeometry,
  textComp,
  textShowing,
  waitFor,
} from "./SteadyHandsLeafHelpers"

const ID = "c2-method-score-and-submit"

function flat(path: V2[]): number[] {
  const out: number[] = []
  for (const p of path) out.push(p.x, p.y)
  return out
}

@component
export class SteadyHandsC2MethodScenario extends Scenario {
  async run(): Promise<void> {
    const ev = new Evidence(ID)
    const T = "method-call"
    const main = getMain()
    await waitFor("practice needle live", () => main.phase === "rehearse" && main.crossSection.practiceEnabled, 15000)
    const g = stitchGeometry(main)

    const show = (label: string, s: any) =>
      ev.note(`${label}: pass=${s.pass} dev=${s.maxDeviationMm.toFixed(3)} angle=${s.entryAngleDeg.toFixed(2)} endErr=${s.endErrorMm.toFixed(3)} reason=${s.reason}`)

    const ideal = main.scorePracticePath(main.idealPracticePath())
    show("idealPracticePath", ideal)
    ev.eq(T, "ideal arc scores green", ideal.pass, true)
    const straight = main.scorePracticePath(main.straightPracticePath())
    show("straightPracticePath", straight)
    ev.eq(T, "straight entry→exit scores red", straight.pass, false)

    const b14 = main.scorePracticePath(flat(arcPath(g, 60, mmToView(1.4, g))))
    show("bulge 1.4 mm", b14)
    ev.eq(T, "1.4 mm off the arc → green", b14.pass, true)
    const b16 = main.scorePracticePath(flat(arcPath(g, 60, mmToView(1.6, g))))
    show("bulge 1.6 mm", b16)
    ev.eq(T, "1.6 mm off the arc → red", b16.pass, false)
    ev.eq(T, "1.6 mm reason", b16.reason, "off the arc")

    const a77 = main.scorePracticePath(flat(angledEntryPath(g, 77, 50)))
    show("entry 77°", a77)
    ev.eq(T, "entry 13° off 90° → green", a77.pass, true)
    const a73 = main.scorePracticePath(flat(angledEntryPath(g, 73, 50)))
    show("entry 73°", a73)
    ev.eq(T, "entry 17° off 90° → red", a73.pass, false)
    ev.eq(T, "17° reason", a73.reason, "entry angle")

    const shortPath = main.scorePracticePath(flat(arcPath(g, 60).slice(0, 40)))
    show("stops 2/3 of the way", shortPath)
    ev.eq(T, "stopping short of the exit → red", shortPath.pass, false)
    ev.eq(T, "stopping short reason", shortPath.reason, "missed exit")

    // State path: straight → red, then ideal → green → Rehearse clears.
    main.submitPracticePath(main.straightPracticePath())
    ev.eq(T, "submit straight: practiceResult", main.practiceResult, "fail")
    ev.eq(T, "submit straight: phase", main.phase, "rehearse")
    await waitFor("needle reset", () => main.crossSection.practiceEnabled, 3000)
    main.submitPracticePath(main.idealPracticePath())
    ev.eq(T, "submit ideal: practiceResult", main.practiceResult, "pass")
    await waitFor("rehearse cleared", () => main.phase === "mark", 4000)
    ev.eq(T, "rehearseEndReason", main.rehearseEndReason, "stitch")
    ev.eq(T, "crossSectionVisible", main.crossSectionVisible, false)
    ev.eq(T, "promptVisible", main.promptVisible, true)
    ev.truthy(T, "PromptText showing", textShowing(textComp("PromptText")))
  }
}
