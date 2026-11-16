import { describe, expect, it } from 'vitest';
import {
  formatHandoffDate,
  formatHandoffDateTime,
  formatHandoffVerboseDate,
  getMedicalSpecialtyStatusLabel,
  resolveHandoffDocumentTitleLabel,
} from '@/shared/handoff/handoffPresentation';

describe('handoffPresentation', () => {
  it('formats handoff timestamps defensively', () => {
    expect(formatHandoffDateTime('2026-03-16T12:30:00.000Z')).toContain('16');
    expect(formatHandoffDate('2026-03-16')).toContain('16');
    expect(formatHandoffVerboseDate('2026-03-16')).toContain('2026');
    expect(formatHandoffDateTime(undefined)).toBe('sin registro');
  });

  it('resolves consistent specialty status labels', () => {
    expect(getMedicalSpecialtyStatusLabel('updated_by_specialist')).toBe(
      'Actualizado por especialista hoy'
    );
    expect(getMedicalSpecialtyStatusLabel('confirmed_no_changes')).toBe('Confirmado sin cambios');
    expect(getMedicalSpecialtyStatusLabel('pending')).toBe('Pendiente');
  });

  it('reuses a shared title label for generated handoff documents', () => {
    expect(
      resolveHandoffDocumentTitleLabel({
        selectedShift: 'day',
        recordDate: '2026-03-16',
      })
    ).toContain('16-03-2026');
  });
});
