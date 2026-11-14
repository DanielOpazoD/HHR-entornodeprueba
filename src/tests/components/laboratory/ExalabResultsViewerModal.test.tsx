import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
vi.unmock('@/features/laboratory/components/ExalabResultsViewerModal');
vi.mock('@/components/shared/BaseModal', () => ({
  BaseModal: ({ children, headerActions }: { children: ReactNode; headerActions: ReactNode }) => (
    <div>
      {headerActions}
      {children}
    </div>
  ),
}));
vi.mock('@/services/laboratory/exalabService', () => ({
  exalabStatus: vi.fn(),
  autoConnectExalab: vi.fn(),
  connectExalab: vi.fn(),
  disconnectExalab: vi.fn(),
  searchExalab: vi.fn(),
  fetchExalabPdf: vi.fn(),
  ExalabRequestError: class extends Error {
    constructor(
      message: string,
      public code?: string
    ) {
      super(message);
    }
  },
}));
import { ExalabResultsViewerModal } from '@/features/laboratory/components/ExalabResultsViewerModal';
import {
  autoConnectExalab,
  exalabStatus,
  searchExalab,
  fetchExalabPdf,
  ExalabRequestError,
} from '@/services/laboratory/exalabService';
const exam = {
  id: '123',
  rut: '12345678-5',
  date: '2026-11-08',
  time: '12:34:56',
  patientName: 'PACIENTE SINTETICO',
  laboratory: 'CENTRO SINTETICO',
  exams: 'GLUCOSA',
  link: 'hhr-exalab://report/synthetic',
};
const revoke = vi.fn();
const create = vi.fn(() => 'blob:synthetic-exalab');
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exalabStatus).mockResolvedValue({ connected: true, expiresAt: null });
  vi.mocked(autoConnectExalab).mockResolvedValue('unavailable');
  vi.mocked(searchExalab).mockResolvedValue([exam]);
  vi.mocked(fetchExalabPdf).mockResolvedValue(
    new Blob(['%PDF-1.4\n%%EOF'], { type: 'application/pdf' })
  );
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = create;
      static override revokeObjectURL = revoke;
    }
  );
});
afterEach(() => vi.unstubAllGlobals());
const mount = () =>
  render(
    <ExalabResultsViewerModal
      onClose={vi.fn()}
      sourceSelector={<span>Fuentes</span>}
      patients={[
        {
          bedId: 'R1',
          label: 'R1 · PACIENTE SINTETICO',
          patientName: 'PACIENTE SINTETICO',
          rut: '12.345.678-5',
        },
      ]}
    />
  );
const search = async () => {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Buscar en Exalab' })).toBeEnabled()
  );
  await userEvent.click(screen.getByRole('button', { name: 'Buscar en Exalab' }));
};
describe('Exalab original reports', () => {
  it('searches with a complete RUT, shows the source centre and opens the original PDF inside HHR', async () => {
    const view = mount();
    await search();
    expect(await screen.findByText('CENTRO SINTETICO')).toBeInTheDocument();
    expect(searchExalab).toHaveBeenCalledWith(
      '12345678-5',
      expect.any(String),
      expect.any(String),
      expect.any(AbortSignal)
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ver PDF' }));
    expect(await screen.findByTitle('PDF Exalab folio 123')).toHaveAttribute(
      'src',
      'blob:synthetic-exalab'
    );
    expect(screen.getByRole('link', { name: 'Descargar PDF original' })).toHaveAttribute(
      'download',
      'Exalab_123.pdf'
    );
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-exalab');
  });
  it('preserves known reports when a refresh fails and distinguishes session expiry from no exams', async () => {
    mount();
    await search();
    await screen.findByText('CENTRO SINTETICO');
    vi.mocked(searchExalab).mockRejectedValueOnce(
      new ExalabRequestError('Renueva tu sesión Exalab.', 'SESSION_REQUIRED')
    );
    await search();
    expect(await screen.findByRole('alert')).toHaveTextContent('Renueva tu sesión');
    expect(screen.getByText('CENTRO SINTETICO')).toBeInTheDocument();
    expect(
      screen.queryByText('Exalab no informó exámenes en este período.')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar en Exalab' })).toBeDisabled();
  });
  it('discards a late response after changing the patient and releases its request', async () => {
    let finish: (value: (typeof exam)[]) => void = () => undefined;
    vi.mocked(searchExalab).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    mount();
    await search();
    const signal = vi.mocked(searchExalab).mock.calls[0][3];
    await userEvent.clear(screen.getByLabelText('RUT del paciente'));
    expect(signal.aborted).toBe(true);
    await act(async () => finish([exam]));
    expect(screen.queryByText('CENTRO SINTETICO')).not.toBeInTheDocument();
  });
});
const sessionRequired = () =>
  new ExalabRequestError('Renueva tu sesión Exalab.', 'SESSION_REQUIRED');
describe('Exalab automatic connection', () => {
  it('connects silently on open when this PC authorized it and shows until when it stays valid', async () => {
    vi.mocked(exalabStatus)
      .mockRejectedValueOnce(sessionRequired())
      .mockResolvedValueOnce({ connected: true, expiresAt: Date.UTC(2026, 10, 9, 23, 30) });
    vi.mocked(autoConnectExalab).mockResolvedValueOnce('connected');
    mount();
    expect(
      await screen.findByText('Tu sesión Exalab está conectada · vigente hasta las 18:30.')
    ).toBeInTheDocument();
    expect(autoConnectExalab).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Buscar en Exalab' })).toBeEnabled();
  });
  it('asks to log in to Exalab and reconnects by itself when the extension announces a new session', async () => {
    vi.mocked(exalabStatus).mockRejectedValueOnce(sessionRequired());
    vi.mocked(autoConnectExalab).mockResolvedValueOnce('no_session');
    mount();
    expect(
      await screen.findByText('Abre Exalab e ingresa con ClaveÚnica. HHR se conectará solo.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir Exalab' })).toHaveAttribute(
      'href',
      'https://exalab.saludoriente.cl/web_ssmo/index.php'
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    vi.mocked(autoConnectExalab).mockResolvedValueOnce('connected');
    vi.mocked(exalabStatus).mockResolvedValueOnce({ connected: true, expiresAt: null });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          origin: window.location.origin,
          data: { type: 'HHR_EXALAB_SESSION_AVAILABLE' },
        })
      );
    });
    expect(await screen.findByText('Tu sesión Exalab está conectada.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Abrir Exalab' })).not.toBeInTheDocument();
  });
  it('reconnects once and repeats the search once when the bridge lost the session', async () => {
    mount();
    vi.mocked(searchExalab).mockRejectedValueOnce(sessionRequired());
    vi.mocked(autoConnectExalab).mockResolvedValueOnce('connected');
    await search();
    expect(await screen.findByText('CENTRO SINTETICO')).toBeInTheDocument();
    expect(searchExalab).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('never loops: a second expiry after reconnecting is reported once', async () => {
    mount();
    vi.mocked(searchExalab)
      .mockRejectedValueOnce(sessionRequired())
      .mockRejectedValueOnce(sessionRequired());
    vi.mocked(autoConnectExalab).mockResolvedValueOnce('connected');
    await search();
    expect(await screen.findByRole('alert')).toHaveTextContent('Renueva tu sesión');
    expect(searchExalab).toHaveBeenCalledTimes(2);
    expect(autoConnectExalab).toHaveBeenCalledTimes(1);
  });
});
