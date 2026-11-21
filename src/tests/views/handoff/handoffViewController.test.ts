// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  buildHandoffChecklistSectionViewModel,
  buildHandoffNovedadesBindings,
  buildNursingNoteChange,
  getVisibleHandoffBeds,
  resolveHandoffTitle,
  resolveHandoffTableHeaderClass,
  resolveHandoffNovedadesValue,
  resolveNursingNoteField,
  shouldShowHandoffPatient,
  shouldShowNightCudyrActions,
  resolveHandoffAuditDescriptor,
} from '@/features/handoff/controllers/handoffViewController';
import { resolveHandoffDocumentTitleLabel } from '@/shared/handoff/handoffPresentation';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

// ---------------------------------------------------------------------------
// resolveHandoffTitle
// ---------------------------------------------------------------------------
describe('resolveHandoffTitle', () => {
  it('returns nursing day shift title', () => {
    const title = resolveHandoffTitle('day');
    expect(title).toContain('Enfermería');
    expect(title).toContain('Día');
  });

  it('returns nursing night shift title', () => {
    const title = resolveHandoffTitle('night');
    expect(title).toContain('Enfermería');
    expect(title).toContain('Noche');
  });
});

// ---------------------------------------------------------------------------
// resolveHandoffTableHeaderClass
// ---------------------------------------------------------------------------
describe('resolveHandoffTableHeaderClass', () => {
  it('returns sky-themed class for nursing day shift', () => {
    const cls = resolveHandoffTableHeaderClass('day');
    expect(cls).toContain('bg-medical-50');
    expect(cls).toContain('text-sky-900');
  });

  it('returns slate-themed class for nursing night shift', () => {
    const cls = resolveHandoffTableHeaderClass('night');
    expect(cls).toContain('bg-slate-100');
    expect(cls).toContain('text-slate-500');
  });
});

