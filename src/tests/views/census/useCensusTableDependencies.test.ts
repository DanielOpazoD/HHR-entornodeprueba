import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCensusTableDependencies } from '@/features/census/hooks/useCensusTableDependencies';
import {
  useDailyRecordActions,
  useDailyRecordBeds,
  useDailyRecordOverrides,
  useDailyRecordStaff,
} from '@/context/DailyRecordContext';
import { useCensusActionCommands } from '@/features/census/context/censusActionContexts';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { useAuth } from '@/context/AuthContext';
import { useTableConfig } from '@/context/TableConfigContext';
import { useDiagnosisMode } from '@/features/census/hooks/useDiagnosisMode';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordActions: vi.fn(),
  useDailyRecordBeds: vi.fn(),
  useDailyRecordOverrides: vi.fn(),
  useDailyRecordStaff: vi.fn(),
}));

vi.mock('@/features/census/context/censusActionContexts', () => ({
  useCensusActionCommands: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: vi.fn(),
  useNotification: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/context/TableConfigContext', () => ({
  useTableConfig: vi.fn(),
}));

vi.mock('@/features/census/hooks/useDiagnosisMode', () => ({
  useDiagnosisMode: vi.fn(),
}));

const asHookValue = <T>(value: Partial<T>): T => value as T;

describe('useCensusTableDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useDailyRecordBeds).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordBeds>>({})
    );
    vi.mocked(useDailyRecordStaff).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordStaff>>({ activeExtraBeds: ['E1'] })
    );
    vi.mocked(useDailyRecordOverrides).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordOverrides>>({})
    );
    vi.mocked(useDailyRecordActions).mockReturnValue(
      asHookValue<ReturnType<typeof useDailyRecordActions>>({
        resetDay: vi.fn(),
        updatePatient: vi.fn(),
      })
    );
    vi.mocked(useCensusActionCommands).mockReturnValue(
      asHookValue<ReturnType<typeof useCensusActionCommands>>({
        handleRowAction: vi.fn(),
      })
    );
    vi.mocked(useConfirmDialog).mockReturnValue(
      asHookValue<ReturnType<typeof useConfirmDialog>>({
        confirm: vi.fn(),
      })
    );
    vi.mocked(useNotification).mockReturnValue(
      asHookValue<ReturnType<typeof useNotification>>({
        warning: vi.fn(),
      })
    );
    vi.mocked(useAuth).mockReturnValue(
      asHookValue<ReturnType<typeof useAuth>>({
        role: 'admin',
      })
    );
    vi.mocked(useTableConfig).mockReturnValue(
      asHookValue<ReturnType<typeof useTableConfig>>({
        config: {
          columns: {
            actions: 50,
            bed: 80,
            type: 60,
            name: 200,
            rut: 100,
            age: 50,
            diagnosis: 200,
            specialty: 80,
            status: 100,
            admission: 100,
            dmi: 60,
            cqx: 60,
            upc: 60,
          },
          pageMargin: 20,
          version: 1,
          lastUpdated: new Date().toISOString(),
        },
        isEditMode: false,
        updateColumnWidth: vi.fn(),
      })
    );
    vi.mocked(useDiagnosisMode).mockReturnValue({
      diagnosisMode: 'free',
      toggleDiagnosisMode: vi.fn(),
    });
  });

  it('returns dependencies from all context/hooks in one object', () => {
    const { result } = renderHook(() => useCensusTableDependencies());

    expect(result.current.role).toBe('admin');
    expect(result.current.staff?.activeExtraBeds).toEqual(['E1']);
    expect(result.current.config.columns.bed).toBe(80);
    expect(result.current.diagnosisMode).toBe('free');
    expect(typeof result.current.handleRowAction).toBe('function');
    expect(typeof result.current.confirm).toBe('function');
  });
});
