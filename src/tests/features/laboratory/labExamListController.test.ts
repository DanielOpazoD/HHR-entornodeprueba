// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { SyslabExamItem } from '@/types/domain/labExamTypes';
import {
  resolveAllSelectableExamsSelected,
  resolveLabExamDateRange,
  resolveSelectableLabExams,
} from '@/features/laboratory/controllers/labExamListController';

const buildExam = (overrides: Partial<SyslabExamItem> = {}): SyslabExamItem => ({
  id: '100',
  link: 'http://example.com/100',
  date: '06/04/2026',
  time: '10:00:00',
  patientName: 'Paciente Test',
  origin: 'HOSP',
  exams: ['HEMOGRAMA'],
  ...overrides,
});

describe('labExamListController', () => {
  it('returns only exams that can actually be selected', () => {
    const exams = [
      buildExam({ id: 'linked-a' }),
      buildExam({ id: 'linked-b' }),
      buildExam({ id: 'pdf-missing', link: '' }),
    ];

    expect(resolveSelectableLabExams(exams).map(exam => exam.id)).toEqual(['linked-a', 'linked-b']);
  });

  it('reports all selectable exams as selected only when every linked exam is selected', () => {
    const exams = [
      buildExam({ id: 'linked-a' }),
      buildExam({ id: 'linked-b' }),
      buildExam({ id: 'pdf-missing', link: '' }),
    ];

    expect(resolveAllSelectableExamsSelected(exams, new Set(['linked-a']))).toBe(false);
    expect(resolveAllSelectableExamsSelected(exams, new Set(['linked-a', 'linked-b']))).toBe(true);
  });

  it('returns false when there are no selectable exams', () => {
    const exams = [buildExam({ id: 'pdf-missing', link: '' })];

    expect(resolveAllSelectableExamsSelected(exams, new Set())).toBe(false);
  });

  it('normalizes custom date ranges to full-day boundaries', () => {
    const range = resolveLabExamDateRange('2026-04-01', '2026-04-03');

    expect(range).not.toBeNull();
    expect(range?.from.getFullYear()).toBe(2026);
    expect(range?.from.getMonth()).toBe(3);
    expect(range?.from.getDate()).toBe(1);
    expect(range?.from.getHours()).toBe(0);
    expect(range?.from.getMinutes()).toBe(0);
    expect(range?.from.getSeconds()).toBe(0);
    expect(range?.from.getMilliseconds()).toBe(0);

    expect(range?.to.getFullYear()).toBe(2026);
    expect(range?.to.getMonth()).toBe(3);
    expect(range?.to.getDate()).toBe(3);
    expect(range?.to.getHours()).toBe(23);
    expect(range?.to.getMinutes()).toBe(59);
    expect(range?.to.getSeconds()).toBe(59);
    expect(range?.to.getMilliseconds()).toBe(999);
  });

  it('returns null when the date range is incomplete', () => {
    expect(resolveLabExamDateRange('2026-04-01', '')).toBeNull();
    expect(resolveLabExamDateRange('', '2026-04-03')).toBeNull();
  });
});
