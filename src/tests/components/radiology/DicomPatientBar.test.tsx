import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DicomPatientBar } from '@/components/radiology/DicomPatientBar';
vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: async () => ({}),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('viewer patient header and explicit report download', () => {
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
  it('downloads only a PDF after a click with a generic filename and revokes its URL on close', async () => {
    const create = vi.fn(() => 'blob:synthetic-report'),
      revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
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
    fireEvent.click(screen.getByRole('button', { name: 'Descargar informe MMRAD' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('informe-mmrad.pdf');
    expect(anchor.href).toBe('blob:synthetic-report');
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
    fireEvent.click(screen.getByRole('button', { name: 'Descargar informe MMRAD' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[0][1].cache).toBe('no-store');
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
