import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WoundCareMobileQrPanel } from '@/features/wound-care/components/WoundCareMobileQrPanel';
import type { WoundCareMobileUploadSession } from '@/types/domain/woundCare';

const createSessionUseCaseMock = vi.fn();
const revokeSessionUseCaseMock = vi.fn();
const qrToDataUrlMock = vi.fn();
const writeClipboardTextMock = vi.fn();

const authState = {
  currentUser: {
    uid: 'nurse-1',
    email: 'enfermeria@hospital.cl',
    displayName: 'Enfermería Prueba',
  } as { uid: string; email: string | null; displayName: string | null } | null,
  role: 'nurse_hospital',
};

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@/constants/firestorePaths', () => ({
  getActiveHospitalId: () => 'hanga-roa',
}));

vi.mock('@/features/wound-care/use-cases/woundCareUseCases', () => ({
  executeCreateWoundCareMobileUploadSession: (...args: unknown[]) =>
    createSessionUseCaseMock(...args),
  executeRevokeWoundCareMobileUploadSession: (...args: unknown[]) =>
    revokeSessionUseCaseMock(...args),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: (...args: unknown[]) => qrToDataUrlMock(...args),
  },
}));

vi.mock('@/shared/runtime/browserClipboardRuntime', () => ({
  writeClipboardText: (...args: unknown[]) => writeClipboardTextMock(...args),
}));

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const episodeA = {
  episodeKey: '11.111.111-1__2026-04-01__10:00',
  patientRut: '11.111.111-1',
  patientName: 'Paciente Sintético',
};

const episodeB = {
  episodeKey: '11.111.111-1__2026-04-01__11:00',
  patientRut: '11.111.111-1',
  patientName: 'Paciente Sintético',
};

const makeSession = (sessionId: string, episode = episodeA): WoundCareMobileUploadSession => ({
  sessionId,
  hospitalId: 'hanga-roa',
  episodeKey: episode.episodeKey,
  patientRut: episode.patientRut,
  patientName: episode.patientName,
  createdBy: {
    uid: 'nurse-1',
    email: 'enfermeria@hospital.cl',
    displayName: 'Enfermería Prueba',
    role: 'nurse_hospital',
  },
  createdAt: '2026-04-01T15:00:00.000Z',
  expiresAt: '2026-04-01T15:30:00.000Z',
  scope: 'wound_care_upload_only',
  maxUploads: 50,
  uploadCount: 0,
});

