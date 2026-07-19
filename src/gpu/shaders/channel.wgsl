// The tape/transmission channel, all on the 1D composite signal:
//  - luma path: (composite - chroma) through the bandwidth/peaking FIR
//  - chroma path: direct, or up-converted back from color-under (with per-line
//    playback phase jitter -> the VHS rainbow instability), re-bandpassed
//  - multipath ghost, band-limited AM noise, 60Hz hum, RF dropouts,
//    head-switch noise band
// Runs once per dub generation; P.gen decorrelates the noise seeds.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> filters: array<f32>;
@group(0) @binding(2) var<storage, read> comp: array<f32>;
@group(0) @binding(3) var<storage, read> chroma: array<f32>;
@group(0) @binding(4) var<storage, read> under: array<f32>;
@group(0) @binding(5) var<storage, read> lineParams: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> outBuf: array<f32>;

fn cosUp(row: u32, s: f32) -> f32 {
  let lp = lineParams[row];
  return cos(lp.y + lp.z + 2.0 * PI * fract(DOWN_PER_SAMPLE * s));
}

var<workgroup> tileLc: array<f32, TILE>; // luma-path source: comp - chroma
var<workgroup> tileUn: array<f32, TILE>; // color-under signal

@compute @workgroup_size(64, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let row = wid.y;
  let base = i32(row * SPL + wid.x * 64u) - i32(HALO);
  for (var i = lid.x; i < TILE; i = i + 64u) {
    let ci = clampIdx(base + i32(i));
    tileLc[i] = comp[ci] - chroma[ci];
  }
  if (P.colorUnderMix > 0.0) {
    for (var i = lid.x; i < TILE; i = i + 64u) {
      tileUn[i] = under[clampIdx(base + i32(i))];
    }
  }
  workgroupBarrier();

  let s = gid.x;
  if (s >= SPL) {
    return;
  }
  let n = row * SPL + s;

  // luma through the channel FIR
  let ml = (LUMA_TAPS - 1u) / 2u;
  var luma = 0.0;
  for (var k = 0u; k < LUMA_TAPS; k = k + 1u) {
    luma = luma + filters[SEC_LUMA * FILTER_STRIDE + k] * tileLc[lid.x + HALO + k - ml];
  }

  // chroma: crossfade direct <-> color-under playback (up-convert + bandpass)
  var chr = chroma[n];
  if (P.colorUnderMix > 0.0) {
    let mb = (CHROMA_BP_TAPS - 1u) / 2u;
    var up = 0.0;
    for (var k = 0u; k < CHROMA_BP_TAPS; k = k + 1u) {
      let si = i32(s) + i32(k) - i32(mb);
      up = up + filters[SEC_CHROMA_BP * FILTER_STRIDE + k] * tileUn[lid.x + HALO + k - mb] * 2.0 * cosUp(row, f32(si));
    }
    chr = mix(chr, up, P.colorUnderMix);
  }

  var out = luma + chr;

  // multipath ghost of the pre-channel signal
  if (P.ghostGain != 0.0) {
    let gpos = f32(n) - P.ghostDelay;
    let g0 = i32(floor(gpos));
    out = out + P.ghostGain
      * catmull(comp[clampIdx(g0 - 1)], comp[clampIdx(g0)], comp[clampIdx(g0 + 1)], comp[clampIdx(g0 + 2)], fract(gpos));
  }

  // additive noise (snow), 1-2-1 band-limited: receiver noise comes through
  // the IF filter, so it has no energy near the top of the 14.3 MHz raster
  if (P.noiseSigma > 0.0) {
    let ns = pcg(P.frame * 2654435761u + P.gen * 2246822519u);
    out = out + P.noiseSigma * 0.4082 * (gauss((n - 1u) ^ ns) + 2.0 * gauss(n ^ ns) + gauss((n + 1u) ^ ns));
  }

  // 60 Hz hum: one cycle per field, slowly rolling
  if (P.humAmp > 0.0) {
    out = out + P.humAmp * sin(2.0 * PI * (f32(row) / f32(NLINES) + f32(P.frame) * 0.0037));
  }

  // 4.5 MHz FM sound carrier leaking past the trap. It is exactly 286
  // cycles/line (fH = 4.5MHz/286), i.e. 11/35 of the sample rate, so the
  // weave is stationary until the audio FM (buzz) moves it.
  if (P.soundIre > 0.0) {
    let ph = f32((11u * s) % 35u) / 35.0;
    let buzz = 2.2 * sin(2.0 * PI * (f32(row) / 262.5 + 0.011 * f32(P.frame)));
    out = out + P.soundIre * sin(2.0 * PI * ph + buzz);
  }

  // RF dropout: per-line chance, a span of the line collapses to demodulated snow
  let lp = lineParams[row];
  if (lp.w < P.dropoutRate / f32(NLINES)) {
    let h = pcg(bitcast<u32>(lp.w) ^ 0x51ed270bu);
    let start = f32(h % SPL);
    let len = P.dropoutLen * (0.4 + 1.2 * rand01(h ^ 0x9134u));
    let fs = f32(s);
    if (fs >= start && fs < start + len) {
      let snow = 55.0 + 45.0 * gauss(n ^ pcg(P.frame * 977u + P.gen * 7919u));
      out = mix(out, snow, 0.95);
    }
  }

  // head-switch disturbance band at the bottom of the picture
  if (P.headSwitchNoise > 0.0 && row >= HEAD_SWITCH_LINE && row < HEAD_SWITCH_LINE + 3u) {
    out = out + P.headSwitchNoise * 25.0 * gauss(n ^ pcg(P.frame * 3121u + row + P.gen * 4423u));
  }

  outBuf[n] = out;
}
