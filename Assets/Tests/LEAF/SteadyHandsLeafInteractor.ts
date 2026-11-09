/**
 * SteadyHandsLeafInteractor — LEAF test interactor for The Steady Hands.
 *
 * Drives the REAL SIK input path (Interactable hover → onTriggerStart → onTriggerEnd), exactly
 * like LEAF's DefaultLeafInteractor, but lets a test aim the interactor ray at an exact world
 * point instead of the target's centre. Everything the Lens reads comes through the SIK
 * Interactor it is handed in the event (startPoint / direction / targetHitInfo):
 *  - tapButton(name)                    stock LEAF trigger on a UI Kit button (SceneObject name).
 *  - pinchAt(target, worldPoint)        ray from the eye through worldPoint; a physics ray cast
 *                                       against the target supplies targetHitInfo.hit.position.
 *  - sweepDrag(target, grab, points)    pinch with the ray through `grab`, sweep the ray through
 *                                       `points` (one per frame), release — a hand ray moving
 *                                       across the 3x cross-section.
 *
 * Test-only. Does not modify LEAF or the Lens; extends DefaultLeafInteractor's protected state.
 */
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {makeEventPromise, nextFrame, sleep, withTimeout} from "Leaf.lspkg/Utils/common/Utils"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"

const STEP_TIMEOUT_MS = 4000

/** Wait until a named Interactable exists, is enabled in the hierarchy and has a collider. */
export async function waitInteractable(name: string, timeoutMs: number = 3000): Promise<Interactable> {
  const t0 = getTime()
  for (;;) {
    const it = findInteractableByName(name, undefined, true)
    if (it && it.colliders.length > 0) return it
    if ((getTime() - t0) * 1000 > timeoutMs) {
      throw new Error(`Interactable "${name}" not live (enabled + collider) after ${timeoutMs} ms`)
    }
    await nextFrame()
  }
}

function isUnder(so: SceneObject | null, root: SceneObject): boolean {
  let cur = so
  while (!isNull(cur)) {
    if (cur.isSame(root)) return true
    cur = cur.getParent()
  }
  return false
}

export class SteadyHandsLeafInteractor extends DefaultLeafInteractor {
  private eye = WorldCameraFinderProvider.getInstance()
  /** World point of the last physics hit on the target (null = ray missed it; Lens falls back to the ray). */
  lastHitWorld: vec3 | null = null
  /** Name of whatever the last aiming ray hit first (diagnostic). */
  lastHitName: string = ""

  constructor(name: string = "SteadyHandsLeafInteractor") {
    super(name)
  }

  findEnabled(name: string): Interactable {
    const it = findInteractableByName(name, undefined, true)
    if (!it) throw new Error(`Interactable "${name}" not found or not enabled`)
    return it
  }

  /** Stock LEAF trigger (hover → select → release) on a named UI Kit button. */
  async tapButton(name: string): Promise<void> {
    const b = await waitInteractable(name)
    await withTimeout(this.trigger(b), 6000, `tap "${name}" timed out`)
    await sleep(150)
  }

  /** Point the interactor ray from the eye through `worldPoint`, targeting `target`. */
  private aimAt(target: Interactable, worldPoint: vec3): Promise<void> {
    this.overrideInteractable = target
    const origin = this.eye.getWorldPosition()
    this.startPoint = origin
    this.endPoint = worldPoint
    ;(this as any).raycastHit = null
    this.lastHitWorld = null
    this.lastHitName = ""
    const dir = worldPoint.sub(origin).normalize()
    const far = worldPoint.add(dir.uniformScale(3))
    const targetSo = target.getSceneObject()
    return new Promise<void>((resolve) => {
      Physics.createGlobalProbe().rayCast(origin, far, (hit) => {
        if (!isNull(hit) && !isNull(hit.collider)) {
          const hitSo = hit.collider.getSceneObject()
          this.lastHitName = hitSo.name
          if (isUnder(hitSo, targetSo)) {
            ;(this as any).raycastHit = hit
            this.endPoint = hit.position
            this.lastHitWorld = hit.position
          }
        }
        resolve()
      })
    })
  }

  private async hoverAt(target: Interactable, worldPoint: vec3): Promise<void> {
    const [hover, cancelHover] = makeEventPromise(target.onHoverEnter)
    try {
      await withTimeout(this.aimAt(target, worldPoint), STEP_TIMEOUT_MS, "aiming ray cast never returned")
      await withTimeout(hover, STEP_TIMEOUT_MS, `hover on "${target.getSceneObject().name}" never entered`)
    } finally {
      cancelHover()
    }
  }

  private async safeExitHover(): Promise<void> {
    try {
      await withTimeout(this.exitHover(), 1500, "hover exit not observed")
    } catch (e) {
      print(`[SH-LEAF][interactor][note] ${e}`)
      this.overrideInteractable = undefined
    }
  }

  /** Pinch `target` with the ray through `worldPoint` (real SIK trigger start/end). */
  async pinchAt(target: Interactable, worldPoint: vec3): Promise<void> {
    await this.hoverAt(target, worldPoint)
    await nextFrame()
    const [started, cancelStart] = makeEventPromise(target.onTriggerStart)
    this.startSelecting()
    try {
      await withTimeout(started, STEP_TIMEOUT_MS, `trigger start on "${target.getSceneObject().name}" never fired`)
    } finally {
      cancelStart()
    }
    await nextFrame()
    const [ended, cancelEnd] = makeEventPromise(target.onTriggerEnd)
    this.stopSelecting()
    try {
      await withTimeout(ended, STEP_TIMEOUT_MS, `trigger end on "${target.getSceneObject().name}" never fired`)
    } finally {
      cancelEnd()
    }
    await this.safeExitHover()
    await sleep(120)
  }

  /**
   * Pinch with the ray through `grabWorld`, then sweep the ray through `points` (world),
   * holding each for `framesPerPoint` frames, then release.
   */
  async sweepDrag(
    target: Interactable,
    grabWorld: vec3,
    points: vec3[],
    framesPerPoint: number = 1,
    holdEndFrames: number = 4,
  ): Promise<void> {
    await this.hoverAt(target, grabWorld)
    const eye = this.eye.getWorldPosition()
    // Aim at the grab point on the section plane itself, not the collider's front surface.
    this.startPoint = eye
    this.endPoint = grabWorld
    await nextFrame()
    const [started, cancelStart] = makeEventPromise(target.onTriggerStart)
    this.startSelecting()
    try {
      await withTimeout(started, STEP_TIMEOUT_MS, `trigger start on "${target.getSceneObject().name}" never fired`)
    } finally {
      cancelStart()
    }
    await nextFrame()
    for (const p of points) {
      this.startPoint = eye
      this.endPoint = p
      for (let k = 0; k < framesPerPoint; k++) await nextFrame()
    }
    for (let k = 0; k < holdEndFrames; k++) await nextFrame()
    const [ended, cancelEnd] = makeEventPromise(target.onTriggerEnd)
    const [endedOut, cancelEndOut] = makeEventPromise(target.onTriggerEndOutside)
    this.stopSelecting()
    try {
      await withTimeout(Promise.race([ended, endedOut]), STEP_TIMEOUT_MS, "drag release never fired")
    } finally {
      cancelEnd()
      cancelEndOut()
    }
    await this.safeExitHover()
  }
}
