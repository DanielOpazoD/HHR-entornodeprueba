import React, { memo, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UIProvider, useUI, useNotification, useConfirmDialog } from '@/context/UIContext';

describe.each([useUI, useNotification, useConfirmDialog])(
  'stable UI actions through %s',
  useActions => {
    it('updates toasts and dialogs without notifying action-only consumers or losing their edits', async () => {
      const rendered = vi.fn();
      let decision: boolean | undefined;
      const Editor = memo(() => {
        rendered();
        const { success, dismissAll, confirm } = useActions();
        const [value, setValue] = useState('');
        return (
          <>
            <input
              aria-label="Draft"
              value={value}
              onChange={event => setValue(event.target.value)}
            />
            <button onClick={() => success('Saved')}>Notify</button>
            <button onClick={dismissAll}>Dismiss</button>
            <button
              onClick={() =>
                void confirm({ message: 'Proceed?' }).then(answer => {
                  decision = answer;
                })
              }
            >
              Ask
            </button>
          </>
        );
      });
      Editor.displayName = 'ActionOnlyEditor';
      const Parent = ({ revision }: { revision: number }) => (
        <>
          <span>{revision}</span>
          <UIProvider>
            <Editor />
          </UIProvider>
        </>
      );
      const { rerender } = render(<Parent revision={0} />);
      const input = screen.getByLabelText('Draft');
      fireEvent.change(input, { target: { value: 'Unconfirmed edit' } });
      const initialRenders = rendered.mock.calls.length;

      fireEvent.click(screen.getByText('Notify'));
      expect(screen.getByText('Saved')).toBeInTheDocument();
      rerender(<Parent revision={1} />);
      fireEvent.click(screen.getByText('Dismiss'));
      expect(screen.queryByText('Saved')).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('Ask'));
      expect(screen.getByText('Proceed?')).toBeInTheDocument();
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirmar' })));

      expect(decision).toBe(true);
      expect(rendered).toHaveBeenCalledTimes(initialRenders);
      expect(screen.getByLabelText('Draft')).toBe(input);
      expect(input).toHaveValue('Unconfirmed edit');
    });
  }
);
