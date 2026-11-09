const path = require('path');
const fs = require('fs');
const audio = require('/Users/gauravshrivastava/.claude/plugins/cache/ls-extensions/ls-clad/1.0.0/skills/build-sfx/tools');
const PROJECT_ASSETS_SFX = '/Users/gauravshrivastava/Projects/ghost-attending/Assets/GeneratedSFX';
fs.mkdirSync(PROJECT_ASSETS_SFX, { recursive: true });
const p = audio.sfx_presets;
const SR = audio.SAMPLE_RATE;

function write(name, buf) {
  audio.mix_bus.masterChain(buf, { normalize: 'peak' });
  audio.WavBuilder.write(buf, path.join(PROJECT_ASSETS_SFX, name + '.wav'));
  console.log('wrote', name);
}

// Soft, quiet button click for + / - / Ready.
write('ButtonClick', p.uiClick({ character: 'soft' }));

// Gentle tick when a pinch lands on the pad.
write('PinchMark', p.uiBlip({ pitch: 3 }));

// Practice stitch passed: soft ascending bells.
write('StitchGood', p.uiSuccess());

// Practice stitch missed: soft, controlled descending tone.
write('StitchMiss', audio.mix_bus.applyFx(p.uiError({ pitch: -2 }), { gain: 0.6 }));

// Needle-count mismatch: LOW two-tone chime (bell C3 then A2), warm, clearly distinct.
function lowChime() {
  const a = audio.synth_voices.bell(48, 0.6, 95, 120); // C3
  const b = audio.synth_voices.bell(45, 0.9, 90, 120); // A2
  const out = new Float32Array(Math.floor(2.4 * SR));
  audio.addInto(out, a, 0, 0.8);
  audio.addInto(out, b, Math.floor(0.32 * SR), 0.85);
  audio.fadeOut(out, 0.4);
  return audio.mix_bus.applyFx(out, { hpf: 70, lpf: 3200, reverb: 'mediumRoom', gain: 0.9 });
}
write('MismatchChime', lowChime());

// Closed: calm rising confirmation bells (higher, brighter than the mismatch chime).
write('ClosedChime', p.uiNotify());
