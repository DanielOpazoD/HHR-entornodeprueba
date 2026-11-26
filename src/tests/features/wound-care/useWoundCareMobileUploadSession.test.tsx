import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WoundCareMobileQrPanel } from '@/features/wound-care/components/WoundCareMobileQrPanel';
import type { WoundCareMobileUploadSession } from '@/types/domain/woundCare';

const listActiveSessionsUseCaseMock = vi.fn();
const createSessionUseCaseMock = vi.fn();
const revokeSessionUseCaseMock = vi.fn();
const qrToDataUrlMock = vi.fn();
const writeClipboardTextMock = vi.fn();

const authoringState = {
  isCurrent: true,
  ownerKey: 'owner-a',
  generation: 'gen-1',
};

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

vi.mock('@/services/session/authoringSession', () => ({
  guardAuthoringSession: () => {
    const capturedOwner = authoringState.ownerKey;
    const capturedGeneration = authoringState.generation;
    return {
      session: { ownerKey: capturedOwner, generation: capturedGeneration },
      isCurrent: () =>
        authoringState.isCurrent &&
        authoringState.ownerKey === capturedOwner &&
        authoringState.generation === capturedGeneration,
      check: () => {
        if (
          !authoringState.isCurrent ||
          authoringState.ownerKey !== capturedOwner ||
          authoringState.generation !== capturedGeneration
        ) {
          throw new Error('La sesión cambió.');
        }
      },
    };
  },
  authoringSessionScope: (session?: { ownerKey: string | null; generation: string | null }) =>
    session?.ownerKey && session?.generation ? `${session.ownerKey}:${session.generation}` : '',
}));

