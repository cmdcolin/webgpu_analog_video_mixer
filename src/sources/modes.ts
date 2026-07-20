export const SOURCE_MODES = [
  'bars',
  'sweep',
  'tv static',
  'vhs static',
  'file',
  'webcam',
] as const
export const SOURCE_B_MODES = ['none', 'bars', 'sweep', 'file'] as const
export type SourceMode = (typeof SOURCE_MODES)[number]
export type SourceBMode = (typeof SOURCE_B_MODES)[number]

// Full labels shown inside the dropdowns so each option explains what it is.
export const SOURCE_DESC: Record<SourceMode | SourceBMode, string> = {
  none: 'Off — no second source',
  bars: 'Color bars — SMPTE test pattern',
  sweep: 'Sweep — frequency zone plate',
  'tv static': 'TV static — no-signal broadcast snow',
  'vhs static': 'VHS static — blank-tape noise',
  file: 'File… — open an image or video',
  webcam: 'Webcam / USB device — camera or RCA capture',
}
