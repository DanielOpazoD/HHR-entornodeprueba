import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelState } from '@/features/census/components/patient-row/useClinicalPanelSnapshot';
import { ClinicalExplorerNotes } from '@/features/census/components/clinical-explorer/ClinicalExplorerNotes';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { parseClinicalPanel } from '@/features/rayen-import/clinical-panel';
import { panelResult } from '../clinicalPanelDrawer.fixture';

const mocks = vi.hoisted(() => ({ state: null as unknown as PanelState, reload: vi.fn() }));
vi.mock('@/features/census/components/patient-row/useClinicalPanelSnapshot', () => ({
  useClinicalPanelSnapshot: () => ({ state: mocks.state, reload: mocks.reload }),
}));
const panel = parseClinicalPanel(panelResult.events, panelResult.carePlan);
const props = {
  episodeId: 'synthetic-one',
  selectedDate: '2026-07-13',
  onSelectDate: vi.fn(),
  tab: 'all' as const,
  onShowAll: vi.fn(),
};
const disclosure = (): HTMLDetailsElement => {
  const element = screen.getByRole('region', { name: 'Indicaciones' }).querySelector('details');
  if (!(element instanceof HTMLDetailsElement)) throw new Error('Missing indications disclosure');
  return element;
};
describe('combined indications disclosure', () => {
  beforeEach(() => {
    mocks.state = { phase: 'ready', panel };
    vi.clearAllMocks();
  });
  afterEach(() => act(() => setSessionGeneration(null)));

  it('keeps date and count visible while initially folding treatment and date controls', () => {
    render(<ClinicalExplorerNotes {...props} />);
    const card = screen.getByRole('region', { name: 'Indicaciones' });
    expect(disclosure().open).toBe(false);
    expect(within(card).getByText('13-07-2026')).toBeVisible();
    expect(card).toHaveTextContent('0 vigentes');
    expect(within(card).getByLabelText('Fecha de indicaciones')).not.toBeVisible();
    fireEvent.click(within(card).getByText('Mostrar indicaciones'));
    expect(disclosure().open).toBe(true);
    expect(within(card).getByLabelText('Fecha de indicaciones')).toBeVisible();
    fireEvent.click(within(card).getByText('Ocultar indicaciones'));
    expect(disclosure().open).toBe(false);
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it('retains the chosen date while folding and resets disclosure for another episode or session', () => {
    const view = render(<ClinicalExplorerNotes {...props} />);
    fireEvent.click(screen.getByText('Mostrar indicaciones'));
    fireEvent.change(screen.getByLabelText('Fecha de indicaciones'), {
      target: { value: '2026-07-11' },
    });
    expect(props.onSelectDate).toHaveBeenLastCalledWith('2026-07-11');
    view.rerender(<ClinicalExplorerNotes {...props} selectedDate="2026-07-11" />);
    expect(disclosure().open).toBe(true);
    fireEvent.click(screen.getByText('Ocultar indicaciones'));
    expect(screen.getByText('11-07-2026')).toBeVisible();
    fireEvent.click(screen.getByText('Mostrar indicaciones'));
    view.rerender(<ClinicalExplorerNotes {...props} episodeId="synthetic-two" />);
    expect(disclosure().open).toBe(false);
    fireEvent.click(screen.getByText('Mostrar indicaciones'));
    act(() => setSessionGeneration('synthetic-session'));
    expect(disclosure().open).toBe(false);
  });

  it('keeps the full indications tab expanded with the same selected date', () => {
    render(<ClinicalExplorerNotes {...props} tab="indications" />);
    expect(screen.getByLabelText('Fecha de indicaciones')).toBeVisible();
    expect(screen.getByLabelText('Fecha de indicaciones')).toHaveValue('2026-07-13');
    expect(screen.queryByText('Mostrar indicaciones')).toBeNull();
  });

  it('shows loading and read failure directly instead of concealing them behind the disclosure', () => {
    mocks.state = { phase: 'loading' };
    const view = render(<ClinicalExplorerNotes {...props} />);
    expect(screen.getAllByRole('status', { name: 'Leyendo Ficha Médico' })).toHaveLength(2);
    mocks.state = { phase: 'error', message: 'Fallo sintético de lectura' };
    view.rerender(<ClinicalExplorerNotes {...props} />);
    expect(screen.getAllByText('Fallo sintético de lectura')).toHaveLength(2);
    expect(screen.queryByText('Mostrar indicaciones')).toBeNull();
    expect(screen.queryByText('0 vigentes')).toBeNull();
  });
});
