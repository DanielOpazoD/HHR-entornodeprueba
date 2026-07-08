import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildClinicalDocumentSignatureProfileFromDraft,
  createClinicalDocumentSignatureProfileService,
} from '@/features/clinical-documents/services/clinicalDocumentSignatureProfileService';

const repository = {
  getDoc: vi.fn(),
  setDoc: vi.fn(),
};

describe('clinicalDocumentSignatureProfileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores the specialist signature profile under the current user settings document', async () => {
    const service = createClinicalDocumentSignatureProfileService(repository);

    await service.saveProfile({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      displayName: '  Dra. Firma Personal  ',
      specialty: '  Medicina Interna  ',
    });

    expect(repository.setDoc).toHaveBeenCalledWith(
      'userSettings',
      'specialist-uid',
      {
        clinicalSignatureProfile: {
          uid: 'specialist-uid',
          email: 'especialista@hospital.cl',
          displayName: 'Dra. Firma Personal',
          specialty: 'Medicina Interna',
          updatedAt: expect.any(String),
        },
      },
      { merge: true }
    );
  });

  it('loads only the clinical signature profile from the current user settings document', async () => {
    repository.getDoc.mockResolvedValueOnce({
      theme: 'dark',
      clinicalSignatureProfile: {
        uid: 'specialist-uid',
        email: 'especialista@hospital.cl',
        displayName: 'Dra. Firma Personal',
        specialty: 'Medicina Interna',
        updatedAt: '2026-05-07T12:00:00.000Z',
      },
    });
    const service = createClinicalDocumentSignatureProfileService(repository);

    await expect(service.getProfile('specialist-uid')).resolves.toEqual({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      displayName: 'Dra. Firma Personal',
      specialty: 'Medicina Interna',
      updatedAt: '2026-05-07T12:00:00.000Z',
    });
  });

  it('builds a save payload from the current document footer fields', () => {
    expect(
      buildClinicalDocumentSignatureProfileFromDraft(
        {
          uid: 'u1',
          email: 'doctor@test.com',
          displayName: 'Cuenta Google',
        },
        {
          medico: 'Dra. Documento',
          especialidad: 'Cardiologia',
        }
      )
    ).toEqual({
      uid: 'u1',
      email: 'doctor@test.com',
      displayName: 'Dra. Documento',
      specialty: 'Cardiologia',
    });
  });
});
