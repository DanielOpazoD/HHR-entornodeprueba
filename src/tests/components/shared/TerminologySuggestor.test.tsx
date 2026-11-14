import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TerminologySuggestor } from '@/components/shared/TerminologySuggestor';

vi.mock('@/services/terminology/terminologyService', () => ({
  searchDiagnoses: vi.fn().mockResolvedValue([]),
  forceAISearch: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/services/terminology/cie10AISearch', () => ({
  checkAIAvailability: vi.fn().mockResolvedValue(false),
}));

const openSelector = () => {
  fireEvent.click(screen.getByPlaceholderText('Buscar diagnóstico…'));
  return screen.getByPlaceholderText('Describa el diagnóstico o ingrese código…');
};

describe('TerminologySuggestor', () => {
  it('opens the selector retaining the current diagnosis', () => {
    render(<TerminologySuggestor value="Diagnóstico sintético" onChange={vi.fn()} />);
    expect(openSelector()).toHaveValue('Diagnóstico sintético');
    expect(screen.getByText('Selector de Diagnóstico CIE-10')).toBeInTheDocument();
  });

  it('clears the search through the named icon button', async () => {
    const onChange = vi.fn();
    render(<TerminologySuggestor value="Diagnóstico sintético" onChange={onChange} />);
    const input = openSelector();
    const button = screen.getByRole('button', { name: 'Limpiar búsqueda' });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(button);
    expect(input).toHaveValue('');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''));
  });
});
