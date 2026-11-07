/** Signed milliseconds with a real minus sign, e.g. "+12", "−40", "0". */
export const fmtMs = (ms: number) => `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${Math.abs(ms).toFixed(0)}`;
