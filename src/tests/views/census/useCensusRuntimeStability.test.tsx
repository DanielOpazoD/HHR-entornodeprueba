import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCensusTableRuntime } from '@/features/census/hooks/useCensusTableRuntime';
import { getDefaultConfig } from '@/services/storage/tableConfigService';
import { buildCensusBedRows } from '@/features/census/controllers/censusTableViewController';

vi.mock('@/features/census/hooks/useCensusTableDependencies', () => ({
  useCensusTableDependencies: () => dependencies,
}));
vi.mock('@/features/census/components/useEmptyBedActivation', () => ({
  useEmptyBedActivation: () => ({ activateEmptyBed: vi.fn() }),
}));
vi.mock('@/features/census/hooks/useCensusColumnResize', () => ({
  useCensusColumnResize: () => ({ handleColumnResize: vi.fn() }),
}));
vi.mock('@/features/census/controllers/censusTableViewController', async original => ({
  ...(await original<typeof import('@/features/census/controllers/censusTableViewController')>()),
  buildCensusBedRows: vi.fn(
    (await original<typeof import('@/features/census/controllers/censusTableViewController')>())
      .buildCensusBedRows
  ),
}));
const dependencies = {
  beds: {},
  staff: undefined,
  overrides: {},
  config: getDefaultConfig(),
  role: 'admin',
  resetDay: vi.fn(),
  confirm: vi.fn(),
  warning: vi.fn(),
};
it('builds unchanged rows once across five renders without staff configuration', () => {
  const { result, rerender } = renderHook(() =>
    useCensusTableRuntime({ currentDateString: '2026-11-06' })
  );
  const rows = result.current.unifiedRows;
  for (let i = 0; i < 4; i++) rerender();
  expect(buildCensusBedRows).toHaveBeenCalledTimes(1);
  expect(result.current.unifiedRows).toBe(rows);
  dependencies.beds = {};
  rerender();
  expect(buildCensusBedRows).toHaveBeenCalledTimes(2);
  expect(result.current.unifiedRows).not.toBe(rows);
});
