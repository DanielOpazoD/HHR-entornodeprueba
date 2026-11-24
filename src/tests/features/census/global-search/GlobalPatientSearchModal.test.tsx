import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalPatientSearchModal } from '@/features/census/components/global-search/GlobalPatientSearchModal';
import type { ClinicalDocSummary } from '@/features/census/components/global-search/globalSearchContracts';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  clearSelection: vi.fn(),
  selectPatient: vi.fn(),
  setQuery: vi.fn(),
  setSelectedIndex: vi.fn(),
  reset: vi.fn(),
}));

const sampleDoc: ClinicalDocSummary = {
  id: 'doc-1',
  episodeKey: '11.111.111-1__2026-10-20',
  documentType: 'epicrisis',
  status: 'draft',
  createdAt: '2026-10-25T12:00:00Z',
  updatedAt: '2026-10-25T12:00:00Z',
  createdBy: 'AUTOR SINTETICO',
};

const sampleSelectedPatient = {
  master: {
    rut: '11.111.111-1',
    fullName: 'PACIENTE SINTETICO',
    createdAt: 1,
    updatedAt: 1,
  },
  history: null,
  isLoadingHistory: false,
  historyWarning: null,
  historyRecordsRead: 0,
  timelineState: { groupedEpisodes: [], episodeCount: 0, hasEpisodes: false },
};

vi.mock('@/features/census/components/global-search/useGlobalPatientSearch', () => ({
  useGlobalPatientSearch: () => mocks.search(),
}));

vi.mock('@/features/census/components/global-search/PatientEpisodeTimeline', () => ({
  PatientEpisodeTimeline: ({
    onOpenClinicalDocument,
  }: {
    onOpenClinicalDocument: (doc: ClinicalDocSummary) => void;
  }) => (
    <div>
      <span>Detalle del paciente</span>
      <button type="button" onClick={() => onOpenClinicalDocument(sampleDoc)}>
        Abrir documento
      </button>
    </div>
  ),
}));

vi.mock('@/features/clinical-documents', () => ({
  ClinicalDocumentsModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
    // Mirror BaseModal's document-level Escape listener to verify sibling modal coordination.
    useEffect(() => {
      if (!isOpen) return undefined;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') onClose();
      };
      document.addEventListener('keydown', onKeyDown);
      return () => document.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;
    return <div data-testid="clinical-documents-viewer">Visor de documentos</div>;
  },
}));

const buildSearchState = (overrides: Record<string, unknown> = {}) => ({
  query: '',
  results: [],
  selectedIndex: 0,
  isSearching: false,
  hasSearched: false,
  searchError: null,
  selectedPatient: null,
  episodeDocuments: {},
  setQuery: mocks.setQuery,
  setSelectedIndex: mocks.setSelectedIndex,
  selectPatient: mocks.selectPatient,
  clearSelection: mocks.clearSelection,
  loadEpisodeDocuments: vi.fn(),
  downloadDocumentPdf: vi.fn(),
  retrySearch: vi.fn(),
  reset: mocks.reset,
  ...overrides,
});

describe('GlobalPatientSearchModal keyboard and backdrop dismissal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search.mockReturnValue(buildSearchState());
  });

  afterEach(cleanup);

  it('steps back from selected patient then closes on Escape even when focus is on document.body', () => {
    const onClose = vi.fn();
    mocks.search.mockReturnValue(buildSearchState({ selectedPatient: sampleSelectedPatient }));

    const view = render(<GlobalPatientSearchModal isOpen onClose={onClose} />);

    // Clicking non-focusable text leaves focus on document.body.
    fireEvent.click(screen.getByText('Detalle del paciente'));
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(mocks.clearSelection).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    // Next render shows the list; a second Escape closes the modal once.
    mocks.search.mockReturnValue(buildSearchState({ selectedPatient: null }));
    view.rerender(<GlobalPatientSearchModal isOpen onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('handles Escape only once when focus is inside the search input', () => {
    const onClose = vi.fn();
    mocks.search.mockReturnValue(buildSearchState({ selectedPatient: sampleSelectedPatient }));

    render(<GlobalPatientSearchModal isOpen onClose={onClose} />);
    const input = screen.getByPlaceholderText('Buscar por nombre, apellido o RUT…');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(mocks.clearSelection).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets Escape close only the nested ClinicalDocumentsModal without clearing the search selection', async () => {
    const onClose = vi.fn();
    mocks.search.mockReturnValue(buildSearchState({ selectedPatient: sampleSelectedPatient }));

    render(<GlobalPatientSearchModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir documento' }));
    expect(await screen.findByTestId('clinical-documents-viewer')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('clinical-documents-viewer')).not.toBeInTheDocument();
    });
    expect(mocks.clearSelection).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // Once the nested viewer is closed, Escape steps back to the search list.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(mocks.clearSelection).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when clicking the backdrop, ignores clicks inside the panel, and ignores Escape when closed', () => {
    const onClose = vi.fn();
    const view = render(<GlobalPatientSearchModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByPlaceholderText('Buscar por nombre, apellido o RUT…'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('global-search-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    view.rerender(<GlobalPatientSearchModal isOpen={false} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
