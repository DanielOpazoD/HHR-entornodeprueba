import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClinicalPanel } from '@/features/rayen-import/clinical-panel';
import { ClinicalExplorerNotes } from '@/features/census/components/clinical-explorer/ClinicalExplorerNotes';
const mocks = vi.hoisted(() => ({ panel: null as unknown, reload: vi.fn() }));
vi.mock('@/features/census/components/patient-row/useClinicalPanelSnapshot', () => ({
  useClinicalPanelSnapshot: () => ({
    state: { phase: 'ready', panel: mocks.panel },
    reload: mocks.reload,
  }),
}));
const makePanel = (count: number): ClinicalPanel => ({
  evolutions: Array.from({ length: count }, (_, i) => ({
    id: String(i),
    kind: 'evolution',
    title: 'Evolución',
    text: `Nota sintética ${i + 1}`,
    author: 'PROFESIONAL SINTÉTICO',
    role: i % 2 ? 'Enfermería' : 'Médico',
    profession: i % 2 ? 'nursing' : 'medical',
    publishedAt: '2026-11-06 09:00',
    archived: false,
    suspended: false,
    isNew: false,
    crossedOut: false,
  })),
  indicationDays: [],
  careDays: [],
});
const props = {
  episodeId: 'episode-one',
  selectedDate: null,
  onSelectDate: vi.fn(),
  tab: 'evolutions' as const,
  onShowAll: vi.fn(),
};
describe('ClinicalExplorerNotes', () => {
  beforeEach(() => {
    mocks.panel = makePanel(1500);
    mocks.reload.mockClear();
  });
  it('starts a large history with a readable batch while retaining access to later notes', () => {
    render(<ClinicalExplorerNotes {...props} />);
    expect(screen.getAllByRole('article')).toHaveLength(20);
    expect(screen.getByText('Mostrando 20 de 1500')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar 20 más' }));
    expect(screen.getAllByRole('article')).toHaveLength(40);
    expect(screen.getByText('Nota sintética 40')).toBeVisible();
    expect(screen.queryByText('Nota sintética 41')).toBeNull();
    expect(mocks.reload).not.toHaveBeenCalled();
  });
  it('resets the batch when changing profession or episode', () => {
    const view = render(<ClinicalExplorerNotes {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar 20 más' }));
    expect(screen.getAllByRole('article')).toHaveLength(40);
    fireEvent.click(screen.getByRole('button', { name: 'Médico (750)' }));
    expect(screen.getAllByRole('article')).toHaveLength(20);
    expect(screen.queryByText('Nota sintética 2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar 20 más' }));
    expect(screen.getAllByRole('article')).toHaveLength(40);
    view.rerender(<ClinicalExplorerNotes {...props} episodeId="episode-two" />);
    expect(screen.getAllByRole('article')).toHaveLength(20);
    view.rerender(<ClinicalExplorerNotes {...props} />);
    expect(screen.getAllByRole('article')).toHaveLength(20);
  });

  it('retains explicit access to the full history for reading or browser search', () => {
    render(<ClinicalExplorerNotes {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todas' }));
    expect(screen.getAllByRole('article')).toHaveLength(1500);
    expect(screen.getByText('Nota sintética 1500')).toBeVisible();
    expect(screen.getByText('Mostrando 1500 de 1500')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Mostrar todas' })).toBeNull();
  });

  it('loads the remaining short batch and preserves the three-note combined preview', () => {
    mocks.panel = makePanel(23);
    const view = render(<ClinicalExplorerNotes {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar 3 más' }));
    expect(screen.getAllByRole('article')).toHaveLength(23);
    expect(screen.queryByRole('button', { name: /Mostrar.*más/ })).toBeNull();
    view.rerender(<ClinicalExplorerNotes {...props} tab="all" />);
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Ver historial ›' })).toBeVisible();
  });

  it('distinguishes a filter with no matches from an empty history', () => {
    const view = render(<ClinicalExplorerNotes {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Otros (0)' }));
    expect(screen.getByText('Sin evoluciones para este filtro.')).toBeVisible();
    expect(screen.queryByText('Sin evoluciones en Ficha Médico.')).toBeNull();
    mocks.panel = makePanel(0);
    view.rerender(<ClinicalExplorerNotes {...props} />);
    expect(screen.getByText('Sin evoluciones en Ficha Médico.')).toBeVisible();
  });
});
