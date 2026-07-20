// Present the CRT face (faceTex, the glowing screen — not the raw decode): 4:3
// letterbox and a finite gaussian beam-spot profile across scanlines. No
// geometry/vignette kitsch.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var screenTex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(pos[vi], 0.0, 1.0);
  o.uv = pos[vi] * vec2f(0.5, -0.5) + vec2f(0.5);
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  if (P.dbgView == 1.0) {
    return vec4f(in.uv, 0.5, 1.0);
  }
  let cs = vec2f(P.canvasW, P.canvasH);
  let px = in.uv * cs;
  let scale = min(cs.x / 4.0, cs.y / 3.0);
  let half = vec2f(2.0 * scale, 1.5 * scale);
  let rel = (px - cs * 0.5) / half;
  if (any(abs(rel) > vec2f(1.0))) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  let tuv = rel * 0.5 + vec2f(0.5);
  var col = textureSampleLevel(screenTex, samp, tuv, 0.0).rgb;
  // Horizontal Catmull-Rom reconstruction: bilinear is -6 dB at the sample
  // rate's edge, so the upscale reads mushy; the cubic keeps single-sample
  // luma detail crisp (with a hint of authentic edge ringing).
  if (P.crtSharp > 0.0) {
    let w = f32(ACTIVE_W);
    let x = tuv.x * w - 0.5;
    let t = fract(x);
    let x1 = floor(x) + 0.5;
    let p0 = textureSampleLevel(screenTex, samp, vec2f((x1 - 1.0) / w, tuv.y), 0.0).rgb;
    let p1 = textureSampleLevel(screenTex, samp, vec2f(x1 / w, tuv.y), 0.0).rgb;
    let p2 = textureSampleLevel(screenTex, samp, vec2f((x1 + 1.0) / w, tuv.y), 0.0).rgb;
    let p3 = textureSampleLevel(screenTex, samp, vec2f((x1 + 2.0) / w, tuv.y), 0.0).rgb;
    let sharp = p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0)));
    col = mix(col, clamp(sharp, vec3f(0.0), vec3f(1.0)), P.crtSharp);
  }
  let fr = fract(tuv.y * f32(ACTIVE_H)) - 0.5;
  let beam = 1.0 - P.scanBeam * (1.0 - exp(-fr * fr * 10.0));
  col = col * beam;
  // Aperture grille: vertical RGB phosphor stripes, gain-compensated for the
  // mean transmission loss so mids hold while bright areas clip toward white —
  // the highlight desaturation a real tube's bloom gives.
  if (P.maskAmt > 0.0) {
    let stripe = u32(fract(px.x / max(P.maskPitch, 1.5)) * 3.0);
    var m = vec3f(1.0 - P.maskAmt);
    m[stripe] = 1.0;
    col = col * m / (1.0 - 2.0 * P.maskAmt / 3.0);
  }
  return vec4f(col, 1.0);
}
