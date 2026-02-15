import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  buildCensusTableLayoutBindings,
  resolveCensusTableStyle,
} from '@/features/census/controllers/censusTableLayoutController';
import { BedType } from '@/types';

describe('censusTableLayoutController', () => {
  it('builds header/body bindings with consistent forwarding', () => {
    const onClearAll = vi.fn().mockResolvedValue(undefined);
    const onToggleDiagnosisMode = vi.fn();
    const onResizeColumn = vi.fn(() => vi.fn());
    const onAction = vi.fn();
    const onActivateEmptyBed = vi.fn();

    const bindings = buildCensusTableLayoutBindings({
      currentDateString: '2026-02-15',
      readOnly: false,
      columns: {
        actions: 50,
        bed: 80,
        type: 60,
        name: 200,
        rut: 100,
        age: 50,
        diagnosis: 200,
        specialty: 80,
        status: 100,
        admission: 100,
        dmi: 60,
        cqx: 60,
        upc: 60,
      },
      isEditMode: false,
      canDeleteRecord: true,
      resetDayDeniedMessage: '',
      onClearAll,
      diagnosisMode: 'free',
      onToggleDiagnosisMode,
      onResizeColumn,
      occupiedRows: [],
      emptyBeds: [],
      bedTypes: {},
      onAction,
      onActivateEmptyBed,
      totalWidth: 1200,
    });

    expect(bindings.headerProps.onClearAll).toBe(onClearAll);
    expect(bindings.headerProps.onToggleDiagnosisMode).toBe(onToggleDiagnosisMode);
    expect(bindings.headerProps.onResizeColumn).toBe(onResizeColumn);
    expect(bindings.bodyProps.currentDateString).toBe('2026-02-15');
    expect(bindings.bodyProps.onAction).toBe(onAction);
    expect(bindings.bodyProps.onActivateEmptyBed).toBe(onActivateEmptyBed);
    expect(bindings.tableStyle).toEqual({ width: '1200px', minWidth: '100%' });
  });

  it('keeps rows and bed data references untouched', () => {
    const occupiedRows = [
      {
        id: 'row-1',
        bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
        data: DataFactory.createMockPatient('R1'),
        isSubRow: false,
      },
    ];
    const emptyBeds = [{ id: 'R2', name: 'R2', type: BedType.MEDIA, isCuna: false }];
    const bedTypes = { R1: BedType.MEDIA, R2: BedType.MEDIA };

    const bindings = buildCensusTableLayoutBindings({
      currentDateString: '2026-02-15',
      readOnly: true,
      columns: {
        actions: 50,
        bed: 80,
        type: 60,
        name: 200,
        rut: 100,
        age: 50,
        diagnosis: 200,
        specialty: 80,
        status: 100,
        admission: 100,
        dmi: 60,
        cqx: 60,
        upc: 60,
      },
      isEditMode: false,
      canDeleteRecord: false,
      resetDayDeniedMessage: 'No autorizado',
      onClearAll: vi.fn().mockResolvedValue(undefined),
      diagnosisMode: 'cie10',
      onToggleDiagnosisMode: vi.fn(),
      onResizeColumn: vi.fn(() => vi.fn()),
      occupiedRows,
      emptyBeds,
      bedTypes,
      onAction: vi.fn(),
      onActivateEmptyBed: vi.fn(),
      totalWidth: 1200,
    });

    expect(bindings.bodyProps.occupiedRows).toBe(occupiedRows);
    expect(bindings.bodyProps.emptyBeds).toBe(emptyBeds);
    expect(bindings.bodyProps.bedTypes).toBe(bedTypes);
  });

  it('resolves table style from total width', () => {
    expect(resolveCensusTableStyle(980)).toEqual({
      width: '980px',
      minWidth: '100%',
    });
  });
});
