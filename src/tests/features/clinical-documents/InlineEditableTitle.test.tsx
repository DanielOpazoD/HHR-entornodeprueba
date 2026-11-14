import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InlineEditableTitle } from '@/features/clinical-documents/components/InlineEditableTitle';

describe('InlineEditableTitle', () => {
  it('activates editing and commits trimmed values on blur', () => {
    const onChange = vi.fn();
    const onActivate = vi.fn();
    const onDeactivate = vi.fn();

    render(
      <InlineEditableTitle
        value="Título actual"
        onChange={onChange}
        onActivate={onActivate}
        onDeactivate={onDeactivate}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Título actual' }));
    const input = screen.getByDisplayValue('Título actual');
    fireEvent.change(input, { target: { value: '  Título editado  ' } });
    fireEvent.blur(input);

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('Título editado');
    expect(onDeactivate).toHaveBeenCalledTimes(1);
  });

  it('restores the original value on escape and renders as text when disabled', () => {
    const onChange = vi.fn();
    const onDeactivate = vi.fn();

    const { rerender } = render(
      <InlineEditableTitle value="Título actual" onChange={onChange} onDeactivate={onDeactivate} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Título actual' }));
    const input = screen.getByDisplayValue('Título actual');
    fireEvent.change(input, { target: { value: 'Temporal' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onChange).not.toHaveBeenCalled();
    expect(onDeactivate).toHaveBeenCalledTimes(1);

    rerender(<InlineEditableTitle value="Solo lectura" onChange={onChange} disabled={true} />);
    expect(screen.getByText('Solo lectura')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Solo lectura' })).not.toBeInTheDocument();
  });
});
