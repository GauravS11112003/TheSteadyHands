/**
 * StageSkin — the prepped skin window with a true 3D incision (STAGE stand-in, preview look).
 *
 * Owns:
 *  - A procedural skin patch (x ±8.6, z ±6.1) set into the patient's abdomen (StageBody leaves
 *    exactly this rectangle open): flat at field y = +1.0 (pad-local y = +0.5, the SuturePad's
 *    pinch plane), slightly everted at the wound lips, with a faint redness halo and the shared
 *    betadine prep tint (vertex colour multiplied onto the skin albedo), so it blends seamlessly.
 *  - The 6.0 cm wound: a lens-shaped slit along x ∈ [-3, 3] at z = 0 (~2.5 mm gape at the centre,
 *    ~1.2 cm deep) whose walls show epidermis / dermis / lobular fat / dark-red base.
 *
 * Expects: this SceneObject sits at the SurgicalField origin (identity, unit scale), i.e. its
 * local frame IS the field frame. @inputs: skin material (UberPBR, vertex colour → base colour),
 * wound material (UberPBR, vertex colour → base colour, wet/low roughness).
 * Must not: move the pinch plane, own any collider or interaction (SuturePad does that).
 */
import {MeshKit, RGBA, V3, addMeshObject, clamp, noise2, smoothstep} from "./StageMeshKit"
import {prepTint} from "./StageBodyShape"

const SURF_Y = 1.0
const HALF_LEN = 3.0
const HALF_GAPE = 0.125
const DEPTH = 1.2
const WIN_HX = 7.5
const WIN_HZ = 5.0
const EXT_X = 8.6
const EXT_Z = 6.1

