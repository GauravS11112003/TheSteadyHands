/**
 * IK reachability — drives LEAF's IK body interactor (Bitmoji arm + head) the way a standing user
 * would, and reports whether each target is reached directly (arm) or by far-field ray, plus any
 * LEAF reach diagnostics. LEAF fails the scenario if an error-severity diagnostic fires.
 *
 * Parameters (per registered id):
 *   part = "rehearse-and-pad"  needle drag (right hand), Ready to close (left), pad pinch (right)
 *          "closing-controls"  Ready to close (left), real aimed pinches on the cut ends,
 *                              then + + − Close (left) → 1 missing, − Close → Closed
 *   id   = scenario id used in the evidence log
 */
import {DiagnosticRecorder} from "Leaf.lspkg/Diagnostic/DiagnosticRecorder"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {createIKInteractor} from "Leaf.lspkg/Interactors/interactor/ik/visualizer/BitmojiAvatar"
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {withTimeout} from "Leaf.lspkg/Utils/common/Utils"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {Evidence, fmtV, getMain, mustFind, sleep, waitFor} from "./SteadyHandsLeafHelpers"
import {SteadyHandsLeafInteractor, waitInteractable} from "./SteadyHandsLeafInteractor"

@component
export class SteadyHandsIKReachScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const part = config?.get("part") ?? "rehearse-and-pad"
    const ev = new Evidence(config?.get("id") ?? `ik-reach-${part}`)
    const T = "real-input"
    const main = getMain()
    ev.noteEye()
    const ik = createIKInteractor()
    const rec = DiagnosticRecorder.getInstance()
    try {
      await withTimeout(ik.ready, 20000, "IK avatar not ready after 20 s")
      ev.note("IK avatar ready")
    } catch (e) {
      ev.note(`${e} — continuing with the IK arms only`)
    }

    const find = (name: string): Interactable => {
      const it = findInteractableByName(name, undefined, true)
      if (!it) throw new Error(`Interactable "${name}" not found or not enabled`)
      return it
    }
    const head = mustFind("Camera Object").getTransform().getWorldPosition()
    const ikTrigger = async (name: string, hand: "left" | "right") => {
      const it = await waitInteractable(name)
      const n0 = rec.getAll().length
      const indirect = ik[hand].isIndirect(it)
      const dist = it.getTransform().getWorldPosition().distance(head)
      await withTimeout(ik.trigger(it, hand), 20000, `IK trigger on ${name} timed out`)
      const fresh = rec.getAll().slice(n0).map((e) => `${e.diagnostic.severity}:${e.diagnostic.category}`)
      ev.note(`IK ${hand} trigger "${name}": route=${indirect ? "far-field ray (beyond arm reach)" : "direct (arm reach)"} eyeDist=${dist.toFixed(1)}cm diagnostics=[${fresh.join(", ")}]`)
      await sleep(250)
    }

    if (part === "control") {
      // Harness control: a temporary 4 cm Interactable at a comfortable right-hand spot (runtime only).
      const probe = global.scene.createSceneObject("LeafIKProbe")
      probe.getTransform().setWorldPosition(new vec3(15, -35, -35))
      const col = probe.createComponent("Physics.ColliderComponent") as ColliderComponent
      const box = Shape.createBoxShape()
      box.size = new vec3(4, 4, 4)
      col.shape = box
      col.fitVisual = false
      const it = probe.createComponent(Interactable.getTypeName()) as Interactable
      let started = 0
      let hovered = 0
      await sleep(300)
      it.onHoverEnter.add(() => hovered++)
      it.onTriggerStart.add(() => started++)
      const n0 = rec.getAll().length
      const indirect = ik.right.isIndirect(it)
      try {
        await withTimeout(ik.trigger(it, "right"), 20000, "IK trigger on probe timed out")
      } catch (e) {
        ev.note(`${e}`)
      }
      const fresh = rec.getAll().slice(n0).map((e) => `${e.diagnostic.severity}:${e.diagnostic.category}`)
      ev.note(`IK right trigger on control probe at (15,-35,-35): route=${indirect ? "far-field" : "direct"} hovers=${hovered} triggerStarts=${started} diagnostics=[${fresh.join(", ")}]`)
      probe.destroy()
      ev.truthy(T, "IK harness can hover + trigger a plain 4 cm Interactable within easy reach", hovered > 0 && started > 0, `hovers=${hovered} triggers=${started}`)
      return
    }

    if (part === "rehearse-and-pad") {
      await waitFor("practice needle live", () => main.phase === "rehearse" && main.crossSection.practiceEnabled, 15000)
      const needle = find("PracticeNeedle")
      const n0 = rec.getAll().length
      const a0 = main.practiceAttempts
      const indirect = ik.right.isIndirect(needle)
      const right = main.crossSection.getSceneObject().getTransform().right
      let dragErr = ""
      try {
        await withTimeout(ik.drag(needle, right.uniformScale(3.0), "right"), 25000, "IK drag on PracticeNeedle timed out")
      } catch (e) {
        dragErr = `${e}`
      }
      try {
        await waitFor("IK drag scored", () => main.practiceAttempts > a0, 3000)
      } catch (e) {
        dragErr += ` | ${e}`
      }
      const fresh = rec.getAll().slice(n0).map((e) => `${e.diagnostic.severity}:${e.diagnostic.category}`)
      ev.note(
        `IK right drag "PracticeNeedle": route=${indirect ? "far-field ray" : "direct"} attempts=${main.practiceAttempts - a0} result=${main.practiceResult} dev=${main.lastStitchDeviationMm.toFixed(2)}mm angle=${main.lastStitchEntryAngleDeg.toFixed(1)}deg reason="${main.lastStitchReason}" diagnostics=[${fresh.join(", ")}]${dragErr ? " error=" + dragErr : ""}`,
      )
      ev.truthy(T, "IK drag grabbed the needle and produced a scored attempt", main.practiceAttempts > a0, dragErr)

      if (main.phase === "rehearse") {
        await waitFor("Ready to close live", () => mustFind("ReadyToCloseButton").isEnabledInHierarchy, 3000)
        await ikTrigger("ReadyToCloseButton", "left")
      }
      await waitFor("phase = mark", () => main.phase === "mark", 3000)
      ev.eq(T, "IK Ready to close: rehearseEndReason", main.rehearseEndReason, main.practiceResult === "pass" ? "stitch" : "skip")

      await ikTrigger("SuturePad", "right")
      await waitFor("IK pad pinch registered", () => main.pinchCount === 1, 2000)
      const padT = mustFind("SuturePad").getTransform()
      const a = padT.getInvertedWorldTransform().multiplyPoint(mustFind("PinchMarker_A").getTransform().getWorldPosition())
      ev.note(`IK pad pinch landed at pad-local ${fmtV(a)}`)
      ev.eq(T, "IK pad pinch registered as the first end", main.pinchCount, 1)
    } else {
      await waitFor("Ready to close live", () => main.phase === "rehearse" && mustFind("ReadyToCloseButton").isEnabledInHierarchy, 8000)
      await ikTrigger("ReadyToCloseButton", "left")
      await waitFor("phase = mark", () => main.phase === "mark", 3000)
      const ix = new SteadyHandsLeafInteractor()
      await ix.pinchAt(ix.findEnabled("SuturePad"), mustFind("CutEnd_Left").getTransform().getWorldPosition())
      await ix.pinchAt(ix.findEnabled("SuturePad"), mustFind("CutEnd_Right").getTransform().getWorldPosition())
      await waitFor("phase = close", () => main.phase === "close", 2000)
      await sleep(400)
      await ikTrigger("NeedlePlusButton", "left")
      await ikTrigger("NeedlePlusButton", "left")
      await ikTrigger("NeedleMinusButton", "left")
      ev.eq(T, "IK + + −: needlesOut", main.needlesOut, 1)
      await ikTrigger("CloseButton", "left")
      ev.eq(T, "IK Close with 1 out: alert", main.controls.alertDisplay, "1 missing")
      await ikTrigger("NeedleMinusButton", "left")
      await ikTrigger("CloseButton", "left")
      ev.eq(T, "IK Close at zero: isClosed", main.isClosed, true)
    }
    const report = rec.toReport()
    ev.note(`LEAF diagnostic report: ${report.length > 0 ? report.replace(/\n/g, " | ") : "(none)"}`)
    ev.eq(T, "no error-severity reach diagnostics", rec.hasErrors(), false)
  }
}
