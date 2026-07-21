// GPU-generated source B: same no-signal snow / blank-tape noise as source A's
// compose.wgsl branch, but B has no compose stage of its own (it goes straight
// from upload to encode), so this is a standalone pass writing directly into
// srcTexB. Regenerated every frame so it crawls.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var srcTexB: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ACTIVE_W || gid.y >= ACTIVE_H) {
    return;
  }
  var v: vec3f;
  if (P.srcNoiseB < 1.5) {
    v = vec3f(rand01(pcg(gid.x + gid.y * ACTIVE_W + P.frame * 2654435761u)));
  } else {
    let line = rand01(pcg(gid.y * 2246822519u + P.frame * 40503u));
    let fine = rand01(pcg((gid.x / 4u) + gid.y * ACTIVE_W + P.frame * 2654435761u));
    let l = 0.32 + 0.30 * fine + 0.14 * line;
    v = vec3f(l * 0.8, l * 0.9, l);
  }
  textureStore(srcTexB, vec2i(gid.xy), vec4f(v, 1.0));
}
