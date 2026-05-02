import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EpisodeBlockCard } from '@/features/census/components/global-search/EpisodeBlockCard';
import type { GroupedEpisode } from '@/features/census/components/global-search/globalSearchContracts';

const closedEpisode: GroupedEpisode = {
  id: 'episode-1',
  admission: {
    id: 'ing-1',
    type: 'Ingreso',
    date: '2026-04-12',
    diagnosis: 'S/D',
    bedName: 'H2C2',
  },
  discharge: {
    id: 'eg-1',
    type: 'Egreso',
    date: '2026-04-24',
    diagnosis: 'S/D',
    bedName: 'H2C2',
  },
  diagnosis: 'S/D',
  bedName: 'H2C2',
  daysOfStay: 12,
};

describe('EpisodeBlockCard', () => {
  it('keeps placeholder-only episodes compact without rendering S/D noise', () => {
    render(
      <EpisodeBlockCard
        episode={closedEpisode}
        rut="18.781.542-8"
        episodeDocuments={{}}
        onLoadDocuments={vi.fn()}
        onDownloadPdf={vi.fn()}
        onNavigateToDate={vi.fn()}
      />
    );

    expect(screen.getByText('12-04-2026')).toBeInTheDocument();
    expect(screen.getByText('24-04-2026')).toBeInTheDocument();
    expect(screen.getByText('H2C2')).toBeInTheDocument();
    expect(screen.queryByText('S/D')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Documentos clinicos/i })).toBeInTheDocument();
  });
});
