// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fillIEEHForm } from '@/features/clinical-documents/services/ieehPdfService';
import type { PatientData } from '../../../types/domain/patient';
import { PatientStatus, Specialty } from '../../../types/domain/patientClassification';

// Use vi.hoisted to define mock objects that are used in vi.mock
const { mockDrawText, mockGetPage, mockEmbedFont, mockSave } = vi.hoisted(() => {
  const mockDrawText = vi.fn();
  return {
    mockDrawText,
    mockGetPage: vi.fn().mockReturnValue({
      drawText: mockDrawText,
    }),
    mockEmbedFont: vi.fn().mockResolvedValue({
      widthOfTextAtSize: vi.fn().mockReturnValue(10),
    }),
    mockSave: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  };
});

// Mock pdf-lib
vi.mock('pdf-lib', async () => {
  const actual = await vi.importActual<typeof import('pdf-lib')>('pdf-lib');
  return {
    ...actual,
    PDFDocument: {
      load: vi.fn().mockResolvedValue({
        embedFont: mockEmbedFont,
        getPage: mockGetPage,
        save: mockSave,
      }),
    },
  };
});

const collectDrawnText = (): string =>
  mockDrawText.mock.calls.map(([text]) => String(text)).join('');

// Mock fetch
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
});

describe('ieehPdfService - fillIEEHForm logic', () => {
  const mockPatient: PatientData = {
    bedId: '1',
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    patientName: 'JUAN PEREZ',
    rut: '12345678-9',
    age: '30',
    pathology: 'DIAGNOSTICO BASE',
    cie10Code: 'A00',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.EMPTY,
    admissionDate: '01-01-2024',
    admissionTime: '10:00',
    insurance: 'Fonasa',
    admissionOrigin: 'Urgencias',
    hasWristband: false,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
  };
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prioritizes dialog overrides for diagnosis and CIE-10', async () => {
    const discharge = {
      diagnosticoPrincipal: 'DIAGNOSTICO DIALOGO',
      cie10Code: 'B00',
    };

    await fillIEEHForm(mockPatient, discharge);

    const drawnChars = collectDrawnText();

    expect(drawnChars).toContain('DIAGNOSTICO DIALOGO');
    expect(drawnChars).toContain('B00');
    expect(drawnChars).not.toContain('DIAGNOSTICO BASE');
  });

  it('falls back to patient data when dialog overrides are missing', async () => {
    await fillIEEHForm(mockPatient, {});

    const drawnChars = collectDrawnText();

    expect(drawnChars).toContain('DIAGNOSTICO BASE');
    expect(drawnChars).toContain('A00');
  });

  it('correctly maps insurance and origin codes', async () => {
    await fillIEEHForm(mockPatient, {});

    const drawnChars = collectDrawnText();

    // Fonasa -> '1'
    expect(drawnChars).toContain('1');
  });

  it('handles new fields from dialog (surgery, procedure, doctor)', async () => {
    const discharge = {
      intervencionQuirurgica: '1',
      intervencionQuirurgDescrip: 'APENDICECTOMIA',
      procedimiento: '2',
      procedimientoDescrip: 'ECOGRAFIA',
      tratanteNombre: 'DR. HOUSE',
      tratanteRut: '12.345.678-9',
      condicionEgreso: '7',
    };

    await fillIEEHForm(mockPatient, discharge);

    const drawnChars = collectDrawnText();

    expect(drawnChars).toContain('APENDICECTOMIA');
    expect(drawnChars).toContain('ECOGRAFIA');
    expect(drawnChars).toContain('DR. HOUSE');
    expect(drawnChars).toContain('12.345.678-9');
    expect(drawnChars).toContain('7');
  });

  it('caches the blank template across calls and clears cache on fetch error', async () => {
    vi.resetModules();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
    vi.stubGlobal('fetch', fetchSpy);

    const { fillIEEHForm: freshFillIEEHForm } =
      await import('@/features/clinical-documents/services/ieehPdfService');

    await expect(freshFillIEEHForm(mockPatient, {})).rejects.toThrow('plantilla IEEH (503)');

    await freshFillIEEHForm(mockPatient, {});
    await freshFillIEEHForm(mockPatient, {});

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      '/docs/estadistico-egreso.pdf',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    vi.unstubAllGlobals();
  });
});
