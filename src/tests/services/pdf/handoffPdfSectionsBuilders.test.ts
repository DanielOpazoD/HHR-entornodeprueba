import { describe, expect, it, vi } from 'vitest';

import {
  addPatientTable,
  buildPatientTableBody,
} from '@/services/pdf/handoffPdfPatientTableSection';
import { buildMovementsSummaryTables } from '@/services/pdf/handoffPdfMovementsSummarySection';
import { resolveStatusTextStyles } from '@/services/pdf/handoffPdfTableFormattingController';
import { HANDOFF_PDF_PAGE_LAYOUT } from '@/services/pdf/handoffPdfPageLayout';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const baseRecord: DailyRecord = {
  date: '2026-03-10',
  beds: {
    H1C1: {
      bedId: 'H1C1',
      isBlocked: false,
      bedMode: 'Cama',
      hasCompanionCrib: false,
      patientName: 'Juan Perez',
      rut: '1-9',
      age: '45a',
      pathology: 'Neumonia',
      specialty: 'Medicina' as DailyRecord['beds'][string]['specialty'],
      status: 'Grave' as DailyRecord['beds'][string]['status'],
      admissionDate: '2026-03-05',
      hasWristband: false,
      surgicalComplication: false,
      isUPC: false,
      devices: ['VVP'],
      deviceDetails: {
        VVP: { installationDate: '2026-03-08' },
      },
      handoffNoteDayShift: 'Observacion dia',
      handoffNoteNightShift: 'Observacion noche',
      medicalHandoffNote: 'Observacion medica',
    },
  } as DailyRecord['beds'],
  discharges: [
    {
      id: 'd1',
      bedId: 'a1',
      bedName: 'A1',
      bedType: 'Básica',
      patientName: 'Juan Perez',
      rut: '1-9',
      diagnosis: 'Neumonia',
      time: '12:00',
      status: 'Vivo',
      dischargeType: 'Domicilio (Habitual)',
    },
  ],
  transfers: [
    {
      id: 't1',
      bedId: 'a1',
      bedName: 'A1',
      bedType: 'Básica',
      patientName: 'Juan Perez',
      rut: '1-9',
      diagnosis: 'Neumonia',
      time: '12:00',
      receivingCenter: 'HDS',
      evacuationMethod: 'Ambulancia',
    },
  ],
  cma: [
    {
      id: 'c1',
      bedName: 'CMA1',
      patientName: 'Ana Diaz',
      rut: '2-7',
      age: '34a',
      diagnosis: 'Biopsia',
      specialty: 'Cirugía',
      interventionType: 'Cirugía Mayor Ambulatoria',
      timestamp: '2026-03-10T12:00:00Z',
    },
  ],
  nurses: ['', ''],
  nursesDayShift: ['', ''],
  nursesNightShift: ['', ''],
  tensDayShift: ['', '', ''],
  tensNightShift: ['', '', ''],
  activeExtraBeds: [],
  handoffDayChecklist: {},
  handoffNightChecklist: {},
  handoffNovedadesDayShift: '',
  handoffNovedadesNightShift: '',
  medicalHandoffNovedades: '',
  handoffNightReceives: [],
  lastUpdated: '2026-03-10T12:00:00Z',
  schemaVersion: 1,
};

describe('handoffPdf section builders', () => {
  it('arma filas de pacientes con dias y observacion correctos', () => {
    const rows = buildPatientTableBody(baseRecord, false, 'day');
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toMatchObject({ content: expect.stringContaining('Juan Perez') });
    expect(rows[0][4]).toBe('VVP (3d)');
    expect(rows[0][5]).toBe('Observacion dia');
    expect(rows[0]._daysStr).toBe('5d');
  });

  it('renderiza la tabla de pacientes dentro del margen seguro A4', () => {
    const doc = {
      setFontSize: vi.fn(),
      setFont: vi.fn(),
      setTextColor: vi.fn(),
      text: vi.fn(),
      lastAutoTable: { finalY: 72 },
    };
    const autoTable = vi.fn();

    addPatientTable(doc as never, baseRecord, false, 'day', 42, autoTable as never);

    expect(autoTable).toHaveBeenCalledWith(
      doc,
      expect.objectContaining({
        margin: HANDOFF_PDF_PAGE_LAYOUT.margin,
      })
    );
  });

  it('mantiene 0d en pacientes ingresados el mismo dia para coincidir con censo', () => {
    const rows = buildPatientTableBody(
      {
        ...baseRecord,
        beds: {
          ...baseRecord.beds,
          H1C1: {
            ...baseRecord.beds.H1C1,
            admissionDate: baseRecord.date,
          },
        },
      },
      false,
      'day'
    );

    expect(rows[0]._daysStr).toBe('0d');
  });

  it('resuelve estilos por estado clinico', () => {
    expect(resolveStatusTextStyles('grave')).toMatchObject({ fontStyle: 'bold' });
    expect(resolveStatusTextStyles('estable')).toMatchObject({ textColor: [21, 128, 61] });
    expect(resolveStatusTextStyles('otro')).toBeNull();
  });

  it('arma las tablas de resumen de movimientos', () => {
    const tables = buildMovementsSummaryTables(baseRecord);
    expect(tables).toHaveLength(3);
    expect(tables[0].rows[0][0]).toBe('A1');
    expect(tables[1].rows[0][3]).toBe('HDS');
    expect(tables[2].rows[0][0]).toBe('Ana Diaz');
  });

  it('excluye movimientos con tombstone del resumen PDF de entrega', () => {
    const tables = buildMovementsSummaryTables({
      ...baseRecord,
      discharges: [
        ...baseRecord.discharges,
        {
          ...baseRecord.discharges[0],
          id: 'd-deleted',
          patientName: 'Alta eliminada',
          deletedAt: '2026-03-10T13:00:00Z',
        },
      ],
      transfers: [
        ...baseRecord.transfers,
        {
          ...baseRecord.transfers[0],
          id: 't-deleted',
          patientName: 'Traslado eliminado',
          deletedAt: '2026-03-10T13:00:00Z',
        },
      ],
      cma: [
        ...baseRecord.cma,
        {
          ...baseRecord.cma[0],
          id: 'c-deleted',
          patientName: 'CMA eliminada',
          deletedAt: '2026-03-10T13:00:00Z',
        },
      ],
    });

    expect(tables[0].rows).toHaveLength(1);
    expect(tables[0].rows.flat()).not.toContain('Alta eliminada');
    expect(tables[1].rows).toHaveLength(1);
    expect(tables[1].rows.flat()).not.toContain('Traslado eliminado');
    expect(tables[2].rows).toHaveLength(1);
    expect(tables[2].rows.flat()).not.toContain('CMA eliminada');
  });
});
