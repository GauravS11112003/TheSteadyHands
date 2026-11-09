/**
 * StageBody — the visible patient (STAGE stand-in): a premium medical-simulation manikin lying
 * supine on the OR table, head toward +X, midline at field z = -10.
 *
 * Owns:
 *  - The skin mesh (torso with gentle anatomy, arms at the sides, neck, head with a simple face),
 *    whose abdomen passes exactly through the pinch plane (field y = 1.0) round the incision and
 *    leaves the SkinWindow patch rectangle open so the wound mesh drops in seamlessly
 *    (same material, same UVs, same betadine prep tint at the seam).
 *  - A bouffant surgical cap, a pillow under the head, a sheet over the legs from the hips down
 *    (relaxed cloth with folds, skirts over the sides/foot, rolled hem at the hips).
 *  - Cheap clinical realism: three ECG electrodes with lead wires, an IV cannula + line on the far
 *    forearm running to a bag on a pole.
 *
 * Expects: this SceneObject sits at the SurgicalField origin (identity, unit scale).
 * Must not: own colliders or interaction; no runtime updates after onAwake.
 */
import {MeshKit, RGBA, V3, add, addMeshObject, clamp, cross, lerp, noise1, noise2, norm, scale, smoothstep, sub} from "./StageMeshKit"
import {ARM_DZ, PATCH_HX, PATCH_HZ, PILLOW, YM, Z0, baseHeight, plateauWeight, prepTint, rawBody, skinHeight} from "./StageBodyShape"

const TABLE_X0 = -110
const TABLE_Z_NEAR = 17.5
const TABLE_Z_FAR = -37.5
const SHEET_X1 = -31 // sheet covers from the hips down
const T = 0.35
const CORNER_R = 4
const HANG = 44
const TILE = 12
// anaesthesia (ether) screen at the clavicle line: hides face + cap from the surgeon's side
const SCREEN_X = 44.5
const BAR_Y = 34
const BAR_R = 1.6
const SCREEN_Z0 = -50
const SCREEN_Z1 = 28

function wrap(h: number): [number, number] {
  const arc = (Math.PI / 2) * CORNER_R
  if (h <= arc) {
    const th = h / CORNER_R
    return [CORNER_R * Math.sin(th), CORNER_R * (1 - Math.cos(th))]
  }
  const extra = h - arc
  return [CORNER_R + extra * 0.06, CORNER_R + extra]
}

function folds(s: number, seed: number): number {
  const ph = 1.3 * noise1(s / 23, seed)
  const a = Math.sin((s / 8.5) * Math.PI * 2 + ph * 3)
  const b = Math.sin((s / 4.1) * Math.PI * 2 + ph * 5 + 1.3)
  const amp = 0.65 + 0.35 * noise1(s / 11 + 7, seed + 1)
  return (0.72 * a + 0.28 * b) * amp
}

function gauss(dx: number, dz: number, rx: number, rz: number): number {
  return Math.exp(-(dx * dx) / (rx * rx) - (dz * dz) / (rz * rz))
}

function range(a: number, b: number, n: number): number[] {
  const out: number[] = []
  for (let k = 0; k <= n; k++) out.push(a + ((b - a) * k) / n)
  return out
}

