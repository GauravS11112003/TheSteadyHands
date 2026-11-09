/**
 * GhostHandRig — poses a duplicated SIK skinned hand (…HandModel → …HandRig → wrist → finger
 * joints) from code (plain class; no HandVisual script, so tracking never drives it).
 *
 * Owns:
 *  - Reading the rest pose once (joint positions in model space, rest local rotations) and
 *    deriving anatomical axes per joint: flexion (curl toward the palm), abduction (about the
 *    palm normal) and the thumb's opposition roll — each expressed in the joint's parent frame,
 *    so a pose is just angles in degrees.
 *  - The hand frame (wrist origin; X = toward the fingers, Y = back of the hand) used to place
 *    the whole model relative to an instrument: placeModel(targetPose) puts the wrist frame there.
 * Must not: animate on its own — the controller calls apply()/placeModel() every frame.
 */
import {Pose, basisQuat} from "./GhostMath"

export interface FingerPose {
  /** Abduction at the MCP (deg, + toward the thumb side). */
  spread: number
  mcp: number
  pip: number
  dip: number
}

export interface ThumbPose {
  /** CMC: + = palmar abduction (away from the palm plane). */
  abd: number
  /** CMC: + = flex across the palm toward the little finger. */
  flex: number
  /** CMC: + = opposition roll (pronate the thumb toward the fingers). */
  roll: number
  mcp: number
  ip: number
}

export interface HandPose {
  thumb: ThumbPose
  index: FingerPose
  mid: FingerPose
  ring: FingerPose
  pinky: FingerPose
  /** Palmar cupping of the ring/little metacarpals (deg). */
  cup: number
}

export function fp(spread: number, mcp: number, pip: number, dip: number): FingerPose {
  return {spread, mcp, pip, dip}
}

export function lerpHandPose(a: HandPose, b: HandPose, t: number): HandPose {
  const L = (x: number, y: number) => x + (y - x) * t
  const F = (x: FingerPose, y: FingerPose): FingerPose => ({
    spread: L(x.spread, y.spread),
    mcp: L(x.mcp, y.mcp),
    pip: L(x.pip, y.pip),
    dip: L(x.dip, y.dip),
  })
  return {
    thumb: {
      abd: L(a.thumb.abd, b.thumb.abd),
      flex: L(a.thumb.flex, b.thumb.flex),
      roll: L(a.thumb.roll, b.thumb.roll),
      mcp: L(a.thumb.mcp, b.thumb.mcp),
      ip: L(a.thumb.ip, b.thumb.ip),
    },
    index: F(a.index, b.index),
    mid: F(a.mid, b.mid),
    ring: F(a.ring, b.ring),
    pinky: F(a.pinky, b.pinky),
    cup: L(a.cup, b.cup),
  }
}

interface JointInfo {
  so: SceneObject
  rest: quat
  /** Flexion axis in the parent's local frame. */
  flex: vec3
  /** Abduction axis (palm normal) in the parent's local frame. */
  abd: vec3
  /** Roll axis (bone direction) in the parent's local frame. */
  roll: vec3
}

const FINGERS = ["index", "mid", "ring", "pinky"]

export class GhostHandRig {
  readonly model: SceneObject
  readonly isRight: boolean
  readonly wrist: SceneObject
  /** Wrist frame in model space (X fingers, Y dorsal). */
  readonly handFrameModel: Pose
  private joints: Map<string, JointInfo> = new Map()
  private restModel: Map<string, vec3> = new Map()
  private byName: Map<string, SceneObject> = new Map()
  private scale = 1

