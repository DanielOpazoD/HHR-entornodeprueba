import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RutPassportInput } from '@/features/census/components/patient-row/RutPassportInput';
import * as browserClipboardRuntime from '@/shared/runtime/browserClipboardRuntime';

const renderComponent = (props?: Partial<React.ComponentProps<typeof RutPassportInput>>) =>
  render(
    <table>
      <tbody>
        <tr>
          <RutPassportInput value="" documentType="RUT" onChange={vi.fn()} {...props} />
        </tr>
      </tbody>
    </table>
  );

describe('RutPassportInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('copies the clicked RUT and resets feedback only after clipboard completion', async () => {
    vi.useFakeTimers();
    let resolveCopy!: () => void;
    const pendingCopy = new Promise<void>(resolve => {
      resolveCopy = resolve;
    });
    const writeClipboardTextSpy = vi
      .spyOn(browserClipboardRuntime, 'writeClipboardText')
      .mockReturnValue(pendingCopy);

    renderComponent({
      value: '12.345.678-5',
      documentType: 'RUT',
    });

    fireEvent.click(screen.getByRole('textbox'));

    expect(writeClipboardTextSpy).toHaveBeenCalledWith('12.345.678-5');
    expect(screen.queryByTitle('RUT copiado')).not.toBeInTheDocument();
    await act(async () => {
      resolveCopy();
      await pendingCopy;
    });

    expect(screen.getByTitle('RUT copiado')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    expect(screen.getByTitle('RUT válido')).toBeInTheDocument();
  });

  it('does not copy when the document type is passport', async () => {
    const writeClipboardTextSpy = vi
      .spyOn(browserClipboardRuntime, 'writeClipboardText')
      .mockResolvedValue(undefined);

    renderComponent({
      value: 'AB123456',
      documentType: 'Pasaporte',
    });

    fireEvent.click(screen.getByRole('textbox'));

    expect(writeClipboardTextSpy).not.toHaveBeenCalled();
  });

  it('auto-fills "-" and locks input for RN in clinical crib context', async () => {
    const onChange = vi.fn();
    renderComponent({
      value: '',
      onChange,
      isClinicalCribPatient: true,
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('-'));
  });

  it('shows hidden hover action to unlock RUT placeholder', () => {
    const onChange = vi.fn();
    renderComponent({
      value: '-',
      onChange,
      isClinicalCribPatient: true,
    });

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(input.value).toBe('');
    expect(screen.queryByTitle('Cambiar a Pasaporte')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Editar RUT RN'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('keeps RN RUT editable after unlock (does not re-apply placeholder immediately)', async () => {
    const StatefulHarness: React.FC = () => {
      const [rut, setRut] = React.useState('-');
      return (
        <table>
          <tbody>
            <tr>
              <RutPassportInput
                value={rut}
                documentType="RUT"
                onChange={setRut}
                isClinicalCribPatient
              />
            </tr>
          </tbody>
        </table>
      );
    };

    render(<StatefulHarness />);
    fireEvent.click(screen.getByLabelText('Editar RUT RN'));

    await waitFor(() => {
      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input).not.toBeDisabled();
      expect(input.value).toBe('');
    });
  });
});
