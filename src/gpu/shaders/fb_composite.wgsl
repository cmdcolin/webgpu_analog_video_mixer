// Hardware mixer feedback: the mixer's own output (last frame's degraded
// composite, one frame sync of delay) is routed back into an input bus and
// crossfaded against the live signal — no camera, no lens. A fader is a
// crossfade, not a sum, which is why hardware loops regress instead of
// whiting out. The loop delay knob is the cable length: each 70ns sample of
// delay spins fed-back hue 90 degrees per generation. Fed-back burst replaces
// part of live burst, so ACC pumping and color killer dropout at high mix are
// emergent. Amplifier rails clip the output.

// The luma keyer gates the crossfade with a sliced level of the fed-back
// signal itself (self-key): the loop only regenerates where its own picture
// crosses the key level. Negative key amount inverts polarity.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> prev: array<f32>;
@group(0) @binding(2) var<storage, read_write> comp: array<f32>;

// keyer's luma lowpass: a 4-sample boxcar spans one subcarrier cycle exactly
fn keyLuma(pos: f32) -> f32 {
  let i0 = i32(floor(pos)) - 1;
  var acc = 0.0;
  for (var k = 0; k < 4; k = k + 1) {
    acc = acc + prev[clampIdx(i0 + k)];
  }
  return acc * 0.25;
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  let row = gid.y;
  if (s >= SPL || row >= NLINES) {
    return;
  }
  let n = row * SPL + s;
  let pos = f32(n) - P.cfbDelay - P.cfbLines * f32(SPL);
  let i0 = i32(floor(pos));
  let fb = catmull(prev[clampIdx(i0 - 1)], prev[clampIdx(i0)], prev[clampIdx(i0 + 1)], prev[clampIdx(i0 + 2)], fract(pos));
  var m = P.cfbMix;
  if (P.cfbKey != 0.0) {
    var gate = smoothstep(P.cfbKeyLevel - P.cfbKeySoft, P.cfbKeyLevel + P.cfbKeySoft, keyLuma(pos));
    if (P.cfbKey < 0.0) {
      gate = 1.0 - gate;
    }
    m = m * mix(1.0, gate, abs(P.cfbKey));
  }
  comp[n] = clamp(mix(comp[n], P.cfbGain * fb, m), -60.0, 140.0);
}
