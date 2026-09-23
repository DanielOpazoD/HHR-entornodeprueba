import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) => name !== 'SPECIALTY_RULES_MEMORY',
}));
vi.mock('@/services/specialty/specialtyJevClient', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/specialty/specialtyJevClient')>()),
  requestSpecialtySuggestion: request,
  acceptSpecialtySuggestion: vi.fn(),
  publishSpecialtyMemory: vi.fn(),
}));

import { SpecialtyChip } from '@/features/census/components/patient-row/SpecialtyChip';
import { JevSuggestionPendingError, JevSuggestionUnavailableError,
  shouldRetainJevRequestId } from '@/services/specialty/specialtyJevClient';

describe('SpecialtyChip Jev request identity', () => {
  afterEach(() => {
    request.mockReset();
    vi.unstubAllGlobals();
  });

  it('reuses a request after an ambiguous network failure', async () => {
    const randomUUID = vi.fn().mockReturnValue('synthetic-request-001');
    vi.stubGlobal('crypto', { randomUUID });
    request.mockRejectedValueOnce(new Error('network interrupted')).mockResolvedValueOnce({
      model: 'jev-1.13.0', promptVersion: '1', choice: 'internal_medicine',
      specialty: 'Med Interna', confidence: 0.8,
    });
    render(<SpecialtyChip specialty="" onAssign={vi.fn()} cie10Code="J18.9"
      scope={{ date: '2026-09-23', bedId: 'R1', target: 'bed', episodeId: 'synthetic-episode' }} />);
    fireEvent.click(screen.getByTitle('Asignar especialidad'));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    await screen.findByText('Med Interna');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]).toBe(request.mock.calls[1][1]);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nueva consulta Jev' })).toBeEnabled());
  });

  it('retains only uncertain failures and replaces an ID after definitive rejection', async () => {
    expect(shouldRetainJevRequestId(new JevSuggestionPendingError('pending'))).toBe(true);
    expect(shouldRetainJevRequestId({ code: 'functions/unavailable' })).toBe(true);
    expect(shouldRetainJevRequestId({ code: 'functions/aborted' })).toBe(false);
    expect(shouldRetainJevRequestId(new JevSuggestionUnavailableError('failed'))).toBe(false);

    const randomUUID = vi.fn()
      .mockReturnValueOnce('synthetic-request-001')
      .mockReturnValueOnce('synthetic-request-002');
    vi.stubGlobal('crypto', { randomUUID });
    request.mockRejectedValueOnce(Object.assign(new Error('stale evidence'),
      { code: 'functions/aborted' })).mockResolvedValueOnce({
      model: 'jev-1.13.0', promptVersion: '1', choice: 'internal_medicine',
      specialty: 'Med Interna', confidence: 0.8,
    });
    render(<SpecialtyChip specialty="" onAssign={vi.fn()} cie10Code="J18.9"
      scope={{ date: '2026-09-23', bedId: 'R1', target: 'bed', episodeId: 'synthetic-episode' }} />);
    fireEvent.click(screen.getByTitle('Asignar especialidad'));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    await screen.findByText('Med Interna');
    expect(request.mock.calls.map(call => call[1])).toEqual([
      'synthetic-request-001', 'synthetic-request-002',
    ]);
  });

  it('drops a pending request when the diagnosis code changes', async () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce('synthetic-request-001')
      .mockReturnValueOnce('synthetic-request-002');
    vi.stubGlobal('crypto', { randomUUID });
    request.mockRejectedValueOnce(new Error('network interrupted')).mockResolvedValueOnce({
      model: 'jev-1.13.0', promptVersion: '1', choice: 'internal_medicine',
      specialty: 'Med Interna', confidence: 0.8,
    });
    const scope = { date: '2026-09-23', bedId: 'R1', target: 'bed' as const,
      episodeId: 'synthetic-episode' };
    const view = render(<SpecialtyChip specialty="" onAssign={vi.fn()}
      cie10Code="J18.9" scope={scope} />);
    fireEvent.click(screen.getByTitle('Asignar especialidad'));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    await screen.findByRole('alert');
    view.rerender(<SpecialtyChip specialty="" onAssign={vi.fn()}
      cie10Code="J18.1" scope={scope} />);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    await screen.findByText('Med Interna');
    expect(request.mock.calls.map(call => call[1])).toEqual([
      'synthetic-request-001', 'synthetic-request-002',
    ]);
  });
});
