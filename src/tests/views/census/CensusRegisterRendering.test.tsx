import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DailyRecordProvider } from '@/context/DailyRecordContext';
import type { DailyRecord, DailyRecordContextType } from '@/context/dailyRecordContextContracts';
import { CensusRegisterSections } from '@/features/census/components/CensusRegisterSections';
import { useCensusMovementData } from '@/features/census/hooks/useCensusMovementData';
import { DataFactory } from '@/tests/factories/DataFactory';

const renders = vi.hoisted(() => ({ discharges: vi.fn(), transfers: vi.fn(), cma: vi.fn() }));
const MovementProbe = ({ bucket }: { bucket: keyof typeof renders }) => {
  const data = useCensusMovementData();
  renders[bucket]();
  return (
    <output data-testid={bucket}>
      {data.recordDate}:{data[bucket]?.length ?? 0}
    </output>
  );
};
vi.mock('@/features/census/components/DischargesSection', () => ({
  DischargesSection: () => <MovementProbe bucket="discharges" />,
}));
vi.mock('@/features/census/components/TransfersSection', () => ({
  TransfersSection: () => <MovementProbe bucket="transfers" />,
}));
vi.mock('@/features/census/components/CMASection', () => ({
  CMASection: () => <MovementProbe bucket="cma" />,
}));
vi.mock('@/features/census/components/CensusModals', () => ({
  CensusModals: ({
    showBedManagerModal,
    onCloseBedManagerModal,
  }: {
    showBedManagerModal: boolean;
    onCloseBedManagerModal: () => void;
  }) =>
    showBedManagerModal ? (
      <button onClick={onCloseBedManagerModal}>Close synthetic manager</button>
    ) : null,
}));

describe('census register rendering through the real provider', () => {
  it('skips twenty unrelated parent/bed updates but still publishes movements, date and access changes', async () => {
    vi.clearAllMocks();
    const base = DataFactory.createMockDailyRecord('2026-10-01');
    const onClose = vi.fn();
    const props = {
      readOnly: true,
      showBedManagerModal: false,
      onCloseBedManagerModal: onClose,
      accessProfile: 'default' as const,
    };
    const viewOf = (
      record: DailyRecord,
      nextProps: React.ComponentProps<typeof CensusRegisterSections> = props
    ) => (
      <DailyRecordProvider
        value={
          {
            record,
            syncStatus: 'saved',
            lastSyncTime: null,
            bootstrapPhase: 'record_ready',
          } as DailyRecordContextType
        }
      >
        <CensusRegisterSections {...nextProps} />
      </DailyRecordProvider>
    );
    const view = render(viewOf(base));
    for (let i = 1; i <= 20; i++)
      view.rerender(viewOf({ ...base, beds: { ...base.beds }, lastUpdated: `revision-${i}` }));
    for (const spy of Object.values(renders)) expect(spy).toHaveBeenCalledTimes(1);
    const moved = { ...base, discharges: [DataFactory.createMockDischarge()] };
    view.rerender(viewOf(moved));
    expect(screen.getByTestId('discharges')).toHaveTextContent('2026-10-01:1');
    view.rerender(viewOf({ ...moved, date: '2026-10-02' }));
    expect(screen.getByTestId('discharges')).toHaveTextContent('2026-10-02:1');
    view.rerender(viewOf(moved, { ...props, accessProfile: 'specialist' }));
    expect(screen.queryByTestId('discharges')).not.toBeInTheDocument();
    view.rerender(viewOf(moved, { ...props, readOnly: false, showBedManagerModal: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close synthetic manager' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const nextClose = vi.fn();
    view.rerender(
      viewOf(moved, {
        ...props,
        readOnly: false,
        showBedManagerModal: true,
        onCloseBedManagerModal: nextClose,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close synthetic manager' }));
    expect(nextClose).toHaveBeenCalledTimes(1);
    view.rerender(viewOf(moved, { ...props, showBedManagerModal: true }));
    expect(
      screen.queryByRole('button', { name: 'Close synthetic manager' })
    ).not.toBeInTheDocument();
  });
});
