import { ok } from '@/lib/api/http';
import { onboardingSteps } from '@/lib/onboarding/steps';

export async function GET() {
  return ok(onboardingSteps);
}
