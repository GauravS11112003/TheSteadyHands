/**
 * StageBodyShape — shared shape + tone functions for the procedural patient manikin (plain module).
 *
 * Owns: the body heightfield (torso with gentle anatomy, neck, head with simple face, arms at the
 * sides, legs + feet), the pillow top, the window plateau that makes the abdominal skin pass exactly
 * through the pinch plane (field y = 1.0) round the incision, and the betadine prep tint used by
 * BOTH the body skin and the SkinWindow patch so the two meet seamlessly.
 *
 * Field frame: patient supine along X, head toward +X, midline z = -10, mattress top y = -21.
 * Must not: create scene objects.
 */
import {clamp, lerp, noise1, noise2, smax, smoothstep} from "./StageMeshKit"

export const YM = -21
export const Z0 = -10
export const SURF_Y = 1.0
/** Arm axis offset from the midline (tucked at the sides). */
export const ARM_DZ = 25
/** SkinWindow patch extent (the body mesh leaves exactly this rectangle open). */
export const PATCH_HX = 8.6
export const PATCH_HZ = 6.1
export const PILLOW = {x0: 51, x1: 80, z0: Z0 - 19, z1: Z0 + 19, h: 8}

function knots(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0]
  for (let i = 0; i < xs.length - 1; i++) {
    if (x <= xs[i + 1]) {
      const t = (x - xs[i]) / (xs[i + 1] - xs[i])
      return lerp(ys[i], ys[i + 1], t * t * (3 - 2 * t))
    }
  }
  return ys[ys.length - 1]
}

function logHeight(dz: number, r: number, cy: number): number {
  const q = Math.abs(dz) / r
  if (q < 1) return cy + r * Math.sqrt(1 - q * q)
  return cy - (q - 1) * r * 2
}

function gauss(dx: number, dz: number, rx: number, rz: number): number {
  return Math.exp(-(dx * dx) / (rx * rx) - (dz * dz) / (rz * rz))
}

export function pillowTop(x: number, z: number): number {
  const p = PILLOW
  const ex = Math.min(x - p.x0, p.x1 - x)
  const ez = Math.min(z - p.z0, p.z1 - z)
  const e = Math.min(ex, ez)
  if (e < 0) return YM
  const R = 3.2
  const round = e < R ? Math.sqrt(Math.max(0, 1 - ((R - e) / R) * ((R - e) / R))) : 1
  return YM + p.h * (0.35 + 0.65 * round)
}

/** Base surface under the body: pillow under the head, otherwise the mattress. */
export function baseHeight(x: number, z: number): number {
  return Math.max(YM, pillowTop(x, z))
}

const TX = [-47, -40, -28, -15, 0, 15, 28, 38, 44, 48, 51, 54]
const TH = [-4, 15, 19, 21, 22.6, 24, 25.5, 24, 19.5, 13.5, 6, -4]
const TW = [15, 19, 20, 21.5, 22.6, 22.2, 21.5, 21.5, 20.5, 18.5, 15.5, 11]
/** Cross-section exponent: flatter, broader abdomen (so the prepped field is naturally level). */
const TP = [2.6, 2.8, 3.2, 3.9, 4.4, 3.7, 3.0, 2.8, 2.6, 2.4, 2.3, 2.2]

