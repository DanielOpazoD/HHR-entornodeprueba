import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCensusEmailRecipientsEditor } from '@/features/census/hooks/useCensusEmailRecipientsEditor';

describe('useCensusEmailRecipientsEditor', () => {
  it('adds a recipient and clears input/error', () => {
    const onRecipientsChange = vi.fn();
    const { result } = renderHook(() =>
      useCensusEmailRecipientsEditor({
        isOpen: true,
        recipients: ['a@mail.com'],
        onRecipientsChange,
      })
    );

    act(() => {
      result.current.setNewRecipient('b@mail.com');
    });

    act(() => {
      result.current.addRecipient();
    });

    expect(onRecipientsChange).toHaveBeenCalledWith(['a@mail.com', 'b@mail.com']);
    expect(result.current.newRecipient).toBe('');
    expect(result.current.error).toBeNull();
  });

  it('shows validation error for duplicate recipient', () => {
    const { result } = renderHook(() =>
      useCensusEmailRecipientsEditor({
        isOpen: true,
        recipients: ['a@mail.com'],
        onRecipientsChange: vi.fn(),
      })
    );

    act(() => {
      result.current.setNewRecipient('A@mail.com');
    });

    act(() => {
      result.current.addRecipient();
    });

    expect(result.current.error).toMatch(/ya está agregado/i);
  });

  it('resets transient state when modal opens', () => {
    const onRecipientsChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ isOpen }) =>
        useCensusEmailRecipientsEditor({
          isOpen,
          recipients: ['a@mail.com', 'b@mail.com'],
          onRecipientsChange,
        }),
      {
        initialProps: { isOpen: false },
      }
    );

    act(() => {
      result.current.setNewRecipient('temp@mail.com');
      result.current.toggleBulkEditor();
    });

    rerender({ isOpen: true });

    expect(result.current.newRecipient).toBe('');
    expect(result.current.showBulkEditor).toBe(false);
    expect(result.current.bulkRecipients).toContain('a@mail.com');
  });
});
