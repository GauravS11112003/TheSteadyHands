/**
 * StageDrape — the draped patient (STAGE stand-in, preview look).
 *
 * Owns:
 *  - An invisible body form (smooth union of torso super-ellipse, legs, feet and tucked arms,
 *    supine along field X, head toward +X, midline at field z = -10, on the mattress top y = -21).
 *  - The main surgical drape: a cloth heightfield relaxed over that form (bridges between limbs,
 *    sags under gravity), with soft folds, wrapping over the table edges into a hanging skirt with
 *    vertical folds, and a 15 × 10 cm fenestration centred at field (0, 1, 0).
 *  - The raised incise rim around the fenestration (real thickness, ~1 cm proud of the skin).
 *  - The anesthesia ether screen at the head end: a curtain hung over a bar at x ≈ 46.
 *
 * Expects: this SceneObject sits at the SurgicalField origin (identity, unit scale).
 * @inputs: drape material (UberPBR cloth, two-sided), rim material, chrome material (bar).
 * Must not: own colliders or interaction; it is a visual stand-in only.
 */
import {MeshKit, RGBA, V3, addMeshObject, clamp, lerp, noise1, noise2, smax, smoothstep} from "./StageMeshKit"

const YM = -21 // mattress top
const Z0 = -10 // patient midline
const TABLE_X0 = -110
const TABLE_Z_NEAR = 17.5
const TABLE_Z_FAR = -37.5
const DRAPE_X1 = 50 // drape runs under the ether screen and stops here
const SCREEN_X = 46
const T = 0.35 // cloth offset above the form
const WIN_HX = 7.5
const WIN_HZ = 5.0
const WIN_Y = 1.3 // drape level at the fenestration (skin is at 1.0, rim covers the step)
const CORNER_R = 4 // cloth bend radius over the table edge
const HANG = 44 // skirt length below the table edge
const TILE = 12 // cm per fabric texture repeat

/** Piecewise-smooth interpolation through (x, y) knots. */
function knots(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0]
  for (let i = 0; i < xs.length - 1; i++) {
    if (x <= xs[i + 1]) {
      const t = (x - xs[i]) / (xs[i + 1] - xs[i])
      const u = t * t * (3 - 2 * t)
      return lerp(ys[i], ys[i + 1], u)
    }
  }
  return ys[ys.length - 1]
}

/** Height of an elliptic "log" of radius r whose centre sits h above the mattress; continues downward outside. */
function logHeight(dz: number, r: number, cy: number): number {
  const q = Math.abs(dz) / r
  if (q < 1) return cy + r * Math.sqrt(1 - q * q)
  return cy - (q - 1) * r * 2
}

function bodyHeight(x: number, z: number): number {
  let y = YM - 6
  // torso: flat-topped super-ellipse cross-section
  const TX = [-47, -40, -28, -15, 0, 15, 28, 38, 44, 49]
  const TH = [-4, 15, 19, 21, 22.6, 24, 25.5, 24, 18, -4]
  const TW = [15, 19.5, 20, 19.5, 20.5, 21, 22, 22.5, 21, 17]
  if (x > -50 && x < 52) {
    const H = knots(TX, TH, x)
    const W = knots(TX, TW, x)
    const q = Math.abs(z - Z0) / W
    let h: number
    if (q < 1) h = YM + H * Math.pow(1 - Math.pow(q, 3.2), 1 / 3.2)
    else h = YM - (q - 1) * 30
    y = smax(y, h, 3)
  }
  // legs: thigh → knee → ankle, lying on the mattress
  for (const s of [-1, 1]) {
    if (x < -30 && x > -112) {
      const LX = [-112, -102, -88, -75, -60, -42, -30]
      const LR = [3.6, 4.2, 5.4, 6.2, 7.6, 8.8, 8.8]
      const LZ = [7.2, 7.4, 7.8, 8.2, 8.8, 9.5, 9.5]
      const r = knots(LX, LR, x)
      const zc = Z0 + s * knots(LX, LZ, x)
      const knee = 1.6 * Math.exp(-((x + 75) * (x + 75)) / 60)
      const h = logHeight(z - zc, r, YM + r * 0.8 + knee)
      y = smax(y, h, 2.5)
    }
    // feet, toes up
    const fx = (x + 106) / 4.2
    const fz = (z - (Z0 + s * 8)) / 4.6
    const f2 = fx * fx + fz * fz
    if (f2 < 1) y = smax(y, YM + 4 + 13.5 * Math.sqrt(1 - f2), 2.5)
    // arms tucked at the sides
    if (x > -16 && x < 42) {
      const AX = [-16, -8, 10, 30, 42]
      const AR = [2.8, 3.4, 3.9, 4.6, 4.6]
      const r = knots(AX, AR, x)
      const zc = Z0 + s * 25
      const h = logHeight(z - zc, r, YM + r * 0.85)
      y = smax(y, h, 2.0)
    }
  }
  return Math.max(y, YM)
}

