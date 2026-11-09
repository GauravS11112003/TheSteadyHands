/**
 * SteadyHandsMath — pure functions for The Steady Hands (no scene access, no Lens types).
 *
 * Owns:
 *  - Suture-count math: count = round(length / spacing) - 1, never below 0.
 *  - Even bite spacing: bite i of n sits at t = i / (n + 1) between the two marked ends.
 *  - Practice-stitch scoring in the 3x cross-section, converted back to REAL skin size:
 *      pass = path stays within toleranceMm of the ideal arc AND the entry angle is
 *             within angleTolDeg of 90 deg to the skin surface AND the path ends at the exit.
 *  - Label formatting ("6.0 cm → 11 sutures", "1 missing").
 *
 * Must not: touch SceneObjects, components, or engine globals. Everything here is
 * deterministic so it can be checked directly from tests (LEAF) or a debugger.
 */

/** A 2D point in cross-section view space (cm, as drawn at the view scale). */
export interface P2 {
  x: number
  y: number
}

/** Ideal simple-interrupted stitch as drawn in the cross-section (view cm). */
export interface StitchGeometry {
  /** Needle entry on the skin surface. */
  entry: P2
  /** Needle exit on the skin surface (mirror of entry across the cut). */
  exit: P2
  /** Centre of the ideal semicircular arc (on the skin surface, at the cut). */
  center: P2
  /** Arc radius in view cm. */
  radius: number
  /** Drawing scale (3 = the cross-section is drawn at 3x real size). */
  viewScale: number
}

export interface StitchScore {
  pass: boolean
  /** Worst distance from the ideal arc, in REAL mm. */
  maxDeviationMm: number
  /** Entry angle to the skin surface in degrees (90 = straight in). */
  entryAngleDeg: number
  /** |90 - entryAngleDeg|. */
  angleErrorDeg: number
  /** Distance from the path's last point to the exit, in REAL mm. */
  endErrorMm: number
  reachedExit: boolean
  /** Short human reason, e.g. "ok", "off the arc", "entry angle", "missed exit". */
  reason: string
}

/** Number of sutures for a marked incision length. 6.0 cm at 0.5 cm spacing → 11. */
export function sutureCountForLength(lengthCm: number, spacingCm: number = 0.5): number {
  if (!(lengthCm > 0) || !(spacingCm > 0)) return 0
  return Math.max(0, Math.round(lengthCm / spacingCm) - 1)
}

/** Fractions along the incision (0..1) for n evenly spaced bites: i / (n + 1). */
export function biteFractions(count: number): number[] {
  const out: number[] = []
  for (let i = 1; i <= count; i++) out.push(i / (count + 1))
  return out
}

/** Bite centre points (pad-local x/z) evenly spaced between two ends. */
export function bitePositions(a: P2, b: P2, count: number): P2[] {
  return biteFractions(count).map((t) => ({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t}))
}

