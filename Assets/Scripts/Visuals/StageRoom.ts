/**
 * StageRoom — the operating-room set around the stand-in (preview only; on device the real room).
 *
 * Owns: light seamless floor (field y = -90, contact shadow under the table baked in), pale surgical
 * green walls with a darker wainscot on three sides (the side behind the surgeon is open), a ceiling
 * with light panels, wall details (steel cabinets, X-ray viewer, clock, door), twin surgical lamps
 * on articulated arms high on the far side, a vitals monitor on a pole cart (ECG screen texture) and
 * an anaesthesia machine at the head end behind the ether screen.
 *
 * Expects: this SceneObject sits at the SurgicalField origin (identity, unit scale) — field frame.
 * Must not: own colliders or interaction, or change any light.
 */
import {MeshKit, RGBA, V3, add, addMeshObject, clamp, cross, dot, lerp, norm, scale, smoothstep, sub} from "./StageMeshKit"

const FLOOR_Y = -90
const CEIL_Y = 210
const X0 = -360
const X1 = 330
const Z_FAR = -320
const Z_NEAR = 240
const INCISION: V3 = [0, 1, 0]

function range(a: number, b: number, n: number): number[] {
  const out: number[] = []
  for (let k = 0; k <= n; k++) out.push(a + ((b - a) * k) / n)
  return out
}

/** Rotate v about unit axis k by angle (Rodrigues). */
function rotate(v: V3, k: V3, ang: number): V3 {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const kv = cross(k, v)
  const kd = dot(k, v) * (1 - c)
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd]
}

/** Rotation taking +Y to `up` (returns a function on vectors). */
function frameFromUp(up: V3): (v: V3) => V3 {
  const u = norm(up)
  const ax = cross([0, 1, 0], u)
  const l = Math.sqrt(dot(ax, ax))
  if (l < 1e-6) return u[1] > 0 ? (v) => v : (v) => [v[0], -v[1], -v[2]]
  const k = scale(ax, 1 / l)
  const ang = Math.acos(clamp(u[1], -1, 1))
  return (v) => rotate(v, k, ang)
}

