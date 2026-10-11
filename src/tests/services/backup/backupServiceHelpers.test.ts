// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildNursingHandoffBackupPayload,
  countPatientsInBackupContent,
  docToBackupFile,
  docToBackupPreview,
  formatDateForBackupTitle,
  generateBackupId,
} from '@/services/backup/backupServiceHelpers';

describe('backupServiceHelpers', () => {
  it('generates deterministic backup ids', () => {
    expect(generateBackupId('2025-01-01', 'night')).toBe('2025-01-01_night');
  });

  it('counts only occupied beds from content', () => {
    expect(
      countPatientsInBackupContent({
        beds: {
          A1: { patientName: 'Jane Doe' },
          A2: { patientName: '' },
          A3: {},
        },
      })
    ).toBe(1);
  });

  it('builds nursing handoff payload with derived title and metadata', () => {
    const payload = buildNursingHandoffBackupPayload({
      date: '2025-01-01',
      shiftType: 'day',
      deliveryStaff: 'D',
      receivingStaff: 'R',
      content: { beds: { A1: { patientName: 'Jane Doe' } } },
      createdAt: 'now',
      createdBy: { uid: 'u1', email: 'a@b.com', name: 'User' },
    });

    expect(payload.title).toBe('Entrega de Turno Enfermería - Turno Largo - 01-01-2025');
    expect(payload.metadata).toEqual({
      deliveryStaff: 'D',
      receivingStaff: 'R',
      patientCount: 1,
      shiftType: 'day',
    });
  });

  it('maps firestore documents to preview and full file', () => {
    const snapshot = {
      id: 'backup-1',
      data: () => ({
        type: 'NURSING_HANDOFF',
        shiftType: 'day',
        date: '2025-01-01',
        title: 'Title',
        createdAt: { toDate: () => ({ toISOString: () => '2025-01-01T00:00:00.000Z' }) },
        createdBy: { uid: 'u1', email: 'a@b.com', name: 'User' },
        metadata: { patientCount: 1 },
        content: { beds: {} },
      }),
    };

    expect(docToBackupPreview(snapshot as never)).toEqual({
      id: 'backup-1',
      type: 'NURSING_HANDOFF',
      shiftType: 'day',
      date: '2025-01-01',
      title: 'Title',
      createdAt: '2025-01-01T00:00:00.000Z',
      createdBy: { uid: 'u1', email: 'a@b.com', name: 'User' },
      metadata: { patientCount: 1 },
    });
    expect(docToBackupFile(snapshot as never).content).toEqual({ beds: {} });
  });

  it('falls back to stringified timestamps and rejects empty firestore documents', () => {
    const snapshotWithStringTimestamp = {
      id: 'backup-2',
      data: () => ({
        type: 'NURSING_HANDOFF',
        shiftType: 'night',
        date: '2025-01-02',
        title: 'Title 2',
        createdAt: { toString: () => 'legacy-created-at' },
        createdBy: { uid: 'u2', email: 'b@c.com', name: 'User 2' },
        metadata: { patientCount: 0 },
        content: { beds: {} },
      }),
    };
    const emptySnapshot = {
      id: 'backup-empty',
      data: () => undefined,
    };

    expect(docToBackupPreview(snapshotWithStringTimestamp as never).createdAt).toBe(
      'legacy-created-at'
    );
    expect(() => docToBackupPreview(emptySnapshot as never)).toThrow('Document data is undefined');
    expect(() => docToBackupFile(emptySnapshot as never)).toThrow('Document data is undefined');
  });

  it('formats backup title dates consistently', () => {
    expect(formatDateForBackupTitle('2025-01-01')).toBe('01-01-2025');
  });
});
