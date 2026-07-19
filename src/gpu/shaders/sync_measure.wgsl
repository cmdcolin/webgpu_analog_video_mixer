// Sync separator, measurement half: one thread per line hunts the falling
// sync edge near the expected line start and samples the gated sync depth
// (tip vs back porch) and the mid-line level (broad-pulse detection for
// vertical lock). The flywheel PLL in sync.wgsl consumes these per-line
// measurements; only that tiny recurrence stays serial.
//
// measure[row] = (edge sample or -1000 if not found, porch - tip depth,
//                 unused, 1 if mid-line sits at sync level)

@group(0) @binding(0) var<storage, read> comp: array<f32>;
@group(0) @binding(1) var<storage, read_write> measure: array<vec4f>;

const SLICE = -20.0; // IRE slicing level

fn levelAt(n: i32) -> f32 {
  // small boxcar lowpass, the sync separator's RC filter
  var acc = 0.0;
  for (var k = -2; k <= 2; k = k + 1) {
    acc = acc + comp[clampIdx(n + k)];
  }
  return acc / 5.0;
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let row = gid.x;
  if (row >= NLINES) {
    return;
  }
  let base = i32(row * SPL);

  // hunt for the falling sync edge near the expected line start
  var edge = -1000.0;
  var prev = levelAt(base - 30);
  for (var s = -29; s < 55; s = s + 1) {
    let cur = levelAt(base + s);
    if (prev >= SLICE && cur < SLICE) {
      edge = f32(s);
      break;
    }
    prev = cur;
  }

  // gated depth: sample mid-tip and back porch relative to the found edge
  var depth = 0.0;
  if (edge > -999.0) {
    let tip = levelAt(base + i32(edge) + 20);
    let porch = levelAt(base + i32(edge) + i32(SYNC_LEN) + 8);
    depth = porch - tip;
  }

  let broad = select(0.0, 1.0, levelAt(base + 200) < SLICE);
  measure[row] = vec4f(edge, depth, 0.0, broad);
}