/** Baked OR-lamp pool: bright round the fenestration, falling off softly over ~40 cm. */
function lightPool(x: number, z: number): number {
  const r2 = (x * x) / (42 * 42) + ((z + 3) * (z + 3)) / (30 * 30)
  return 0.6 + 0.4 * Math.exp(-r2 * 1.4)
}

/** Out/down offsets of cloth wrapped over an edge of radius CORNER_R, after hanging length h. */
function wrap(h: number): [number, number] {
  const arc = (Math.PI / 2) * CORNER_R
  if (h <= arc) {
    const th = h / CORNER_R
    return [CORNER_R * Math.sin(th), CORNER_R * (1 - Math.cos(th))]
  }
  const extra = h - arc
  return [CORNER_R + extra * 0.06, CORNER_R + extra]
}

/** Irregular 1D fold profile (−1..1) along a coordinate. */
function folds(s: number, seed: number): number {
  const ph = 1.3 * noise1(s / 23, seed)
  const a = Math.sin((s / 8.5) * Math.PI * 2 + ph * 3)
  const b = Math.sin((s / 4.1) * Math.PI * 2 + ph * 5 + 1.3)
  const amp = 0.65 + 0.35 * noise1(s / 11 + 7, seed + 1)
  return (0.72 * a + 0.28 * b) * amp
}

