import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToolFrame } from '@/features/clinical-library/components/tools/ToolFrame';

describe('ToolFrame panel chrome', () => {
  it('retains the full heading, navigation and separate primary action', () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    const title = 'Formulario clínico de evaluación y solicitud de traslado';
    render(
      <ToolFrame
        title={title}
        icon={<span>Icono</span>}
        onBack={onBack}
        onClose={onClose}
        action={<button type="button">Generar PDF</button>}
      >
        <label htmlFor="synthetic-field">Campo sintético</label>
        <input id="synthetic-field" defaultValue="Borrador" />
      </ToolFrame>
    );
    expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: title })).not.toHaveClass('truncate');
    fireEvent.click(screen.getByRole('button', { name: 'Volver a la biblioteca' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar documentos' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Campo sintético')).toHaveValue('Borrador');
    expect(screen.getByRole('button', { name: 'Generar PDF' })).toBeEnabled();
  });

  it('keeps the clinical reference reachable after the form', () => {
    render(
      <ToolFrame
        title="Herramienta"
        icon={null}
        onBack={vi.fn()}
        onClose={vi.fn()}
        reference={{ citation: 'Referencia sintética', url: 'https://example.org/reference' }}
      >
        <p>Contenido</p>
      </ToolFrame>
    );
    expect(screen.getByText('Referencia sintética')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver fuente' })).toHaveAttribute(
      'rel',
      'noopener noreferrer'
    );
  });
});