@component
export class StageRoom extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">StageRoom – operating-room set (preview stand-in)</span>')
  @input
  @hint("Floor material (UberPBR, Vertex Color = Base Color, light grey, low roughness)")
  floorMaterial: Material
  @input
  @hint("Wall/ceiling/fixture material (UberPBR, Vertex Color = Base Color, white base)")
  wallMaterial: Material
  @input
  @hint("Unlit warm-white material for light panels and lamp faces")
  glowMaterial: Material
  @input
  @hint("Unlit textured material showing the vitals (ECG) screen")
  screenMaterial: Material
  @input
  @hint("Chrome material (lamp arms, poles)")
  chromeMaterial: Material
  @input
  @hint("Build the procedural anaesthesia machine (off if a generated GLB is placed instead)")
  buildAnesthesia: boolean = true

  roomTriangles = 0

  onAwake(): void {
    const root = this.getSceneObject()
    const floor = this.buildFloor()
    const shell = new MeshKit()
    this.buildWalls(shell)
    const glow = new MeshKit()
    const screen = new MeshKit()
    const chrome = new MeshKit()
    this.buildCeilingLights(glow)
    this.buildWallDetails(shell, glow)
    this.buildLamps(shell, glow, chrome)
    this.buildMonitor(shell, screen, chrome, [52, -118], 50)
    if (this.buildAnesthesia) this.buildAnesthesiaMachine(shell, screen, chrome)
    this.roomTriangles = floor.triangleCount + shell.triangleCount + glow.triangleCount + screen.triangleCount + chrome.triangleCount
    addMeshObject(root, "RoomFloor", floor, this.floorMaterial, MeshShadowMode.Receiver)
    addMeshObject(root, "RoomShell", shell, this.wallMaterial, MeshShadowMode.None)
    addMeshObject(root, "RoomGlow", glow, this.glowMaterial, MeshShadowMode.None)
    addMeshObject(root, "RoomScreens", screen, this.screenMaterial, MeshShadowMode.None)
    addMeshObject(root, "RoomChrome", chrome, this.chromeMaterial, MeshShadowMode.None)
  }

  // ------------------------------------------------------------------ floor + walls
  private buildFloor(): MeshKit {
    const kit = new MeshKit()
    const xs = range(X0, X1, 46)
    const zs = range(Z_NEAR, Z_FAR, 40)
    const P: V3[][] = []
    const UV: [number, number][][] = []
    const C: RGBA[][] = []
    for (const z of zs) {
      const row: V3[] = []
      const uvRow: [number, number][] = []
      const cRow: RGBA[] = []
      for (const x of xs) {
        row.push([x, FLOOR_Y, z])
        uvRow.push([x / 80, -z / 80])
        // contact shadow under the table + base, soft darkening along the walls
        const dx = Math.max(0, Math.abs(x + 10) - 100)
        const dz = Math.max(0, Math.abs(z + 10) - 30)
        const under = 1 - 0.45 * (1 - smoothstep(0, 40, Math.sqrt(dx * dx + dz * dz)))
        const wall = Math.min(x - X0, X1 - x, z - Z_FAR)
        const edge = 1 - 0.18 * (1 - smoothstep(0, 60, wall))
        const k = under * edge
        cRow.push([k, k, k, 1])
      }
      P.push(row)
      UV.push(uvRow)
      C.push(cRow)
    }
    // rows run toward −z, columns +x → faces up
    kit.grid(P, UV, {colorAt: (i, j) => C[j][i]})
    return kit
  }

  private wallBands(): {ys: number[]; cols: RGBA[]} {
    const base: RGBA = [0.52, 0.6, 0.59, 1]
    const wains: RGBA = [0.62, 0.76, 0.73, 1]
    const rail: RGBA = [0.86, 0.9, 0.9, 1]
    const upper: RGBA = [0.74, 0.88, 0.84, 1]
    return {
      ys: [FLOOR_Y, -80, -80, 20, 20, 25, 25, CEIL_Y],
      cols: [base, base, wains, wains, rail, rail, upper, upper],
    }
  }

  private wall(kit: MeshKit, a: V3, b: V3): void {
    // columns from a → b along the floor, rows up; the wall faces (b − a) × up
    const {ys, cols} = this.wallBands()
    const n = 10
    const P: V3[][] = []
    const UV: [number, number][][] = []
    for (const y of ys) {
      const row: V3[] = []
      const uvRow: [number, number][] = []
      for (let k = 0; k <= n; k++) {
        const t = k / n
        row.push([lerp(a[0], b[0], t), y, lerp(a[2], b[2], t)])
        uvRow.push([t * 4, y / 100])
      }
      P.push(row)
      UV.push(uvRow)
    }
    kit.grid(P, UV, {colorAt: (_i, j) => cols[j]})
  }

  private buildWalls(kit: MeshKit): void {
    this.wall(kit, [X0, 0, Z_FAR], [X1, 0, Z_FAR]) // far wall faces +z
    this.wall(kit, [X0, 0, Z_NEAR], [X0, 0, Z_FAR]) // foot-end wall faces +x
    this.wall(kit, [X1, 0, Z_FAR], [X1, 0, Z_NEAR]) // head-end wall faces −x
    // ceiling, facing down
    const xs = range(X0, X1, 4)
    const zs = range(Z_FAR, Z_NEAR, 4)
    const P: V3[][] = zs.map((z) => xs.map((x) => [x, CEIL_Y, z] as V3))
    const UV: [number, number][][] = zs.map((z) => xs.map((x) => [x / 100, z / 100] as [number, number]))
    kit.grid(P, UV, {colorAt: () => [0.93, 0.94, 0.94, 1]})
  }

  private buildCeilingLights(glow: MeshKit): void {
    for (const x of [-190, -10, 170]) {
      for (const z of [-220, -60]) {
        glow.roundedBox([x, CEIL_Y - 1, z], [120, 1.2, 60], 0.4, 1, [1, 1, 1, 1], 0.01, 1)
      }
    }
  }

  private buildWallDetails(kit: MeshKit, glow: MeshKit): void {
    const steel: RGBA = [0.86, 0.88, 0.9, 1]
    const seam: RGBA = [0.62, 0.66, 0.7, 1]
    // stainless supply cabinets on the far wall
    for (const x of [-250, -160, -70]) {
      kit.roundedBox([x, FLOOR_Y + 95, Z_FAR + 21], [86, 190, 40], 1.5, 1, steel, 0.05, 1)
      kit.roundedBox([x, FLOOR_Y + 95, Z_FAR + 41.2], [1.2, 182, 0.6], 0.2, 1, seam, 0.05, 1)
      kit.roundedBox([x + 6, FLOOR_Y + 110, Z_FAR + 41.6], [1.4, 26, 1.4], 0.5, 1, [0.7, 0.72, 0.75, 1], 0.05, 1)
    }
    // back-lit X-ray viewer + frame
    kit.roundedBox([110, 115, Z_FAR + 3], [118, 72, 5], 1.2, 1, [0.8, 0.83, 0.85, 1], 0.05, 1)
    glow.roundedBox([110, 115, Z_FAR + 5.8], [108, 62, 0.6], 0.2, 1, [1, 1, 1, 1], 0.01, 1)
    // wall clock
    kit.roundedBox([230, 150, Z_FAR + 2], [36, 36, 3], 1.4, 1, [0.95, 0.96, 0.96, 1], 0.05, 2)
    kit.roundedBox([230, 155, Z_FAR + 3.8], [1.4, 11, 0.6], 0.2, 1, [0.35, 0.4, 0.42, 1], 0.05, 1)
    kit.roundedBox([234, 150, Z_FAR + 3.8], [9, 1.4, 0.6], 0.2, 1, [0.35, 0.4, 0.42, 1], 0.05, 1)
    // sliding door on the foot-end wall
    kit.roundedBox([X0 + 2.5, FLOOR_Y + 105, -120], [5, 210, 130], 1, 1, [0.7, 0.8, 0.78, 1], 0.05, 1)
    glow.roundedBox([X0 + 5.3, FLOOR_Y + 150, -120], [0.6, 40, 34], 0.2, 1, [1, 1, 1, 1], 0.01, 1)
  }

  // ------------------------------------------------------------------ surgical lamps
  private buildLamps(kit: MeshKit, glow: MeshKit, chrome: MeshKit): void {
    const mount: V3 = [-5, CEIL_Y, -95]
    const hub: V3 = [-5, CEIL_Y - 28, -95]
    chrome.tube([mount, hub], 4, 16, true)
    kit.roundedBox(mount, [30, 4, 30], 1.5, 1, [0.9, 0.92, 0.93, 1], 0.05, 1)
    const heads: [V3, V3][] = [
      [[-42, 72, -82], [-46, 160, -105]],
      [[38, 82, -88], [42, 165, -110]],
    ]
    for (const [head, elbow] of heads) {
      const d = norm(sub(INCISION, head)) // face direction
      const up = scale(d, -1)
      const R = frameFromUp(up)
      const top = add(head, R([0, 13, 0]))
      chrome.tube([hub, [lerp(hub[0], elbow[0], 0.5), hub[1] + 4, lerp(hub[2], elbow[2], 0.5)], elbow], 2.4, 12, true)
      chrome.tube([elbow, [elbow[0], lerp(elbow[1], top[1], 0.5), elbow[2]], add(top, R([0, 18, 0])), top], 2.0, 12, true)
      // housing: shallow dome, opening toward the patient (local −Y)
      const prof: [number, number][] = [
        [29, -1.5],
        [30.5, 0],
        [30, 3],
        [27, 7],
        [20, 10.5],
        [10, 12.5],
        [0.1, 13],
      ]
      const sides = 28
      const P: V3[][] = []
      const UV: [number, number][][] = []
      for (const [r, y] of prof) {
        const row: V3[] = []
        const uvRow: [number, number][] = []
        for (let i = 0; i <= sides; i++) {
          const a = (i / sides) * Math.PI * 2
          row.push(add(head, R([Math.cos(a) * r, y, -Math.sin(a) * r])))
          uvRow.push([i / sides, y / 13])
        }
        P.push(row)
        UV.push(uvRow)
      }
      kit.grid(P, UV, {colorAt: (_i, j) => (j === 0 ? [0.75, 0.78, 0.8, 1] : [0.95, 0.96, 0.97, 1])})
      // glowing face (fan facing −Y local) + darker LED cells ring
      const c = glow.vertex(add(head, R([0, -1.2, 0])), d, [0.5, 0.5])
      const ring: number[] = []
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2
        ring.push(glow.vertex(add(head, R([Math.cos(a) * 28.8, -1.4, -Math.sin(a) * 28.8])), d, [0.5, 0.5]))
      }
      for (let i = 0; i < sides; i++) glow.tri(c, ring[i + 1], ring[i])
      // sterile centre handle
      chrome.tube([add(head, R([0, -1.3, 0])), add(head, R([0, -9, 0]))], 1.6, 12, true)
    }
  }

  // ------------------------------------------------------------------ vitals monitor
  private buildMonitor(kit: MeshKit, screen: MeshKit, chrome: MeshKit, at: [number, number], screenY: number): void {
    const [x, z] = at
    // five-leg base on casters, pole, monitor
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3
      const e: V3 = [x + Math.cos(a) * 28, FLOOR_Y + 6, z + Math.sin(a) * 28]
      chrome.tube([[x, FLOOR_Y + 9, z], e], 1.4, 8, true)
      kit.roundedBox([e[0], FLOOR_Y + 2.5, e[2]], [4, 5, 4], 1.8, 1, [0.4, 0.45, 0.48, 1], 0.05, 2)
    }
    chrome.tube([[x, FLOOR_Y + 8, z], [x, screenY - 18, z]], 1.6, 12, true)
    // monitor housing tilted slightly toward the table
    kit.roundedBox([x, screenY, z - 1], [58, 42, 9], 2.2, 1, [0.5, 0.55, 0.58, 1], 0.05, 2)
    kit.roundedBox([x, screenY - 23, z - 1], [16, 6, 8], 1.5, 1, [0.5, 0.55, 0.58, 1], 0.05, 1)
    const w = 51
    const h = 32
    const zf = z + 3.6
    const P: V3[][] = [
      [[x - w / 2, screenY - h / 2, zf], [x + w / 2, screenY - h / 2, zf]],
      [[x - w / 2, screenY + h / 2, zf], [x + w / 2, screenY + h / 2, zf]],
    ]
    screen.grid(P, [[[0, 0], [1, 0]], [[0, 1], [1, 1]]], {colorAt: () => [1, 1, 1, 1]})
  }

  // ------------------------------------------------------------------ anaesthesia machine
  private buildAnesthesiaMachine(kit: MeshKit, screen: MeshKit, chrome: MeshKit): void {
    const cx = 128
    const cz = -48
    const body: RGBA = [0.9, 0.92, 0.94, 1]
    const panel: RGBA = [0.62, 0.68, 0.72, 1]
    // cart with drawers
    kit.roundedBox([cx, FLOOR_Y + 45, cz], [62, 74, 66], 3, 1, body, 0.05, 2)
    for (let k = 0; k < 3; k++) kit.roundedBox([cx - 31.4, FLOOR_Y + 22 + k * 22, cz], [1.2, 18, 56], 0.4, 1, panel, 0.05, 1)
    // work surface + upper tower
    kit.roundedBox([cx, FLOOR_Y + 84, cz], [70, 4, 72], 1.5, 1, [0.8, 0.83, 0.86, 1], 0.05, 1)
    kit.roundedBox([cx + 8, FLOOR_Y + 120, cz], [44, 68, 60], 3, 1, body, 0.05, 2)
    // flowmeter bank + vaporizers on the patient-facing side (−x)
    kit.roundedBox([cx - 14.5, FLOOR_Y + 118, cz - 14], [1.5, 30, 18], 0.5, 1, [0.78, 0.9, 0.95, 1], 0.05, 1)
    kit.roundedBox([cx - 16, FLOOR_Y + 98, cz + 10], [12, 18, 10], 2, 1, [0.55, 0.78, 0.85, 1], 0.05, 1)
    kit.roundedBox([cx - 16, FLOOR_Y + 98, cz + 22], [12, 18, 10], 2, 1, [0.78, 0.65, 0.88, 1], 0.05, 1)
    // screen on an arm above, facing the patient side
    kit.roundedBox([cx - 4, FLOOR_Y + 172, cz - 6], [6, 30, 40], 1.5, 1, [0.5, 0.55, 0.58, 1], 0.05, 1)
    const xf = cx - 7.2
    const y0 = FLOOR_Y + 160
    const y1 = FLOOR_Y + 184
    const P: V3[][] = [
      [[xf, y0, cz - 23], [xf, y0, cz + 11]],
      [[xf, y1, cz - 23], [xf, y1, cz + 11]],
    ]
    // columns along +z, rows up: z × y = −x → the screen faces the patient side, texture unmirrored
    screen.grid(P, [[[0, 0], [1, 0]], [[0, 1], [1, 1]]], {colorAt: () => [1, 1, 1, 1]})
    chrome.tube([[cx - 4, FLOOR_Y + 154, cz - 6], [cx + 8, FLOOR_Y + 154, cz - 6]], 1.2, 8, true)
    // casters
    for (const sx of [-26, 26]) {
      for (const sz of [-28, 28]) chrome.tube([[cx + sx, FLOOR_Y + 3.5, cz + sz - 2], [cx + sx, FLOOR_Y + 3.5, cz + sz + 2]], 3.2, 12, true)
    }
    // reservoir bag + corrugated circuit toward the head end, disappearing under the screen drape
    const bag: V3 = [cx - 36, FLOOR_Y + 78, cz + 26]
    kit.lathe(bag, [[0.1, -14], [5, -12], [7.5, -6], [8, 0], [7, 5], [3, 9], [1.2, 11]], 16, [0.55, 0.66, 0.85, 1])
    for (const dz of [-6, 6]) {
      const pts: V3[] = []
      for (let k = 0; k <= 16; k++) {
        const t = k / 16
        pts.push([lerp(cx - 32, 86, t), FLOOR_Y + 112 - 70 * Math.sin(t * Math.PI * 0.55) + 20 * t, lerp(cz + dz, -10 + dz, t)])
      }
      kit.tube(pts, 1.7, 10, true, [0.82, 0.9, 0.95, 1])
    }
  }
}
