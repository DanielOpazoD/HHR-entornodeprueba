import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TransferCoverTool } from '@/features/clinical-library/components/tools/TransferCoverTool';

const printMock = vi.hoisted(() =>
  vi.fn((_document: { title: string; body: string; styles: string }) => 'printed' as const)
);
vi.mock('@/features/clinical-library/services/printHtmlDocument', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/features/clinical-library/services/printHtmlDocument')
  >()),
  printHtmlDocument: printMock,
}));

const patients = [
  {
    bedId: 'R1',
    label: 'R1 · Ana Pakarati',
    patientName: 'Ana Pakarati',
    rut: '12.345.678-9',
    age: '71',
  },
];

describe('TransferCoverTool', () => {
  it('prefills from a census patient and prints a legal landscape cover', () => {
    render(<TransferCoverTool onBack={vi.fn()} onClose={vi.fn()} patients={patients} />);
    const printButton = screen.getByTestId('transfer-cover-print');
    expect(printButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Desde el censo'), { target: { value: 'R1' } });
    expect(screen.getByLabelText('Nombre y apellidos')).toHaveValue('Ana Pakarati');
    expect(screen.getByLabelText('RUT')).toHaveValue('12.345.678-9');
    expect(screen.getByTestId('transfer-cover-preview')).toHaveTextContent('Ana Pakarati');
    expect(printButton).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Carta' }));
    fireEvent.click(printButton);
    expect(printMock).toHaveBeenCalledTimes(1);
    const document = printMock.mock.calls[0][0];
    expect(document.styles).toContain('letter landscape');
    expect(document.body).toContain('Ana Pakarati');
    expect(document.body).toContain('Cama R1');
  });

  it('accepts manual entry when the patient is not in the census', () => {
    render(<TransferCoverTool onBack={vi.fn()} onClose={vi.fn()} patients={[]} />);
    fireEvent.change(screen.getByLabelText('Nombre y apellidos'), {
      target: { value: 'Juan Tuki' },
    });
    expect(screen.getByTestId('transfer-cover-print')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('RUT'), { target: { value: '9.876.543-2' } });
    expect(screen.getByTestId('transfer-cover-print')).toBeEnabled();
  });
});
