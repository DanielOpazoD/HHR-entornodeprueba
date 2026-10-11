import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenSyncSessionReportButton } from '@/features/rayen-import/components/RayenSyncSessionReportButton';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';
vi.mock('@/shared/runtime/browserClipboardRuntime', () => ({ writeClipboardText: vi.fn() }));

describe('sync performance summary copy', () => {
  beforeEach(() => vi.mocked(writeClipboardText).mockReset());
  it('copies an aggregate report through the existing clipboard boundary', async () => {
    vi.mocked(writeClipboardText).mockResolvedValue();
    render(<RayenSyncSessionReportButton history={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar resumen de rendimiento' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Resumen copiado'));
    expect(JSON.parse(vi.mocked(writeClipboardText).mock.calls[0][0])).toMatchObject({
      format: 'hhr.sync-performance-summary.v1',
      groups: [],
    });
  });
  it('keeps copy failures recoverable without claiming success', async () => {
    vi.mocked(writeClipboardText)
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce();
    render(<RayenSyncSessionReportButton history={[]} />);
    const button = screen.getByRole('button', { name: 'Copiar resumen de rendimiento' });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No se pudo copiar'));
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Resumen copiado'));
  });
});
