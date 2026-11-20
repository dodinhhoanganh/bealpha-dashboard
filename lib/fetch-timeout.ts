export function fetchTimeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}
