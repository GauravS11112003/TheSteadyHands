/**
 * Done criterion 3 — "Pinching both ends of the 6.0 cm cut shows 11 bite marks and
 * '6.0 cm → 11 sutures'. Marking 3.0 cm shows 5."
 *
 * REAL INPUT: pinch "ReadyToCloseButton" (stock LEAF trigger) to reach Mark, then pinch the SIK
 * Interactable "SuturePad" twice with the interactor ray aimed from the eye through each end
 * point; a physics ray cast against the pad supplies the SIK hit the Lens reads.
 *
 * Parameters (per registered id):
 *   ends   = "anchors" (the authored CutEnd_Left / CutEnd_Right) or "x1,z1,x2,z2" (pad-local cm)
 *   length = expected marked length, cm
 *   count  = expected suture / bite count
 *   label  = expected count label
 *   id     = scenario id used in the evidence log
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {Evidence, fmtV, getMain, mustFind, padTopToWorld, textComp, textShowing, waitFor} from "./SteadyHandsLeafHelpers"
import {SteadyHandsLeafInteractor} from "./SteadyHandsLeafInteractor"

@component
export class SteadyHandsC3MarkScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const ends = config?.get("ends") ?? "anchors"
    const wantLen = parseFloat(config?.get("length") ?? "6.0")
    const wantCount = parseInt(config?.get("count") ?? "11")
    const wantLabel = config?.get("label") ?? "6.0 cm → 11 sutures"
    const ev = new Evidence(config?.get("id") ?? "c3-mark")
    const T = "real-input"
    const main = getMain()
    ev.noteEye()
    const ix = new SteadyHandsLeafInteractor()

    await waitFor("Ready to close live", () => main.phase === "rehearse" && mustFind("ReadyToCloseButton").isEnabledInHierarchy, 8000)
    await ix.tapButton("ReadyToCloseButton")
    await waitFor("phase = mark", () => main.phase === "mark", 2000)

    const padSo = mustFind("SuturePad")
    const padT = padSo.getTransform()
    let aW: vec3
    let bW: vec3
    if (ends === "anchors") {
      aW = mustFind("CutEnd_Left").getTransform().getWorldPosition()
      bW = mustFind("CutEnd_Right").getTransform().getWorldPosition()
    } else {
      const v = ends.split(",").map((s) => parseFloat(s))
      aW = padTopToWorld(main, v[0], v[1])
      bW = padTopToWorld(main, v[2], v[3])
    }
    const aL = padT.getInvertedWorldTransform().multiplyPoint(aW)
    const bL = padT.getInvertedWorldTransform().multiplyPoint(bW)
    ev.note(`aiming at A world=${fmtV(aW)} (pad-local ${fmtV(aL)}), B world=${fmtV(bW)} (pad-local ${fmtV(bL)})`)

    const pad = ix.findEnabled("SuturePad")
    await ix.pinchAt(pad, aW)
    ev.note(`pinch A ray hit "${ix.lastHitName}" at ${fmtV(ix.lastHitWorld)}`)
    ev.eq(T, "pinchCount after first pinch", main.pinchCount, 1)
    const mA = mustFind("PinchMarker_A")
    ev.eq(T, "pinch marker A shown", mA.isEnabledInHierarchy, true)
    const mAL = padT.getInvertedWorldTransform().multiplyPoint(mA.getTransform().getWorldPosition())
    ev.near(T, "marker A x lands on end A (pad-local cm)", mAL.x, aL.x, 0.05)
    ev.near(T, "marker A z lands on end A (pad-local cm)", mAL.z, aL.z, 0.05)
    ev.eq(T, "prompt still showing after the first pinch", textShowing(textComp("PromptText")), true)
    ev.eq(T, "no bite marks after one pinch", main.biteMarkCount, 0)

    await ix.pinchAt(pad, bW)
    ev.note(`pinch B ray hit "${ix.lastHitName}" at ${fmtV(ix.lastHitWorld)}`)
    ev.note(`state after marking: ${main.stateSummary()}`)
    ev.eq(T, "pinchCount after second pinch", main.pinchCount, 2)
    const mB = mustFind("PinchMarker_B")
    ev.eq(T, "pinch marker B shown", mB.isEnabledInHierarchy, true)
    const mBL = padT.getInvertedWorldTransform().multiplyPoint(mB.getTransform().getWorldPosition())
    ev.near(T, "marker B x lands on end B (pad-local cm)", mBL.x, bL.x, 0.05)
    ev.near(T, "marker B z lands on end B (pad-local cm)", mBL.z, bL.z, 0.05)

    ev.near(T, "markedLengthCm", main.markedLengthCm, wantLen, 0.02)
    ev.eq(T, "sutureCount", main.sutureCount, wantCount)
    ev.eq(T, "biteMarkCount", main.biteMarkCount, wantCount)
    ev.eq(T, "biteMarksVisible", main.biteMarksVisible, true)
    ev.eq(T, "countLabelText", main.countLabelText, wantLabel)

    // Visual state: the label on the pad, and the bite-mark objects themselves.
    const ct = textComp("SutureCountText")
    ev.truthy(T, "SutureCountText showing beside the wound", textShowing(ct))
    ev.eq(T, "SutureCountText label text", ct.text, wantLabel)
    ev.eq(T, "prompt hidden after the second pinch", textShowing(textComp("PromptText")), false)
    ev.eq(T, "promptVisible", main.promptVisible, false)

    const root = mustFind("BiteMarks")
    const bites: SceneObject[] = []
    for (let i = 0; i < root.getChildrenCount(); i++) {
      const c = root.getChild(i)
      if (c.name.indexOf("Bite_") === 0 && c.isEnabledInHierarchy) bites.push(c)
    }
    ev.eq(T, "Bite_* objects on the pad", bites.length, wantCount)

    // Geometry: evenly spaced along A→B, first/last one spacing in from each end, dots 5 mm either side.
    const ax = aL.x
    const az = aL.z
    const dx = bL.x - aL.x
    const dz = bL.z - aL.z
    const len = Math.sqrt(dx * dx + dz * dz)
    const ux = dx / len
    const uz = dz / len
    const along: number[] = []
    let maxSide = 0
    let minSide = Infinity
    let dotCount = 0
    for (const b of bites) {
      let near: vec3 | null = null
      let far: vec3 | null = null
      for (let k = 0; k < b.getChildrenCount(); k++) {
        const c = b.getChild(k)
        const w2l = padT.getInvertedWorldTransform()
        if (c.name === "DotNear") near = w2l.multiplyPoint(c.getTransform().getWorldPosition())
        if (c.name === "DotFar") far = w2l.multiplyPoint(c.getTransform().getWorldPosition())
      }
      if (!near || !far) continue
      dotCount += 2
      const cx = (near.x + far.x) / 2
      const cz = (near.z + far.z) / 2
      along.push((cx - ax) * ux + (cz - az) * uz)
      for (const d of [near, far]) {
        const side = Math.abs((d.x - ax) * -uz + (d.z - az) * ux)
        maxSide = Math.max(maxSide, side)
        minSide = Math.min(minSide, side)
      }
    }
    along.sort((p, q) => p - q)
    const spacing = len / (wantCount + 1)
    let maxGapErr = 0
    for (let i = 1; i < along.length; i++) maxGapErr = Math.max(maxGapErr, Math.abs(along[i] - along[i - 1] - spacing))
    ev.note(
      `bites along A→B (cm): ${along.map((v) => v.toFixed(3)).join(", ")}; side offsets ${minSide.toFixed(3)}..${maxSide.toFixed(3)} cm`,
    )
    ev.eq(T, "two glowing dots per bite", dotCount, wantCount * 2)
    ev.near(T, "first bite in from end A (cm)", along[0], spacing, 0.01)
    ev.near(T, "last bite in from end B (cm)", len - along[along.length - 1], spacing, 0.01)
    ev.between(T, "max deviation from even spacing (cm)", maxGapErr, 0, 0.01)
    ev.near(T, "dots 5 mm from the cut line (min, cm)", minSide, 0.5, 0.01)
    ev.near(T, "dots 5 mm from the cut line (max, cm)", maxSide, 0.5, 0.01)

    // Counter appears with the marks.
    ev.eq(T, "phase", main.phase, "close")
    ev.eq(T, "controls mode", main.controls.mode, "closing")
    ev.eq(T, "NeedleCounter shown", mustFind("NeedleCounter").isEnabledInHierarchy, true)
    ev.eq(T, "needle count display starts at 0", main.controls.countDisplay, "0")
  }
}