  constructor(model: SceneObject, isRight: boolean) {
    this.model = model
    this.isRight = isRight
    const all = new Map<string, SceneObject>()
    collect(model, all)
    this.byName = all
    this.wrist = all.get("wrist")
    this.bindSkin(all)
    const inv = model.getTransform().getInvertedWorldTransform()
    const mp = (name: string): vec3 => {
      const so = all.get(name)
      return so ? inv.multiplyPoint(so.getTransform().getWorldPosition()) : vec3.zero()
    }
    for (const [name] of all) this.restModel.set(name, mp(name))
    const w = mp("wrist")
    const idx0 = mp("index-0")
    const pin0 = mp("pinky-0")
    const mid0 = mp("mid-0")
    // Palm normal (direction the palm faces), in model space.
    let palm = idx0.sub(w).cross(pin0.sub(w)).normalize()
    if (!isRight) palm = palm.uniformScale(-1)
    const fwd = mid0.sub(w).normalize()
    this.handFrameModel = new Pose(w, basisQuat(fwd, palm.uniformScale(-1)))

    const modelRot = model.getTransform().getWorldRotation()
    const toParentLocal = (so: SceneObject, dirModel: vec3): vec3 => {
      const worldDir = modelRot.multiplyVec3(dirModel)
      const parent = so.getParent()
      const pr = parent ? parent.getTransform().getWorldRotation() : quat.quatIdentity()
      return pr.invert().multiplyVec3(worldDir).normalize()
    }
    const add = (name: string, flexModel: vec3, abdModel: vec3, rollModel: vec3) => {
      const so = all.get(name)
      if (!so) return
      this.joints.set(name, {
        so,
        rest: so.getTransform().getLocalRotation(),
        flex: toParentLocal(so, flexModel),
        abd: toParentLocal(so, abdModel),
        roll: toParentLocal(so, rollModel),
      })
    }
    for (const f of FINGERS) {
      const p0 = mp(`${f}-0`)
      const p1 = mp(`${f}-1`)
      const d = p1.sub(p0).normalize()
      // Positive rotation about (d × palm) carries the bone toward the palm.
      const flex = d.cross(palm).normalize()
      // Positive abduction toward the thumb side: rotation about ±palm.
      const thumbSide = mp("thumb-0").sub(w)
      let abd = palm
      if (abd.cross(d).dot(thumbSide) < 0) abd = abd.uniformScale(-1)
      for (let j = 0; j <= 2; j++) add(`${f}-${j}`, flex, abd, d)
      add(`wrist_to_${f}`, fwd.cross(palm).normalize(), abd, fwd)
    }
    // Thumb: flex curls it across the palm; abduction lifts it out of the palm plane.
    const t0 = mp("thumb-0")
    const t1 = mp("thumb-1")
    const td = t1.sub(t0).normalize()
    // Flex direction: toward the little-finger side across the palm.
    const across = pin0.sub(idx0).normalize()
    let tflex = td.cross(across).normalize()
    if (tflex.cross(td).dot(across) < 0) tflex = tflex.uniformScale(-1)
    // Abduction: carries the thumb toward the palm normal (palmar abduction).
    let tabd = td.cross(palm).normalize()
    if (tabd.cross(td).dot(palm) < 0) tabd = tabd.uniformScale(-1)
    let troll = td
    if (!isRight) troll = troll.uniformScale(-1)
    add("thumb-0", tflex, tabd, troll)
    add("thumb-1", tflex, tabd, troll)
    add("thumb-2", tflex, tabd, troll)
  }

  /**
   * Make the duplicated Skin drive from the duplicated joints: a duplicated SIK hand model can
   * keep its skin bones pointing at the original (tracked) rig. Rebind every bone by name.
   */
  private bindSkin(all: Map<string, SceneObject>): void {
    const skin = this.model.getComponent("Component.Skin") as Skin
    if (!skin) {
      print(`[GhostHandRig] ${this.model.name}: no Skin component`)
      return
    }
    let names: string[] = []
    try {
      names = skin.getSkinBoneNames()
    } catch (e) {
      print(`[GhostHandRig] ${this.model.name}: getSkinBoneNames failed: ${e}`)
      return
    }
    let rebound = 0
    let missing = 0
    let foreign = 0
    for (const n of names) {
      const mine = all.get(n)
      if (!mine) {
        missing++
        continue
      }
      let cur: SceneObject | null = null
      try {
        cur = skin.getSkinBone(n)
      } catch (e) {
        cur = null
      }
      if (!cur || !cur.isSame(mine)) {
        if (cur) foreign++
        skin.setSkinBone(n, mine)
        rebound++
      }
    }
    if (rebound > 0) {
      print(`[GhostHandRig] ${this.model.name}: rebound ${rebound}/${names.length} skin bones to the duplicated rig (${foreign} pointed elsewhere)`)
    }
  }

  setScale(s: number): void {
    this.scale = s
    this.model.getTransform().setLocalScale(new vec3(s, s, s))
  }

  /** Rest position of a joint in model space (unscaled). */
  restPoint(name: string): vec3 {
    return this.restModel.get(name) ?? vec3.zero()
  }

