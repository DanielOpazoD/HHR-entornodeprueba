import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReminderBadge } from '@/components/reminders/ReminderBadge';
import { useReminderCenter } from '@/hooks/useReminders';

vi.mock('@/hooks/useReminders', () => ({
  useReminderCenter: vi.fn(),
}));

describe('ReminderBadge', () => {
  it('keeps a stable notification slot while the reminder center is bootstrapping', () => {
    vi.mocked(useReminderCenter).mockReturnValue({
      unreadCount: 0,
      hasUrgentUnread: false,
      loading: true,
      isAvailable: false,
      openCenter: vi.fn(),
    } as never);

    render(<ReminderBadge />);

    const button = screen.getByRole('button', { name: /abrir avisos/i });
    expect(button).toHaveClass('h-8');
    expect(button).toHaveClass('w-[58px]');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('reminder-badge-count')).toHaveClass('w-5');
  });
});
