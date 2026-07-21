// Camera-at-monitor feedback: the previous frame's CRT face (faceTex, the
// glowing screen from crt_face — not the raw decode) is re-photographed through
// a camera model — affine reframe, lens defocus + vignette, then the sensor's
// black cut and full-well saturation — and mixed with the live source.
// The nonlinearity is what makes the loop organic: bright cores bloom, dim
// trails decay into black instead of hovering as gray copies. The result is
// the encoder input, so every generation traverses the full analog chain.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var prevTex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var inputTex: texture_storage_2d<rgba8unorm, write>;

// lens defocus: center tap + 6-point ring at the focus radius
fn cam(uv: vec2f) -> vec3f {
  let r = vec2f(P.fbFocus / f32(ACTIVE_W), P.fbFocus / f32(ACTIVE_H));
  var acc = textureSampleLevel(prevTex, samp, uv, 0.0).rgb * 0.25;
  for (var i = 0u; i < 6u; i = i + 1u) {
    let a = f32(i) * PI / 3.0;
    acc = acc + textureSampleLevel(prevTex, samp, uv + vec2f(cos(a), sin(a)) * r, 0.0).rgb * 0.125;
  }
  return acc;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ACTIVE_W || gid.y >= ACTIVE_H) {
    return;
  }
  let uv = vec2f((f32(gid.x) + 0.5) / f32(ACTIVE_W), (f32(gid.y) + 0.5) / f32(ACTIVE_H));
  // cover-fit the source into the 4:3 frame
  let disp = 4.0 / 3.0;
  var suv = uv;
  if (P.srcAspect > disp) {
    suv.x = 0.5 + (uv.x - 0.5) * (disp / P.srcAspect);
  } else {
    suv.y = 0.5 + (uv.y - 0.5) * (P.srcAspect / disp);
  }
  var src = textureSampleLevel(srcTex, samp, suv, 0.0).rgb;
  // Bob-deinterlace: a capture card weaves NTSC's two time-staggered fields
  // into one raster, so motion combs. Rebuild the whole frame from the even
  // field alone by interpolating between its lines — combing gone, at half the
  // vertical resolution (authentic 240p). Landing the linear sampler on exact
  // even-line centers keeps each field line clean; only the vertical fill lerps.
  if (P.deint > 0.5) {
    let sh = f32(textureDimensions(srcTex).y);
    let sy = suv.y * sh - 0.5;
    let e = floor(sy * 0.5) * 2.0;
    let f = clamp((sy - e) * 0.5, 0.0, 1.0);
    let a = textureSampleLevel(srcTex, samp, vec2f(suv.x, (e + 0.5) / sh), 0.0).rgb;
    let b = textureSampleLevel(srcTex, samp, vec2f(suv.x, (e + 2.5) / sh), 0.0).rgb;
    src = mix(a, b, f);
  }
  // GPU-generated noise sources, regenerated every frame so they crawl.
  if (P.srcNoise > 0.5) {
    if (P.srcNoise < 1.5) {
      // TV static: fine, full-contrast luminance snow — no-signal broadcast
      // snow. Fed through the encoder, its high-frequency energy blooms into
      // authentic rainbow speckle.
      src = vec3f(rand01(pcg(gid.x + gid.y * ACTIVE_W + P.frame * 2654435761u)));
    } else {
      // VHS blank tape: grayer, bluish, horizontally smeared (head-scanned
      // along the line) with a slow per-line brightness drift.
      let line = rand01(pcg(gid.y * 2246822519u + P.frame * 40503u));
      let fine = rand01(pcg((gid.x / 4u) + gid.y * ACTIVE_W + P.frame * 2654435761u));
      let v = 0.32 + 0.30 * fine + 0.14 * line;
      src = vec3f(v * 0.8, v * 0.9, v);
    }
  };

  // transform in 4:3 aspect space so rotation doesn't shear
  let asp = vec2f(4.0 / 3.0, 1.0);
  let rel0 = (uv - vec2f(0.5)) * asp;
  let c = cos(P.fbRotate);
  let s = sin(P.fbRotate);
  let rel = mat2x2f(c, s, -s, c) * rel0;
  let fuv = rel / max(P.fbZoom, 0.05) / asp + vec2f(0.5) + vec2f(P.fbShiftX, P.fbShiftY);

  let inside = all(fuv >= vec2f(0.0)) && all(fuv <= vec2f(1.0));
  var fb = vec3f(0.0);
  if (inside) {
    fb = cam(fuv) * P.fbGain;
    // lens vignette, in sensor coordinates
    fb = fb * max(1.0 - P.fbVign * 1.45 * dot(rel0, rel0), 0.0);
    // sensor black cut, then full-well saturation
    fb = max(fb - vec3f(P.fbBlack), vec3f(0.0)) / (1.0 - P.fbBlack);
    // A photosite has a finite well: highlights roll into a shoulder and
    // asymptote at clip, they never gain past it. That falling gain is what
    // stabilizes the loop — once the fed-back level climbs into the shoulder the
    // round-trip gain drops below unity, so a loop that would otherwise run away
    // settles into a bright fixed point instead of pinning the whole raster
    // white. fbKnee sets where the well starts to fill: 0 is a hard clip (no
    // shoulder, the loop can still white out), 1 rolls off early and gently.
    let knee = mix(1.0, 0.3, clamp(P.fbKnee, 0.0, 1.0));
    let over = max(fb - vec3f(knee), vec3f(0.0));
    fb = min(fb, vec3f(knee)) + (1.0 - knee) * over / (1.0 - knee + over);
  }
  let outc = mix(src, fb, P.fbMix);
  textureStore(inputTex, vec2i(gid.xy), vec4f(outc, 1.0));
}
