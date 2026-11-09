/**
 * LeafIndex — registers The Steady Hands LEAF scenarios (one or more per done criterion).
 * Ids are prefixed with the done criterion they cover (c1…c5); "ik-" ids are reachability checks.
 * "method" ids drive the controller directly and are controls for the real-input ids.
 */
import {scenariosIndex} from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import {ScenarioMetadata} from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import {SteadyHandsC1GhostDemoScenario} from "./SteadyHandsC1GhostDemoScenario"
import {SteadyHandsC2DragScenario} from "./SteadyHandsC2DragScenario"
import {SteadyHandsC2MethodScenario} from "./SteadyHandsC2MethodScenario"
import {SteadyHandsC2RedDragScenario} from "./SteadyHandsC2RedDragScenario"
import {SteadyHandsC2SkipScenario} from "./SteadyHandsC2SkipScenario"
import {SteadyHandsC3MarkScenario} from "./SteadyHandsC3MarkScenario"
import {SteadyHandsC3MethodScenario} from "./SteadyHandsC3MethodScenario"
import {SteadyHandsC3PinchGuardScenario} from "./SteadyHandsC3PinchGuardScenario"
import {SteadyHandsC4C5MethodScenario} from "./SteadyHandsC4C5MethodScenario"
import {SteadyHandsC4MissingNeedleScenario} from "./SteadyHandsC4MissingNeedleScenario"
import {SteadyHandsC5CloseScenario} from "./SteadyHandsC5CloseScenario"
import {SteadyHandsIKReachScenario} from "./SteadyHandsIKReachScenario"

const drag = (id: string, shape: string, amount: string, expect: string): ScenarioMetadata => ({
  id,
  typename: SteadyHandsC2DragScenario.getTypeName(),
  parameters: {shape, amount, expect, id},
})

@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    // 1 — ghost demo + 3× cross-section
    {id: "c1-ghost-stitch-and-cross-section", typename: SteadyHandsC1GhostDemoScenario.getTypeName()},

    // 2 — practice stitch (real-input drags), skip button, method control
    drag("c2-green-drag-ideal-arc", "ideal", "0", "pass"),
    drag("c2-green-drag-1.2mm-off-arc", "bulge", "1.2", "pass"),
    drag("c2-red-drag-1.8mm-off-arc", "bulge", "1.8", "fail"),
    drag("c2-green-drag-entry-78deg", "angle", "78", "pass"),
    drag("c2-red-drag-entry-70deg", "angle", "70", "fail"),
    {id: "c2-red-stitch-straight-drags", typename: SteadyHandsC2RedDragScenario.getTypeName()},
    {id: "c2-skip-ready-to-close-button", typename: SteadyHandsC2SkipScenario.getTypeName()},
    {id: "c2-method-score-and-submit", typename: SteadyHandsC2MethodScenario.getTypeName()},

    // 3 — marking (real-input pinches), guard, method control
    {
      id: "c3-mark-6cm-cut-ends",
      typename: SteadyHandsC3MarkScenario.getTypeName(),
      parameters: {ends: "anchors", length: "6.0", count: "11", label: "6.0 cm → 11 sutures", id: "c3-mark-6cm-cut-ends"},
    },
    {
      id: "c3-mark-3cm",
      typename: SteadyHandsC3MarkScenario.getTypeName(),
      parameters: {ends: "-1.5,0,1.5,0", length: "3.0", count: "5", label: "3.0 cm → 5 sutures", id: "c3-mark-3cm"},
    },
    {id: "c3-pad-pinch-guard-and-stock-trigger", typename: SteadyHandsC3PinchGuardScenario.getTypeName()},
    {id: "c3-method-mark-6cm-and-3cm", typename: SteadyHandsC3MethodScenario.getTypeName()},

    // 4 + 5 — needle counter and Close (real-input buttons), method control
    {id: "c4-plus-plus-minus-close-1-missing", typename: SteadyHandsC4MissingNeedleScenario.getTypeName()},
    {
      id: "c5-close-at-zero-direct",
      typename: SteadyHandsC5CloseScenario.getTypeName(),
      parameters: {path: "direct", id: "c5-close-at-zero-direct"},
    },
    {
      id: "c5-close-at-zero-after-1-missing",
      typename: SteadyHandsC5CloseScenario.getTypeName(),
      parameters: {path: "after-missing", id: "c5-close-at-zero-after-1-missing"},
    },
    {id: "c4c5-method-needles-and-close", typename: SteadyHandsC4C5MethodScenario.getTypeName()},

    // IK reachability (standing user, LEAF IK arm)
    {
      id: "ik-reach-needle-ready-pad",
      typename: SteadyHandsIKReachScenario.getTypeName(),
      parameters: {part: "rehearse-and-pad", id: "ik-reach-needle-ready-pad"},
    },
    {
      id: "ik-harness-control-probe",
      typename: SteadyHandsIKReachScenario.getTypeName(),
      parameters: {part: "control", id: "ik-harness-control-probe"},
    },
    {
      id: "ik-reach-closing-controls",
      typename: SteadyHandsIKReachScenario.getTypeName(),
      parameters: {part: "closing-controls", id: "ik-reach-closing-controls"},
    },
  ]
}
