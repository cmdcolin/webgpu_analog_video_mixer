// CRT faceplate: turn the decoded signal into a picture of a glowing tube, so
// both the feedback camera (compose) and the display (present) photograph an
// emissive screen instead of the raw signal buffer. Highlight bloom spreads
// bright cores, halation adds a wide warm glass-scatter halo, a phosphor floor
// lifts blacks into a faint haze, and overbright phosphors clip toward white.
// Beam/scanline/mask geometry stays in present — it is sub-raster here; this
// pass is the photographic light behaviour that makes the loop read as a camera
// pointed at a monitor rather than a signal fed back on itself.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var faceTex: texture_storage_2d<rgba8unorm, write>;

// P22 glass scatter is red-dominant, so bloom haze and the black-level glow
// both warm toward amber.
const WARM = vec3f(1.0, 0.62, 0.38);

fn luma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.299, 0.587, 0.114));
}

// over-threshold colour, hue preserved: only the part of a pixel brighter than
// t contributes light to its neighbours.
fn bright(c: vec3f, t: f32) -> vec3f {
  let l = luma(c);
  return c * max(l - t, 0.0) / max(l, 1e-3);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ACTIVE_W || gid.y >= ACTIVE_H) {
    return;
  }
  let dim = vec2f(f32(ACTIVE_W), f32(ACTIVE_H));
  let uv = (vec2f(gid.xy) + 0.5) / dim;
  var col = textureSampleLevel(srcTex, samp, uv, 0.0).rgb;

  // Identity copy when the faceplate is disabled: keeps a clean signal clean
  // and skips the tap work.
  if (P.crtBloom + P.crtHalation + P.crtGlow <= 0.0) {
    textureStore(faceTex, vec2i(gid.xy), vec4f(col, 1.0));
    return;
  }

  // Golden-angle disk taps sampled at two radii: a tight cluster for bloom, a
  // wide one for halation. The feedback loop compounds the spread over frames,
  // so a modest single-pass kernel is enough here.
  var bloom = vec3f(0.0);
  var halo = vec3f(0.0);
  let rb = 3.5;
  let rh = 15.0;
  for (var i = 0u; i < 16u; i = i + 1u) {
    let a = f32(i) * 2.3999632;
    let rr = sqrt((f32(i) + 0.5) / 16.0);
    let dir = vec2f(cos(a), sin(a)) * rr;
    bloom = bloom + bright(textureSampleLevel(srcTex, samp, uv + dir * rb / dim, 0.0).rgb, 0.55);
    halo = halo + bright(textureSampleLevel(srcTex, samp, uv + dir * rh / dim, 0.0).rgb, 0.35);
  }
  col = col + P.crtBloom * bloom / 16.0 + P.crtHalation * luma(halo / 16.0) * WARM;

  // Phosphor glow floor: the glass is never truly black — a faint warm haze
  // that lifts with nearby light, plus a small ambient pedestal.
  col = col + P.crtGlow * WARM * (0.02 + 0.10 * luma(col));

  // Overbright phosphors desaturate toward white as the beam saturates.
  let l = luma(col);
  col = mix(col, vec3f(l), clamp((l - 0.85) * 3.0, 0.0, 0.6));

  textureStore(faceTex, vec2i(gid.xy), vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0));
}
