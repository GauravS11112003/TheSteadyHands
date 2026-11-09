/**
 * SteadyHandsSceneContracts — stable names of authored SceneObjects and generated assets.
 *
 * Owns: the strings tests (LEAF) and future agents use to find things. Renaming an authored
 * object in the scene means updating it here too. Holds no logic and no scene access.
 */
export const SceneNames = {
  /** Root with SteadyHandsMain (the flow controller + readable state). */
  main: "SteadyHands",
  /** The one movable root for the whole surgical field (pad centre on the table top). */
  field: "SurgicalField",
  table: "VirtualTable",
  /** Pinch target: the suture pad (SIK Interactable, pinch lands on its top surface). */
  pad: "SuturePad",
  cutEndLeft: "CutEnd_Left",
  cutEndRight: "CutEnd_Right",
  crossSection: "CrossSection",
  /** Drag target: the practice needle on the 3x cross-section (2 cm grab zone). */
  practiceNeedle: "PracticeNeedle",
  ghostDriver: "GhostHand_Driver",
  ghostForceps: "GhostHand_Forceps",
  controls: "ClosingControls",
  /** UIKit buttons (findable as SIK Interactables by these SceneObject names). */
  readyToCloseButton: "ReadyToCloseButton",
  plusButton: "NeedlePlusButton",
  minusButton: "NeedleMinusButton",
  closeButton: "CloseButton",
  padLabels: "PadLabels",
} as const

export const AssetPaths = {
  ghostDriverGlb: "GeneratedMeshes/GhostHandDriver.glb",
  ghostForcepsGlb: "GeneratedMeshes/GhostHandForceps.glb",
  sfx: [
    "GeneratedSFX/ButtonClick.wav",
    "GeneratedSFX/PinchMark.wav",
    "GeneratedSFX/StitchGood.wav",
    "GeneratedSFX/StitchMiss.wav",
    "GeneratedSFX/MismatchChime.wav",
    "GeneratedSFX/ClosedChime.wav",
  ],
  icons: ["Icons/add.png", "Icons/remove.png", "Icons/check_circle.png", "Icons/skip_next.png", "Icons/warning.png"],
} as const

/** Pad-local cut ends (cm from pad centre): the drawn 6.0 cm incision runs left → right. */
export const CUT_HALF_LENGTH_CM = 3.0
