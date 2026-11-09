/**
 * SteadyHandsAudioController — every sound cue in The Steady Hands, in one place.
 *
 * Owns: one AudioComponent per cue (created at runtime under this SceneObject), cue volumes,
 * and a play counter per cue so tests can check that, e.g., the low mismatch chime played.
 *
 * Expects @inputs: the six generated WAVs in Assets/GeneratedSFX (wired by the bootstrap).
 * Must not: decide when a cue plays — SteadyHandsMain calls play*() as the flow advances.
 */

export type Cue = "click" | "pinch" | "stitchGood" | "stitchMiss" | "mismatch" | "closed"

@component
export class SteadyHandsAudioController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SteadyHandsAudioController – sound cues</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("Soft click for + / − / Ready to close / Close")
  clickTrack: AudioTrackAsset
  @input
  @hint("Tick when a pinch lands on the pad")
  pinchTrack: AudioTrackAsset
  @input
  @hint("Practice stitch turned green")
  stitchGoodTrack: AudioTrackAsset
  @input
  @hint("Practice stitch turned red")
  stitchMissTrack: AudioTrackAsset
  @input
  @hint("LOW chime for a needle-count mismatch on Close")
  mismatchTrack: AudioTrackAsset
  @input
  @hint("Calm confirmation when the wound is closed")
  closedTrack: AudioTrackAsset
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("Master volume for all cues (0–1)")
  @widget(new SliderWidget(0, 1, 0.05))
  masterVolume: number = 0.8
  @input
  @hint("Extra gain on the mismatch chime so it reads clearly (0–1)")
  @widget(new SliderWidget(0, 1, 0.05))
  mismatchVolume: number = 1.0
  @ui.group_end

  private players: {[cue: string]: AudioComponent} = {}
  private counts: {[cue: string]: number} = {}

  onAwake(): void {
    this.addPlayer("click", this.clickTrack, 0.6)
    this.addPlayer("pinch", this.pinchTrack, 0.7)
    this.addPlayer("stitchGood", this.stitchGoodTrack, 0.8)
    this.addPlayer("stitchMiss", this.stitchMissTrack, 0.7)
    this.addPlayer("mismatch", this.mismatchTrack, this.mismatchVolume)
    this.addPlayer("closed", this.closedTrack, 0.8)
  }

  /** Play a cue once. Safe to call before tracks are wired (logs and counts anyway). */
  play(cue: Cue): void {
    this.counts[cue] = (this.counts[cue] ?? 0) + 1
    const p = this.players[cue]
    if (!p) {
      print(`[SteadyHandsAudio] cue '${cue}' has no track wired`)
      return
    }
    if (p.isPlaying()) p.stop(false)
    p.play(1)
  }

  /** How many times a cue has been requested since the Lens started. */
  playCount(cue: Cue): number {
    return this.counts[cue] ?? 0
  }

  private addPlayer(cue: Cue, track: AudioTrackAsset, volume: number): void {
    this.counts[cue] = 0
    if (!track) return
    const so = global.scene.createSceneObject("Cue_" + cue)
    so.setParent(this.getSceneObject())
    const a = so.createComponent("Component.AudioComponent") as AudioComponent
    a.audioTrack = track
    a.volume = Math.max(0, Math.min(1, volume * this.masterVolume))
    // Input-reactive cues: low latency so the sound lands with the pinch (Specs defaults to LowPower).
    a.playbackMode = Audio.PlaybackMode.LowLatency
    this.players[cue] = a
  }
}
