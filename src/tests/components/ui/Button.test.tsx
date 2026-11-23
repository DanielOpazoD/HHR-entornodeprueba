import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/base/Button';

describe('Shared action controls', () => {
  it('preserves the action, form type and forwarded keyboard focus', () => {
    const action = vi.fn();
    const ref = React.createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} type="button" onClick={action}>
        Guardar borrador
      </Button>
    );
    const button = screen.getByRole('button', { name: 'Guardar borrador' });
    expect(button).toHaveAttribute('type', 'button');
    ref.current?.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('prevents repeated activation and keeps the accessible label while loading', () => {
    const action = vi.fn();
    const { rerender } = render(
      <Button isLoading onClick={action}>
        Generar PDF
      </Button>
    );
    const button = screen.getByRole('button', { name: 'Generar PDF' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(action).not.toHaveBeenCalled();
    rerender(<Button onClick={action}>Generar PDF</Button>);
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('retains disabled, custom styling, native attributes and right-hand icons', () => {
    render(
      <Button
        disabled
        variant="outline"
        size="icon"
        aria-label="Descargar"
        className="custom"
        icon={<span data-testid="icon">↓</span>}
        iconPosition="right"
      />
    );
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descargar' })).toHaveClass('custom');
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});
