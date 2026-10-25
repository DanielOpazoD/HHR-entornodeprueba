import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SectionErrorBoundary } from '@/components/shared/SectionErrorBoundary';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DiagnosisInput } from '@/features/census/components/patient-row/DiagnosisInput';

const chunk = '@/features/census/components/patient-row/DiagnosisCie10Cell';
const setOnline = (value: boolean) =>
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
const chunkError = () => new Error('Failed to fetch dynamically imported module');

async function mount({ fails = true, recovers = false, readOnly = false, isSubRow = true } = {}) {
  let attempts = 0;
  vi.doMock(chunk, async () => {
    attempts++;
    if (fails && (!recovers || attempts === 1)) throw chunkError();
    return vi.importActual(chunk);
  });
  const { DiagnosisInput: Input } =
    await import('@/features/census/components/patient-row/DiagnosisInput');
  const save = vi.fn();
  const multiple = vi.fn();
  const original = DataFactory.createMockPatient('R1', {
    patientName: 'RN SINTETICO P15',
    pathology: 'Diagnóstico libre sintético',
    cie10Code: 'P07.3',
    cie10Description: 'Prematuro sintético',
    clinicalEpisodeId: 'ep_synthetic_p15',
  });
  function Table() {
    const [data, setData] = useState(original);
    const onChange: React.ComponentProps<typeof DiagnosisInput>['onChange'] = field => value => {
      save(field, value);
      setData(current => ({ ...current, [field]: value }));
    };
    return (
      <SectionErrorBoundary sectionName="Tabla de Pacientes">
        <table data-testid="patient-table">
          <tbody>
            <tr>
              <td>
                <input aria-label="Otra fila" defaultValue="Otro diagnóstico" />
              </td>
              <Input
                data={data}
                isSubRow={isSubRow}
                diagnosisMode="cie10"
                readOnly={readOnly}
                onChange={onChange}
                onMultipleUpdate={multiple}
              />
            </tr>
          </tbody>
        </table>
        <output data-testid="saved-patient">{JSON.stringify(data)}</output>
      </SectionErrorBoundary>
    );
  }
  render(<Table />);
  return { save, multiple, original, attempts: () => attempts };
}

beforeEach(() => {
  vi.resetModules();
  setOnline(false);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.doUnmock(chunk);
  vi.restoreAllMocks();
  setOnline(true);
});

describe('DiagnosisInput unavailable CIE-10 chunk', () => {
  it('keeps the table, other typing and the current diagnosis editable through normal saving', async () => {
    const { save, multiple, original } = await mount();
    const other = screen.getByLabelText('Otra fila');
    fireEvent.change(other, { target: { value: 'Edición pendiente en otra fila' } });
    const input = await screen.findByPlaceholderText('Diagnóstico (texto libre)');
    expect(input).toHaveValue(original.pathology);
    expect(screen.getByText(/Buscador CIE-10 no disponible/)).toHaveAttribute('role', 'status');
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'Diagnóstico editado sin conexión' } });
    act(() => input.blur());
    expect(save).toHaveBeenCalledWith('pathology', 'Diagnóstico editado sin conexión');
    expect(multiple).not.toHaveBeenCalled();
    expect(JSON.parse(screen.getByTestId('saved-patient').textContent || '')).toEqual({
      ...original,
      pathology: 'Diagnóstico editado sin conexión',
    });
    expect(screen.getByTestId('patient-table')).toBeVisible();
    expect(screen.queryByText('Error en Tabla de Pacientes')).not.toBeInTheDocument();
    expect(other).toHaveValue('Edición pendiente en otra fila');
  });

  it('retains unsaved typing when reconnecting and recovers CIE-10 after blur saves it', async () => {
    const { save, attempts } = await mount({ recovers: true });
    const input = await screen.findByPlaceholderText('Diagnóstico (texto libre)');
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'Borrador al reconectar' } });
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(attempts()).toBe(2));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(screen.getByPlaceholderText('Diagnóstico (texto libre)')).toBe(input);
    expect(input).toHaveValue('Borrador al reconectar');
    act(() => input.blur());
    expect(await screen.findByPlaceholderText('Buscar diagnóstico CIE-10...')).toHaveValue(
      'Prematuro sintético'
    );
    expect(save).toHaveBeenCalledWith('pathology', 'Borrador al reconectar');
    expect(screen.getByTestId('saved-patient')).toHaveTextContent('Borrador al reconectar');
  });

  it('keeps a clinical editor portal draft while the chunk recovers', async () => {
    const { multiple } = await mount({ recovers: true, isSubRow: false });
    await screen.findByPlaceholderText('Diagnóstico (texto libre)');
    fireEvent.click(screen.getByLabelText('Editar bloque clínico'));
    const draft = screen.getByLabelText('Diagnóstico');
    act(() => draft.focus());
    fireEvent.change(draft, { target: { value: 'Borrador clínico en portal' } });
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.dynamicImportSettled();
    });
    expect(screen.getByLabelText('Diagnóstico')).toBe(draft);
    expect(draft).toHaveValue('Borrador clínico en portal');
    expect(multiple).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(multiple).toHaveBeenCalledWith(
        expect.objectContaining({ pathology: 'Borrador clínico en portal' })
      )
    );
  });

  it('keeps the fallback after a cached import failure and reloads only with confirmation', async () => {
    const { defaultBrowserWindowRuntime } =
      await import('@/shared/runtime/browserWindowRuntimeCore');
    const reload = vi.spyOn(defaultBrowserWindowRuntime, 'reload').mockImplementation(() => {});
    const confirm = vi.spyOn(defaultBrowserWindowRuntime, 'confirm').mockReturnValue(false);
    const { attempts } = await mount();
    const input = await screen.findByPlaceholderText('Diagnóstico (texto libre)');
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'Borrador conservado' } });
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(attempts()).toBe(2));
    expect(input).toHaveValue('Borrador conservado');
    expect(reload).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Recargar aplicación' }));
    expect(reload).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Recargar aplicación' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('preserves read-only access in the fallback', async () => {
    const { save } = await mount({ readOnly: true });
    expect(await screen.findByPlaceholderText('Diagnóstico (texto libre)')).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });

  it('still loads the real CIE-10 editor and saves code selection through the normal patch', async () => {
    setOnline(true);
    const { multiple } = await mount({ fails: false });
    expect(await screen.findByPlaceholderText('Buscar diagnóstico CIE-10...')).toHaveValue(
      'Prematuro sintético'
    );
    expect(screen.queryByText(/Buscador CIE-10 no disponible/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar código CIE-10' }));
    expect(multiple).toHaveBeenCalledWith({ cie10Code: '', cie10Description: '' });
  });
});
