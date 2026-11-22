// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildExamRequestOpenState,
  resolveExamRequestPrevision,
  toggleExamRequestSelection,
} from '@/features/census/components/exam-request/examRequestController';

describe('examRequestController', () => {
  it('builds the open state with normalized insurance', () => {
    const result = buildExamRequestOpenState('Fonasa b');

    expect(result.selectedExams.size).toBe(0);
    expect(result.procedencia).toBe('Hospitalización');
    expect(result.prevision).toBe('FONASA B');
  });

  it('falls back to FONASA when insurance is missing', () => {
    expect(resolveExamRequestPrevision()).toBe('FONASA');
    expect(resolveExamRequestPrevision('   ')).toBe('FONASA');
  });

  it('toggles selection in a copy-safe way', () => {
    const initial = new Set(['HEMOGRAMA']);

    const added = toggleExamRequestSelection(initial, 'GLICEMIA');
    const removed = toggleExamRequestSelection(added, 'HEMOGRAMA');

    expect(initial.has('GLICEMIA')).toBe(false);
    expect(added.has('HEMOGRAMA')).toBe(true);
    expect(added.has('GLICEMIA')).toBe(true);
    expect(removed.has('HEMOGRAMA')).toBe(false);
    expect(removed.size).toBe(1);
  });
});
