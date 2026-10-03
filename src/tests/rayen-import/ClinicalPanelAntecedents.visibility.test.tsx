import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalPanelAntecedents } from '@/features/census/components/patient-row/ClinicalPanelAntecedents';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/features/rayen-import/clinical-panel', () => ({ requestClinicalAction: request }));
vi.mock('@/features/census/components/patient-row/ClinicalAntecedentCard', () => ({
  ClinicalAntecedentCard: () => <div>Historia conservada</div>,
}));
const response = {
  ok: true,
  warnings: [],
  entries: [
    {
      id: '1',
      source: 'Primaria',
      date: '20261003',
      diagnosis: 'Sintético',
      facility: 'TEST',
      type: 'Consulta',
    },
  ],
};
let visibility: DocumentVisibilityState;
const changeVisibility = async (next: DocumentVisibilityState) => {
  await act(async () => {
    visibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  request.mockResolvedValue(response);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('antecedent refresh visibility', () => {
  it('skips hidden refreshes and refreshes overdue information once on return', async () => {
    render(<ClinicalPanelAntecedents clinicalEpisodeId="12" />);
    await act(async () => undefined);
    expect(request).toHaveBeenCalledTimes(1);
    await changeVisibility('hidden');
    await act(async () => vi.advanceTimersByTimeAsync(15 * 60_000));
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Historia conservada')).toBeInTheDocument();
    await changeVisibility('visible');
    expect(request).toHaveBeenCalledTimes(2);
    await changeVisibility('hidden');
    await changeVisibility('visible');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('reschedules the periodic deadline after an overdue return just before the old tick', async () => {
    render(<ClinicalPanelAntecedents clinicalEpisodeId="12" />);
    await act(async () => undefined);
    await changeVisibility('hidden');
    await act(async () => vi.advanceTimersByTimeAsync(599_000));
    await changeVisibility('visible');
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(299_000));
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('waits for visibility on initial mount and retains the visible five-minute refresh', async () => {
    visibility = 'hidden';
    render(<ClinicalPanelAntecedents clinicalEpisodeId="12" />);
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(request).not.toHaveBeenCalled();
    await changeVisibility('visible');
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('coalesces return and timer events while pending, and cleans up on episode changes', async () => {
    let finish!: (value: typeof response) => void;
    request.mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve;
      })
    );
    const view = render(<ClinicalPanelAntecedents clinicalEpisodeId="12" />);
    await changeVisibility('hidden');
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    await changeVisibility('visible');
    expect(request).toHaveBeenCalledTimes(1);
    const oldSignal = request.mock.calls[0][3] as AbortSignal;
    view.rerender(<ClinicalPanelAntecedents clinicalEpisodeId="13" />);
    await act(async () => undefined);
    expect(oldSignal.aborted).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => finish(response));
    view.unmount();
    await changeVisibility('hidden');
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    await changeVisibility('visible');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