@component
export class StageDrape extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">StageDrape – draped patient, fenestration, ether screen (stand-in)</span>')
  @input
  @hint("Drape cloth material (UberPBR, two-sided, Vertex Color = Base Color)")
  drapeMaterial: Material
  @input
  @hint("Incise rim material around the fenestration")
  rimMaterial: Material
  @input
  @hint("Chrome material for the ether-screen bar")
  chromeMaterial: Material

  drapeTriangles = 0
  rimTriangles = 0
  screenTriangles = 0

  // relaxed cloth heightfield on a 1 cm grid
  private gx0 = TABLE_X0
  private gz0 = TABLE_Z_FAR
  private gnx = 0
  private gnz = 0
  private D: Float32Array
  private O: Float32Array

  onAwake(): void {
    const root = this.getSceneObject()
    this.relax()
    const drape = this.buildDrape()
    const rim = this.buildRim()
    const screen = this.buildScreen()
    const bar = this.buildBar()
    this.drapeTriangles = drape.triangleCount
    this.rimTriangles = rim.triangleCount
    this.screenTriangles = screen.triangleCount + bar.triangleCount
    addMeshObject(root, "DrapeCloth", drape, this.drapeMaterial, MeshShadowMode.Receiver)
    addMeshObject(root, "FenestrationRim", rim, this.rimMaterial, MeshShadowMode.Receiver)
    addMeshObject(root, "EtherScreen", screen, this.drapeMaterial, MeshShadowMode.Receiver)
    addMeshObject(root, "EtherScreenBar", bar, this.chromeMaterial, MeshShadowMode.None)
  }

  // ---------------------------------------------------------------- cloth heightfield
  private relax(): void {
    this.gnx = Math.ceil(DRAPE_X1 - this.gx0) + 1
    this.gnz = Math.ceil(TABLE_Z_NEAR - this.gz0) + 1
    const nx = this.gnx
    const nz = this.gnz
    const O = new Float32Array(nx * nz)
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        O[k * nx + i] = bodyHeight(this.gx0 + i, this.gz0 + k) + T
      }
    }
    // obstacle membrane under gravity: D ≥ O, D ≤ avg(neighbours) − g; edges pinned to the table top
    const D = new Float32Array(O)
    const g = 0.05
    const tmp = new Float32Array(O.length)
    for (let it = 0; it < 120; it++) {
      for (let k = 0; k < nz; k++) {
        for (let i = 0; i < nx; i++) {
          const id = k * nx + i
          if (i === 0 || k === 0 || k === nz - 1 || i === nx - 1) {
            tmp[id] = O[id]
            continue
          }
          const avg = 0.25 * (D[id - 1] + D[id + 1] + D[id - nx] + D[id + nx])
          tmp[id] = Math.max(O[id], avg - g)
        }
      }
      D.set(tmp)
    }
    this.D = D
    this.O = O
  }

  private sampleField(F: Float32Array, x: number, z: number): number {
    const fx = clamp(x - this.gx0, 0, this.gnx - 1.0001)
    const fz = clamp(z - this.gz0, 0, this.gnz - 1.0001)
    const i = Math.floor(fx)
    const k = Math.floor(fz)
    const tx = fx - i
    const tz = fz - k
    const nx = this.gnx
    const a = F[k * nx + i]
    const b = F[k * nx + i + 1]
    const c = F[(k + 1) * nx + i]
    const d = F[(k + 1) * nx + i + 1]
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz)
  }

  /** Window weight: 1 at the fenestration (forced flat), 0 a few cm away. */
  private winWeight(x: number, z: number): number {
    const dr = Math.max(Math.abs(x) - WIN_HX, Math.abs(z) - WIN_HZ)
    return 1 - smoothstep(1.2, 7.5, dr)
  }

  /** Cloth top height (with soft folds) at a point on the table footprint. */
  private clothTop(x: number, z: number): {y: number; ao: number} {
    const d = this.sampleField(this.D, x, z)
    const o = this.sampleField(this.O, x, z)
    // slope across the body (flanks) drives the vertical fold amplitude
    const sz = (this.sampleField(this.D, x, z + 1) - this.sampleField(this.D, x, z - 1)) * 0.5
    const slope = clamp(Math.abs(sz), 0, 1.6)
    const bridge = clamp((d - o) / 1.5, 0, 1)
    const ww = this.winWeight(x, z)
    const edgeFade = smoothstep(0, 6, Math.min(z - TABLE_Z_FAR, TABLE_Z_NEAR - z, x - TABLE_X0))
    let amp = (0.18 + 0.75 * slope + 0.45 * bridge) * (1 - ww) * (0.35 + 0.65 * edgeFade)
    const f = folds(x + 3.0 * noise1(z / 9, 5), 31) * amp + 0.25 * noise2(x / 6, z / 6, 33) * (1 - ww)
    let y = lerp(d, WIN_Y, ww) + f
    // contact AO: valleys of the fold pattern and the tent edges read a little darker
    const ao = (1 - 0.16 * clamp(-f / 1.2, 0, 1) - 0.08 * bridge) * lightPool(x, z)
    return {y, ao}
  }

  private topXs(): number[] {
    const xs: number[] = []
    for (let x = TABLE_X0; x < -14 - 1e-6; x += 3) xs.push(x)
    for (let x = -14; x < 14 - 1e-6; x += 0.5) xs.push(x)
    for (let x = 14; x <= DRAPE_X1 + 1e-6; x += 2) xs.push(x)
    return xs
  }

  private topZs(): number[] {
    // from near edge (+z) to far edge (−z)
    const zs: number[] = []
    for (let k = 0; k < 4; k++) zs.push(TABLE_Z_NEAR - k * 1.75)
    for (let z = 10.5; z > -10.5 + 1e-6; z -= 0.5) zs.push(z)
    for (let k = 0; k <= 15; k++) zs.push(-10.5 - k * 1.8)
    return zs
  }

  private hangSteps(): number[] {
    return [0, 1.5, 3.3, 5.5, 9, 14, 21, 29, 37, 44].map((h) => (h / 44) * HANG)
  }

  private buildDrape(): MeshKit {
    const kit = new MeshKit()
    const hs = this.hangSteps()
    const xsTop = this.topXs()
    const zsTop = this.topZs()
    // columns: foot skirt (hang descending to 0) then the top xs
    const colX: number[] = []
    const colH: number[] = []
    for (let k = hs.length - 1; k >= 1; k--) {
      colX.push(TABLE_X0)
      colH.push(hs[k])
    }
    for (const x of xsTop) {
      colX.push(x)
      colH.push(0)
    }
    // rows: near skirt (hang descending), top zs, far skirt (hang ascending)
    const rowZ: number[] = []
    const rowH: number[] = []
    const rowSide: number[] = []
    for (let k = hs.length - 1; k >= 1; k--) {
      rowZ.push(TABLE_Z_NEAR)
      rowH.push(hs[k])
      rowSide.push(1)
    }
    for (const z of zsTop) {
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
        const top = this.clothTop(x, z)
        let px = x
        let pz = z
        let py = top.y
        let ao = top.ao
        if (hx > 0 || hz > 0) {
          // hem length varies a little so the skirt edge is not ruler-straight
          const hemVar = 1 + 0.05 * noise1((x + z) / 13, 41)
          const hxx = hx * hemVar
          const hzz = hz * hemVar
          const [ox] = wrap(hxx)
          const [oz] = wrap(hzz)
          const [, down] = wrap(Math.sqrt(hxx * hxx + hzz * hzz))
          const yEdge = this.clothTop(x, z).y
          py = yEdge - down
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
    const nTopCols0 = hs.length - 1
    const nTopRows0 = hs.length - 1
    const nTopRows1 = nTopRows0 + zsTop.length - 1
    kit.grid(P, UV, {
      colorAt: (i, j) => C[j][i],
      keepQuad: (i, j) => {
        if (i < nTopCols0 || j < nTopRows0 || j >= nTopRows1) return true
        const xc = 0.5 * (colX[i] + colX[i + 1])
        const zc = 0.5 * (rowZ[j] + rowZ[j + 1])
        return !(Math.abs(xc) < WIN_HX && Math.abs(zc) < WIN_HZ)
      },
    })
    return kit
  }

  // ---------------------------------------------------------------- fenestration rim
  private buildRim(): MeshKit {
    const kit = new MeshKit()
    // closed path round the window, counter-clockwise seen from +y with +x→+z at the +x side
    const rc = 0.7
    const path: {p: [number, number]; n: [number, number]}[] = []
    const corners: [number, number, number][] = [
      [WIN_HX - rc, WIN_HZ - rc, 0],
      [-WIN_HX + rc, WIN_HZ - rc, Math.PI / 2],
      [-WIN_HX + rc, -WIN_HZ + rc, Math.PI],
      [WIN_HX - rc, -WIN_HZ + rc, (3 * Math.PI) / 2],
    ]
    // start at the +x side, z = -(WIN_HZ - rc) going +z
    for (let c = 0; c < 4; c++) {
      const [cx, cz, a0] = corners[c]
      const prev = corners[(c + 3) % 4]
      // straight segment from previous corner arc end to this corner arc start
      const startA = a0
      const sx = prev[0] + rc * Math.cos(startA)
      const sz = prev[1] + rc * Math.sin(startA)
      const ex = cx + rc * Math.cos(startA)
      const ez = cz + rc * Math.sin(startA)
      const len = Math.hypot(ex - sx, ez - sz)
      const nSeg = Math.max(1, Math.round(len / 0.8))
      for (let k = 0; k < nSeg; k++) {
        const t = k / nSeg
        path.push({p: [lerp(sx, ex, t), lerp(sz, ez, t)], n: [Math.cos(startA), Math.sin(startA)]})
      }
      for (let k = 0; k < 6; k++) {
        const a = startA + (k / 6) * (Math.PI / 2)
        path.push({p: [cx + rc * Math.cos(a), cz + rc * Math.sin(a)], n: [Math.cos(a), Math.sin(a)]})
      }
    }
    path.push(path[0])
    // profile: (outward offset from the window edge, height)
    const prof: [number, number][] = [
      [0.0, 0.9],
      [0.0, 1.45],
      [0.03, 1.72],
      [0.14, 1.9],
      [0.34, 2.0],
      [0.6, 2.04],
      [0.95, 2.02],
      [1.3, 1.94],
      [1.7, 1.8],
      [2.1, 1.62],
      [2.5, 1.45],
      [2.9, 1.3],
      [3.3, 1.16],
    ]
    const P: V3[][] = []
    const UV: [number, number][][] = []
    let along = 0
    const alongs: number[] = []
    for (let i = 0; i < path.length; i++) {
      if (i > 0) along += Math.hypot(path[i].p[0] - path[i - 1].p[0], path[i].p[1] - path[i - 1].p[1])
      alongs.push(along)
    }
    for (const [o, y] of prof) {
      const row: V3[] = []
      const uvRow: [number, number][] = []
      for (let i = 0; i < path.length; i++) {
        const {p, n} = path[i]
        const px = p[0] + n[0] * o
        const pz = p[1] + n[1] * o
        // outer part of the rim follows the cloth so it tucks under the drape smoothly
        const ty = this.clothTop(px, pz).y
        const blend = smoothstep(1.4, 3.3, o)
        row.push([px, lerp(y, Math.max(ty + 0.05, Math.min(y, ty + 0.4)), blend), pz])
        uvRow.push([alongs[i] / TILE, o / TILE])
      }
      P.push(row)
      UV.push(uvRow)
    }
    kit.grid(P, UV, {
      colorAt: (i, j) => {
        const k = j === 0 ? 0.55 : j === 1 ? 0.8 : 1
        return [k, k, k, 1]
      },
    })
    return kit
  }

  // ---------------------------------------------------------------- ether screen
  private buildScreen(): MeshKit {
    const kit = new MeshKit()
    const z0 = -46
    const z1 = 24
    const barY = 34
    const barR = 1.6
    const xb = SCREEN_X + barR
    const zs: number[] = []
    for (let z = z0; z <= z1 + 1e-6; z += 1.75) zs.push(z)
    // rows from the bottom of the front face, up, over the bar, down the back
    const frontYs: number[] = []
    const nFront = 26
    for (let k = 0; k <= nFront; k++) frontYs.push(k / nFront)
    const arcN = 8
    const backN = 6
    const P: V3[][] = []
    const UV: [number, number][][] = []
    const C: RGBA[][] = []
    const rowsPerCol: V3[][] = []
    for (const z of zs) {
      // bottom: tucked into the drape over the table, hanging free beyond it
      let yBot: number
      const onTable = z < TABLE_Z_NEAR + 1 && z > TABLE_Z_FAR - 1
      if (onTable) yBot = this.clothTop(SCREEN_X, clamp(z, TABLE_Z_FAR, TABLE_Z_NEAR)).y - 0.6
      else yBot = -58 + 2 * noise1(z / 7, 61)
      const blendEdge = smoothstep(TABLE_Z_NEAR - 1, TABLE_Z_NEAR + 5, z) + smoothstep(TABLE_Z_FAR + 1, TABLE_Z_FAR - 5, z)
      if (onTable && blendEdge > 0) yBot = lerp(yBot, -58, clamp(blendEdge, 0, 1))
      const col: V3[] = []
      for (const t of frontYs) {
        const y = lerp(yBot, barY, t)
        const gather = smoothstep(barY - 6, barY, y)
        const amp = 0.4 + 1.6 * (1 - t) * (1 - t) + 0.6 * gather
        const f = folds(z + 1.5 * noise1(y / 15, 63), 65) * amp
        col.push([SCREEN_X - Math.max(0, f + amp * 0.6) * (1 - gather * 0.7), y, z])
      }
      for (let k = 1; k <= arcN; k++) {
        const a = Math.PI - (k / arcN) * Math.PI
        col.push([xb + barR * Math.cos(a), barY + barR * Math.sin(a), z])
      }
      for (let k = 1; k <= backN; k++) {
        const y = barY - (k / backN) * 9
        const f = folds(z + 4, 67) * 0.5 * (k / backN)
        col.push([xb + barR + f + 0.4 * (k / backN), y, z])
      }
      rowsPerCol.push(col)
    }
    const nRows = rowsPerCol[0].length
    for (let j = 0; j < nRows; j++) {
      const row: V3[] = []
      const uvRow: [number, number][] = []
      const cRow: RGBA[] = []
      for (let i = 0; i < zs.length; i++) {
        const p = rowsPerCol[i][j]
        row.push(p)
        uvRow.push([zs[i] / TILE, (j < nFront + 1 ? p[1] : barY + (j - nFront) * 1.2) / TILE])
        const shade = j <= nFront ? 1 - 0.12 * clamp((SCREEN_X - p[0]) / 2.5, 0, 1) : 0.85
        cRow.push([shade, shade, shade, 1])
      }
      P.push(row)
      UV.push(uvRow)
      C.push(cRow)
    }
    // columns along +z, rows up the front: dPu × dPv = z × y = −x → faces the patient side
    kit.grid(P, UV, {colorAt: (i, j) => C[j][i]})
    return kit
  }

  private buildBar(): MeshKit {
    const kit = new MeshKit()
    const xb = SCREEN_X + 1.6
    const pts: V3[] = []
    // U-shaped bar: posts at both ends drop to the rail clamps, bend radius 3
    const zA = -49
    const zB = 27
    const R = 3
    const yTop = 34
    for (let k = 0; k <= 6; k++) pts.push([xb, lerp(-31, yTop - R, k / 6), zA])
    for (let k = 1; k <= 8; k++) {
      const a = Math.PI - (k / 8) * (Math.PI / 2)
      pts.push([xb, yTop - R + R * Math.sin(a), zA + R + R * Math.cos(a)])
    }
    for (let k = 1; k <= 10; k++) pts.push([xb, yTop, lerp(zA + R, zB - R, k / 10)])
    for (let k = 1; k <= 8; k++) {
      const a = Math.PI / 2 - (k / 8) * (Math.PI / 2)
      pts.push([xb, yTop - R + R * Math.sin(a), zB - R + R * Math.cos(a)])
    }
    for (let k = 1; k <= 6; k++) pts.push([xb, lerp(yTop - R, -31, k / 6), zB])
    kit.tube(dedupe(pts), 0.9, 12, true)
    return kit
  }
}

function dedupe(pts: V3[]): V3[] {
  const out: V3[] = []
  for (const p of pts) {
    const q = out[out.length - 1]
    if (!q || Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) > 1e-3) out.push(p)
  }
  return out
}
