import { describe, expect, it } from 'vitest';

import {
  parseClinicalAttachmentRecord,
  safeParseClinicalAttachmentRecord,
} from '@/features/clinical-documents/contracts/clinicalAttachmentRuntimeContracts';

const buildRecord = () => ({
  id: 'att_1',
  hospitalId: 'hhr',
  patientRut: '13.545.665-9',
  patientRutKey: '13545665-9',
  patientName: 'Paciente Test',
  episodeKey: '13.545.665-9__2026-04-15',
  documentId: 'doc_1',
  documentType: 'epicrisis',
  sectionId: 'annexes',
  storagePath: 'clinical-attachments/hhr/13545665-9/episode/att_1/informe.pdf',
  downloadUrl: 'https://storage.test/informe.pdf',
  originalFileName: 'informe.pdf',
  displayName: 'Informe PDF',
  contentType: 'application/pdf',
  fileKind: 'pdf',
  sizeBytes: 1024,
  status: 'active',
  createdAt: '2026-05-21T10:00:00.000Z',
  createdBy: {
    uid: 'u1',
    email: 'doctor@example.com',
    displayName: 'Doctor',
    role: 'doctor_urgency',
  },
  updatedAt: '2026-05-21T10:00:00.000Z',
  updatedBy: {
    uid: 'u1',
    email: 'doctor@example.com',
    displayName: 'Doctor',
    role: 'doctor_urgency',
  },
});

describe('clinicalAttachmentRuntimeContracts', () => {
  it('parses a valid clinical attachment record', () => {
    expect(parseClinicalAttachmentRecord(buildRecord())).toMatchObject({
      id: 'att_1',
      patientRutKey: '13545665-9',
      fileKind: 'pdf',
      status: 'active',
    });
  });

  it('rejects malformed or unsupported attachment records', () => {
    const result = safeParseClinicalAttachmentRecord({
      ...buildRecord(),
      fileKind: 'zip',
      sizeBytes: -1,
    });

    expect(result.success).toBe(false);
  });
});
