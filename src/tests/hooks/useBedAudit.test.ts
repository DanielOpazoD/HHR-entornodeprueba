import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PATIENT_CLINICAL_AUDIT_DEBOUNCE_MS, useBedAudit } from '@/hooks/useBedAudit';
import { useAuditContext } from '@/context/AuditContext';
import { getAttributedAuthors } from '@/services/admin/attributionService';
import type { CudyrScore } from '@/types/domain/cudyr';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

vi.mock('../../context/AuditContext', () => ({
  useAuditContext: vi.fn(),
}));

vi.mock('../../services/admin/attributionService', () => ({
  getAttributedAuthors: vi.fn(),
}));

describe('useBedAudit', () => {
  const mockLogDebouncedEvent = vi.fn();
  const mockLogEvent = vi.fn();
  const mockLogPatientAdmission = vi.fn();
  const mockLogCudyrModified = vi.fn();
  const buildCudyr = (overrides: Partial<CudyrScore> = {}): CudyrScore => ({
    changeClothes: 0,
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
    ...overrides,
  });

  const buildPatient = (overrides: Partial<PatientData> = {}): PatientData => ({
    bedId: 'B1',
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    patientName: '',
    rut: '',
    age: '',
    pathology: '',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    admissionDate: '',
    hasWristband: false,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    ...overrides,
  });

  const mockRecord: DailyRecord = {
    date: '2026-01-19',
    beds: {
      B1: buildPatient({
        patientName: 'John Doe',
        rut: '123-4',
        cudyr: buildCudyr({ mobilization: 1 }),
      }),
      B2: buildPatient({
        clinicalCrib: buildPatient({
          patientName: 'Baby Doe',
          rut: '567-8',
          cudyr: buildCudyr({ feeding: 2 }),
        }),
      }),
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-01-19T00:00:00.000Z',
    nurses: ['', ''],
    activeExtraBeds: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuditContext).mockReturnValue({
      logDebouncedEvent: mockLogDebouncedEvent,
      logEvent: mockLogEvent,
      logPatientAdmission: mockLogPatientAdmission,
      logCudyrModified: mockLogCudyrModified,
      userId: 'user123',
    } as unknown as ReturnType<typeof useAuditContext>);
  });

  it('should log patient admission when name is added', () => {
    const { result } = renderHook(() => useBedAudit(mockRecord));
    const oldPatient = buildPatient({ patientName: '' });

    result.current.auditPatientChange('B1', 'patientName', oldPatient, 'New Patient');

    expect(mockLogPatientAdmission).toHaveBeenCalledWith('B1', 'New Patient', '', '2026-01-19');
  });

  it('should log PATIENT_MODIFIED when name is changed', () => {
    const { result } = renderHook(() => useBedAudit(mockRecord));
    const oldPatient = buildPatient({ patientName: 'Old Name', rut: '111' });

    result.current.auditPatientChange('B1', 'patientName', oldPatient, 'New Name');

    expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
      'PATIENT_MODIFIED',
      'patient',
      'B1',
      expect.objectContaining({ patientName: 'New Name' }),
      '111',
      '2026-01-19',
      undefined,
      PATIENT_CLINICAL_AUDIT_DEBOUNCE_MS
    );
  });

  it('should log device changes', () => {
    const { result } = renderHook(() => useBedAudit(mockRecord));
    const oldPatient = buildPatient({
      patientName: 'John',
      deviceDetails: { CVP: { installationDate: '2026-01-18' } },
    });
    const newDetails = {
      CVP: { installationDate: '2026-01-18', notes: 'Changed' },
    };

    result.current.auditPatientChange('B1', 'deviceDetails', oldPatient, newDetails);

    expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
      'PATIENT_MODIFIED',
      'patient',
      'B1',
      expect.objectContaining({
        changes: expect.objectContaining({
          deviceDetails: expect.any(Object),
        }),
      }),
      '',
      '2026-01-19',
      undefined,
      PATIENT_CLINICAL_AUDIT_DEBOUNCE_MS
    );
  });

  it('should log critical field changes', () => {
    const { result } = renderHook(() => useBedAudit(mockRecord));
    const oldPatient = buildPatient({ patientName: 'John', status: PatientStatus.ESTABLE });

    result.current.auditPatientChange('B1', 'status', oldPatient, PatientStatus.DE_CUIDADO);

    expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
      'PATIENT_MODIFIED',
      'patient',
      'B1',
      expect.objectContaining({
        changes: { status: { old: PatientStatus.ESTABLE, new: PatientStatus.DE_CUIDADO } },
      }),
      '',
      '2026-01-19',
      undefined,
      PATIENT_CLINICAL_AUDIT_DEBOUNCE_MS
    );
  });

  it('should log diagnosis changes with an explicit clinical action', () => {
    const { result } = renderHook(() => useBedAudit(mockRecord));
    const oldPatient = buildPatient({
      patientName: 'John',
      rut: '123-4',
      pathology: 'Diagnostico previo',
    });

    result.current.auditPatientChange('B1', 'pathology', oldPatient, 'Diagnostico actualizado');

    expect(mockLogDebouncedEvent).toHaveBeenCalledWith(
      'PATIENT_DIAGNOSIS_CHANGED',
      'patient',
      'B1',
      expect.objectContaining({
        patientName: 'John',
        bedId: 'B1',
        changes: {
          diagnosis: {
            old: 'Diagnostico previo',
            new: 'Diagnostico actualizado',
          },
        },
      }),
      '123-4',
      '2026-01-19',
      undefined,
      PATIENT_CLINICAL_AUDIT_DEBOUNCE_MS
    );
  });

  it('should log specialty changes through audit context without legacy audit service imports', () => {
    const { result } = renderHook(() => useBedAudit(mockRecord));
    const oldPatient = buildPatient({
      patientName: 'John',
      rut: '123-4',
      specialty: Specialty.MEDICINA,
    });

    result.current.auditPatientChange('B1', 'specialty', oldPatient, Specialty.CIRUGIA);

    expect(mockLogEvent).toHaveBeenCalledWith(
      'PATIENT_SPECIALTY_CHANGED',
      'patient',
      'B1',
      expect.objectContaining({
        patientName: 'John',
        bedId: 'B1',
        field: 'specialty',
        changes: {
          specialty: { old: Specialty.MEDICINA, new: Specialty.CIRUGIA },
        },
      }),
      '123-4',
      '2026-01-19'
    );
  });

  it('should log CUDYR changes with attributed authors', () => {
    vi.mocked(getAttributedAuthors).mockReturnValue('Author 1');
    const { result } = renderHook(() => useBedAudit(mockRecord));

    result.current.auditCudyrChange('B1', 'mobilization', 3);

    expect(mockLogCudyrModified).toHaveBeenCalledWith(
      'B1',
      'John Doe',
      '123-4',
      'mobilization',
      3,
      1,
      '2026-01-19',
      'Author 1'
    );
  });

  it('should log Crib CUDYR changes', () => {
    vi.mocked(getAttributedAuthors).mockReturnValue('Author 1');
    const { result } = renderHook(() => useBedAudit(mockRecord));

    result.current.auditCribCudyrChange('B2', 'feeding', 5);

    expect(mockLogCudyrModified).toHaveBeenCalledWith(
      'B2-crib',
      'Baby Doe',
      '567-8',
      'feeding',
      5,
      2,
      '2026-01-19',
      'Author 1'
    );
  });
});
