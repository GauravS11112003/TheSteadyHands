/**
 * StageTray — the Mayo instrument stand over the patient's legs (STAGE stand-in, preview look).
 *
 * Owns: a stainless Mayo tray (rolled rim, top ≈ field y +12) centred near field (-55, z -5),
 * its cantilever frame, post and wheeled base standing on the floor beyond the far side of the
 * table, and a folded huck towel on the tray. The instruments themselves are authored GLB
 * children placed on the towel (see the scene: VirtualTable/MayoTray/Instruments).
 *
 * Expects: this SceneObject sits at the SurgicalField origin (identity, unit scale).
 * Must not: overlap the closing controls (field x ≈ -16): the tray spans x -79..-31.
 */
import {MeshKit, RGBA, V3, addMeshObject, lerp, noise2} from "./StageMeshKit"

export const TRAY_CX = -55
export const TRAY_CZ = -5
export const TRAY_W = 48 // along x
export const TRAY_D = 32 // along z
export const TRAY_FLOOR_Y = 11.0 // inside floor of the tray
export const TOWEL_TOP_Y = TRAY_FLOOR_Y + 0.7
const FLOOR_Y = -90

@component
export class StageTray extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">StageTray – Mayo stand, tray and towel (stand-in)</span>')
  @input
  @hint("Brushed stainless material (tray)")
  steelMaterial: Material
  @input
  @hint("Chrome material (frame, post)")
  chromeMaterial: Material
  @input
  @hint("Towel cloth material")
  towelMaterial: Material

  trayTriangles = 0

  onAwake(): void {
    const root = this.getSceneObject()
    const tray = new MeshKit()
    const cx = TRAY_CX
    const cz = TRAY_CZ
    const hw = TRAY_W / 2
    const hd = TRAY_D / 2
    // floor plate
    tray.roundedBox([cx, TRAY_FLOOR_Y - 0.15, cz], [TRAY_W - 0.6, 0.3, TRAY_D - 0.6], 0.12, 2, [1, 1, 1, 1], 0.05, 1)
    // walls, slightly flared, 1.4 cm tall
    const wallH = 1.4
    const wy = TRAY_FLOOR_Y + wallH / 2 - 0.15
    tray.roundedBox([cx, wy, cz + hd - 0.15], [TRAY_W, wallH, 0.3], 0.12, 1, [1, 1, 1, 1], 0.05, 1)
    tray.roundedBox([cx, wy, cz - hd + 0.15], [TRAY_W, wallH, 0.3], 0.12, 1, [1, 1, 1, 1], 0.05, 1)
    tray.roundedBox([cx + hw - 0.15, wy, cz], [0.3, wallH, TRAY_D], 0.12, 1, [1, 1, 1, 1], 0.05, 1)
    tray.roundedBox([cx - hw + 0.15, wy, cz], [0.3, wallH, TRAY_D], 0.12, 1, [1, 1, 1, 1], 0.05, 1)
    // rolled rim along the top edge
    const rimY = TRAY_FLOOR_Y + wallH - 0.1
    const rim: V3[] = []
    const rr = 1.2
    const corner = (x: number, z: number, a0: number) => {
      for (let k = 0; k <= 5; k++) {
        const a = a0 + (k / 5) * (Math.PI / 2)
        rim.push([x + rr * Math.cos(a), rimY, z + rr * Math.sin(a)])
      }
    }
    corner(cx + hw - rr, cz + hd - rr, 0)
    corner(cx - hw + rr, cz + hd - rr, Math.PI / 2)
    corner(cx - hw + rr, cz - hd + rr, Math.PI)
    corner(cx + hw - rr, cz - hd + rr, (3 * Math.PI) / 2)
    rim.push(rim[0])
    tray.tube(rim, 0.28, 8, false)

    const frame = new MeshKit()
    // two runners under the tray, joined by a cross bar at the post, cantilevered from the far side
    const postX = cx
    const postZ = -48
    const runY = TRAY_FLOOR_Y - 1.4
    for (const dx of [-16, 16]) {
      frame.tube([[cx + dx, runY, cz + hd - 2], [cx + dx, runY, postZ]], 0.8, 12, true)
    }
    frame.tube([[cx - 16, runY, postZ], [cx + 16, runY, postZ]], 0.8, 12, true)
    // telescoping post: thin upper tube, thicker lower tube, collar
    frame.tube([[postX, runY, postZ], [postX, -40, postZ]], 1.3, 16, true)
    frame.tube([[postX, -38, postZ], [postX, FLOOR_Y + 6, postZ]], 1.9, 16, true)
    frame.lathe([postX, -40, postZ], [[1.95, -1.2], [2.6, -1.0], [2.7, 0], [2.6, 1.0], [1.95, 1.2]], 20)
    // U base on casters
    const baseY = FLOOR_Y + 5
    frame.tube([[postX - 30, baseY, postZ], [postX + 30, baseY, postZ]], 1.6, 14, true)
    for (const dx of [-30, 30]) {
      frame.tube([[postX + dx, baseY, postZ], [postX + dx, baseY, postZ - 34]], 1.6, 14, true)
    }
    frame.tube([[postX, baseY, postZ], [postX, FLOOR_Y + 6, postZ]], 2.0, 14, false)
    const casters = new MeshKit()
    for (const dx of [-30, 30]) {
      for (const dz of [0, -34]) {
        const x = postX + dx
        const z = postZ + dz
        casters.tube([[x, baseY - 1.5, z], [x, FLOOR_Y + 3.2, z]], 0.7, 10, false)
        casters.tube([[x - 1.2, FLOOR_Y + 2.4, z], [x + 1.2, FLOOR_Y + 2.4, z]], 2.4, 16, true)
      }
    }

    // folded huck towel: a soft slab with gentle wrinkles and a rounded folded edge
    const towel = this.buildTowel()

    this.trayTriangles = tray.triangleCount + frame.triangleCount + casters.triangleCount + towel.triangleCount
    addMeshObject(root, "MayoTrayPan", tray, this.steelMaterial, MeshShadowMode.Both)
    addMeshObject(root, "MayoStandFrame", frame, this.chromeMaterial, MeshShadowMode.None)
    addMeshObject(root, "MayoCasters", casters, this.steelMaterial, MeshShadowMode.None)
    addMeshObject(root, "MayoTowel", towel, this.towelMaterial, MeshShadowMode.Receiver)
  }

  private buildTowel(): MeshKit {
    const kit = new MeshKit()
    const x0 = TRAY_CX - TRAY_W / 2 + 1.6
    const x1 = TRAY_CX + TRAY_W / 2 - 1.6
    const z0 = TRAY_CZ - TRAY_D / 2 + 1.6
    const z1 = TRAY_CZ + TRAY_D / 2 - 1.6
    const thick = 0.7
    const nx = 40
    const nz = 28
    const R = 0.35
    const P: V3[][] = []
    const UV: [number, number][][] = []
    const C: RGBA[][] = []
    // top sheet with rounded falloff at the border (rows from +z to −z, columns +x)
    for (let j = 0; j <= nz; j++) {
      const t = j / nz
      const z = lerp(z1, z0, t)
      const row: V3[] = []
      const uvRow: [number, number][] = []
      const cRow: RGBA[] = []
      for (let i = 0; i <= nx; i++) {
        const x = lerp(x0, x1, i / nx)
        const ex = Math.min(x - x0, x1 - x)
        const ez = Math.min(z - z0, z1 - z)
        const e = Math.min(ex, ez)
        const edge = e < R ? Math.sqrt(Math.max(0, 1 - ((R - e) / R) * ((R - e) / R))) : 1
        const wr = 0.12 * noise2(x / 5, z / 5, 71) + 0.06 * noise2(x / 2.2, z / 2.2, 72)
        const y = TRAY_FLOOR_Y + (thick + wr) * (0.25 + 0.75 * edge)
        row.push([x, y, z])
        uvRow.push([x / 10, -z / 10])
        const k = 0.9 + 0.1 * edge + wr * 0.4
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
