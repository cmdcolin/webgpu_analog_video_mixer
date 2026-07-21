// A control's value rounded to a sensible number of decimals for its step:
// finer steps show more places. Shared by the slider readout and its help card
// so both round identically (they differ only in how they append the unit).
export const formatValue = (value: number, step: number) =>
  value.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0)