vi.mock('@/features/wound-care/use-cases/woundCareUseCases', () => ({
  executeListActiveWoundCareMobileUploadSessions: (...args: unknown[]) =>
    listActiveSessionsUseCaseMock(...args),
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

const makeSession = (
  sessionId: string,
  episode = episodeA,
  uid = 'nurse-1'
): WoundCareMobileUploadSession => ({
  sessionId,
  hospitalId: 'hanga-roa',
  episodeKey: episode.episodeKey,
  patientRut: episode.patientRut,
  patientName: episode.patientName,
  createdBy: {
    uid,
    email: `${uid}@hospital.cl`,
    displayName: `Usuario ${uid}`,
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
    authoringState.isCurrent = true;
    authoringState.ownerKey = 'owner-a';
    authoringState.generation = 'gen-1';
    authState.currentUser = {
      uid: 'nurse-1',
      email: 'enfermeria@hospital.cl',
      displayName: 'Enfermería Prueba',
    };
    authState.role = 'nurse_hospital';
    listActiveSessionsUseCaseMock.mockResolvedValue({
      status: 'success',
      data: [],
      issues: [],
    });
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
    expect(screen.getByAltText('QR para subir fotos clínicas')).toBeInTheDocument();
    expect(screen.getByText(/wcu_session_1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revocar qr/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /revocar qr/i }));

    await waitFor(() => {
      expect(screen.getByText(/qr revocado/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/wcu_session_1/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revocar qr/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/generando qr/i)).not.toBeInTheDocument();
  });

  it('recovers an existing active QR when reopening the panel instead of issuing a second live link', async () => {
    const session1 = makeSession('wcu_original_active');
    listActiveSessionsUseCaseMock
      .mockResolvedValueOnce({ status: 'success', data: [], issues: [] })
      .mockResolvedValueOnce({ status: 'success', data: [session1], issues: [] });
    createSessionUseCaseMock.mockResolvedValueOnce({
      status: 'success',
      data: session1,
      issues: [],
    });
    revokeSessionUseCaseMock
      .mockResolvedValueOnce({
        status: 'failed',
        data: null,
        issues: [{ kind: 'unknown', message: 'Permiso denegado.' }],
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: null,
        issues: [],
      });

    const firstRender = render(<WoundCareMobileQrPanel episodeContext={episodeA} />);
    await screen.findByAltText('QR para subir fotos clínicas');
    fireEvent.click(screen.getByRole('button', { name: /revocar qr/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Permiso denegado.');
    });

    // Close/unmount the modal and reopen it on the same episode later.
    firstRender.unmount();

    render(<WoundCareMobileQrPanel episodeContext={episodeA} />);

    await screen.findByAltText('QR para subir fotos clínicas');
    expect(screen.getByText(/wcu_original_active/)).toBeInTheDocument();
    // Must NOT have emitted a second session.
    expect(createSessionUseCaseMock).toHaveBeenCalledTimes(1);

    // Retrying revocation revokes the original active session cleanly.
    fireEvent.click(screen.getByRole('button', { name: /revocar qr/i }));
    await waitFor(() => {
      expect(screen.getByText(/qr revocado/i)).toBeInTheDocument();
    });
    expect(revokeSessionUseCaseMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: 'wcu_original_active' })
    );
  });

  it('joins an in-flight QR creation when the panel closes and reopens before the write settles', async () => {
    const deferredCreate = createDeferred<{
      status: 'success';
      data: WoundCareMobileUploadSession;
      issues: [];
    }>();
    createSessionUseCaseMock.mockReturnValueOnce(deferredCreate.promise);

    const firstRender = render(<WoundCareMobileQrPanel episodeContext={episodeA} />);
    await waitFor(() => {
      expect(createSessionUseCaseMock).toHaveBeenCalledTimes(1);
    });

    firstRender.unmount();

    render(<WoundCareMobileQrPanel episodeContext={episodeA} />);
    // Must NOT fire a duplicate create while the first write is still pending.
    expect(createSessionUseCaseMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferredCreate.resolve({
        status: 'success',
        data: makeSession('wcu_inflight_joined'),
        issues: [],
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/wcu_inflight_joined/)).toBeInTheDocument();
    });
    expect(createSessionUseCaseMock).toHaveBeenCalledTimes(1);
  });

  it('aborts Regenerar without creating a replacement under the previous author when the active user switches during a delayed revoke', async () => {
    const sessionA = makeSession('wcu_user_a', episodeA, 'nurse-a');
    const sessionB = makeSession('wcu_user_b', episodeA, 'nurse-b');
    const deferredRevokeA = createDeferred<{ status: 'success'; data: null; issues: [] }>();

    authState.currentUser = {
      uid: 'nurse-a',
      email: 'a@hospital.cl',
      displayName: 'Enfermera A',
    };
    listActiveSessionsUseCaseMock
      .mockResolvedValueOnce({ status: 'success', data: [sessionA], issues: [] })
      .mockResolvedValueOnce({ status: 'success', data: [sessionA], issues: [] })
      .mockResolvedValueOnce({ status: 'success', data: [], issues: [] });
    revokeSessionUseCaseMock.mockReturnValueOnce(deferredRevokeA.promise);
    createSessionUseCaseMock.mockResolvedValueOnce({
      status: 'success',
      data: sessionB,
      issues: [],
    });

    const { rerender } = render(<WoundCareMobileQrPanel episodeContext={episodeA} />);
    await screen.findByText(/wcu_user_a/);

    // User A initiates Regenerar, pausing on the revoke call.
    fireEvent.click(screen.getByRole('button', { name: /regenerar/i }));
    await waitFor(() => {
      expect(revokeSessionUseCaseMock).toHaveBeenCalledTimes(1);
    });

    // Switch authenticated user to B while User A's revoke is still pending.
    authState.currentUser = {
      uid: 'nurse-b',
      email: 'b@hospital.cl',
      displayName: 'Enfermera B',
    };
    authoringState.ownerKey = 'owner-b';
    rerender(<WoundCareMobileQrPanel episodeContext={episodeA} />);

    // Release User A's delayed revoke: User A must NOT call create with nurse-a.
    await act(async () => {
      deferredRevokeA.resolve({ status: 'success', data: null, issues: [] });
    });

    await waitFor(() => {
      expect(screen.getByText(/wcu_user_b/)).toBeInTheDocument();
    });
    expect(createSessionUseCaseMock).toHaveBeenCalledTimes(1);
    expect(createSessionUseCaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ uid: 'nurse-b' }),
      })
    );
  });

  it('halts Regenerar silently before issuing a replacement when another tab replaces the authoring session', async () => {
    const sessionA = makeSession('wcu_tab_a', episodeA, 'nurse-1');
    const deferredRevoke = createDeferred<{ status: 'success'; data: null; issues: [] }>();

    listActiveSessionsUseCaseMock
      .mockResolvedValueOnce({ status: 'success', data: [sessionA], issues: [] })
      .mockResolvedValueOnce({ status: 'success', data: [sessionA], issues: [] });
    revokeSessionUseCaseMock.mockReturnValueOnce(deferredRevoke.promise);

    render(<WoundCareMobileQrPanel episodeContext={episodeA} />);
    await screen.findByText(/wcu_tab_a/);

    fireEvent.click(screen.getByRole('button', { name: /regenerar/i }));
    await waitFor(() => {
      expect(revokeSessionUseCaseMock).toHaveBeenCalledTimes(1);
    });

    // Another tab took over the browser session while this tab's revoke was in flight.
    authoringState.isCurrent = false;

    await act(async () => {
      deferredRevoke.resolve({ status: 'success', data: null, issues: [] });
    });

    expect(createSessionUseCaseMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('revokes the previous active session before issuing a replacement on Regenerar, and keeps the previous session if revoking fails', async () => {
    const session1 = makeSession('wcu_session_1');
    const session2 = makeSession('wcu_session_2');
    listActiveSessionsUseCaseMock
      .mockResolvedValueOnce({ status: 'success', data: [], issues: [] })
      .mockResolvedValueOnce({ status: 'success', data: [session1], issues: [] })
      .mockResolvedValueOnce({ status: 'success', data: [session1], issues: [] });
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

    fireEvent.click(screen.getByRole('button', { name: /regenerar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Error revocando sesión anterior.');
    });
    expect(createSessionUseCaseMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/wcu_session_1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revocar qr/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /regenerar/i }));

    await waitFor(() => {
      expect(screen.getByText(/wcu_session_2/)).toBeInTheDocument();
    });
    expect(revokeSessionUseCaseMock).toHaveBeenCalledTimes(2);
    expect(createSessionUseCaseMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('fails closed without creating a duplicate when active session verification fails, and recovers on Reintentar', async () => {
    const existingSession = makeSession('wcu_existing_server');
    listActiveSessionsUseCaseMock
      .mockResolvedValueOnce({
        status: 'failed',
        data: [],
        issues: [{ kind: 'unknown', message: 'Sin conexión para verificar QR.' }],
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: [existingSession],
        issues: [],
      });

    render(<WoundCareMobileQrPanel episodeContext={episodeA} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión para verificar QR.');
    });
    expect(createSessionUseCaseMock).not.toHaveBeenCalled();
    expect(screen.getByText(/qr no disponible/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    await waitFor(() => {
      expect(screen.getByText(/wcu_existing_server/)).toBeInTheDocument();
    });
    expect(createSessionUseCaseMock).not.toHaveBeenCalled();
  });

  it('clears the revoked previous session if creating the replacement fails on Regenerar', async () => {
    const session1 = makeSession('wcu_session_1');
    listActiveSessionsUseCaseMock
      .mockResolvedValueOnce({ status: 'success', data: [], issues: [] })
      .mockResolvedValueOnce({ status: 'success', data: [session1], issues: [] });
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
    expect(screen.getByRole('button', { name: /reintentar/i })).not.toBeDisabled();
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

    rerender(<WoundCareMobileQrPanel episodeContext={episodeB} />);

    await waitFor(() => {
      expect(createSessionUseCaseMock).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      deferredA.resolve({
        status: 'success',
        data: makeSession('wcu_episode_a', episodeA),
        issues: [],
      });
    });
    expect(screen.queryByText(/wcu_episode_a/)).not.toBeInTheDocument();

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
