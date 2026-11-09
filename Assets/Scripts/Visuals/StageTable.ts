/**
 * StageTable — the operating table under the drape (STAGE stand-in, preview look).
 *
 * Owns: padded mattress sections with rounded edges (top at field y = -21, x -110..+90,
 * z -37.5..+17.5), the steel under-frame, chrome side rails on stand-offs, the central column
 * and the base on the floor (field y = -90), plus a soft contact-shadow floor patch.
 *
 * Expects: this SceneObject sits at the SurgicalField origin (identity, unit scale).
 * Must not: own colliders or interaction; visual stand-in only.
 */
import {MeshKit, RGBA, V3, addMeshObject, clamp, smoothstep} from "./StageMeshKit"

const WHITE: RGBA = [1, 1, 1, 1]

const YM = -21
const FLOOR_Y = -90

@component
export class StageTable extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">StageTable – OR table, rails, column, base (stand-in)</span>')
  @input
  @hint("Mattress vinyl material")
  mattressMaterial: Material
  @input
  @hint("Chrome material (rails)")
  chromeMaterial: Material
  @input
  @hint("Painted steel material (frame, column, base)")
  steelMaterial: Material
  @input
  @hint("Floor material (receives the contact shadow); leave empty for no floor")
  @allowUndefined
  floorMaterial: Material

  tableTriangles = 0

  onAwake(): void {
    const root = this.getSceneObject()
    const mattress = new MeshKit()
    // head / back / seat / leg sections with 0.8 cm hinge gaps
    const sections: [number, number, number, number][] = [
      [62, 90, -24, 4], // headrest (narrower)
      [5, 61.2, -37.5, 17.5],
      [-50, 4.2, -37.5, 17.5],
      [-110, -50.8, -37.5, 17.5],
    ]
    for (const [x0, x1, z0, z1] of sections) {
      mattress.roundedBox([(x0 + x1) / 2, YM - 4, (z0 + z1) / 2], [x1 - x0, 8, z1 - z0], 2.6, 4, WHITE, 0.05, 3)
    }
    const steel = new MeshKit()
    // under-frame plates per section
    for (const [x0, x1, z0, z1] of sections) {
      steel.roundedBox([(x0 + x1) / 2, YM - 10, (z0 + z1) / 2], [x1 - x0 - 2, 4, z1 - z0 - 4], 0.8, 1, WHITE, 0.05, 1)
    }
    // column + base
    steel.roundedBox([-12, (FLOOR_Y + 6 + YM - 12) / 2, -10], [34, YM - 12 - (FLOOR_Y + 6), 24], 3, 2, WHITE, 0.05, 3)
    steel.roundedBox([-12, -31.5, -10], [60, 3, 34], 1.2, 1, WHITE, 0.05, 1) // column head / tilt housing
    steel.roundedBox([-14, FLOOR_Y + 3.5, -10], [96, 7, 52], 3, 2, WHITE, 0.05, 3)
    const chrome = new MeshKit()
    for (const zr of [TABLE_RAIL_NEAR, TABLE_RAIL_FAR]) {
      chrome.roundedBox([-10, YM - 9, zr], [196, 3.2, 1.0], 0.45, 2, WHITE, 0.05, 2)
      for (let x = -100; x <= 80; x += 45) {
        const zs = zr > 0 ? zr - 1.2 : zr + 1.2
        chrome.roundedBox([x, YM - 9, zs], [3, 2.2, 2.2], 0.4, 1, WHITE, 0.05, 1)
      }
    }
    this.tableTriangles = mattress.triangleCount + steel.triangleCount + chrome.triangleCount
    addMeshObject(root, "Mattress", mattress, this.mattressMaterial, MeshShadowMode.Receiver)
    addMeshObject(root, "TableFrame", steel, this.steelMaterial, MeshShadowMode.Receiver)
    addMeshObject(root, "SideRails", chrome, this.chromeMaterial, MeshShadowMode.None)
    if (this.floorMaterial) {
      const floor = this.buildFloor()
      this.tableTriangles += floor.triangleCount
      addMeshObject(root, "Floor", floor, this.floorMaterial, MeshShadowMode.Receiver)
    }
  }

  /** A floor patch with baked soft contact shadow under the table and the drape skirt. */
  private buildFloor(): MeshKit {
    const kit = new MeshKit()
    const X0 = -190
    const X1 = 150
    const Z0 = -130
    const Z1 = 70
    const N = 32
    const P: V3[][] = []
    const UV: [number, number][][] = []
    const C: RGBA[][] = []
    for (let j = 0; j <= N; j++) {
      const z = Z1 + (Z0 - Z1) * (j / N)
      const row: V3[] = []
      const uvRow: [number, number][] = []
      const cRow: RGBA[] = []
      for (let i = 0; i <= N; i++) {
        const x = X0 + (X1 - X0) * (i / N)
        row.push([x, FLOOR_Y, z])
        uvRow.push([x / 60, -z / 60])
        // rounded-rect distance to the table footprint
        const dx = Math.max(0, Math.abs(x + 10) - 100)
        const dz = Math.max(0, Math.abs(z + 10) - 30)
        const d = Math.sqrt(dx * dx + dz * dz)
        const under = 1 - 0.55 * (1 - smoothstep(0, 38, d))
        const bx = Math.max(0, Math.abs(x + 14) - 48)
        const bz = Math.max(0, Math.abs(z + 10) - 26)
        const base = 1 - 0.35 * (1 - smoothstep(0, 9, Math.sqrt(bx * bx + bz * bz)))
        const k = clamp(under * base, 0, 1)
        cRow.push([k, k, k, 1])
      }
      P.push(row)
      UV.push(uvRow)
      C.push(cRow)
    }
    kit.grid(P, UV, {colorAt: (i, j) => C[j][i]})
    return kit
  }
}

const TABLE_RAIL_NEAR = 19.6
const TABLE_RAIL_FAR = -39.6
