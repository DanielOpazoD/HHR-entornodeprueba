import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DailyRecordProvider } from '@/context/DailyRecordContext';
import type { DailyRecordContextType } from '@/context/dailyRecordContextContracts';
import { CensusStaffHeader } from '@/features/census/components/CensusStaffHeader';
import { CensusToolbarMenuTargetContext } from '@/shared/ui/CensusToolbarMenuTargetContext';
import { DataFactory } from '@/tests/factories/DataFactory';

const calls = vi.hoisted(() => ({ nurse: vi.fn() }));
vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({ nursesList: [], tensList: [], professionalsCatalog: [] }),
}));
vi.mock('@/features/census/components/NurseSelector', () => ({
  NurseSelector: (props: { nursesDayShift: string[] }) => {
    calls.nurse(props);
    return <span>{props.nursesDayShift.join(',')}</span>;
  },
}));
vi.mock('@/features/census/components/TensSelector', () => ({ TensSelector: () => null }));
const record = DataFactory.createMockDailyRecord('2026-10-15');
const value = (next = record): DailyRecordContextType =>
  ({
    record: next,
    syncStatus: 'saved',
    lastSyncTime: null,
    bootstrapPhase: 'record_ready',
  }) as DailyRecordContextType;

describe('census header rendering with the real fragmented provider', () => {
  it('isolates twenty revision updates while the medical action receives every fresh record', () => {
    calls.nurse.mockClear();
    const target = document.createElement('div');
    document.body.append(target);
    const medicalAction = vi.fn(({ record: current }) => <span>{current.lastUpdated}</span>);
    const tree = (context: DailyRecordContextType) => (
      <DailyRecordProvider value={context}>
        <CensusToolbarMenuTargetContext.Provider value={target}>
          <CensusStaffHeader stats={null} readOnly renderMedicalHandoffAction={medicalAction} />
        </CensusToolbarMenuTargetContext.Provider>
      </DailyRecordProvider>
    );
    const view = render(tree(value()));
    for (let i = 1; i <= 20; i++)
      view.rerender(tree(value({ ...record, lastUpdated: `revision-${i}` })));
    expect(calls.nurse).toHaveBeenCalledTimes(1);
    expect(medicalAction).toHaveBeenCalledTimes(21);
    expect(target).toHaveTextContent('revision-20');
    view.rerender(
      tree(value({ ...record, date: '2026-10-16', nursesDayShift: ['Enfermera sintética'] }))
    );
    expect(screen.getByText(/Enfermera sintética/)).toBeVisible();
    expect(calls.nurse).toHaveBeenCalledTimes(2);
    expect(medicalAction.mock.lastCall?.[0].record.date).toBe('2026-10-16');
    view.unmount();
    expect(target).toBeEmptyDOMElement();
    target.remove();
  });
});
