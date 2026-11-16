import { describe, expect, it, vi } from 'vitest';
import {
  buildHandoffChecklistSectionViewModel,
  buildHandoffNovedadesBindings,
  buildHandoffScreenShellModel,
  buildNursingHandoffContentBindings,
  resolveHandoffAuditDescriptor,
  resolveHandoffScreenFrame,
  resolveHandoffNovedadesValue,
  resolveHandoffTableHeaderClass,
  resolveHandoffTitle,
  shouldShowNightCudyrActions,
} from '@/features/handoff/controllers/handoffViewController';

const frameFor = (selectedShift: 'day' | 'night', recordDate?: string) =>
  resolveHandoffScreenFrame({ selectedShift, readOnly: false, recordDate });

describe('handoffViewController', () => {
  it('resolves view title by shift', () => {
    expect(resolveHandoffTitle('day')).toContain('Día');
    expect(resolveHandoffTitle('night')).toContain('Noche');
  });

  it('resolves header classes by shift', () => {
    expect(resolveHandoffTableHeaderClass('day')).toContain('bg-medical-50');
    expect(resolveHandoffTableHeaderClass('night')).toContain('bg-slate-100');
  });

  it('resolves the document title for each nursing shift', () => {
    expect(frameFor('day', '2026-02-15').documentTitle).toBe('TL 15-02-2026');
    expect(frameFor('night', '2026-02-15').documentTitle).toBe('TN 15-02-2026');
  });

  it('returns null document title for missing/invalid dates', () => {
    expect(frameFor('day').documentTitle).toBeNull();
    expect(frameFor('day', 'invalid').documentTitle).toBeNull();
  });

  it('resolves novedades value with night fallback', () => {
    const record = {
      handoffNovedadesDayShift: 'Day note',
      handoffNovedadesNightShift: '',
    };

    expect(resolveHandoffNovedadesValue({ selectedShift: 'day', record })).toBe('Day note');
    expect(resolveHandoffNovedadesValue({ selectedShift: 'night', record })).toBe('Day note');
  });

  it('shows night CUDYR actions only for the night shift', () => {
    expect(shouldShowNightCudyrActions('night')).toBe(true);
    expect(shouldShowNightCudyrActions('day')).toBe(false);
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