@component
export class StageSkin extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">StageSkin – prepped skin window + 3D incision (stand-in)</span>')
  @input
  @hint("Skin material (UberPBR: skin albedo + normal, Vertex Color = Base Color)")
  skinMaterial: Material
  @input
  @hint("Wound wall material (UberPBR, Vertex Color = Base Color, low roughness)")
  woundMaterial: Material
  @input
  @hint("Lip eversion height at the wound centre, cm (keep ≤ 0.05 so bite dots stay visible)")
  eversionCm: number = 0.035

  /** Triangle counts of the built meshes (for budgeting / reports). */
  skinTriangles = 0
  woundTriangles = 0

  onAwake(): void {
    const root = this.getSceneObject()
    const skin = this.buildSkin()
    const wound = this.buildWound()
    this.skinTriangles = skin.triangleCount
    this.woundTriangles = wound.triangleCount
    addMeshObject(root, "SkinSurface", skin, this.skinMaterial, MeshShadowMode.Receiver)
    addMeshObject(root, "IncisionWalls", wound, this.woundMaterial, MeshShadowMode.Receiver)
  }

  /** Half gape (cm) of the wound at x. */
  private gape(x: number): number {
    const q = 1 - (x / HALF_LEN) * (x / HALF_LEN)
    return q > 0 ? HALF_GAPE * Math.pow(q, 0.75) : 0
  }

  private depth(x: number): number {
    const q = 1 - (x / HALF_LEN) * (x / HALF_LEN)
    return q > 0 ? DEPTH * Math.pow(q, 0.5) : 0
  }

  private envelope(x: number): number {
    const q = 1 - (x / HALF_LEN) * (x / HALF_LEN)
    return q > 0 ? Math.pow(q, 0.5) : 0
  }

  private columns(): number[] {
    const xs: number[] = []
    for (let x = -EXT_X; x < -3.6 - 1e-6; x += 0.5) xs.push(x)
    for (let k = 0; k <= 60; k++) xs.push(-3.6 + k * 0.12)
    for (let x = 3.6 + 0.5; x <= EXT_X + 1e-6; x += 0.5) xs.push(Math.min(x, EXT_X))
    if (xs[xs.length - 1] < EXT_X - 1e-6) xs.push(EXT_X)
    return xs
  }

  private skinColor(x: number, z: number, edgeDist: number): RGBA {
    // betadine prep: the same organic patch the body mesh uses, so the seam is invisible
    const p = prepTint(x, z)
    let r = p[0]
    let g = p[1]
    let bl = p[2]
    // faint redness halo around the wound
    const dx = Math.max(0, Math.abs(x) - HALF_LEN)
    const dWound = Math.sqrt(dx * dx + z * z)
    const halo = 0.55 * Math.exp(-Math.max(0, dWound - this.gape(x)) / 0.32) * (0.8 + 0.2 * noise2(x * 2, z * 2, 13))
    g *= 1 - halo * 0.3
    bl *= 1 - halo * 0.3
    r *= 1 - halo * 0.03
    // the lip itself: a hair rosier
    if (Math.abs(x) < HALF_LEN) {
      const lip = Math.exp(-edgeDist / 0.025) * this.envelope(x)
      g *= 1 - lip * 0.42
      bl *= 1 - lip * 0.4
      r *= 1 - lip * 0.08
    }
    return [r, g, bl, 1]
  }

  private buildSkin(): MeshKit {
    const kit = new MeshKit()
    const xs = this.columns()
    const ROWS = 26
    const ev = this.eversionCm
    for (const side of [1, -1]) {
      const P: V3[][] = []
      const UV: [number, number][][] = []
      const C: RGBA[][] = []
      for (let j = 0; j <= ROWS; j++) {
        const t = j / ROWS
        const row: V3[] = []
        const uvRow: [number, number][] = []
        const cRow: RGBA[] = []
        for (const x of xs) {
          const w = this.gape(x)
          const d = (EXT_Z - w) * Math.pow(t, 2.2)
          const z = side * (w + d)
          const y = SURF_Y + ev * Math.exp(-d / 0.15) * this.envelope(x)
          row.push([x, y, z])
          uvRow.push([x / 4.0 + 0.37, -z / 4.0 + 0.61])
          cRow.push(this.skinColor(x, z, d))
        }
        P.push(row)
        UV.push(uvRow)
        C.push(cRow)
      }
      // near half (side +1): rows run toward +z, so dPu × dPv = x × z points down → flip.
      kit.grid(P, UV, {flip: side > 0, colorAt: (i, j) => C[j][i]})
    }
    return kit
  }

  private wallColor(depth: number, x: number, s: number): RGBA {
    const epi: V3 = [0.97, 0.88, 0.82]
    const derm: V3 = [0.95, 0.62, 0.62]
    const fat: V3 = [1.0, 0.86, 0.5]
    const base: V3 = [0.62, 0.14, 0.13]
    const lob = 0.08 * noise2(x * 4.0, depth * 5.0, 21) + 0.05 * noise2(x * 9.0, depth * 11.0, 22)
    const mix = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
    let c = mix(epi, derm, smoothstep(0.05, 0.09, depth))
    const fatC: V3 = [fat[0], clamp(fat[1] + lob, 0, 1), clamp(fat[2] + lob * 1.5, 0, 1)]
    c = mix(c, fatC, smoothstep(0.3, 0.36, depth))
    c = mix(c, base, smoothstep(0.92, 1.05, depth))
    const ao = 1 - 0.3 * s * s
    return [c[0] * ao, c[1] * ao, c[2] * ao, 1]
  }

  private buildWound(): MeshKit {
    const kit = new MeshKit()
    const xs = this.columns().filter((x) => Math.abs(x) < HALF_LEN + 1e-6)
    const ss = [0, 0.03, 0.07, 0.12, 0.18, 0.25, 0.33, 0.42, 0.52, 0.62, 0.72, 0.8, 0.87, 0.93, 0.97, 1]
    const ev = this.eversionCm
    for (const side of [1, -1]) {
      const P: V3[][] = []
      const UV: [number, number][][] = []
      const C: RGBA[][] = []
      for (const s of ss) {
        const row: V3[] = []
        const uvRow: [number, number][] = []
        const cRow: RGBA[] = []
        for (const x of xs) {
          const w = this.gape(x)
          const D = this.depth(x)
          const dep = D * s
          const top = SURF_Y + ev * this.envelope(x)
          // lens profile: slight overhang at the lip, closing to the base line z = 0
          const z = side * w * Math.pow(Math.max(0, 1 - s * s), 0.6) * (1 + 0.15 * Math.sin(s * Math.PI))
          row.push([x, top - dep, z])
          uvRow.push([x * 0.5, dep * 0.5])
          cRow.push(this.wallColor(dep, x, s))
        }
        P.push(row)
        UV.push(uvRow)
        C.push(cRow)
      }
      // far wall (side −1) faces +z: dPu × dPv = x × (down, +z) points into tissue → flip.
      kit.grid(P, UV, {flip: side < 0, colorAt: (i, j) => C[j][i]})
    }
    return kit
  }
}
