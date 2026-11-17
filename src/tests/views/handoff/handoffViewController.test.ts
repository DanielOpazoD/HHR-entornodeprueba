// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  buildHandoffChecklistSectionViewModel,
  buildHandoffNovedadesBindings,
  buildHandoffScreenShellModel,
  buildNursingHandoffContentBindings,
  resolveHandoffTitle,
  resolveHandoffTableHeaderClass,
  resolveHandoffNovedadesValue,
  shouldShowNightCudyrActions,
  resolveHandoffAuditDescriptor,
  resolveHandoffScreenFrame,
} from '@/features/handoff/controllers/handoffViewController';

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
// resolveHandoffScreenFrame
// ---------------------------------------------------------------------------
describe('resolveHandoffScreenFrame', () => {
  it('returns correct frame for nursing night shift', () => {
    const frame = resolveHandoffScreenFrame({ selectedShift: 'night', readOnly: false });
    expect(frame.title).toContain('Noche');
    expect(frame.tableHeaderClass).toContain('bg-slate-100');
  });

  it('respects readOnly flag', () => {
    const frame = resolveHandoffScreenFrame({ selectedShift: 'day', readOnly: true });
    expect(frame.effectiveReadOnly).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Screen frame, bindings and shell (formerly src/tests/views/handoff/handoffViewController.test.ts)
// ---------------------------------------------------------------------------
const frameFor = (selectedShift: 'day' | 'night', recordDate?: string) =>
  resolveHandoffScreenFrame({ selectedShift, readOnly: false, recordDate });

describe('handoffViewController', () => {
  it('resolves the document title for each nursing shift', () => {
    expect(frameFor('day', '2026-02-15').documentTitle).toBe('TL 15-02-2026');
    expect(frameFor('night', '2026-02-15').documentTitle).toBe('TN 15-02-2026');
  });

  it('returns null document title for missing/invalid dates', () => {
    expect(frameFor('day').documentTitle).toBeNull();
    expect(frameFor('day', 'invalid').documentTitle).toBeNull();
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

  it('returns passthrough bindings for the nursing content slice', () => {
    const nursingBindings = buildNursingHandoffContentBindings({
      visibleBeds: [],
      record: { date: '2026-03-26' } as never,
      noteField: 'handoffNoteDayShift',
      onNoteChange: vi.fn(),
      tableHeaderClass: 'header',
      readOnly: false,
      hasAnyPatients: true,
      shouldShowPatient: vi.fn(() => true),
      clinicalEventActions: {} as never,
      selectedShift: 'day',
      updateHandoffNovedades: vi.fn(),
    });

    expect(nursingBindings.selectedShift).toBe('day');
    expect(nursingBindings.tableHeaderClass).toBe('header');
  });

  it('builds a consistent screen frame and audit descriptor', () => {
    const frame = resolveHandoffScreenFrame({
      selectedShift: 'day',
      role: 'nurse_hospital',
      readOnly: true,
      recordDate: '2026-03-26',
    });

    expect(frame.title).toBe('Entrega Turno Enfermería - Día ');
    expect(frame.tableHeaderClass).toContain('bg-medical-50');
    expect(frame.documentTitle).toBe('TL 26-03-2026');
    expect(frame.effectiveReadOnly).toBe(true);
    expect(resolveHandoffAuditDescriptor('night')).toEqual({
      action: 'VIEW_NURSING_HANDOFF',
      details: {
        view: 'nursing_handoff',
        shift: 'night',
      },
    });
  });

  it('lets clinical events be edited only when the screen is editable', () => {
    const shellFor = (readOnly: boolean) =>
      buildHandoffScreenShellModel({
        selectedShift: 'day',
        role: 'nurse_hospital',
        readOnly,
        recordDate: '2026-03-25',
        todayISO: '2026-03-26',
      });

    expect(shellFor(false).canEditClinicalEvents).toBe(true);
    expect(shellFor(true).canEditClinicalEvents).toBe(false);
    expect(shellFor(false).auditDescriptor.action).toBe('VIEW_NURSING_HANDOFF');
  });
});
