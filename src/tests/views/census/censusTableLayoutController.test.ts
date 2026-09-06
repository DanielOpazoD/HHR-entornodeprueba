import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  buildCensusTableLayoutBindings,
  resolveCensusTableProjection,
  resolveCensusTableStyle,
} from '@/features/census/controllers/censusTableLayoutController';
import { BedType } from '@/types/domain/beds';

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
        scores: 56,
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
      unifiedRows: [],
      bedTypes: {},
      clinicalDocumentPresenceByBedId: {},
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
    // Visible columns include identity, diagnosis and the 64px UPC minimum (+4px).
    expect(bindings.headerProps.columns.upc).toBe(64);
    expect(bindings.bodyProps.columns.upc).toBe(64);
    expect(bindings.tableStyle).toEqual({ width: '1294px', minWidth: '100%' });
  });

  it('keeps rows and bed data references untouched', () => {
    const unifiedRows = [
      {
        kind: 'occupied' as const,
        id: 'row-1',
        bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
        data: DataFactory.createMockPatient('R1'),
        isSubRow: false,
      },
      {
        kind: 'empty' as const,
        id: 'R2',
        bed: { id: 'R2', name: 'R2', type: BedType.MEDIA, isCuna: false },
      },
    ];
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
        scores: 56,
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
      unifiedRows,
      bedTypes,
      clinicalDocumentPresenceByBedId: {},
      onAction: vi.fn(),
      onActivateEmptyBed: vi.fn(),
      totalWidth: 1200,
    });

    expect(bindings.bodyProps.unifiedRows).toBe(unifiedRows);
    expect(bindings.bodyProps.bedTypes).toBe(bedTypes);
  });

  it('resolves table style from total width', () => {
    expect(resolveCensusTableStyle(980)).toEqual({
      width: '980px',
      minWidth: '100%',
    });
  });

  it('resolves projected columns and width as a single projection step', () => {
    const projection = resolveCensusTableProjection(
      {
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
        scores: 56,
        cqx: 60,
        upc: 60,
      },
      'specialist'
    );

    expect(projection.visibleColumnCount).toBeLessThan(12);
    expect(projection.visibleTotalWidth).toBeGreaterThan(0);
    expect(projection.projectedColumns.status).toBe(0);
  });
});
