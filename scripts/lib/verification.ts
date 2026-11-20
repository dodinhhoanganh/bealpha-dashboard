export interface VerificationCheck {
  name: string;
  source?: string;
  target: string;
  passed: boolean;
}

export function buildVerificationReport(checks: VerificationCheck[], generatedAt = new Date()): {
  generatedAt: string;
  passed: boolean;
  checks: VerificationCheck[];
} {
  return {
    generatedAt: generatedAt.toISOString(),
    passed: checks.length > 0 && checks.every(check => check.passed),
    checks,
  };
}
