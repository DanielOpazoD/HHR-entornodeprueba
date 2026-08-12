import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReleaseEvidenceStatusPanel } from '@/features/admin/components/ReleaseEvidenceStatusPanel';

describe('ReleaseEvidenceStatusPanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the SHA, generation time and current report count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          contractVersion: 1,
          generatedAt: '2026-08-11T12:30:00.000Z',
          gitSha: '1234567890abcdef',
          status: 'current',
          summary: { decisionReports: 10, currentReports: 10, staleReports: 0 },
        }),
      })
    );

    render(<ReleaseEvidenceStatusPanel />);

    expect(await screen.findByText('Vigente')).toBeInTheDocument();
    expect(screen.getByText('1234567890ab')).toBeInTheDocument();
    expect(screen.getByText('10/10')).toBeInTheDocument();
    expect(screen.getByText(/11-08-2026/i)).toBeInTheDocument();
  });

  it('fails closed when the runtime contract cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    render(<ReleaseEvidenceStatusPanel />);

    expect(await screen.findByText('No generada')).toBeInTheDocument();
    expect(screen.getByText(/no incluye un contrato/i)).toBeInTheDocument();
  });

  it('fails closed when the runtime payload is structurally incomplete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'current' }) })
    );

    render(<ReleaseEvidenceStatusPanel />);

    expect(await screen.findByText('No generada')).toBeInTheDocument();
    expect(screen.getByText('No disponible')).toBeInTheDocument();
  });
});
