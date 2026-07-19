// Bandpass the composite around fsc to isolate the chroma signal. Feeds both
// the luma path (composite - chroma = chroma trap) and the color-under path.

@group(0) @binding(0) var<storage, read> filters: array<f32>;
@group(0) @binding(1) var<storage, read> comp: array<f32>;
@group(0) @binding(2) var<storage, read_write> chroma: array<f32>;

var<workgroup> tile: array<f32, TILE>;

@compute @workgroup_size(64, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let row = wid.y;
  let base = i32(row * SPL + wid.x * 64u) - i32(HALO);
  for (var i = lid.x; i < TILE; i = i + 64u) {
    tile[i] = comp[clampIdx(base + i32(i))];
  }
  workgroupBarrier();

  let s = gid.x;
  if (s >= SPL) {
    return;
  }
  let m = (CHROMA_BP_TAPS - 1u) / 2u;
  var acc = 0.0;
  for (var k = 0u; k < CHROMA_BP_TAPS; k = k + 1u) {
    acc = acc + filters[SEC_CHROMA_BP * FILTER_STRIDE + k] * tile[lid.x + HALO + k - m];
  }
  chroma[row * SPL + s] = acc;
}
