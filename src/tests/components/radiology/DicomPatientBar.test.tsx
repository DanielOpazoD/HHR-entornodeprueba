import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DicomPatientBar } from '@/components/radiology/DicomPatientBar';
vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: async () => ({}),
}));
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('viewer patient header and embedded report preview', () => {
  it('shows context without fetching a report automatically and hides an unavailable report', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(
      <DicomPatientBar patientId="SYNTHETIC" patientName="Synthetic patient" date="20261016" />
    );
    expect(screen.getByText('Synthetic patient')).toBeVisible();
    expect(screen.getByText('16/10/2026')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('previews the PDF without downloading and releases it when the report closes', async () => {
    const create = vi.fn(() => 'blob:synthetic-report'),
      revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static override createObjectURL = create;
        static override revokeObjectURL = revoke;
      }
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('%PDF-1.4 synthetic', { headers: { 'Content-Type': 'application/pdf' } })
        )
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const view = render(
      <DicomPatientBar patientId="SYNTHETIC" reportLink="https://example.test/report" />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver informe MMRAD' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Informe MMRAD' })).toBeVisible()
    );
    expect(screen.getByTitle('PDF del informe MMRAD')).toHaveAttribute(
      'src',
      'blob:synthetic-report'
    );
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Descargar PDF' })).toHaveAttribute(
      'download',
      'informe-mmrad.pdf'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar informe' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-report');
  });
  it('aborts an in-flight download when the viewer closes', async () => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    vi.stubGlobal('fetch', fetch);
    const view = render(
      <DicomPatientBar patientId="SYNTHETIC" reportLink="https://example.test/report" />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver informe MMRAD' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[0][1].cache).toBe('no-store');
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
