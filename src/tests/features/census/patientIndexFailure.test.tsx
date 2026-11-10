import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalPatientSearchModal } from '@/features/census/components/global-search/GlobalPatientSearchModal';
import { PatientDatabaseManager } from '@/features/admin/components/internal/PatientDatabaseManager';

const { getDocs, startAfter } = vi.hoisted(() => ({ getDocs: vi.fn(), startAfter: vi.fn() }));
vi.mock('@/services/repositories/repositoryFirestoreRuntime', () => ({
  defaultRepositoryFirestoreRuntime: { getDb: () => ({}) },
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(async () => ({ exists: () => false })),
  collection: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  startAfter,
  where: vi.fn(),
  getDocs,
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  writeBatch: vi.fn(),
  arrayUnion: vi.fn(),
}));
vi.mock('@/features/census/components/global-search/usePatientSelection', () => ({
  usePatientSelection: () => ({
    selectedPatient: null,
    episodeDocuments: {},
    resetSelection: vi.fn(),
  }),
}));
vi.mock('@/hooks/usePatientAnalysis', () => ({ usePatientAnalysis: () => ({}) }));
vi.mock('@/features/admin/components/internal/SyncPanel', () => ({ SyncPanel: () => null }));
vi.mock('@/features/admin/components/internal/ConflictPanel', () => ({
  ConflictPanel: () => null,
}));
vi.mock('@/features/admin/components/internal/PatientDetailModal', () => ({
  PatientDetailModal: () => null,
}));

const patient = { rut: '11.111.111-1', fullName: 'ALFA SINTETICA', createdAt: 1, updatedAt: 1 };
const page = { docs: [{ data: () => patient }] };
const failureMessage = 'No se pudo consultar el índice de pacientes.';
const failure = new Error('synthetic unavailable');

beforeEach(() => {
  getDocs.mockReset();
  startAfter.mockClear();
});
afterEach(cleanup);

describe('patient index reads at the SDK boundary', () => {
  it('global search shows a failure instead of absence and retries', async () => {
    getDocs.mockRejectedValue(failure);
    render(<GlobalPatientSearchModal isOpen onClose={() => undefined} />);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, apellido o RUT…'), {
      target: { value: 'alfa' },
    });
    await screen.findByText(failureMessage);
    expect(screen.queryByText(/No se encontraron pacientes/)).not.toBeInTheDocument();
    getDocs.mockResolvedValue(page);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByText(
      (_, element) => element?.textContent === patient.fullName && element.children.length <= 1
    );
    expect(screen.queryByText(failureMessage)).not.toBeInTheDocument();
  });

  it('global search retains the displayed patients when the next query fails', async () => {
    getDocs.mockResolvedValue(page);
    render(<GlobalPatientSearchModal isOpen onClose={() => undefined} />);
    const input = screen.getByPlaceholderText('Buscar por nombre, apellido o RUT…');
    fireEvent.change(input, { target: { value: 'alfa' } });
    await screen.findByText(
      (_, element) => element?.textContent === patient.fullName && element.children.length <= 1
    );
    getDocs.mockRejectedValue(failure);
    fireEvent.change(input, { target: { value: 'beta' } });
    await screen.findByText(failureMessage);
    expect(screen.getByText(patient.fullName)).toBeInTheDocument();
  });

  it('global search keeps the confirmed no-matches text', async () => {
    getDocs.mockResolvedValue({ docs: [] });
    render(<GlobalPatientSearchModal isOpen onClose={() => undefined} />);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, apellido o RUT…'), {
      target: { value: 'alfa' },
    });
    await screen.findByText(/No se encontraron pacientes/);
    expect(screen.queryByText(failureMessage)).not.toBeInTheDocument();
  });

  it('explorer shows an initial failure instead of suggesting synchronization and retries', async () => {
    getDocs.mockRejectedValue(failure);
    render(<PatientDatabaseManager />);
    await screen.findByText(failureMessage);
    expect(screen.queryByText(/No hay pacientes sincronizados/)).not.toBeInTheDocument();
    getDocs.mockResolvedValue(page);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByText(
      (_, element) => element?.textContent === patient.fullName && element.children.length <= 1
    );
  });

  it('explorer preserves patients and pagination cursor on a failed next page', async () => {
    getDocs.mockResolvedValueOnce(page).mockRejectedValue(failure);
    render(<PatientDatabaseManager />);
    await screen.findByText(
      (_, element) => element?.textContent === patient.fullName && element.children.length <= 1
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más registros' }));
    await screen.findByText(failureMessage);
    expect(screen.getByText(patient.fullName)).toBeInTheDocument();
    getDocs.mockResolvedValue({ docs: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.queryByText(failureMessage)).not.toBeInTheDocument());
    expect(screen.getByText(patient.fullName)).toBeInTheDocument();
    expect(startAfter).toHaveBeenNthCalledWith(1, page.docs[0]);
    expect(startAfter).toHaveBeenNthCalledWith(2, page.docs[0]);
  });

  it('explorer preserves displayed patients on a failed search and retries the query', async () => {
    getDocs.mockResolvedValueOnce(page).mockRejectedValue(failure);
    render(<PatientDatabaseManager />);
    await screen.findByText(
      (_, element) => element?.textContent === patient.fullName && element.children.length <= 1
    );
    fireEvent.change(screen.getByPlaceholderText('Buscar por Nombre o RUT...'), {
      target: { value: 'beta' },
    });
    await screen.findByText(failureMessage);
    expect(screen.getByText(patient.fullName)).toBeInTheDocument();
    getDocs.mockResolvedValue({ docs: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByText(/No hay pacientes sincronizados/);
  });

  it('explorer keeps its confirmed empty text', async () => {
    getDocs.mockResolvedValue({ docs: [] });
    render(<PatientDatabaseManager />);
    await screen.findByText(/No hay pacientes sincronizados/);
    expect(screen.queryByText(failureMessage)).not.toBeInTheDocument();
  });
});