// ---------------------------------------------------------------------------
// resolveHandoffNovedadesValue
// ---------------------------------------------------------------------------
describe('resolveHandoffNovedadesValue', () => {
  const baseRecord = {
    handoffNovedadesDayShift: 'Day novedades text',
    handoffNovedadesNightShift: 'Night novedades text',
  };

  it('returns day shift novedades for nursing day shift', () => {
    expect(resolveHandoffNovedadesValue({ selectedShift: 'day', record: baseRecord })).toBe(
      'Day novedades text'
    );
  });

  it('returns night shift novedades for nursing night shift', () => {
    expect(resolveHandoffNovedadesValue({ selectedShift: 'night', record: baseRecord })).toBe(
      'Night novedades text'
    );
  });

  it('falls back to day shift novedades when night shift is empty', () => {
    const record = { ...baseRecord, handoffNovedadesNightShift: undefined };
    expect(resolveHandoffNovedadesValue({ selectedShift: 'night', record })).toBe(
      'Day novedades text'
    );
  });

  it('returns empty string when day shift novedades is undefined', () => {
    const record = { ...baseRecord, handoffNovedadesDayShift: undefined };
    expect(resolveHandoffNovedadesValue({ selectedShift: 'day', record })).toBe('');
  });

  it('returns empty string when both nursing shifts are undefined', () => {
    const record = { handoffNovedadesDayShift: undefined, handoffNovedadesNightShift: undefined };
    expect(resolveHandoffNovedadesValue({ selectedShift: 'night', record })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// shouldShowNightCudyrActions
// ---------------------------------------------------------------------------
describe('shouldShowNightCudyrActions', () => {
  it('returns true for the night shift', () => {
    expect(shouldShowNightCudyrActions('night')).toBe(true);
  });

  it('returns false for the day shift', () => {
    expect(shouldShowNightCudyrActions('day')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Screen title, bindings and audit descriptor
// ---------------------------------------------------------------------------
const documentTitleFor = (selectedShift: 'day' | 'night', recordDate?: string) =>
  resolveHandoffDocumentTitleLabel({ selectedShift, recordDate });

describe('handoffViewController', () => {
  it('resolves the document title for each nursing shift', () => {
    expect(documentTitleFor('day', '2026-02-15')).toBe('TL 15-02-2026');
    expect(documentTitleFor('night', '2026-02-15')).toBe('TN 15-02-2026');
  });

  it('returns null document title for missing/invalid dates', () => {
    expect(documentTitleFor('day')).toBeNull();
    expect(documentTitleFor('day', 'invalid')).toBeNull();
  });

  it('falls back to day novedades when the night shift is an empty string', () => {
    const record = {
      handoffNovedadesDayShift: 'Day note',
      handoffNovedadesNightShift: '',
    };

    expect(resolveHandoffNovedadesValue({ selectedShift: 'day', record })).toBe('Day note');
    expect(resolveHandoffNovedadesValue({ selectedShift: 'night', record })).toBe('Day note');
  });

  it('builds checklist section state', () => {
    expect(
      buildHandoffChecklistSectionViewModel({
        selectedShift: 'night',
        readOnly: false,
        hasShiftSwitcher: true,
      })
    ).toEqual({
      showShiftSwitcher: true,
      isReceivesEditable: true,
      activeChecklistShift: 'night',
    });
  });

  it('builds nursing novedades bindings from the shared handoff policy', () => {
    const onUpdateHandoffNovedades = vi.fn();
    const bindings = buildHandoffNovedadesBindings({
      selectedShift: 'night',
      record: {
        handoffNovedadesDayShift: 'Turno día',
        handoffNovedadesNightShift: 'Turno noche',
      },
      readOnly: true,
      onUpdateHandoffNovedades,
    });

    expect(bindings.value).toBe('Turno noche');
    expect(bindings.readOnly).toBe(true);

    bindings.onChange('Nueva novedad');
    expect(onUpdateHandoffNovedades).toHaveBeenCalledWith('night', 'Nueva novedad');
  });

  it('builds a consistent title and audit descriptor', () => {
    expect(resolveHandoffTitle('day')).toBe('Entrega Turno Enfermería - Día ');
    expect(documentTitleFor('day', '2026-03-26')).toBe('TL 26-03-2026');
    expect(resolveHandoffAuditDescriptor('night')).toEqual({
      action: 'VIEW_NURSING_HANDOFF',
      details: {
        view: 'nursing_handoff',
        shift: 'night',
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Which beds and patients the handoff shows (formerly handoffVisibilityController.test.ts)
// ---------------------------------------------------------------------------
describe('handoff visibility', () => {
  const record = {
    date: '2024-12-28',
    beds: {
      R1: { bedId: 'R1', patientName: 'Paciente', admissionDate: '2024-12-27' } as PatientData,
      R2: { bedId: 'R2', patientName: '', isBlocked: true } as PatientData,
      R3: { bedId: 'R3', patientName: '' } as PatientData,
      R4: {
        bedId: 'R4',
        patientName: 'Ingresa mañana',
        admissionDate: '2024-12-29',
        admissionTime: '10:00',
      } as PatientData,
      E1: { bedId: 'E1', patientName: '' } as PatientData,
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2024-12-28T08:00:00.000Z',
    activeExtraBeds: ['E1'],
  } as DailyRecord;

  it('shows fixed beds and only the extra beds the day has active', () => {
    const beds = [
      { id: 'R1', isExtra: false },
      { id: 'E1', isExtra: true },
      { id: 'E2', isExtra: true },
    ];
    expect(getVisibleHandoffBeds(record, beds)).toEqual([
      { id: 'R1', isExtra: false },
      { id: 'E1', isExtra: true },
    ]);
    expect(getVisibleHandoffBeds(null, beds)).toEqual([]);
  });

  it('shows a blocked bed, hides an empty one and a patient admitted after the shift', () => {
    expect(shouldShowHandoffPatient(record, 'R1', 'day')).toBe(true);
    expect(shouldShowHandoffPatient(record, 'R2', 'day')).toBe(true);
    expect(shouldShowHandoffPatient(record, 'R3', 'day')).toBe(false);
    expect(shouldShowHandoffPatient(record, 'R4', 'night')).toBe(false);
    expect(shouldShowHandoffPatient(record, 'missing', 'day')).toBe(false);
    expect(shouldShowHandoffPatient(null, 'R1', 'day')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// One nursing note edit (formerly handoffNursingNoteController.test.ts)
// ---------------------------------------------------------------------------
describe('buildNursingNoteChange', () => {
  const patient = {
    handoffNoteDayShift: 'Dia actual',
    handoffNoteNightShift: 'Noche actual',
  };

  it('writes a day note to both shifts and keeps the day note as the previous text', () => {
    expect(buildNursingNoteChange({ selectedShift: 'day', patient, value: 'Nueva' })).toEqual({
      noteKey: 'handoffNoteDayShift',
      fields: { handoffNoteDayShift: 'Nueva', handoffNoteNightShift: 'Nueva' },
      oldNote: 'Dia actual',
    });
  });

  it('writes a night note to the night shift only', () => {
    expect(buildNursingNoteChange({ selectedShift: 'night', patient, value: 'Nueva' })).toEqual({
      noteKey: 'handoffNoteNightShift',
      fields: { handoffNoteNightShift: 'Nueva' },
      oldNote: 'Noche actual',
    });
  });

  it('treats a missing patient or note as an empty previous text', () => {
    expect(
      buildNursingNoteChange({ selectedShift: 'night', patient: undefined, value: 'x' }).oldNote
    ).toBe('');
    expect(resolveNursingNoteField('day')).toBe('handoffNoteDayShift');
    expect(resolveNursingNoteField('night')).toBe('handoffNoteNightShift');
  });
});
