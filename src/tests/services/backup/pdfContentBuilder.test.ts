import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildHandoffPdfContent } from '@/services/backup/pdfContentBuilder';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { ShiftType } from '@/types/domain/shift';
import { PatientStatus } from '@/types/domain/patientClassification';

describe('pdfContentBuilder', () => {
  type HandoffRecord = Parameters<typeof buildHandoffPdfContent>[1];
  type AutoTableFn = Parameters<typeof buildHandoffPdfContent>[4];
  type JsPdfDoc = Parameters<typeof buildHandoffPdfContent>[0];

  let mockDoc: JsPdfDoc;
  let mockAutoTable: ReturnType<typeof vi.fn<AutoTableFn>>;
  const mockRecord: HandoffRecord = DataFactory.createMockDailyRecord('2025-01-01', {
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'John Doe',
        rut: '12.345.678-9',
        admissionDate: '2025-01-01',
        status: PatientStatus.ESTABLE,
        pathology: 'Diagnosis',
        devices: ['VVP#1'],
        handoffNoteDayShift: 'Day note',
      }),
    },
    nursesDayShift: ['Nurse A'],
    handoffDayChecklist: { escalaBraden: true },
  });

  const stubGlobalImage = (mode: 'load' | 'error') => {
    global.Image = class {
      onload?: () => void;
      onerror?: (error?: unknown) => void;
      src: string = '';
      constructor() {
        queueMicrotask(() => {
          if (mode === 'load') this.onload?.();
          else this.onerror?.(new Error('Fail'));
        });
      }
    } as unknown as typeof Image;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockDoc = {
      internal: {
        pageSize: { width: 210, height: 297 },
      },
      setFont: vi.fn(),
      setFontSize: vi.fn(),
      setTextColor: vi.fn(),
      text: vi.fn(),
      addImage: vi.fn(),
      setDrawColor: vi.fn(),
      line: vi.fn(),
      setPage: vi.fn(),
      splitTextToSize: vi.fn(text => [text]),
      lastAutoTable: { finalY: 100 },
      getNumberOfPages: vi.fn(() => 1),
    } as unknown as JsPdfDoc;
    mockAutoTable = vi.fn<AutoTableFn>();

    // Mock global Image for getBase64ImageFromURL
    stubGlobalImage('load');
    Object.defineProperty(global.document, 'createElement', {
      value: vi.fn().mockReturnValue({
        getContext: () => ({ drawImage: vi.fn() }),
        toDataURL: () => 'data:image/png;base64,mock',
      }),
      writable: true,
      configurable: true,
    });
  });

  it('should build PDF content without crashing', async () => {
    await buildHandoffPdfContent(
      mockDoc,
      mockRecord,
      'day' as ShiftType,
      { dayStart: '08:00', dayEnd: '20:00' },
      mockAutoTable
    );

    expect(mockDoc.text).toHaveBeenCalled();
    expect(mockAutoTable).toHaveBeenCalled();
    expect(mockDoc.text).toHaveBeenCalledWith(
      expect.stringContaining('ENTREGA DE TURNO ENFERMERÍA - TURNO LARGO'),
      expect.any(Number),
      expect.any(Number)
    );
    const tableBody = mockAutoTable.mock.calls[0]?.[1]?.body as Array<Array<{ content?: string }>>;
    expect(tableBody.some(row => row[1]?.content?.includes('John Doe'))).toBe(true);
  });

  it('should handle missing logo gracefully', async () => {
    stubGlobalImage('error');

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await buildHandoffPdfContent(mockDoc, mockRecord, 'day', {}, mockAutoTable);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PdfContentBuilder] Could not load logo for backup PDF'),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('should handle nursing handoff night shift', async () => {
    const nightRecord: HandoffRecord = {
      ...mockRecord,
      nursesNightShift: ['Nurse B'],
      handoffNightChecklist: { estadistica: true },
      handoffNovedadesNightShift: 'Night news',
    };

    await buildHandoffPdfContent(mockDoc, nightRecord, 'night', {}, mockAutoTable);

    // More flexible assertion for text
    expect(mockDoc.text).toHaveBeenCalledWith(
      expect.stringContaining('ENTREGA DE TURNO ENFERMERÍA - TURNO NOCHE'),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('should handle empty patient list', async () => {
    const emptyRecord: HandoffRecord = { ...mockRecord, beds: {} };
    await buildHandoffPdfContent(mockDoc, emptyRecord, 'day', {}, mockAutoTable);
    const tableBody = mockAutoTable.mock.calls[0]?.[1]?.body as Array<Array<{ content?: string }>>;
    expect(tableBody[0]?.[0]?.content).toBe('No hay pacientes registrados.');
  });

  it('renders night novedades even when the table already reached the bottom of the page', async () => {
    mockDoc.lastAutoTable = { finalY: 280 };
    mockDoc.addPage = vi.fn();

    await buildHandoffPdfContent(
      mockDoc,
      {
        ...mockRecord,
        handoffNovedadesNightShift: 'Novedades noche importantes',
      },
      'night',
      {},
      mockAutoTable
    );

    expect(mockDoc.addPage).toHaveBeenCalled();
    expect(mockDoc.text).toHaveBeenCalledWith(
      'Novedades & Pendientes',
      expect.any(Number),
      expect.any(Number)
    );
    expect(mockDoc.splitTextToSize).toHaveBeenCalledWith(
      'Novedades noche importantes',
      expect.any(Number)
    );
  });

  it('uses day novedades as fallback in night backup PDFs when the night field is empty', async () => {
    await buildHandoffPdfContent(
      mockDoc,
      {
        ...mockRecord,
        handoffNovedadesDayShift: 'Texto visible por defecto en noche',
        handoffNovedadesNightShift: '',
      },
      'night',
      {},
      mockAutoTable
    );

    expect(mockDoc.splitTextToSize).toHaveBeenCalledWith(
      'Texto visible por defecto en noche',
      expect.any(Number)
    );
  });

  it('formats device days without losing a day across September DST and omits future or invalid install dates', async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/Santiago';
    try {
      const dstRecord: HandoffRecord = DataFactory.createMockDailyRecord('2026-09-20', {
        beds: {
          R1: DataFactory.createMockPatient('R1', {
            patientName: 'Paciente DST',
            rut: '12.345.678-9',
            admissionDate: '2026-08-20',
            status: PatientStatus.ESTABLE,
            pathology: 'Diagnóstico',
            devices: ['VVP#1', 'CVC', 'CUP'],
            deviceDetails: {
              'VVP#1': { installationDate: '2026-08-20' },
              CVC: { installationDate: '2026-09-25' },
              CUP: { installationDate: 'invalid-date' },
            },
            handoffNoteDayShift: 'Nota',
          }),
        },
        nursesDayShift: ['Nurse A'],
      });

      await buildHandoffPdfContent(mockDoc, dstRecord, 'day', {}, mockAutoTable);

      const tableBody = mockAutoTable.mock.calls[0]?.[1]?.body as Array<Array<string>>;
      expect(tableBody[0]?.[4]).toBe('VVP#1 (32d), CVC, CUP');
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });
});
