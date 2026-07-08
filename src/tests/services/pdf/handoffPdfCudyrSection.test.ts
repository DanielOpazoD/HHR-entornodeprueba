import { describe, it, expect, vi } from 'vitest';
import { addCudyrTable } from '@/services/pdf/handoffPdfCudyrSection';
import { HANDOFF_PDF_PAGE_LAYOUT } from '@/services/pdf/handoffPdfPageLayout';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const createDocMock = () =>
  ({
    addPage: vi.fn(),
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    text: vi.fn(),
    setDrawColor: vi.fn(),
    setLineWidth: vi.fn(),
    line: vi.fn(),
    internal: { pageSize: { height: 297, width: 210 } },
    lastAutoTable: { finalY: 100 },
  }) as unknown as Parameters<typeof addCudyrTable>[0];

describe('handoffPdfCudyrSection', () => {
  it('renders canonical night-shift nurses in the CUDYR header', () => {
    const doc = createDocMock();
    const autoTable = vi.fn();
    const record = {
      date: '2026-03-07',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '2026-03-07T10:00:00.000Z',
      nursesNightShift: ['Carla', 'Rosa'],
    } as unknown as DailyRecord;

    addCudyrTable(doc, record, 10, autoTable as never);

    expect(autoTable).toHaveBeenCalledWith(
      doc,
      expect.objectContaining({
        margin: HANDOFF_PDF_PAGE_LAYOUT.margin,
      })
    );
    expect(doc.text).toHaveBeenCalledWith(
      expect.stringContaining('Enfermeros/as (Noche): Carla, Rosa'),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('renders canonical vacancy labels when no night-shift nurses are assigned', () => {
    const doc = createDocMock();
    const autoTable = vi.fn();
    const record = {
      date: '2026-03-07',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '2026-03-07T10:00:00.000Z',
      nursesNightShift: ['', ''],
    } as unknown as DailyRecord;

    addCudyrTable(doc, record, 10, autoTable as never);

    expect(doc.text).toHaveBeenCalledWith(
      expect.stringContaining('Enfermeros/as (Noche): Vacante, Vacante'),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('normalizes legacy vacancy markers in the CUDYR header', () => {
    const doc = createDocMock();
    const autoTable = vi.fn();
    const record = {
      date: '2026-03-07',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '2026-03-07T10:00:00.000Z',
      nursesNightShift: [' Carla ', '--'],
    } as unknown as DailyRecord;

    addCudyrTable(doc, record, 10, autoTable as never);

    expect(doc.text).toHaveBeenCalledWith(
      expect.stringContaining('Enfermeros/as (Noche): Carla, Vacante'),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('renders the fixed night-shift application timestamp in the PDF header', () => {
    const doc = createDocMock();
    const autoTable = vi.fn();
    const record = {
      date: '2026-03-07',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '2026-03-07T10:00:00.000Z',
      cudyrUpdatedAt: '2026-03-07T21:45:00',
    } as unknown as DailyRecord;

    addCudyrTable(doc, record, 10, autoTable as never);

    expect(doc.text).toHaveBeenCalledWith(
      expect.stringContaining('Turno 07-03-2026.'),
      expect.any(Number),
      expect.any(Number)
    );
    expect(doc.text).toHaveBeenCalledWith(
      expect.stringContaining('Fecha y hora de corte de aplicación: 08-03-2026, 1:00 AM'),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('keeps the same fixed application timestamp even if only cudyrLockedAt exists', () => {
    const doc = createDocMock();
    const autoTable = vi.fn();
    const record = {
      date: '2026-03-07',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '2026-03-07T10:00:00.000Z',
      cudyrLockedAt: '2026-03-07T18:20:00',
    } as unknown as DailyRecord;

    addCudyrTable(doc, record, 10, autoTable as never);

    expect(doc.text).toHaveBeenCalledWith(
      expect.stringContaining('Fecha y hora de corte de aplicación: 08-03-2026, 1:00 AM'),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('renders the summary headline with categorizable beds, categorized beds and index', () => {
    const doc = createDocMock();
    const autoTable = vi.fn();
    const record = {
      date: '2026-04-12',
      beds: {
        R1: {
          patientName: 'Paciente categorizado',
          rut: '1-9',
          admissionDate: '2026-04-11',
          admissionTime: '18:00',
          cudyr: {
            changeClothes: 1,
            mobilization: 1,
            feeding: 0,
            elimination: 0,
            psychosocial: 0,
            surveillance: 0,
            vitalSigns: 0,
            fluidBalance: 0,
            oxygenTherapy: 0,
            airway: 0,
            proInterventions: 0,
            skinCare: 0,
            pharmacology: 0,
            invasiveElements: 0,
          },
        },
        R2: {
          patientName: 'Paciente sin categorizar',
          rut: '2-7',
          admissionDate: '2026-04-11',
          admissionTime: '19:00',
          cudyr: undefined,
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '2026-04-12T10:00:00.000Z',
    } as unknown as DailyRecord;

    addCudyrTable(doc, record, 10, autoTable as never);

    expect(doc.text).toHaveBeenCalledWith(
      expect.stringContaining(
        'Camas categorizables = 2  |  Camas categorizadas = 1  |  Indice categorización = 50%'
      ),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('does not categorize blocked night-shift admissions and still keeps them visible in the table', () => {
    const doc = createDocMock();
    const autoTable = vi.fn();
    const record = {
      date: '2026-04-12',
      beds: {
        R1: {
          patientName: 'Paciente bloqueado',
          rut: '1-9',
          admissionDate: '2026-04-12',
          admissionTime: '23:30',
          cudyr: {
            changeClothes: 3,
            mobilization: 3,
            feeding: 3,
            elimination: 3,
            psychosocial: 3,
            surveillance: 3,
            vitalSigns: 3,
            fluidBalance: 3,
            oxygenTherapy: 3,
            airway: 3,
            proInterventions: 3,
            skinCare: 3,
            pharmacology: 3,
            invasiveElements: 3,
          },
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '2026-04-12T10:00:00.000Z',
    } as unknown as DailyRecord;

    addCudyrTable(doc, record, 10, autoTable as never);

    const tableConfig = vi.mocked(autoTable).mock.calls[0]?.[1];
    expect(doc.text).not.toHaveBeenCalledWith(
      expect.stringContaining('A1: 1'),
      expect.any(Number),
      expect.any(Number)
    );
    expect(tableConfig?.body[0]?.[1]).toContain('(Bloq.)');
    expect(tableConfig?.body[0]?.[17]).toBe('-');
    expect(tableConfig?.body[0]?.[19]).toBe('-');
  });

  it('includes eligible clinical crib rows in the PDF table', () => {
    const doc = createDocMock();
    const autoTable = vi.fn();
    const record = {
      date: '2026-04-12',
      beds: {
        R1: {
          patientName: 'Madre',
          rut: '1-9',
          admissionDate: '2026-04-11',
          admissionTime: '18:00',
          cudyr: {
            changeClothes: 1,
            mobilization: 0,
            feeding: 0,
            elimination: 0,
            psychosocial: 0,
            surveillance: 0,
            vitalSigns: 0,
            fluidBalance: 0,
            oxygenTherapy: 0,
            airway: 0,
            proInterventions: 0,
            skinCare: 0,
            pharmacology: 0,
            invasiveElements: 0,
          },
          clinicalCrib: {
            patientName: 'RN',
            rut: 'RN-1',
            admissionDate: '2026-04-11',
            admissionTime: '19:00',
            cudyr: {
              changeClothes: 0,
              mobilization: 0,
              feeding: 0,
              elimination: 0,
              psychosocial: 0,
              surveillance: 0,
              vitalSigns: 2,
              fluidBalance: 0,
              oxygenTherapy: 0,
              airway: 0,
              proInterventions: 0,
              skinCare: 0,
              pharmacology: 0,
              invasiveElements: 0,
            },
          },
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '2026-04-12T10:00:00.000Z',
    } as unknown as DailyRecord;

    addCudyrTable(doc, record, 10, autoTable as never);

    const tableConfig = vi.mocked(autoTable).mock.calls[0]?.[1];
    expect(tableConfig?.body).toHaveLength(2);
    expect(tableConfig?.body[1]?.[0]).toBe('R1 (CC)');
    expect(tableConfig?.body[1]?.[1]).toContain('RN');
  });
});
