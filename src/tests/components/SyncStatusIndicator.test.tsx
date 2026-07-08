import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SyncStatusIndicator } from '@/components/layout/SyncStatusIndicator';

const mockUseDailyRecordStatus = vi.hoisted(() => vi.fn());

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordStatus: () => mockUseDailyRecordStatus(),
}));

describe('layout SyncStatusIndicator', () => {
  it.each(['idle', 'saved'] as const)(
    'keeps a reserved right-bar slot when sync status is %s',
    syncStatus => {
      mockUseDailyRecordStatus.mockReturnValue({ syncStatus, lastSyncTime: null });

      render(<SyncStatusIndicator />);

      const slot = screen.getByTestId('sync-status-indicator-slot');
      expect(slot).toHaveClass('h-8');
      expect(slot).toHaveClass('w-[88px]');
      expect(slot).toHaveClass('invisible');
    }
  );

  it('uses the same reserved width while saving', () => {
    mockUseDailyRecordStatus.mockReturnValue({ syncStatus: 'saving', lastSyncTime: null });

    render(<SyncStatusIndicator />);

    const indicator = screen.getByTestId('sync-status-indicator-slot');
    expect(indicator).toHaveClass('h-8');
    expect(indicator).toHaveClass('w-[88px]');
    expect(indicator).not.toHaveClass('invisible');
    expect(screen.getByText('Guardando')).toBeInTheDocument();
  });
});
