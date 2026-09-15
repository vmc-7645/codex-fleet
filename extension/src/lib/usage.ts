export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  recordedTotalTokens?: number;
}
export function totalTokens(u: Usage): number {
  // Cached input and reasoning output are already included in input/output.
  return u.recordedTotalTokens || u.inputTokens + u.outputTokens;
}
export function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}
