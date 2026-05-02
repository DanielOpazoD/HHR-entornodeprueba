import { describe, it, expect } from 'vitest';
import {
  deriveConsentDisplayState,
  canUploadPhotosFromState,
  consentStatusLabel,
  resolveConsentActionLabel,
} from '@/features/wound-care/controllers/consentStatusController';
import {
  groupPhotosByDate,
  formatSessionDate,
  formatPhotoTime,
  formatSessionSummary,
} from '@/features/wound-care/controllers/photoGalleryController';
import {
  formatFileSize,
  formatCompressionRatio,
  formatReadonlyUploadDateTime,
  toClinicalEventIso,
} from '@/features/wound-care/controllers/photoUploadController';
import { resolveWoundCarePatients } from '@/features/wound-care/controllers/woundCareSectionController';
import type { DailyRecord } from '@/domain/handoff/recordContracts';
import { PatientStatus, Specialty } from '@/domain/handoff/patientContracts';
import type {
  WoundCareConsent,
  WoundCarePhoto,
  WoundCareAuditActor,
} from '@/types/domain/woundCare';

const createWoundCarePatient = (
  bedId: string,
  overrides: Partial<DailyRecord['beds'][string]> = {}
): DailyRecord['beds'][string] => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: 'Paciente Test',
  rut: '1-9',
  age: '30',
  pathology: 'Observacion',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-01-15',
  hasWristband: true,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  ...overrides,
});

const createWoundCareRecord = (beds: DailyRecord['beds'] = {}): DailyRecord => ({
  date: '2026-01-15',
  lastUpdated: '',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  nursesDayShift: [],
  nursesNightShift: [],
  tensDayShift: [],
  tensNightShift: [],
  activeExtraBeds: [],
  handoffDayChecklist: {},
  handoffNightChecklist: {},
  handoffNovedadesDayShift: '',
  handoffNovedadesNightShift: '',
  medicalHandoffNovedades: '',
  medicalHandoffDoctor: '',
});

// ============================================================================
// Consent Status Controller
// ============================================================================

describe('consentStatusController', () => {
  const mockActor: WoundCareAuditActor = {
    uid: 'u1',
    email: 'e@e.cl',
    displayName: 'Test',
    role: 'editor',
  };

  const baseConsent: WoundCareConsent = {
    id: 'c1',
    patientRut: '1-1',
    patientName: 'P',
    episodeKey: 'ep',
    status: 'signed',
    consentFileStoragePath: 'p',
    consentFileDownloadUrl: 'u',
    consentFileMimeType: 'application/pdf',
    consentFileSize: 100,
    signedAt: '2026-01-01T00:00:00Z',
    uploadedAt: '2026-01-01T00:00:00Z',
    uploadedBy: mockActor,
  };

  it('returns none when consent is null', () => {
    expect(deriveConsentDisplayState(null)).toBe('none');
  });

  it('returns signed when consent status is signed', () => {
    expect(deriveConsentDisplayState(baseConsent)).toBe('signed');
  });

  it('returns revoked when consent status is revoked', () => {
    expect(deriveConsentDisplayState({ ...baseConsent, status: 'revoked' })).toBe('revoked');
  });

  it('canUploadPhotosFromState only true for signed', () => {
    expect(canUploadPhotosFromState('signed')).toBe(true);
    expect(canUploadPhotosFromState('none')).toBe(false);
    expect(canUploadPhotosFromState('revoked')).toBe(false);
  });

  it('provides labels for all states', () => {
    expect(consentStatusLabel.none).toBeTruthy();
    expect(consentStatusLabel.signed).toBeTruthy();
    expect(consentStatusLabel.revoked).toBeTruthy();
  });

  it('resolveConsentActionLabel provides correct labels', () => {
    expect(resolveConsentActionLabel('none')).toBe('Subir consentimiento');
    expect(resolveConsentActionLabel('signed')).toBe('Ver consentimiento');
    expect(resolveConsentActionLabel('revoked')).toBe('Subir nuevo consentimiento');
  });
});

// ============================================================================
// Photo Gallery Controller
// ============================================================================