  apply(pose: HandPose): void {
    const R = (deg: number) => (deg * Math.PI) / 180
    const set = (name: string, flexDeg: number, abdDeg: number = 0, rollDeg: number = 0) => {
      const j = this.joints.get(name)
      if (!j) return
      let q = j.rest
      if (rollDeg !== 0) q = quat.angleAxis(R(rollDeg), j.roll).multiply(q)
      if (abdDeg !== 0) q = quat.angleAxis(R(abdDeg), j.abd).multiply(q)
      if (flexDeg !== 0) q = quat.angleAxis(R(flexDeg), j.flex).multiply(q)
      j.so.getTransform().setLocalRotation(q)
    }
    const fingers: [string, FingerPose][] = [
      ["index", pose.index],
      ["mid", pose.mid],
      ["ring", pose.ring],
      ["pinky", pose.pinky],
    ]
    for (const [f, p] of fingers) {
      set(`${f}-0`, p.mcp, p.spread)
      set(`${f}-1`, p.pip)
      set(`${f}-2`, p.dip)
    }
    set("wrist_to_ring", pose.cup * 0.5)
    set("wrist_to_pinky", pose.cup)
    set("thumb-0", pose.thumb.flex, pose.thumb.abd, pose.thumb.roll)
    set("thumb-1", pose.thumb.mcp)
    set("thumb-2", pose.thumb.ip)
  }

  /**
   * Place the model (its local transform, relative to its parent) so `frame` (a frame in model
   * space, unscaled; default = the wrist frame) lands on `target` (in the parent's space).
   */
  placeModel(target: Pose, frame: Pose = this.handFrameModel): void {
    const qRoot = target.q.multiply(frame.q.invert())
    const pRoot = target.p.sub(qRoot.multiplyVec3(frame.p.uniformScale(this.scale)))
    const tr = this.model.getTransform()
    tr.setLocalRotation(qRoot)
    tr.setLocalPosition(pRoot)
  }

  /**
   * Direction in the hand's cross-section (model space): 0° = dorsal (back of the hand),
   * 90° = radial (thumb side), 180° = palmar.
   */
  crossDir(deg: number): vec3 {
    const dorsal = this.handFrameModel.q.multiplyVec3(vec3.up())
    const z = this.handFrameModel.q.multiplyVec3(vec3.forward())
    const radial = this.isRight ? z.uniformScale(-1) : z
    const a = (deg * Math.PI) / 180
    return dorsal.uniformScale(Math.cos(a)).add(radial.uniformScale(Math.sin(a)))
  }

  /** Thumb pad / finger pad landmarks in model space (unscaled) for the current pose. */
  thumbPad(t: number = 0.75): vec3 {
    return vec3.lerp(this.posedPoint("thumb-2"), this.posedPoint("thumb-3"), t)
  }

  fingerPad(finger: string): vec3 {
    return vec3.lerp(this.posedPoint(`${finger}-2`), this.posedPoint(`${finger}-3`), 0.6)
  }

  /**
   * Solve the thumb (CMC abd/flex/roll, MCP, IP) so its pad sits `gapCm` from the given finger's
   * pad (a pinch), staying close to the starting thumb angles. Returns the solved pose.
   */
  solveThumbPinch(pose: HandPose, finger: string, gapCm: number): HandPose {
    const target = gapCm / Math.max(1e-3, this.scale)
    const p: HandPose = lerpHandPose(pose, pose, 0)
    const keys: (keyof ThumbPose)[] = ["abd", "flex", "roll", "mcp", "ip"]
    const lo: ThumbPose = {abd: -25, flex: -25, roll: -40, mcp: -10, ip: -10}
    const hi: ThumbPose = {abd: 85, flex: 75, roll: 95, mcp: 60, ip: 75}
    const cost = (): number => {
      this.apply(p)
      let c = Math.abs(this.thumbPad().distance(this.fingerPad(finger)) - target)
      for (const k of keys) {
        const d = p.thumb[k] - pose.thumb[k]
        c += 0.0004 * d * d
      }
      return c
    }
    let best = cost()
    for (const step of [16, 8, 4, 2, 1]) {
      for (let iter = 0; iter < 25; iter++) {
        let improved = false
        for (const k of keys) {
          for (const dir of [1, -1]) {
            const old = p.thumb[k]
            p.thumb[k] = Math.max(lo[k], Math.min(hi[k], old + dir * step))
            const c = cost()
            if (c < best - 1e-5) {
              best = c
              improved = true
            } else {
              p.thumb[k] = old
            }
          }
        }
        if (!improved) break
      }
    }
    this.apply(p)
    return p
  }

