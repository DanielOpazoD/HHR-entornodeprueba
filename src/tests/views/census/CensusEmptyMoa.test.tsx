import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CensusEmptyMoa } from '@/features/census/components/CensusEmptyMoa';

describe('CensusEmptyMoa', () => {
  it('always displays an animation and clicking directly chooses a different scene', () => {
    render(<CensusEmptyMoa />);
    const button = screen.getByRole('button', { name: 'Cambiar animación de Moa' });
    const initial = button.querySelector('[data-moa-scene]')?.getAttribute('data-moa-scene');
    fireEvent.click(button);
    expect(button.querySelector('[data-moa-scene]')?.getAttribute('data-moa-scene')).not.toBe(
      initial
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cerrar|ocultar/i })).not.toBeInTheDocument();
  });
});
