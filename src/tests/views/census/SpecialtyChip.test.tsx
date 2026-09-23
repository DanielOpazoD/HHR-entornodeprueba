import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) => name !== 'SPECIALTY_RULES_MEMORY',
}));
vi.mock('@/services/specialty/specialtyJevClient', () => ({
  JevSuggestionUnavailableError: class extends Error {},
  requestSpecialtySuggestion: request,
  acceptSpecialtySuggestion: vi.fn(),
  publishSpecialtyMemory: vi.fn(),
}));

import { SpecialtyChip } from '@/features/census/components/patient-row/SpecialtyChip';

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
});
