import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClinicalAntecedentDau } from '@/features/census/components/patient-row/ClinicalAntecedentDau';
import { decodeClinicalDauAuth } from '@/features/rayen-import/bridge/clinicalDauAuth';

const flowId = '00000000-0000-4000-8000-000000000001';
const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
const auth = { flowId, url: `${extensionOrigin}/urgency-login.html?flow=${flowId}` };
const getFrame = () => {
  const frame = screen.getByTitle('Acceso seguro a Rayen Urgencias');
  if (!(frame instanceof HTMLIFrameElement)) throw new Error('Missing synthetic iframe');
  return frame;
};
const complete = (frame: HTMLIFrameElement, overrides = {}) =>
  window.dispatchEvent(
    new MessageEvent('message', {
      source: frame.contentWindow,
      origin: extensionOrigin,
      data: { type: 'HHR_URGENCY_LOGIN_STATE', flowId, state: 'authenticated' },
      ...overrides,
    })
  );

describe('DAU login remains beside the selected care', () => {
  it('embeds only the extension page and never renders a password input in HHR', async () => {
    const request = vi.fn(async () => ({ auth }));
    render(<ClinicalAntecedentDau request={request} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Descargar DAU oficial (PDF)' }));
    });
    await screen.findByTitle('Acceso seguro a Rayen Urgencias');
    expect(getFrame()).toHaveAttribute('src', auth.url);
    expect(getFrame()).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar DAU oficial (PDF)' })).toBeDisabled();
  });

  it('retries the original selected download only after authenticated completion', async () => {
    const request = vi.fn().mockResolvedValueOnce({ auth }).mockResolvedValueOnce({ opened: true });
    render(<ClinicalAntecedentDau request={request} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Descargar DAU oficial (PDF)' }));
    });
    await screen.findByTitle('Acceso seguro a Rayen Urgencias');
    act(() => {
      complete(getFrame());
    });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(screen.queryByTitle('Acceso seguro a Rayen Urgencias')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Descargar DAU oficial (PDF)' })).not.toBeDisabled()
    );
  });

  it('ignores a completion from the host page, another origin or another flow', async () => {
    const request = vi.fn(async () => ({ auth }));
    render(<ClinicalAntecedentDau request={request} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Descargar DAU oficial (PDF)' }));
    });
    await screen.findByTitle('Acceso seguro a Rayen Urgencias');
    act(() => {
      complete(getFrame(), { source: window });
      complete(getFrame(), { origin: 'https://untrusted.example' });
      complete(getFrame(), {
        data: { type: 'HHR_URGENCY_LOGIN_STATE', flowId: 'another-flow', state: 'authenticated' },
      });
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(getFrame()).toBeInTheDocument();
  });

  it('does not resume a cancelled login or a login belonging to an unmounted episode', async () => {
    const request = vi.fn(async () => ({ auth }));
    const view = render(<ClinicalAntecedentDau key="episode-1" request={request} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Descargar DAU oficial (PDF)' }));
    });
    await screen.findByTitle('Acceso seguro a Rayen Urgencias');
    const previous = getFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar acceso' }));
    view.rerender(<ClinicalAntecedentDau key="episode-2" request={request} />);
    act(() => {
      complete(previous);
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.queryByTitle('Acceso seguro a Rayen Urgencias')).not.toBeInTheDocument();
  });

  it('offers another native profile while preserving the definitive identity error after cancellation', async () => {
    const request = vi.fn(async () => ({
      error: 'La atención corresponde a otro establecimiento.',
      auth: { ...auth, reason: 'profile' as const },
    }));
    render(<ClinicalAntecedentDau request={request} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Descargar DAU oficial (PDF)' }));
    });
    await screen.findByRole('alert');
    expect(screen.queryByTitle('Acceso seguro a Rayen Urgencias')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión con otro perfil' }));
    await screen.findByTitle('Acceso seguro a Rayen Urgencias');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar acceso' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'La atención corresponde a otro establecimiento.'
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('credential frame boundary', () => {
  it('accepts the packaged login page and the exact single flow parameter', () => {
    expect(decodeClinicalDauAuth(auth)).toEqual(auth);
  });
  it.each([
    'https://untrusted.example/urgency-login.html',
    `${extensionOrigin}/another-page.html?flow=${flowId}`,
    `${extensionOrigin}/urgency-login.html?flow=${flowId}&extra=1`,
    `${extensionOrigin}/urgency-login.html?flow=another-flow`,
    `${extensionOrigin}/urgency-login.html?flow=${flowId}#fragment`,
  ])('rejects an untrusted or malformed login URL', url => {
    expect(decodeClinicalDauAuth({ flowId, url })).toBeUndefined();
  });
});