describe('WoundCareMobileQrPanel & useWoundCareMobileUploadSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = {
      uid: 'nurse-1',
      email: 'enfermeria@hospital.cl',
      displayName: 'Enfermería Prueba',
    };
    authState.role = 'nurse_hospital';
    qrToDataUrlMock.mockImplementation((url: string) =>
      Promise.resolve(`data:image/png;base64,${encodeURIComponent(url)}`)
    );
    writeClipboardTextMock.mockResolvedValue(undefined);
  });

  it('keeps the active QR and revoke retry button visible when revocation returns a failed outcome, then clears on retry success', async () => {
    const session1 = makeSession('wcu_session_1');
    createSessionUseCaseMock.mockResolvedValueOnce({
      status: 'success',
      data: session1,
      issues: [],
    });
    revokeSessionUseCaseMock
      .mockResolvedValueOnce({
        status: 'failed',
        data: null,
        issues: [{ kind: 'unknown', message: 'Sin conexión para revocar el QR.' }],
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: null,
        issues: [],
      });

    render(<WoundCareMobileQrPanel episodeContext={episodeA} />);

    await screen.findByAltText('QR para subir fotos clínicas');
    expect(screen.getByText(/wcu_session_1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /revocar qr/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión para revocar el QR.');
    });
    // Session must stay visible and revocable after failed revocation.
    expect(screen.getByAltText('QR para subir fotos clínicas')).toBeInTheDocument();
    expect(screen.getByText(/wcu_session_1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revocar qr/i })).not.toBeDisabled();

    // Retry revocation succeeds and clearly shows the revoked state instead of "Generando QR...".
    fireEvent.click(screen.getByRole('button', { name: /revocar qr/i }));

    await waitFor(() => {
      expect(screen.getByText(/qr revocado/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/wcu_session_1/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revocar qr/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/generando qr/i)).not.toBeInTheDocument();
  });

  it('revokes the previous active session before issuing a replacement on Regenerar, and keeps the previous session if revoking fails', async () => {
    const session1 = makeSession('wcu_session_1');
    const session2 = makeSession('wcu_session_2');
    createSessionUseCaseMock
      .mockResolvedValueOnce({ status: 'success', data: session1, issues: [] })
      .mockResolvedValueOnce({ status: 'success', data: session2, issues: [] });
    revokeSessionUseCaseMock
      .mockResolvedValueOnce({
        status: 'failed',
        data: null,
        issues: [{ kind: 'unknown', message: 'Error revocando sesión anterior.' }],
      })
      .mockResolvedValueOnce({ status: 'success', data: null, issues: [] });

    render(<WoundCareMobileQrPanel episodeContext={episodeA} />);

    await screen.findByAltText('QR para subir fotos clínicas');

    // First Regenerar fails while revoking session 1 -> must NOT create session 2 or hide session 1.
    fireEvent.click(screen.getByRole('button', { name: /regenerar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Error revocando sesión anterior.');
    });
    expect(createSessionUseCaseMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/wcu_session_1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revocar qr/i })).not.toBeDisabled();

    // Second Regenerar revokes session 1 and then creates session 2.
    fireEvent.click(screen.getByRole('button', { name: /regenerar/i }));

    await waitFor(() => {
      expect(screen.getByText(/wcu_session_2/)).toBeInTheDocument();
    });
    expect(revokeSessionUseCaseMock).toHaveBeenCalledTimes(2);
    expect(createSessionUseCaseMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the revoked previous session if creating the replacement fails on Regenerar', async () => {
    const session1 = makeSession('wcu_session_1');
    createSessionUseCaseMock
      .mockResolvedValueOnce({ status: 'success', data: session1, issues: [] })
      .mockResolvedValueOnce({
        status: 'failed',
        data: null,
        issues: [{ kind: 'unknown', message: 'No se pudo emitir nuevo QR.' }],
      });
    revokeSessionUseCaseMock.mockResolvedValueOnce({ status: 'success', data: null, issues: [] });

    render(<WoundCareMobileQrPanel episodeContext={episodeA} />);

    await screen.findByAltText('QR para subir fotos clínicas');
    fireEvent.click(screen.getByRole('button', { name: /regenerar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('No se pudo emitir nuevo QR.');
    });
    expect(screen.queryByText(/wcu_session_1/)).not.toBeInTheDocument();
    expect(screen.getByText(/qr no disponible/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerar/i })).not.toBeDisabled();
  });

  it('does not recreate the QR when rerendered with a new episodeContext object for the same episode', async () => {
    const session1 = makeSession('wcu_session_1');
    createSessionUseCaseMock.mockResolvedValueOnce({
      status: 'success',
      data: session1,
      issues: [],
    });

    const { rerender } = render(<WoundCareMobileQrPanel episodeContext={{ ...episodeA }} />);

    await screen.findByAltText('QR para subir fotos clínicas');
    expect(createSessionUseCaseMock).toHaveBeenCalledTimes(1);

    rerender(<WoundCareMobileQrPanel episodeContext={{ ...episodeA }} />);

    expect(createSessionUseCaseMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/wcu_session_1/)).toBeInTheDocument();
  });

  it('discards an in-flight create response from a previous episode when the episode changes', async () => {
    const deferredA = createDeferred<{
      status: 'success';
      data: WoundCareMobileUploadSession;
      issues: [];
    }>();
    const deferredB = createDeferred<{
      status: 'success';
      data: WoundCareMobileUploadSession;
      issues: [];
    }>();
    createSessionUseCaseMock
      .mockReturnValueOnce(deferredA.promise)
      .mockReturnValueOnce(deferredB.promise);

    const { rerender } = render(<WoundCareMobileQrPanel episodeContext={episodeA} />);

    await waitFor(() => {
      expect(createSessionUseCaseMock).toHaveBeenCalledTimes(1);
    });

    // Switch to episode B before episode A finishes creating.
    rerender(<WoundCareMobileQrPanel episodeContext={episodeB} />);

    await waitFor(() => {
      expect(createSessionUseCaseMock).toHaveBeenCalledTimes(2);
    });

    // Stale episode A session resolves first and must NOT appear under episode B.
    await act(async () => {
      deferredA.resolve({
        status: 'success',
        data: makeSession('wcu_episode_a', episodeA),
        issues: [],
      });
    });
    expect(screen.queryByText(/wcu_episode_a/)).not.toBeInTheDocument();

    // Episode B session resolves and displays cleanly.
    await act(async () => {
      deferredB.resolve({
        status: 'success',
        data: makeSession('wcu_episode_b', episodeB),
        issues: [],
      });
    });
    await waitFor(() => {
      expect(screen.getByText(/wcu_episode_b/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/wcu_episode_a/)).not.toBeInTheDocument();
  });

  it('deduplicates rapid revoke clicks while revocation is already in flight', async () => {
    const session1 = makeSession('wcu_session_1');
    const deferredRevoke = createDeferred<{ status: 'success'; data: null; issues: [] }>();
    createSessionUseCaseMock.mockResolvedValueOnce({
      status: 'success',
      data: session1,
      issues: [],
    });
    revokeSessionUseCaseMock.mockReturnValueOnce(deferredRevoke.promise);

    render(<WoundCareMobileQrPanel episodeContext={episodeA} />);
    await screen.findByAltText('QR para subir fotos clínicas');

    const revokeButton = screen.getByRole('button', { name: /revocar qr/i });
    fireEvent.click(revokeButton);
    fireEvent.click(revokeButton);

    expect(revokeSessionUseCaseMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferredRevoke.resolve({ status: 'success', data: null, issues: [] });
    });

    await waitFor(() => {
      expect(screen.getByText(/qr revocado/i)).toBeInTheDocument();
    });
  });

  it('keeps the active link and revoke action available if QR canvas rendering fails', async () => {
    const session1 = makeSession('wcu_session_1');
    createSessionUseCaseMock.mockResolvedValueOnce({
      status: 'success',
      data: session1,
      issues: [],
    });
    qrToDataUrlMock.mockRejectedValueOnce(new Error('canvas unavailable'));

    render(<WoundCareMobileQrPanel episodeContext={episodeA} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no fue posible dibujar el código qr/i);
    });
    expect(screen.getByText(/wcu_session_1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revocar qr/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /copiar link/i })).not.toBeDisabled();
    expect(screen.queryByText(/generando qr/i)).not.toBeInTheDocument();
  });
});