/** Torso + anatomy, legs, feet, arms, neck, head (no window plateau). */
export function rawBody(x: number, z: number, withLegs: boolean): number {
  let y = YM - 6
  const dzm = z - Z0
  if (x > -50 && x < 56) {
    const H = knots(TX, TH, x)
    const W = knots(TX, TW, x)
    const q = Math.abs(dzm) / W
    const pe = knots(TX, TP, x)
    let h = q < 1 ? YM + H * Math.pow(1 - Math.pow(q, pe), 1 / pe) : YM - (q - 1) * 30
    if (q < 0.95) {
      const inner = 1 - smoothstep(0.75, 0.95, q)
      // pectorals, sternum groove, clavicles, navel — gentle manikin anatomy
      h += 1.3 * (gauss(x - 27, dzm - 8, 8, 7) + gauss(x - 27, dzm + 8, 8, 7)) * inner
      h -= 0.45 * gauss(0, dzm, 1, 1.6) * smoothstep(14, 20, x) * (1 - smoothstep(34, 39, x))
      for (const s of [-1, 1]) {
        const t = clamp((s * dzm - 3) / 13, 0, 1)
        const cx = 41.5 - t * 2.5
        h += 0.55 * gauss(x - cx, 0, 1.1, 1) * smoothstep(2, 4, s * dzm) * (1 - smoothstep(14, 17, s * dzm))
      }
      // rib margin hint + navel
      h += 0.25 * gauss(x - 12, Math.abs(dzm) - 9, 2.5, 6) * inner
      const rn = (x + 8) * (x + 8) + dzm * dzm
      h += -0.55 * Math.exp(-rn / 0.35) + 0.12 * Math.exp(-((Math.sqrt(rn) - 0.9) ** 2) / 0.1)
    }
    y = smax(y, h, 3)
  }
  for (const s of [-1, 1]) {
    if (withLegs && x < -30 && x > -112) {
      const LX = [-112, -102, -88, -75, -60, -42, -30]
      const LR = [3.6, 4.2, 5.4, 6.2, 7.6, 8.8, 8.8]
      const LZ = [7.2, 7.4, 7.8, 8.2, 8.8, 9.5, 9.5]
      const r = knots(LX, LR, x)
      const zc = Z0 + s * knots(LX, LZ, x)
      const knee = 1.6 * Math.exp(-((x + 75) * (x + 75)) / 60)
      y = smax(y, logHeight(z - zc, r, YM + r * 0.8 + knee), 2.5)
    }
    if (withLegs) {
      const fx = (x + 106) / 4.2
      const fz = (z - (Z0 + s * 8)) / 4.6
      const f2 = fx * fx + fz * fz
      if (f2 < 1) y = smax(y, YM + 4 + 13.5 * Math.sqrt(1 - f2), 2.5)
    }
    // arms at the sides: upper arm → elbow → forearm → hand (palm down)
    if (x > -20 && x < 44) {
      const AX = [-6, 4, 12, 26, 40, 44]
      const AR = [2.6, 3.2, 3.5, 4.0, 4.4, 4.4]
      const zc = Z0 + s * ARM_DZ
      if (x > -6) {
        const r = knots(AX, AR, x)
        y = smax(y, logHeight(z - zc, r, YM + r * 0.85), 1.6)
      }
      const hx = (x + 12) / 6.5
      const hz = (z - zc) / 4.1
      const h2 = hx * hx + hz * hz
      if (h2 < 1) y = smax(y, YM + 0.6 + 2.6 * Math.sqrt(1 - h2), 1.2)
    }
  }
  // neck
  if (x > 40 && x < 60) {
    const fade = smoothstep(40, 45, x) * (1 - smoothstep(56, 60, x))
    y = smax(y, logHeight(dzm, 5.8, YM + 7.6) * fade + (YM - 6) * (1 - fade), 2.5)
  }
  // head on the pillow, face up
  const hx = (x - 63.5) / 10.6
  const hz = dzm / 7.9
  const hr = 1 - hx * hx - hz * hz
  if (hr > -0.5) {
    const cy = YM + PILLOW.h - 1.2 + 9.3
    let h = hr > 0 ? cy + 9.3 * Math.sqrt(hr) : cy - 20 * -hr
    if (hr > 0) {
      h += 2.0 * gauss(x - 61.5, dzm, 2.6, 1.05) // nose
      h += 0.5 * gauss(x - 66.2, 0, 1.2, 1) * (1 - smoothstep(4, 5.5, Math.abs(dzm))) // brow
      h -= 0.55 * (gauss(x - 64.8, dzm - 3.2, 1.5, 1.3) + gauss(x - 64.8, dzm + 3.2, 1.5, 1.3)) // eyes
      h += 0.35 * gauss(x - 57.6, dzm, 0.8, 2.2) // lips
      h += 0.4 * gauss(x - 54.8, dzm, 1.4, 2.4) // chin
    }
    y = smax(y, h, 2.2)
  }
  return y
}

/** Weight of the flat skin plateau round the incision (1 inside the SkinWindow patch). */
export function plateauWeight(x: number, z: number): number {
  const dr = Math.max(Math.abs(x) - PATCH_HX, Math.abs(z) - PATCH_HZ)
  return 1 - smoothstep(0, 7, dr)
}

/**
 * Skin surface height used by the body mesh. Inside the SkinWindow patch it is exactly SURF_Y;
 * outside, the body keeps its own shape but is lifted/lowered by the patch-edge offset, decaying
 * over ~7 cm (no ledge over the flanks).
 */
export function skinHeight(x: number, z: number): number {
  const b = rawBody(x, z, false)
  const w = plateauWeight(x, z)
  if (w <= 0) return b
  const xc = clamp(x, -PATCH_HX, PATCH_HX)
  const zc = clamp(z, -PATCH_HZ, PATCH_HZ)
  const inside = xc === x && zc === z
  if (inside) return SURF_Y
  return b + w * (SURF_Y - rawBody(xc, zc, false))
}

/** Betadine prep zone multiplier (soft organic patch around the incision, light for additive). */
export function prepTint(x: number, z: number): [number, number, number] {
  const ang = Math.atan2(z, x)
  const rad = 1 + 0.12 * noise1(ang * 2.2 + 4, 81) + 0.06 * noise1(ang * 6 + 1, 82)
  const d = Math.sqrt((x / 13.5) * (x / 13.5) + (z / 10) * (z / 10)) / rad
  const inside = 1 - smoothstep(0.82, 1.0, d)
  const streak = 0.75 + 0.25 * noise2(x * 0.32 + z * 0.12, z * 0.5, 83) + 0.08 * noise2(x * 1.4, z * 1.4, 84)
  const s = 0.5 * inside * streak
  return [1 - s * 0.02, 1 - s * 0.17, 1 - s * 0.4]
}