  /**
   * Curl one finger (MCP/PIP/DIP coupled) until its pad comes within `gapCm` of the segment a–b
   * (model space, unscaled) — the finger wraps an instrument shaft. Returns the updated pose.
   */
  solveFingerWrap(pose: HandPose, finger: "index" | "mid" | "ring" | "pinky", a: vec3, b: vec3, gapCm: number, maxCurl: number = 100): HandPose {
    const gap = gapCm / Math.max(1e-3, this.scale)
    const p: HandPose = lerpHandPose(pose, pose, 0)
    const spread = pose[finger].spread
    let bestC = 0
    let bestD = Infinity
    for (let c = 0; c <= maxCurl; c += 2) {
      p[finger] = fp(spread, c, c * 1.1, c * 0.55)
      this.apply(p)
      const d = distToSegment(this.fingerPad(finger), a, b)
      if (d <= gap) {
        bestC = c
        bestD = d
        break
      }
      if (d < bestD) {
        bestD = d
        bestC = c
      }
    }
    p[finger] = fp(spread, bestC, bestC * 1.1, bestC * 0.55)
    this.apply(p)
    return p
  }

  /** Solve the thumb so its pad sits `gapCm` from a model-space point (rests on a shaft). */
  solveThumbTo(pose: HandPose, target: vec3, gapCm: number, padT: number = 0.75): HandPose {
    const gap = gapCm / Math.max(1e-3, this.scale)
    const p: HandPose = lerpHandPose(pose, pose, 0)
    const keys: (keyof ThumbPose)[] = ["abd", "flex", "roll", "mcp", "ip"]
    const lo: ThumbPose = {abd: -25, flex: -25, roll: -40, mcp: -10, ip: -10}
    const hi: ThumbPose = {abd: 85, flex: 75, roll: 95, mcp: 60, ip: 75}
    const cost = (): number => {
      this.apply(p)
      let c = Math.abs(this.thumbPad(padT).distance(target) - gap)
      for (const k of keys) {
        const d = p.thumb[k] - pose.thumb[k]
        c += 0.0004 * d * d
      }
      return c
    }
    let best = cost()
    for (const step of [16, 8, 4, 2, 1]) {
      for (let iter = 0; iter < 25; iter++) {
        let improved = false
        for (const k of keys) {
          for (const dir of [1, -1]) {
            const old = p.thumb[k]
            p.thumb[k] = Math.max(lo[k], Math.min(hi[k], old + dir * step))
            const c = cost()
            if (c < best - 1e-5) {
              best = c
              improved = true
            } else {
              p.thumb[k] = old
            }
          }
        }
        if (!improved) break
      }
    }
    this.apply(p)
    return p
  }

  /** Model-root pose (in the parent space) that puts the wrist frame on `target`. */
  rootPoseForWrist(target: Pose): Pose {
    const qRoot = target.q.multiply(this.handFrameModel.q.invert())
    const pRoot = target.p.sub(qRoot.multiplyVec3(this.handFrameModel.p.uniformScale(this.scale)))
    return new Pose(pRoot, qRoot)
  }

  /** Map a point from the root's parent space into model space (unscaled) for a given root pose. */
  toModel(root: Pose, p: vec3): vec3 {
    return root.q.invert().multiplyVec3(p.sub(root.p)).uniformScale(1 / Math.max(1e-3, this.scale))
  }

  /** Current (posed) position of a joint in model space, unscaled. */
  posedPoint(name: string): vec3 {
    const so = this.findJoint(name)
    if (!so) return vec3.zero()
    return this.model.getTransform().getInvertedWorldTransform().multiplyPoint(so.getTransform().getWorldPosition())
  }

  private findJoint(name: string): SceneObject | null {
    return this.byName.get(name) ?? null
  }

  /** Where a rest-pose model point (e.g. a palm landmark) lands for a given wrist target. */
  modelPointAt(target: Pose, modelPoint: vec3): vec3 {
    const qRoot = target.q.multiply(this.handFrameModel.q.invert())
    const pRoot = target.p.sub(qRoot.multiplyVec3(this.handFrameModel.p.uniformScale(this.scale)))
    return pRoot.add(qRoot.multiplyVec3(modelPoint.uniformScale(this.scale)))
  }
}

function distToSegment(p: vec3, a: vec3, b: vec3): number {
  const ab = b.sub(a)
  const len2 = Math.max(1e-8, ab.dot(ab))
  const t = Math.max(0, Math.min(1, p.sub(a).dot(ab) / len2))
  return p.distance(a.add(ab.uniformScale(t)))
}

function collect(so: SceneObject, out: Map<string, SceneObject>): void {
  if (!out.has(so.name)) out.set(so.name, so)
  for (let i = 0; i < so.getChildrenCount(); i++) collect(so.getChild(i), out)
}
