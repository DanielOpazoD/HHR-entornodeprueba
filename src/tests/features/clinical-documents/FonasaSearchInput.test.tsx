import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchFonasaMock = vi.fn();
const searchFonasaAIMock = vi.fn();
const isFonasaAIAvailableMock = vi.fn();

vi.mock('@/services/terminology/fonasaService', () => ({
  searchFonasa: (...args: unknown[]) => searchFonasaMock(...args),
  searchFonasaAI: (...args: unknown[]) => searchFonasaAIMock(...args),
  isFonasaAIAvailable: () => isFonasaAIAvailableMock(),
}));

import { FonasaSearchInput } from '@/features/clinical-documents/components/FonasaSearchInput';
import type { FonasaEntry } from '@/services/terminology/fonasaService';

const baseEntries: FonasaEntry[] = [
  { code: '0101001', description: 'Consulta medicina interna' },
  { code: '0401005', description: 'Radiografía de tórax' },
];

const baseProps = {
  catalog: 'interventions' as const,
  code: '',
  description: '',
  onSelect: vi.fn(),
  onManualChange: vi.fn(),
  onClear: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers();
  searchFonasaMock.mockReset().mockResolvedValue(baseEntries);
  searchFonasaAIMock.mockReset().mockResolvedValue([]);
  isFonasaAIAvailableMock.mockReset().mockReturnValue(false);
  baseProps.onSelect.mockReset();
  baseProps.onManualChange.mockReset();
  baseProps.onClear.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FonasaSearchInput — catalog mode', () => {
  it('does not trigger search when query is shorter than 2 characters', async () => {
    render(<FonasaSearchInput {...baseProps} />);

    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), { target: { value: 'a' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(searchFonasaMock).not.toHaveBeenCalled();
  });

  it('debounces and runs the catalog search, then shows results', async () => {
    render(<FonasaSearchInput {...baseProps} />);

    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), {
      target: { value: 'radio' },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(searchFonasaMock).toHaveBeenCalledWith('interventions', 'radio');
    expect(screen.getByText('Radiografía de tórax')).toBeInTheDocument();
  });

  it('resets results and hides the dropdown when the search throws', async () => {
    searchFonasaMock.mockRejectedValueOnce(new Error('net'));
    render(<FonasaSearchInput {...baseProps} />);

    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), {
      target: { value: 'radio' },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.queryByText('Radiografía de tórax')).not.toBeInTheDocument();
  });

  it('fires onSelect and clears the query when an entry is chosen', async () => {
    render(<FonasaSearchInput {...baseProps} />);

    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), {
      target: { value: 'radio' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    fireEvent.click(screen.getByText('Radiografía de tórax'));

    expect(baseProps.onSelect).toHaveBeenCalledWith(baseEntries[1]);
    expect(screen.queryByText('Radiografía de tórax')).not.toBeInTheDocument();
  });

  it('renders the AI button when the provider is available and calls searchFonasaAI', async () => {
    isFonasaAIAvailableMock.mockReturnValue(true);
    searchFonasaAIMock.mockResolvedValueOnce([
      { code: 'AI-01', description: 'Sugerencia IA', fromAI: true },
    ]);

    render(<FonasaSearchInput {...baseProps} />);

    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), {
      target: { value: 'consulta' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Buscar con inteligencia artificial'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('Sugerencia IA')).toBeInTheDocument();
  });

  it('ignores AI errors and leaves existing results untouched', async () => {
    isFonasaAIAvailableMock.mockReturnValue(true);
    searchFonasaAIMock.mockRejectedValueOnce(new Error('ai down'));

    render(<FonasaSearchInput {...baseProps} />);

    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), {
      target: { value: 'consulta' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    fireEvent.click(screen.getByLabelText('Buscar con inteligencia artificial'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Consulta medicina interna')).toBeInTheDocument();
  });
});

describe('FonasaSearchInput — mode switching', () => {
  it('shows a visible free-text button in the catalog control row', () => {
    render(<FonasaSearchInput {...baseProps} />);

    expect(screen.getByRole('button', { name: 'Texto libre' })).toBeInTheDocument();
    expect(screen.queryByText('Escribir texto libre')).not.toBeInTheDocument();
  });

  it('switches to manual mode and fires onClear', () => {
    render(<FonasaSearchInput {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Texto libre' }));
    expect(baseProps.onClear).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByPlaceholderText(/Descripción libre/), {
      target: { value: 'otra cosa' },
    });
    expect(baseProps.onManualChange).toHaveBeenCalledWith('otra cosa');
  });

  it('switches back to catalog mode from manual', () => {
    render(<FonasaSearchInput {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Texto libre' }));

    fireEvent.click(screen.getByText('Buscar en catálogo FONASA'));

    expect(screen.getByPlaceholderText(/Buscar por nombre/)).toBeInTheDocument();
  });
});

describe('FonasaSearchInput — selected code view', () => {
  it('shows the selected code chip and allows clearing it', () => {
    render(<FonasaSearchInput {...baseProps} code="0401005" description="Radiografía de tórax" />);

    expect(screen.getByText('0401005')).toBeInTheDocument();
    expect(screen.getByText('Radiografía de tórax')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Cambiar selección'));
    expect(baseProps.onClear).toHaveBeenCalledTimes(1);
  });

  it('offers a "Cambiar a texto libre" shortcut from the chip view', () => {
    render(<FonasaSearchInput {...baseProps} code="0401005" description="Radiografía de tórax" />);

    fireEvent.click(screen.getByText('Cambiar a texto libre'));
    // handleSwitchMode('manual') calls onClear
    expect(baseProps.onClear).toHaveBeenCalledTimes(1);
  });
});
