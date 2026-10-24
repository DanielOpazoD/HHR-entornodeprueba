import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DocRow } from '@/features/census/components/global-search/DocRow';
import { GlobalPatientSearchModal } from '@/features/census/components/global-search/GlobalPatientSearchModal';
import type { ClinicalDocSummary } from '@/features/census/components/global-search/globalSearchContracts';

const { doc } = vi.hoisted(() => ({
  doc: {
    id: 'synthetic-clock',
    episodeKey: 'synthetic-unknown-episode',
    documentType: 'epicrisis',
    status: 'draft',
    createdAt: '2026-10-25T02:30:00Z',
    updatedAt: '2026-10-25T02:30:00Z',
    createdBy: 'AUTOR SINTETICO',
  } satisfies ClinicalDocSummary,
}));

vi.mock('@/features/census/components/global-search/useGlobalPatientSearch', () => ({
  useGlobalPatientSearch: () => ({
    query: '',
    results: [],
    isSearching: false,
    hasSearched: false,
    selectedPatient: {
      master: { fullName: 'PACIENTE SINTETICO', rut: '000000000' },
      history: null,
      timelineState: { groupedEpisodes: [], episodeCount: 0, hasEpisodes: false },
    },
    reset: vi.fn(),
    setQuery: vi.fn(),
  }),
}));
vi.mock('@/features/census/components/global-search/PatientEpisodeTimeline', () => ({
  PatientEpisodeTimeline: ({
    onOpenClinicalDocument,
  }: {
    onOpenClinicalDocument: (document: ClinicalDocSummary) => void;
  }) => <button onClick={() => onOpenClinicalDocument(doc)}>Abrir documento sintético</button>,
}));
vi.mock('@/features/clinical-documents', () => ({
  ClinicalDocumentsModal: ({ currentDateString }: { currentDateString: string }) => (
    <div>Fecha del visor: {currentDateString}</div>
  ),
}));

afterEach(cleanup);

describe('global search document hospital dates', () => {
  it('shows an evening document on the hospital update day', () => {
    render(<DocRow doc={doc} onDownloadPdf={vi.fn()} />);
    expect(screen.getByText(/24-10-2026/)).toBeInTheDocument();
  });
  it('opens an undated episode using the hospital update day', async () => {
    render(<GlobalPatientSearchModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir documento sintético' }));
    expect(await screen.findByText('Fecha del visor: 2026-10-24')).toBeInTheDocument();
  });
});
