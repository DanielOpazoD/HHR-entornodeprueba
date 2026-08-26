import { describe, expect, it } from 'vitest';
import {
  consumeRayenStructuralReviewTiming,
  startRayenStructuralReviewTiming,
  type RayenStructuralReplan,
} from '@/features/rayen-import/hooks/rayenStructuralConvergence';

const plan = {
  runId: 'run-1',
  requestId: 'request-1',
  selectedDate: '2026-08-25',
  clinicalDay: '2026-08-25',
  replan: async () => ({}) as never,
} satisfies RayenStructuralReplan;

describe('Rayen structural review timing', () => {
  it('consumes each human review interval once and can restart after replanning', () => {
    const first = startRayenStructuralReviewTiming(plan, () => 1_000);
    const consumedFirst = consumeRayenStructuralReviewTiming(first, () => 1_650);

    expect(consumedFirst.durationMs).toBe(650);
    expect(consumedFirst.plan).not.toHaveProperty('reviewStartedAtMs');
    expect(
      consumeRayenStructuralReviewTiming(consumedFirst.plan, () => 2_000).durationMs
    ).toBeNull();

    const replanned = startRayenStructuralReviewTiming(consumedFirst.plan, () => 2_100);
    expect(consumeRayenStructuralReviewTiming(replanned, () => 2_400).durationMs).toBe(300);
  });
});