/** Planar distance between two points. */
export function dist(a: P2, b: P2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

/** Length shown to 0.1 cm. */
export function formatLengthCm(lengthCm: number): string {
  return (Math.round(lengthCm * 10) / 10).toFixed(1)
}

/** "6.0 cm → 11 sutures" (singular for 1). */
export function formatCountLabel(lengthCm: number, count: number): string {
  return `${formatLengthCm(lengthCm)} cm → ${count} ${count === 1 ? "suture" : "sutures"}`
}

/** "1 missing" / "2 missing". */
export function formatMissing(needlesOut: number): string {
  return `${needlesOut} missing`
}

/** Needle counter never goes below zero. */
export function clampNeedles(n: number): number {
  return Math.max(0, Math.floor(n))
}

/**
 * Ideal stitch in the cross-section: entry and exit sit `biteFromEdgeCm` (real) from the
 * cut on either side, the arc is a semicircle under the surface so the needle enters
 * at 90 deg to the skin. All returned values are in VIEW cm.
 */
export function idealStitchGeometry(
  surfaceY: number,
  cutX: number,
  biteFromEdgeCm: number = 0.5,
  viewScale: number = 3,
): StitchGeometry {
  const r = biteFromEdgeCm * viewScale
  return {
    entry: {x: cutX - r, y: surfaceY},
    exit: {x: cutX + r, y: surfaceY},
    center: {x: cutX, y: surfaceY},
    radius: r,
    viewScale: viewScale,
  }
}

/** Distance (view cm) from a point to the ideal arc (lower semicircle, entry → exit). */
export function distanceToIdealArc(p: P2, g: StitchGeometry): number {
  if (p.y <= g.center.y) {
    return Math.abs(dist(p, g.center) - g.radius)
  }
  // Above the skin surface: nearest point of the arc is one of its end points.
  return Math.min(dist(p, g.entry), dist(p, g.exit))
}

/** View cm → real mm (1 cm = 10 mm, divided by the drawing scale). */
export function viewCmToRealMm(viewCm: number, viewScale: number): number {
  return (viewCm * 10) / viewScale
}

/** Real mm → view cm. 1.5 mm real at 3x = 0.45 cm (4.5 mm) in the view. */
export function realMmToViewCm(realMm: number, viewScale: number): number {
  return (realMm * viewScale) / 10
}

/**
 * Entry angle of a path to the skin surface, in degrees (90 = perpendicular, the ideal).
 * Takes the chord from the first point to the first point at least `probeDepthViewCm`
 * under the surface, then removes the chord bias of the ideal arc at that same depth, so a
 * path that follows the ideal arc reads exactly 90 deg and a flat skim reads ~0 deg.
 */
export function entryAngleDeg(path: P2[], g: StitchGeometry, probeDepthViewCm: number): number {
  if (path.length < 2) return 0
  const start = path[0]
  for (let i = 1; i < path.length; i++) {
    const depth = g.center.y - path[i].y
    if (depth >= probeDepthViewCm) {
      const dx = Math.abs(path[i].x - start.x)
      const dy = Math.abs(path[i].y - start.y)
      const pathDeg = (Math.atan2(dy, dx) * 180) / Math.PI
      const d = Math.min(depth, g.radius)
      const idealDx = g.radius - Math.sqrt(Math.max(0, g.radius * g.radius - d * d))
      const idealDeg = (Math.atan2(d, idealDx) * 180) / Math.PI
      return Math.max(0, Math.min(180, pathDeg + (90 - idealDeg)))
    }
  }
  return 0
}

/**
 * Score a practice-stitch drag path (view cm) against the ideal arc.
 * Tolerances are given at REAL skin size, so 1.5 mm is checked as 4.5 mm in the 3x view.
 */
export function scoreStitchPath(
  path: P2[],
  g: StitchGeometry,
  toleranceMm: number = 1.5,
  angleTolDeg: number = 15,
): StitchScore {
  if (path.length < 2) {
    return {
      pass: false,
      maxDeviationMm: Infinity,
      entryAngleDeg: 0,
      angleErrorDeg: 90,
      endErrorMm: Infinity,
      reachedExit: false,
      reason: "no path",
    }
  }
  let maxDevView = 0
  for (const p of path) maxDevView = Math.max(maxDevView, distanceToIdealArc(p, g))
  const maxDeviationMm = viewCmToRealMm(maxDevView, g.viewScale)

  // Probe the entry direction 1 mm (real) under the surface.
  const probe = realMmToViewCm(1.0, g.viewScale)
  const angle = entryAngleDeg(path, g, probe)
  const angleErrorDeg = Math.abs(90 - angle)

  const endErrorMm = viewCmToRealMm(dist(path[path.length - 1], g.exit), g.viewScale)
  const reachedExit = endErrorMm <= toleranceMm

  const offArc = maxDeviationMm > toleranceMm
  const badAngle = angleErrorDeg > angleTolDeg
  let reason = "ok"
  if (!reachedExit) reason = "missed exit"
  else if (offArc) reason = "off the arc"
  else if (badAngle) reason = "entry angle"

  return {
    pass: reachedExit && !offArc && !badAngle,
    maxDeviationMm: maxDeviationMm,
    entryAngleDeg: angle,
    angleErrorDeg: angleErrorDeg,
    endErrorMm: endErrorMm,
    reachedExit: reachedExit,
    reason: reason,
  }
}

/** Sample the ideal arc from entry to exit (n + 1 points) — handy for tests and the ghost demo. */
export function idealArcPath(g: StitchGeometry, n: number = 24): P2[] {
  const out: P2[] = []
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (Math.PI * i) / n // 180° (entry, left) → 360° (exit, right), through the bottom
    out.push({x: g.center.x + Math.cos(a) * g.radius, y: g.center.y + Math.sin(a) * g.radius})
  }
  return out
}

/** Straight line from entry to exit (fails: off the arc and 0° entry). */
export function straightPath(g: StitchGeometry, n: number = 12): P2[] {
  const out: P2[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    out.push({x: g.entry.x + (g.exit.x - g.entry.x) * t, y: g.entry.y + (g.exit.y - g.entry.y) * t})
  }
  return out
}

/** [x0, y0, x1, y1, ...] → P2[] (lets tests pass plain number arrays). */
export function pathFromFlat(flat: number[]): P2[] {
  const out: P2[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({x: flat[i], y: flat[i + 1]})
  return out
}

/** P2[] → [x0, y0, x1, y1, ...]. */
export function pathToFlat(path: P2[]): number[] {
  const out: number[] = []
  for (const p of path) out.push(p.x, p.y)
  return out
}
