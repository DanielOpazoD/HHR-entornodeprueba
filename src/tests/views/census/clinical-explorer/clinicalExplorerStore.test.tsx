import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeClinicalExplorer,
  openClinicalExplorer,
  selectClinicalExplorerBed,
  useClinicalExplorerSelection,
} from '@/features/census/components/clinical-explorer/clinicalExplorerStore';

const Probe = ({ censusDate }: { censusDate: string }) => {
  const selection = useClinicalExplorerSelection(censusDate);
  return <output>{selection ? `${selection.censusDate}:${selection.bedId}` : 'censo'}</output>;
};

describe('clinicalExplorerStore', () => {
  afterEach(() => act(() => closeClinicalExplorer()));

  it('opens, moves between beds and closes for the day it was opened from', () => {
    render(<Probe censusDate="2026-11-04" />);
    expect(screen.getByRole('status')).toHaveTextContent('censo');
    act(() => openClinicalExplorer({ censusDate: '2026-11-04', bedId: 'R1' }));
    expect(screen.getByRole('status')).toHaveTextContent('2026-11-04:R1');
    act(() => selectClinicalExplorerBed('H1C1'));
    expect(screen.getByRole('status')).toHaveTextContent('2026-11-04:H1C1');
    act(() => closeClinicalExplorer());
    expect(screen.getByRole('status')).toHaveTextContent('censo');
  });

  it('leaves the explorer when the census moves to another day', () => {
    const view = render(<Probe censusDate="2026-11-04" />);
    act(() => openClinicalExplorer({ censusDate: '2026-11-04', bedId: 'R1' }));
    view.rerender(<Probe censusDate="2026-11-03" />);
    expect(screen.getByRole('status')).toHaveTextContent('censo');
    // Coming back to the original day does not reopen it.
    view.rerender(<Probe censusDate="2026-11-04" />);
    expect(screen.getByRole('status')).toHaveTextContent('censo');
  });

  it('closes when the Eloísa session changes, so the next person starts in the census', () => {
    render(<Probe censusDate="2026-11-04" />);
    act(() => openClinicalExplorer({ censusDate: '2026-11-04', bedId: 'R1' }));
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'HHR_RAYEN_SESSION_CHANGED' } })
      );
    });
    expect(screen.getByRole('status')).toHaveTextContent('censo');
  });
});