describe('photoGalleryController', () => {
  const mockActor: WoundCareAuditActor = {
    uid: 'u1',
    email: 'e@e.cl',
    displayName: 'Test',
    role: 'editor',
  };

  const makePhoto = (id: string, uploadedAt: string): WoundCarePhoto => ({
    id,
    patientRut: '1-1',
    patientName: 'P',
    episodeKey: 'ep',
    consentId: 'c1',
    storagePath: 'p',
    thumbnailStoragePath: 't',
    downloadUrl: 'u',
    thumbnailDownloadUrl: 'u',
    mimeType: 'image/webp',
    originalFileSize: 5000,
    compressedFileSize: 1000,
    width: 800,
    height: 600,
    takenAt: uploadedAt,
    uploadedAt,
    uploadedBy: mockActor,
    isDeleted: false,
  });

  it('groups photos by date', () => {
    const photos = [
      makePhoto('p1', '2026-01-15T10:00:00Z'),
      makePhoto('p2', '2026-01-15T14:00:00Z'),
      makePhoto('p3', '2026-01-16T09:00:00Z'),
    ];

    const sessions = groupPhotosByDate(photos);
    expect(sessions).toHaveLength(2);
    // Most recent date first
    expect(sessions[0].date).toBe('2026-01-16');
    expect(sessions[0].photos).toHaveLength(1);
    expect(sessions[1].date).toBe('2026-01-15');
    expect(sessions[1].photos).toHaveLength(2);
  });

  it('returns empty array for no photos', () => {
    expect(groupPhotosByDate([])).toEqual([]);
  });

  it('formats session date', () => {
    expect(formatSessionDate('2026-01-15')).toBe('15/01/2026');
  });

  it('formats photo time', () => {
    const time = formatPhotoTime('2026-01-15T14:30:00Z');
    expect(time).toBeTruthy();
  });

  it('formats session summary', () => {
    expect(
      formatSessionSummary({
        date: '2026-01-15',
        photos: [makePhoto('p1', '2026-01-15T10:00:00Z')],
      })
    ).toBe('1 foto');
    expect(
      formatSessionSummary({
        date: '2026-01-15',
        photos: [makePhoto('p1', '2026-01-15T10:00:00Z'), makePhoto('p2', '2026-01-15T11:00:00Z')],
      })
    ).toBe('2 fotos');
  });
});

// ============================================================================
// Photo Upload Controller
// ============================================================================

describe('photoUploadController', () => {
  it('keeps upload date as readonly display and stores editable clinical event datetime', () => {
    expect(formatReadonlyUploadDateTime(new Date('2026-05-02T19:45:00.000Z'))).toContain(
      '02/05/2026'
    );
    expect(toClinicalEventIso('2026-05-01T09:30')).toBe('2026-05-01T09:30:00.000Z');
    expect(toClinicalEventIso('')).toBeUndefined();
  });

  it('formats file sizes correctly', () => {
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(1500)).toBe('1.5 KB');
    expect(formatFileSize(2500000)).toBe('2.4 MB');
  });

  it('formats compression ratio', () => {
    expect(formatCompressionRatio(1000, 200)).toBe('80% reducción');
    expect(formatCompressionRatio(0, 0)).toBe('0%');
  });
});

// ============================================================================
// Wound Care Section Controller
// ============================================================================

describe('woundCareSectionController', () => {
  it('returns empty for record with no patients', () => {
    const record = createWoundCareRecord({});
    expect(resolveWoundCarePatients(record)).toEqual([]);
  });

  it('skips blocked beds and patients without rut/admissionDate', () => {
    const record = createWoundCareRecord({
      A1: createWoundCarePatient('A1', { patientName: 'Test', rut: '' }),
      A2: createWoundCarePatient('A2', { patientName: 'Test2', admissionDate: '' }),
      A3: createWoundCarePatient('A3', {
        patientName: 'Test3',
        rut: '12345678-9',
        isBlocked: true,
      }),
    });

    expect(resolveWoundCarePatients(record)).toEqual([]);
  });

  it('extracts valid patients with episodeKey', () => {
    const record = createWoundCareRecord({
      A1: createWoundCarePatient('A1', {
        patientName: 'Paciente Uno',
        rut: '12345678-9',
        admissionDate: '2026-01-15',
      }),
      B2: createWoundCarePatient('B2', {
        patientName: 'Paciente Dos',
        rut: '98765432-1',
        admissionDate: '2026-01-10',
      }),
    });

    const patients = resolveWoundCarePatients(record);
    expect(patients).toHaveLength(2);
    expect(patients[0].episodeKey).toBe('12345678-9__2026-01-15');
    expect(patients[1].episodeKey).toBe('98765432-1__2026-01-10');
  });
});

// ============================================================================
// Wound Care Section Controller - Edge Cases
// ============================================================================

describe('woundCareSectionController - edge cases', () => {
  it('skips patients without name', () => {
    const record = createWoundCareRecord({
      A1: createWoundCarePatient('A1', {
        patientName: '',
        rut: '1-1',
        admissionDate: '2026-01-01',
      }),
    });
    expect(resolveWoundCarePatients(record)).toEqual([]);
  });

  it('skips patients with whitespace-only name', () => {
    const record = createWoundCareRecord({
      A1: createWoundCarePatient('A1', {
        patientName: '   ',
        rut: '1-1',
        admissionDate: '2026-01-01',
      }),
    });
    expect(resolveWoundCarePatients(record)).toEqual([]);
  });

  it('handles record with no beds property', () => {
    const record = createWoundCareRecord();
    expect(resolveWoundCarePatients(record)).toEqual([]);
  });

  it('sorts patients by bedName alphabetically', () => {
    const record = createWoundCareRecord({
      C1: createWoundCarePatient('C1', {
        patientName: 'Charlie',
        rut: '3-3',
        admissionDate: '2026-01-01',
      }),
      A1: createWoundCarePatient('A1', {
        patientName: 'Alice',
        rut: '1-1',
        admissionDate: '2026-01-01',
      }),
      B1: createWoundCarePatient('B1', {
        patientName: 'Bob',
        rut: '2-2',
        admissionDate: '2026-01-01',
      }),
    });
    const result = resolveWoundCarePatients(record);
    expect(result.map(p => p.bedName)).toEqual(['A1', 'B1', 'C1']);
  });
});
