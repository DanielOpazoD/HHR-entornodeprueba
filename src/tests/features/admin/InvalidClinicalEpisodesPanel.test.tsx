import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const service = vi.hoisted(() => ({
  listInvalidClinicalEpisodes: vi.fn(),
  removeInvalidClinicalEpisodeMark: vi.fn(),
}));
vi.mock('@/services/census/invalidClinicalEpisodeService', () => service);

import { InvalidClinicalEpisodesPanel } from '@/features/admin/components/InvalidClinicalEpisodesPanel';

const mark = {
  clinicalEpisodeId: '900200',
  censusDate: '2026-11-05',
  bedId: 'NEO1',
  markedAt: '2026-11-05T20:00:00.000Z',
  markedBy: 'user_nurse',
};

describe('InvalidClinicalEpisodesPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the marks and removes one, then reloads the list', async () => {
    service.listInvalidClinicalEpisodes.mockResolvedValueOnce([mark]).mockResolvedValueOnce([]);
    service.removeInvalidClinicalEpisodeMark.mockResolvedValue(undefined);
    render(<InvalidClinicalEpisodesPanel />);

    expect(await screen.findByText('900200')).toBeInTheDocument();
    expect(screen.getByText('NEO1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar marca' }));

    await waitFor(() =>
      expect(service.removeInvalidClinicalEpisodeMark).toHaveBeenCalledWith('900200')
    );
    expect(await screen.findByText('No hay pacientes marcados.')).toBeInTheDocument();
  });

  it('reports a failed read instead of an empty list', async () => {
    service.listInvalidClinicalEpisodes.mockRejectedValue(new Error('unavailable'));
    render(<InvalidClinicalEpisodesPanel />);

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo leer la lista.');
    expect(screen.queryByText('No hay pacientes marcados.')).toBeNull();
  });

  it('keeps the mark listed when it could not be removed', async () => {
    service.listInvalidClinicalEpisodes.mockResolvedValue([mark]);
    service.removeInvalidClinicalEpisodeMark.mockRejectedValue(new Error('offline'));
    render(<InvalidClinicalEpisodesPanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Quitar marca' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo quitar la marca.');
    expect(screen.getByText('900200')).toBeInTheDocument();
  });
});
