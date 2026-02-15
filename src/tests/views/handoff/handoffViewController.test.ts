import { describe, expect, it } from 'vitest';
import {
  resolveHandoffDocumentTitle,
  resolveHandoffNovedadesValue,
  resolveHandoffTableHeaderClass,
  resolveHandoffTitle,
  shouldShowNightCudyrActions,
} from '@/features/handoff/controllers/handoffViewController';

describe('handoffViewController', () => {
  it('resolves view title by module and shift', () => {
    expect(resolveHandoffTitle({ isMedical: true, selectedShift: 'day' })).toBe(
      'Entrega Turno Médicos'
    );
    expect(resolveHandoffTitle({ isMedical: false, selectedShift: 'day' })).toContain('Día');
    expect(resolveHandoffTitle({ isMedical: false, selectedShift: 'night' })).toContain('Noche');
  });

  it('resolves header classes by module and shift', () => {
    expect(resolveHandoffTableHeaderClass({ isMedical: true, selectedShift: 'day' })).toContain(
      'bg-sky-100'
    );
    expect(resolveHandoffTableHeaderClass({ isMedical: false, selectedShift: 'day' })).toContain(
      'bg-medical-50'
    );
    expect(resolveHandoffTableHeaderClass({ isMedical: false, selectedShift: 'night' })).toContain(
      'bg-slate-100'
    );
  });

  it('resolves document title for medical and nursing shifts', () => {
    expect(
      resolveHandoffDocumentTitle({
        isMedical: true,
        selectedShift: 'day',
        recordDate: '2026-02-15',
      })
    ).toBe('Entrega Medico 15-02-2026');

    expect(
      resolveHandoffDocumentTitle({
        isMedical: false,
        selectedShift: 'day',
        recordDate: '2026-02-15',
      })
    ).toBe('TL 15-02-2026');

    expect(
      resolveHandoffDocumentTitle({
        isMedical: false,
        selectedShift: 'night',
        recordDate: '2026-02-15',
      })
    ).toBe('TN 15-02-2026');
  });

  it('returns null document title for missing/invalid dates', () => {
    expect(
      resolveHandoffDocumentTitle({
        isMedical: false,
        selectedShift: 'day',
      })
    ).toBeNull();

    expect(
      resolveHandoffDocumentTitle({
        isMedical: false,
        selectedShift: 'day',
        recordDate: 'invalid',
      })
    ).toBeNull();
  });

  it('resolves novedades value with night fallback', () => {
    const record = {
      medicalHandoffNovedades: 'Med note',
      handoffNovedadesDayShift: 'Day note',
      handoffNovedadesNightShift: '',
    };

    expect(
      resolveHandoffNovedadesValue({
        isMedical: true,
        selectedShift: 'day',
        record,
      })
    ).toBe('Med note');

    expect(
      resolveHandoffNovedadesValue({
        isMedical: false,
        selectedShift: 'day',
        record,
      })
    ).toBe('Day note');

    expect(
      resolveHandoffNovedadesValue({
        isMedical: false,
        selectedShift: 'night',
        record,
      })
    ).toBe('Day note');
  });

  it('shows night CUDYR actions only for nursing night shift', () => {
    expect(shouldShowNightCudyrActions({ isMedical: false, selectedShift: 'night' })).toBe(true);
    expect(shouldShowNightCudyrActions({ isMedical: false, selectedShift: 'day' })).toBe(false);
    expect(shouldShowNightCudyrActions({ isMedical: true, selectedShift: 'night' })).toBe(false);
  });
});