@component
export class StageBody extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">StageBody – supine patient manikin, sheet, pillow, ECG + IV (stand-in)</span>')
  @input
  @hint("Skin material — the same one SkinWindow uses (UberPBR, Vertex Color = Base Color)")
  skinMaterial: Material
  @input
  @hint("Sheet cloth material over the legs (two-sided)")
  sheetMaterial: Material
  @input
  @hint("Soft cloth material for the surgical cap and pillow")
  capMaterial: Material
  @input
  @hint("Vertex-coloured plastic material (electrodes, leads, IV tape/bag)")
  deviceMaterial: Material
  @input
  @hint("Chrome material (electrode snaps, IV pole)")
  chromeMaterial: Material

  bodyTriangles = 0

  // relaxed sheet heightfield (1 cm grid over the leg end of the table)
  private gx0 = TABLE_X0
  private gz0 = TABLE_Z_FAR
  private gnx = 0
  private gnz = 0
  private D: Float32Array
  private O: Float32Array

  onAwake(): void {
    const root = this.getSceneObject()
    const skin = this.buildSkin()
    const cap = this.buildCap()
    const pillow = new MeshKit()
    pillow.roundedBox(
      [(PILLOW.x0 + PILLOW.x1) / 2, YM + PILLOW.h / 2, (PILLOW.z0 + PILLOW.z1) / 2],
      [PILLOW.x1 - PILLOW.x0, PILLOW.h, PILLOW.z1 - PILLOW.z0],
      3.2,
      3,
      [1, 1, 1, 1],
      0.08,
      3,
    )
    this.relaxSheet()
    const sheet = this.buildSheet()
    const devices = new MeshKit()
    const metal = new MeshKit()
    this.buildEcg(devices, metal)
    this.buildIv(devices, metal)
    const screen = this.buildScreen()
    this.buildScreenBar(metal)
    this.bodyTriangles =
      skin.triangleCount + cap.triangleCount + pillow.triangleCount + sheet.triangleCount + devices.triangleCount + metal.triangleCount + screen.triangleCount
    addMeshObject(root, "PatientSkin", skin, this.skinMaterial, MeshShadowMode.Receiver)
    addMeshObject(root, "SurgicalCap", cap, this.capMaterial, MeshShadowMode.Receiver)
    addMeshObject(root, "Pillow", pillow, this.capMaterial, MeshShadowMode.Receiver)
    addMeshObject(root, "LegSheet", sheet, this.sheetMaterial, MeshShadowMode.Receiver)
    addMeshObject(root, "EtherScreen", screen, this.sheetMaterial, MeshShadowMode.Receiver)
    addMeshObject(root, "EcgAndIv", devices, this.deviceMaterial, MeshShadowMode.None)
    addMeshObject(root, "EcgSnapsIvPole", metal, this.chromeMaterial, MeshShadowMode.None)
  }

  // ------------------------------------------------------------------ skin
  private anatomyTint(x: number, z: number): [number, number, number] {
    const dz = z - Z0
    let r = 1
    let g = 1
    let b = 1
    const cheek = 0.45 * (gauss(x - 60, Math.abs(dz) - 4.6, 3, 2.4))
    g *= 1 - cheek * 0.12
    b *= 1 - cheek * 0.14
    const lips = gauss(x - 57.6, dz, 0.7, 2.0)
    g *= 1 - lips * 0.22
    b *= 1 - lips * 0.2
    const lid = gauss(x - 64.6, Math.abs(dz) - 3.2, 0.22, 1.3)
    const brow = gauss(x - 66.7, Math.abs(dz) - 3.3, 0.35, 1.7)
    const dark = 1 - lid * 0.18 - brow * 0.22
    r *= dark
    g *= dark * (1 - brow * 0.06)
    b *= dark * (1 - brow * 0.1)
    const rn = (x + 8) * (x + 8) + dz * dz
    const navel = Math.exp(-rn / 0.45)
    r *= 1 - navel * 0.2
    g *= 1 - navel * 0.25
    b *= 1 - navel * 0.25
    // knuckles / elbows a touch warmer
    for (const s of [-1, 1]) {
      const k = gauss(x + 16, z - (Z0 + s * ARM_DZ), 2.5, 3) * 0.5 + gauss(x - 12, z - (Z0 + s * ARM_DZ), 2.5, 3) * 0.35
      g *= 1 - k * 0.08
      b *= 1 - k * 0.1
    }
    return [r, g, b]
  }

  private buildSkin(): MeshKit {
    const kit = new MeshKit()
    const xs = [
      ...range(-36, -PATCH_HX, 18).slice(0, -1),
      ...range(-PATCH_HX, PATCH_HX, 40),
      ...range(PATCH_HX, 52, 29).slice(1),
      ...range(52, 76, 32).slice(1),
    ]
    const zs = [
      ...range(19.5, PATCH_HZ, 13).slice(0, -1),
      ...range(PATCH_HZ, -PATCH_HZ, 30),
      ...range(-PATCH_HZ, -39.5, 32).slice(1),
    ]
    const P: V3[][] = []
    const UV: [number, number][][] = []
    const C: RGBA[][] = []
    const Y: number[][] = []
    const B: number[][] = []
    for (const z of zs) {
      const row: V3[] = []
      const uvRow: [number, number][] = []
      const cRow: RGBA[] = []
      const yRow: number[] = []
      const bRow: number[] = []
      for (const x of xs) {
        const y = skinHeight(x, z)
        const base = baseHeight(x, z)
        const yr = Math.max(y, base - 1)
        row.push([x, yr, z])
        uvRow.push([x / 4.0 + 0.37, -z / 4.0 + 0.61])
        // concavity AO (arm/torso valleys) + contact darkening against mattress / pillow
        const hxp = skinHeight(x + 1, z)
        const hxm = skinHeight(x - 1, z)
        const hzp = skinHeight(x, z + 1)
        const hzm = skinHeight(x, z - 1)
        const lap = (hxp + hxm + hzp + hzm) / 4 - y
        let ao = 1 - clamp(lap * 0.32, 0, 0.3)
        ao *= 1 - 0.3 * (1 - smoothstep(0, 3.5, y - base))
        // flanks / underside: darker and a touch warmer, so it reads as skin rather than plastic
        const gx = (hxp - hxm) * 0.5
        const gz = (hzp - hzm) * 0.5
        const tilt = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz)
        ao *= 1 - 0.2 * tilt
        const mott = (1 - plateauWeight(x, z)) * (0.6 * noise2(x / 9, z / 9, 101) + 0.4 * noise2(x / 3.5, z / 3.5, 102))
        const p = prepTint(x, z)
        const a = this.anatomyTint(x, z)
        const r = p[0] * a[0] * ao * (1 + 0.025 * mott)
        const g = p[1] * a[1] * ao * (1 - 0.06 * tilt) * (1 - 0.015 * mott)
        const bl = p[2] * a[2] * ao * (1 - 0.1 * tilt) * (1 - 0.03 * mott)
        cRow.push([r, g, bl, 1])
        yRow.push(yr)
        bRow.push(base)
      }
      P.push(row)
      UV.push(uvRow)
      C.push(cRow)
      Y.push(yRow)
      B.push(bRow)
    }
    kit.grid(P, UV, {
      colorAt: (i, j) => C[j][i],
      keepQuad: (i, j) => {
        const xc = 0.5 * (xs[i] + xs[i + 1])
        const zc = 0.5 * (zs[j] + zs[j + 1])
        if (Math.abs(xc) < PATCH_HX && Math.abs(zc) < PATCH_HZ) return false
        const top = Math.max(Y[j][i], Y[j][i + 1], Y[j + 1][i], Y[j + 1][i + 1])
        const base = Math.min(B[j][i], B[j][i + 1], B[j + 1][i], B[j + 1][i + 1])
        return top > base + 0.05
      },
    })
    return kit
  }

  // ------------------------------------------------------------------ cap
  private capMask(x: number, z: number): boolean {
    const dz = Math.abs(z - Z0)
    const edge = 66.4 - 5.0 * smoothstep(4.5, 7.5, dz)
    const hx = (x - 63.5) / 10.6
    const hz = (z - Z0) / 7.9
    return x > edge && 1 - hx * hx - hz * hz > -0.08
  }

  private buildCap(): MeshKit {
    const kit = new MeshKit()
    const xs = range(57, 76, 32)
    const zs = range(Z0 + 10, Z0 - 10, 34)
    const P: V3[][] = []
    const UV: [number, number][][] = []
    const C: RGBA[][] = []
    for (const z of zs) {
      const row: V3[] = []
      const uvRow: [number, number][] = []
      const cRow: RGBA[] = []
      for (const x of xs) {
        // generous offset: the cap grid is finer than the head skin grid, so stay clear of its chords
        const puff = 1.15 + 0.3 * noise2(x / 2.2, z / 2.2, 95) + 0.12 * noise2(x / 0.9, z / 0.9, 96)
        const y = Math.max(skinHeight(x, z), baseHeight(x, z) - 1) + puff
        row.push([x, y, z])
        uvRow.push([x / 6, -z / 6])
        const k = 0.92 + 0.08 * noise2(x / 1.5, z / 1.5, 97)
        cRow.push([k, k, k, 1])
      }
      P.push(row)
      UV.push(uvRow)
      C.push(cRow)
    }
    kit.grid(P, UV, {
      colorAt: (i, j) => C[j][i],
      keepQuad: (i, j) =>
        this.capMask(xs[i], zs[j]) && this.capMask(xs[i + 1], zs[j]) && this.capMask(xs[i], zs[j + 1]) && this.capMask(xs[i + 1], zs[j + 1]),
    })
    return kit
  }

  // ------------------------------------------------------------------ sheet over the legs
  private relaxSheet(): void {
    this.gnx = Math.ceil(SHEET_X1 + 3 - this.gx0) + 1
    this.gnz = Math.ceil(TABLE_Z_NEAR - this.gz0) + 1
    const nx = this.gnx
    const nz = this.gnz
    const O = new Float32Array(nx * nz)
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) O[k * nx + i] = Math.max(YM, rawBody(this.gx0 + i, this.gz0 + k, true)) + T
    }
    const D = new Float32Array(O)
    const tmp = new Float32Array(O.length)
    for (let it = 0; it < 100; it++) {
      for (let k = 0; k < nz; k++) {
        for (let i = 0; i < nx; i++) {
          const id = k * nx + i
          if (i === 0 || k === 0 || k === nz - 1 || i === nx - 1) {
            tmp[id] = O[id]
            continue
          }
          const avg = 0.25 * (D[id - 1] + D[id + 1] + D[id - nx] + D[id + nx])
          tmp[id] = Math.max(O[id], avg - 0.05)
        }
      }
      D.set(tmp)
    }
    this.D = D
    this.O = O
  }

  private sample(F: Float32Array, x: number, z: number): number {
    const fx = clamp(x - this.gx0, 0, this.gnx - 1.0001)
    const fz = clamp(z - this.gz0, 0, this.gnz - 1.0001)
    const i = Math.floor(fx)
    const k = Math.floor(fz)
    const tx = fx - i
    const tz = fz - k
    const nx = this.gnx
    return lerp(lerp(F[k * nx + i], F[k * nx + i + 1], tx), lerp(F[(k + 1) * nx + i], F[(k + 1) * nx + i + 1], tx), tz)
  }

  private sheetTop(x: number, z: number): {y: number; ao: number} {
    const d = this.sample(this.D, x, z)
    const o = this.sample(this.O, x, z)
    const sz = (this.sample(this.D, x, z + 1) - this.sample(this.D, x, z - 1)) * 0.5
    const slope = clamp(Math.abs(sz), 0, 1.6)
    const bridge = clamp((d - o) / 1.5, 0, 1)
    const edgeFade = smoothstep(0, 6, Math.min(z - TABLE_Z_FAR, TABLE_Z_NEAR - z, x - TABLE_X0))
    const amp = (0.2 + 0.75 * slope + 0.45 * bridge) * (0.35 + 0.65 * edgeFade)
    const f = folds(x + 3.0 * noise1(z / 9, 5), 31) * amp + 0.25 * noise2(x / 6, z / 6, 33)
    const ao = 1 - 0.14 * clamp(-f / 1.2, 0, 1) - 0.06 * bridge
    // never dip into the body (the skin is rendered underneath)
    return {y: Math.max(d + f, o - T + 0.2), ao}
  }

  private buildSheet(): MeshKit {
    const kit = new MeshKit()
    const hs = [0, 1.5, 3.3, 5.5, 9, 14, 21, 29, 37, 44].map((h) => (h / 44) * HANG)
    const colX: number[] = []
    const colH: number[] = []
    for (let k = hs.length - 1; k >= 1; k--) {
      colX.push(TABLE_X0)
      colH.push(hs[k])
    }
    for (const x of range(TABLE_X0, SHEET_X1, 40)) {
      colX.push(x)
      colH.push(0)
    }
    const rowZ: number[] = []
    const rowH: number[] = []
    const rowSide: number[] = []
    for (let k = hs.length - 1; k >= 1; k--) {
      rowZ.push(TABLE_Z_NEAR)
      rowH.push(hs[k])
      rowSide.push(1)
    }
    for (const z of range(TABLE_Z_NEAR, TABLE_Z_FAR, 37)) {
      rowZ.push(z)
      rowH.push(0)
      rowSide.push(0)
    }
    for (let k = 1; k < hs.length; k++) {
      rowZ.push(TABLE_Z_FAR)
      rowH.push(hs[k])
      rowSide.push(-1)
    }
    const P: V3[][] = []
    const UV: [number, number][][] = []
    const C: RGBA[][] = []
    for (let j = 0; j < rowZ.length; j++) {
      const row: V3[] = []
      const uvRow: [number, number][] = []
      const cRow: RGBA[] = []
      for (let i = 0; i < colX.length; i++) {
        const x = colX[i]
        const z = rowZ[j]
        const hx = colH[i]
        const hz = rowH[j]
        const top = this.sheetTop(x, z)
        let px = x
        let pz = z
        let py = top.y
        let ao = top.ao
        if (hx > 0 || hz > 0) {
          const hemVar = 1 + 0.05 * noise1((x + z) / 13, 41)
          const hxx = hx * hemVar
          const hzz = hz * hemVar
          const [ox] = wrap(hxx)
          const [oz] = wrap(hzz)
          const [, down] = wrap(Math.sqrt(hxx * hxx + hzz * hzz))
          py = top.y - down
          const grow = smoothstep(2, 30, Math.max(hxx, hzz))
          if (hz > 0) {
            const side = rowSide[j]
            const f = folds(x + 2.5 * noise1(hzz / 14, 43), side > 0 ? 51 : 52)
            pz = z + side * (oz + grow * 2.4 * f + grow * 0.8)
            ao *= 1 - 0.1 * grow * clamp(-f, 0, 1)
          }
          if (hx > 0) {
            const f = folds(z + 2.5 * noise1(hxx / 14, 47), 53)
            px = x - (ox + grow * 2.4 * f + grow * 0.8)
            ao *= 1 - 0.1 * grow * clamp(-f, 0, 1)
          }
          ao *= 1 - 0.08 * smoothstep(5, HANG, Math.max(hxx, hzz))
        }
        row.push([px, py, pz])
        const zu = rowSide[j] > 0 ? TABLE_Z_NEAR + hz : rowSide[j] < 0 ? TABLE_Z_FAR - hz : z
        uvRow.push([(x - hx) / TILE, -zu / TILE])
        cRow.push([ao, ao, ao, 1])
      }
      P.push(row)
      UV.push(uvRow)
      C.push(cRow)
    }
    kit.grid(P, UV, {colorAt: (i, j) => C[j][i]})
    // rolled hem along the hip edge (the last column), giving the sheet real thickness
    const last = colX.length - 1
    const hem: V3[] = []
    const radii: number[] = []
    for (let j = 0; j < rowZ.length; j++) {
      const p = P[j][last]
      hem.push([p[0] + 0.2, p[1] + 0.45, p[2]])
      radii.push(0.62)
    }
    kit.tube(hem, radii, 10, true)
    return kit
  }

  // ------------------------------------------------------------------ ether screen
  /**
   * A drape hung over a chrome bar at the clavicle line. Over the table it tents back over the head
   * and pillow down to the head end (face + cap hidden from every side); beyond the table edges it
   * falls straight from the bar, closing the tent's sides.
   */
  private buildScreen(): MeshKit {
    const kit = new MeshKit()
    const xb = SCREEN_X + BAR_R
    const nFront = 22
    const arcN = 8
    const nBack = 20
    const zs = range(SCREEN_Z0, SCREEN_Z1, 44)
    const cols: V3[][] = []
    const shades: number[][] = []
    for (const z of zs) {
      const out = Math.max(z - (TABLE_Z_NEAR + 1.5), TABLE_Z_FAR - 1.5 - z, 0)
      const droop = smoothstep(0, 9, out)
      const onTable = Math.max(skinHeight(SCREEN_X, z), baseHeight(SCREEN_X, z), YM) - 0.6
      const yBot = lerp(onTable, -58 + 2 * noise1(z / 7, 61), droop)
      const col: V3[] = []
      const sh: number[] = []
      for (let k = 0; k <= nFront; k++) {
        const t = k / nFront
        const y = lerp(yBot, BAR_Y, t)
        const gather = smoothstep(BAR_Y - 6, BAR_Y, y)
        const amp = 0.4 + 1.5 * (1 - t) * (1 - t) + 0.5 * gather
        const f = folds(z + 1.5 * noise1(y / 15, 63), 65) * amp
        col.push([SCREEN_X - Math.max(0, f + amp * 0.6) * (1 - gather * 0.7), y, z])
        sh.push(1 - 0.1 * clamp(-f / 1.5, 0, 1))
      }
      for (let k = 1; k <= arcN; k++) {
        const a = Math.PI - (k / arcN) * Math.PI
        col.push([xb + BAR_R * Math.cos(a), BAR_Y + BAR_R * Math.sin(a), z])
        sh.push(1)
      }
      // back: tent slope over head + pillow to the head end, or a straight fall beyond the table
      const slope: [number, number][] = [
        [xb + BAR_R, BAR_Y],
        [60, 22],
        [74, 9],
        [86, -8],
        [90.5, -15],
        [92, -24],
        [92.5, -44],
      ]
      for (let k = 1; k <= nBack; k++) {
        const t = k / nBack
        const fi = t * (slope.length - 1)
        const i0 = Math.min(slope.length - 2, Math.floor(fi))
        const tt = fi - i0
        const sx = lerp(slope[i0][0], slope[i0 + 1][0], tt)
        const sy = lerp(slope[i0][1], slope[i0 + 1][1], tt)
        const fx = xb + BAR_R + 0.5 + 1.5 * t
        const fy = lerp(BAR_Y, -58, t)
        const f = folds(z + 3 + 2 * noise1(t * 3, 67), 69) * (0.25 + 0.9 * t)
        col.push([lerp(sx, fx, droop) + f * 0.3 * (1 - droop), lerp(sy, fy, droop) + f * 0.6 * (1 - droop), z + f * 0.4 * droop])
        sh.push(0.9 - 0.06 * t)
      }
      cols.push(col)
      shades.push(sh)
    }
    const nRows = cols[0].length
    const P: V3[][] = []
    const UV: [number, number][][] = []
    const C: RGBA[][] = []
    for (let j = 0; j < nRows; j++) {
      const row: V3[] = []
      const uvRow: [number, number][] = []
      const cRow: RGBA[] = []
      for (let i = 0; i < zs.length; i++) {
        row.push(cols[i][j])
        uvRow.push([zs[i] / TILE, j * 2.2 / TILE])
        const k = shades[i][j]
        cRow.push([k, k, k, 1])
      }
      P.push(row)
      UV.push(uvRow)
      C.push(cRow)
    }
    // columns along +z, rows up the front: dPu × dPv = z × y = −x → the front faces the surgeon
    kit.grid(P, UV, {colorAt: (i, j) => C[j][i]})
    return kit
  }

  private buildScreenBar(metal: MeshKit): void {
    const xb = SCREEN_X + BAR_R
    const zA = SCREEN_Z0 + 1
    const zB = SCREEN_Z1 - 1
    const R = 3
    const pts: V3[] = []
    for (let k = 0; k <= 6; k++) pts.push([xb, lerp(-31, BAR_Y - R, k / 6), zA])
    for (let k = 1; k <= 8; k++) {
      const a = Math.PI - (k / 8) * (Math.PI / 2)
      pts.push([xb, BAR_Y - R + R * Math.sin(a), zA + R + R * Math.cos(a)])
    }
    for (let k = 1; k <= 10; k++) pts.push([xb, BAR_Y, lerp(zA + R, zB - R, k / 10)])
    for (let k = 1; k <= 8; k++) {
      const a = Math.PI / 2 - (k / 8) * (Math.PI / 2)
      pts.push([xb, BAR_Y - R + R * Math.sin(a), zB - R + R * Math.cos(a)])
    }
    for (let k = 1; k <= 6; k++) pts.push([xb, lerp(BAR_Y - R, -31, k / 6), zB])
    metal.tube(pts, 0.9, 12, true)
  }

  // ------------------------------------------------------------------ ECG + IV
  private surface(x: number, z: number): {p: V3; n: V3} {
    const y = skinHeight(x, z)
    const dx = (skinHeight(x + 0.5, z) - skinHeight(x - 0.5, z)) / 1.0
    const dz = (skinHeight(x, z + 0.5) - skinHeight(x, z - 0.5)) / 1.0
    return {p: [x, y, z], n: norm([-dx, 1, -dz])}
  }

  private disc(kit: MeshKit, c: V3, n: V3, r: number, h: number, color: RGBA, seg: number = 16): V3 {
    const t1 = norm(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]))
    const t2 = cross(n, t1)
    const top = add(c, scale(n, h))
    const ringT: V3[] = []
    const ringB: V3[] = []
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2
      const d = add(scale(t1, Math.cos(a)), scale(t2, Math.sin(a)))
      ringT.push(add(top, scale(d, r)))
      ringB.push(add(sub(c, scale(n, 0.08)), scale(d, r)))
    }
    kit.grid([ringB, ringT], [ringB.map(() => [0, 0] as [number, number]), ringT.map(() => [0, 1] as [number, number])], {
      colorAt: () => color,
      normalOverride: (i) => norm(sub(ringT[i], top)),
    })
    const ci = kit.vertex(top, n, [0.5, 0.5], t1, 1, color)
    const ids = ringT.map((p) => kit.vertex(p, n, [0.5, 0.5], t1, 1, color))
    for (let i = 0; i < seg; i++) kit.tri(ci, ids[i], ids[i + 1])
    return top
  }

  private curve(pts: V3[], n: number): V3[] {
    // Catmull-Rom through the control points
    const out: V3[] = []
    for (let s = 0; s < pts.length - 1; s++) {
      const p0 = pts[Math.max(0, s - 1)]
      const p1 = pts[s]
      const p2 = pts[s + 1]
      const p3 = pts[Math.min(pts.length - 1, s + 2)]
      for (let k = 0; k < n; k++) {
        const t = k / n
        const t2 = t * t
        const t3 = t2 * t
        const q: V3 = [0, 0, 0]
        for (let a = 0; a < 3; a++) {
          q[a] = 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)
        }
        out.push(q)
      }
    }
    out.push(pts[pts.length - 1])
    return out
  }

  private buildEcg(dev: MeshKit, metal: MeshKit): void {
    const pads: [number, number, RGBA][] = [
      [33, Z0 + 10, [0.95, 0.95, 0.95, 1]],
      [33, Z0 - 10, [1, 0.42, 0.42, 1]],
      [16, Z0 - 14, [0.45, 0.85, 0.5, 1]],
    ]
    for (const [x, z, wire] of pads) {
      const {p, n} = this.surface(x, z)
      const top = this.disc(dev, add(p, scale(n, 0.05)), n, 1.35, 0.14, [0.97, 0.97, 0.96, 1], 18)
      this.disc(dev, add(top, scale(n, 0.0)), n, 0.75, 0.04, [0.82, 0.85, 0.9, 1], 14)
      const snap = this.disc(metal, top, n, 0.32, 0.3, [1, 1, 1, 1], 10)
      const exitZ = TABLE_Z_FAR - 6
      const path = this.curve(
        [
          snap,
          add(snap, [1.5, 2.2, -1]),
          [lerp(x, 46, 0.5), 5 + (z - Z0) * 0.1, lerp(z, -24, 0.6)],
          [48, -6, -33],
          [52, -20, exitZ],
          [56, -45, exitZ - 4],
        ],
        8,
      )
      dev.tube(path, 0.16, 6, true, wire)
    }
  }

  private buildIv(dev: MeshKit, metal: MeshKit): void {
    // cannula on the dorsum of the far forearm, covered by a clear-ish dressing
    const ax = 2
    const az = Z0 - ARM_DZ
    const top = skinHeight(ax, az)
    dev.roundedBox([ax, top + 0.08, az], [3.4, 0.16, 2.6], 0.07, 1, [0.97, 0.98, 1, 1], 0.05, 1)
    const hub: V3 = [ax + 1.0, top + 0.5, az]
    dev.tube([[ax - 1.2, top + 0.25, az], hub], 0.28, 8, true, [0.55, 0.8, 1, 1])
    // pole + bag beyond the far side of the table, toward the head
    const poleX = 34
    const poleZ = TABLE_Z_FAR - 15
    metal.tube([[poleX, -90, poleZ], [poleX, 72, poleZ]], 1.0, 12, true)
    metal.tube(
      this.curve([[poleX, 72, poleZ], [poleX + 3, 74, poleZ], [poleX + 5, 71, poleZ]], 4),
      0.35,
      8,
      true,
    )
    const bagTop: V3 = [poleX + 5, 69, poleZ]
    dev.roundedBox([bagTop[0], bagTop[1] - 9.5, bagTop[2]], [11, 17, 3.2], 1.4, 2, [0.9, 0.95, 1, 1], 0.05, 2)
    const chamberTop: V3 = [bagTop[0], bagTop[1] - 18.5, bagTop[2]]
    dev.tube([chamberTop, [chamberTop[0], chamberTop[1] - 5, chamberTop[2]]], 0.9, 12, true, [0.92, 0.96, 1, 1])
    const line = this.curve(
      [
        [chamberTop[0], chamberTop[1] - 5, chamberTop[2]],
        [poleX + 3, 25, poleZ + 3],
        [22, -2, poleZ + 6],
        [10, -10, az - 4],
        [ax + 3.2, top + 1.2, az],
        hub,
      ],
      10,
    )
    dev.tube(line, 0.2, 6, true, [0.92, 0.96, 1, 1])
  }
}
