// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  formatReminderDateRange,
  formatReminderPriorityLabel,
  formatReminderShiftLabel,
} from '@/shared/reminders/reminderPresentation';

describe('reminderPresentation', () => {
  it('formatea fechas en dd-mm-aaaa', () => {
    expect(formatReminderDateRange('2026-03-15', '2026-03-20')).toBe('15-03-2026 a 20-03-2026');
  });

  it('construye labels de prioridad y turno consistentes', () => {
    expect(formatReminderPriorityLabel(3)).toBe('Prioridad Crítica');
    expect(formatReminderShiftLabel('night')).toBe('Noche');
  });
});
