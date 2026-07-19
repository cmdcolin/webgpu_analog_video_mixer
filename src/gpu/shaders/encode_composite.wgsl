// Assemble the full composite waveform in IRE: sync tips, breezeway, 9-cycle
// colorburst, band-limited quadrature-modulated chroma on the subcarrier.
// Everything downstream sees only this 1D signal.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> filters: array<f32>;
@group(0) @binding(2) var<storage, read> yuv: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> comp: array<f32>;

var<workgroup> tileUV: array<vec2f, TILE>;

@compute @workgroup_size(64, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let row = wid.y;
  let base = i32(row * SPL + wid.x * 64u) - i32(HALO);
  for (var i = lid.x; i < TILE; i = i + 64u) {
    tileUV[i] = yuv[clampIdx(base + i32(i))].yz;
  }
  workgroupBarrier();

  let s = gid.x;
  if (s >= SPL) {
    return;
  }
  let n = row * SPL + s;
  var out = IRE_BLANK;

  if (row < VSYNC_FIRST || (row > VSYNC_LAST && row < 12u)) {
    // equalizing pulses: narrow half-line-rate pulses flanking vsync
    out = select(IRE_BLANK, IRE_SYNC, (s % 455u) < 33u);
  } else if (row >= VSYNC_FIRST && row <= VSYNC_LAST) {
    // serrated broad pulses: mostly at sync level, rising near each half-line end
    let serration = (s >= 430u && s < 498u) || s >= 880u;
    out = select(IRE_SYNC, IRE_BLANK, serration);
  } else if (s < SYNC_LEN) {
    out = IRE_SYNC;
  } else if (s >= BURST_START && s < BURST_START + BURST_LEN && row > VSYNC_LAST + 1u) {
    // burst at 180 degrees on the U axis: -A*sin
    out = -BURST_AMP * carrier(n, P.frame).x;
  } else if (s >= ACTIVE_START && s < ACTIVE_START + ACTIVE_W && row >= ACTIVE_TOP && row < ACTIVE_TOP + ACTIVE_H) {
    let m = (ENC_CHROMA_TAPS - 1u) / 2u;
    var uf = 0.0;
    var vf = 0.0;
    for (var k = 0u; k < ENC_CHROMA_TAPS; k = k + 1u) {
      let h = filters[SEC_ENC_CHROMA * FILTER_STRIDE + k];
      let uv = tileUV[lid.x + HALO + k - m];
      uf = uf + h * uv.x;
      vf = vf + h * uv.y;
    }
    let sc = carrier(n, P.frame);
    out = IRE_BLACK + VIDEO_RANGE * yuv[n].x + VIDEO_RANGE * (uf * sc.x + vf * sc.y);
  }
  comp[n] = out;
}
