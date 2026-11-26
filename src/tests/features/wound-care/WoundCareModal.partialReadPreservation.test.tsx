import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WoundCareModal } from '@/features/wound-care/components/WoundCareModal';
import type { WoundCareConsent, WoundCarePhoto } from '@/types/domain/woundCare';
import type {
  WoundCareConsentPort,
  WoundCarePhotoPort,
} from '@/features/wound-care/use-cases/woundCarePort';

const listPhotosByPatientRutMock = vi.fn();
const listConsentsByPatientRutMock = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: {
      uid: 'u-1',
      email: 'enfermeria@hospital.cl',
      displayName: 'Enfermería Prueba',
    },
    role: 'nurse_hospital',
  }),
}));

vi.mock('@/constants/firestorePaths', () => ({
  getActiveHospitalId: () => 'hanga-roa',
}));

vi.mock('@/features/wound-care/use-cases/woundCarePort', () => ({
  defaultWoundCarePhotoPort: {
    listByPatientRut: (...args: unknown[]) => listPhotosByPatientRutMock(...args),
  } as unknown as WoundCarePhotoPort,
  defaultWoundCareConsentPort: {
    listByPatientRut: (...args: unknown[]) => listConsentsByPatientRutMock(...args),
  } as unknown as WoundCareConsentPort,
}));

const sampleActor = {
  uid: 'u-1',
  email: 'enfermeria@hospital.cl',
  displayName: 'Enfermería Prueba',
  role: 'nurse_hospital',
};

const episodeContext = {
  episodeKey: '11.111.111-1__2026-04-01__10:00',
  patientRut: '11.111.111-1',
  patientName: 'Paciente Sintético',
};

const samplePhoto: WoundCarePhoto = {
  id: 'photo-1',
  patientRut: episodeContext.patientRut,
  patientName: episodeContext.patientName,
  episodeKey: episodeContext.episodeKey,
  storagePath: 'photos/1.webp',
  thumbnailStoragePath: 'photos/1-thumb.webp',
  downloadUrl: 'https://example.test/1.webp',
  thumbnailDownloadUrl: 'https://example.test/1-thumb.webp',
  mimeType: 'image/webp',
  originalFileSize: 10000,
  compressedFileSize: 3000,
  width: 800,
  height: 600,
  description: 'Curación de prueba',
  takenAt: '2026-04-01T10:05:00Z',
  uploadedAt: '2026-04-01T10:05:00Z',
  uploadedBy: sampleActor,
  isDeleted: false,
};

const signedConsent: WoundCareConsent = {
  id: 'consent-1',
  patientRut: episodeContext.patientRut,
  patientName: episodeContext.patientName,
  episodeKey: episodeContext.episodeKey,
  status: 'signed',
  consentFileStoragePath: 'consents/c1.pdf',
  consentFileDownloadUrl: 'https://example.test/c1.pdf',
  consentFileMimeType: 'application/pdf',
  consentFileSize: 2048,
  signedAt: '2026-04-01T09:00:00Z',
  uploadedAt: '2026-04-01T09:05:00Z',
  uploadedBy: sampleActor,
};

describe('WoundCareModal partial history read preservation', () => {
  beforeEach(() => {
    listPhotosByPatientRutMock.mockReset();
    listConsentsByPatientRutMock.mockReset();
  });

  it('keeps photos visible, blocks duplicate consent upload, and recovers on retry when consents fail', async () => {
    listPhotosByPatientRutMock.mockResolvedValue([samplePhoto]);
    listConsentsByPatientRutMock
      .mockRejectedValueOnce(new Error('consents read failed'))
      .mockResolvedValueOnce([signedConsent]);

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    await screen.findByAltText('Curación de prueba');

    expect(screen.getByRole('alert')).toHaveTextContent(
      /no fue posible verificar el consentimiento/i
    );
    const consentButton = screen.getByRole('button', { name: /subir ci/i });
    expect(consentButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(consentButton).not.toBeDisabled();
    expect(screen.getByText('Consentimiento firmado')).toBeInTheDocument();
  });

  it('keeps signed consent visible and replaces empty photo copy with an error alert when photos fail', async () => {
    listPhotosByPatientRutMock
      .mockRejectedValueOnce(new Error('photos read failed'))
      .mockResolvedValueOnce([samplePhoto]);
    listConsentsByPatientRutMock.mockResolvedValue([signedConsent]);

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    await screen.findByText('Consentimiento firmado');

    expect(screen.getByRole('alert')).toHaveTextContent(/no fue posible cargar las fotografías/i);
    expect(screen.queryByText(/no hay fotografías en esta sesión/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sin registro audiovisual/i)).not.toBeInTheDocument();

    // Signed consent remains inspectable even while photos failed to load.
    expect(screen.getByRole('button', { name: /subir ci/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    await screen.findByAltText('Curación de prueba');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never renders empty audiovisual copy when both photos and consents fail', async () => {
    listPhotosByPatientRutMock.mockRejectedValueOnce(new Error('photos down'));
    listConsentsByPatientRutMock.mockRejectedValueOnce(new Error('consents down'));

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={{ ...episodeContext, episodeKey: '' }}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByRole('alert')).toHaveLength(2);
    });
    expect(screen.queryByText(/sin registro audiovisual/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no hay fotografías en esta sesión/i)).not.toBeInTheDocument();
  });

  it('blocks consent upload when a consent refresh fails and the only preserved consent is revoked', async () => {
    const revokedConsent: WoundCareConsent = {
      ...signedConsent,
      id: 'consent-revoked',
      status: 'revoked',
    };

    // Initial load: photos fail (giving a Reintentar button), consents return a revoked consent.
    listPhotosByPatientRutMock
      .mockRejectedValueOnce(new Error('photos initial outage'))
      .mockResolvedValueOnce([samplePhoto]);
    listConsentsByPatientRutMock
      .mockResolvedValueOnce([revokedConsent])
      .mockRejectedValueOnce(new Error('consents refresh failed'));

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no fue posible cargar las fotografías/i);
    });
    expect(screen.getByRole('button', { name: /subir ci/i })).not.toBeDisabled();

    // Retry: photos recover, consents fail — revoked consent must NOT unlock consent upload.
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    await screen.findByAltText('Curación de prueba');
    expect(screen.getByRole('alert')).toHaveTextContent(
      /no fue posible verificar el consentimiento/i
    );
    expect(screen.getByRole('button', { name: /subir ci/i })).toBeDisabled();
  });

  it('surfaces photosError immediately even when only historical collapsed episodes exist', async () => {
    const historicalConsent: WoundCareConsent = {
      ...signedConsent,
      id: 'consent-old',
      episodeKey: '11.111.111-1__2026-01-10__08:00',
    };

    listPhotosByPatientRutMock.mockRejectedValueOnce(new Error('photos down'));
    listConsentsByPatientRutMock.mockResolvedValueOnce([historicalConsent]);

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={{ ...episodeContext, episodeKey: '' }}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no fue posible cargar las fotografías/i);
    });
    expect(screen.getByText(/Hospitalización 10\/01\/2026/i)).toBeInTheDocument();
  });
});
