import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MedifEditor } from '@/features/clinical-library/components/tools/medif/MedifEditor';
import {
  emptyMedifValues,
  setMedifFieldValue,
} from '@/features/clinical-library/domain/medifDraft';
import { MEDIF_PREFERENCES_STORAGE_KEY } from '@/features/clinical-library/domain/medifPreferences';

const patientValues = (name: string) =>
  setMedifFieldValue(emptyMedifValues(), 'p1_nombre_pasajero', name);
const patients = [
  {
    key: 'bed-1',
    label: 'Cama 1 · Paciente de prueba A',
    sourceLabel: 'Cama 1 · censo 15/10/2026',
    values: patientValues('Paciente de prueba A'),
  },
  {
    key: 'bed-2',
    label: 'Cama 2 · Paciente de prueba B',
    sourceLabel: 'Cama 2 · censo 15/10/2026',
    values: patientValues('Paciente de prueba B'),
  },
];
const setup = () => {
  const onGeneratePdf = vi.fn().mockResolvedValue(undefined);
  const onDirtyChange = vi.fn();
  const props = {
    patients,
    onGeneratePdf,
    onDirtyChange,
    onBack: vi.fn(),
    onClose: vi.fn(),
    previewPageUrls: [],
  };
  return { ...render(<MedifEditor {...props} />), props };
};

describe('MedifEditor', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('ignores delayed preference imports after manual changes or showing all fields', async () => {
    setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Preferencias' }));
    let resolveRead!: (text: string) => void;
    const file = new File([], 'preferences.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      value: () =>
        new Promise<string>(resolve => {
          resolveRead = resolve;
        }),
    });
    fireEvent.change(screen.getByLabelText('Archivo de preferencias'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Seguro de viaje/ }));
    await act(async () => {
      resolveRead(JSON.stringify({ version: 1, hiddenFieldIds: [] }));
    });
    expect(screen.getByRole('checkbox', { name: /Seguro de viaje/ })).not.toBeChecked();
    expect(
      JSON.parse(window.localStorage.getItem(MEDIF_PREFERENCES_STORAGE_KEY)!).hiddenFieldIds
    ).toEqual(['p1_seguro_viaje']);

    fireEvent.change(screen.getByLabelText('Archivo de preferencias'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todos' }));
    await act(async () => {
      resolveRead(JSON.stringify({ version: 1, hiddenFieldIds: ['p1_seguro_viaje'] }));
    });
    expect(screen.getByRole('checkbox', { name: /Seguro de viaje/ })).toBeChecked();
    expect(
      JSON.parse(window.localStorage.getItem(MEDIF_PREFERENCES_STORAGE_KEY)!).hiddenFieldIds
    ).toEqual([]);
  });

  it('discards a preference file when its panel unmounts before the read finishes', async () => {
    setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Preferencias' }));
    let resolveRead!: (text: string) => void;
    const file = new File([], 'preferences.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      value: () =>
        new Promise<string>(resolve => {
          resolveRead = resolve;
        }),
    });
    fireEvent.change(screen.getByLabelText('Archivo de preferencias'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Formulario' }));
    await act(async () => {
      resolveRead(JSON.stringify({ version: 1, hiddenFieldIds: ['p1_seguro_viaje'] }));
    });
    expect(screen.getByLabelText(/Seguro de viaje/)).toBeInTheDocument();
    expect(window.localStorage.getItem(MEDIF_PREFERENCES_STORAGE_KEY)).toBeNull();
  });

  it('guards browser navigation only while the draft contains data and removes the guard on unmount', () => {
    const { unmount } = setup();
    const navigationIsPrevented = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(navigationIsPrevented()).toBe(false);
    fireEvent.change(screen.getByLabelText(/Seguro de viaje/), {
      target: { value: 'Borrador sin descargar' },
    });
    expect(navigationIsPrevented()).toBe(true);
    fireEvent.change(screen.getByLabelText(/Seguro de viaje/), { target: { value: '' } });
    expect(navigationIsPrevented()).toBe(false);
    fireEvent.change(screen.getByLabelText(/Seguro de viaje/), {
      target: { value: 'Borrador sin descargar' },
    });
    unmount();
    expect(navigationIsPrevented()).toBe(false);
  });

  it('confirms replacement when the user edits while a draft file is still being read', async () => {
    setup();
    let resolveRead!: (text: string) => void;
    const read = new Promise<string>(resolve => {
      resolveRead = resolve;
    });
    const file = new File([], 'draft.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => read });
    fireEvent.change(screen.getByLabelText('Archivo de borrador MEDIF'), {
      target: { files: [file] },
    });
    fireEvent.change(screen.getByLabelText(/Seguro de viaje/), {
      target: { value: 'Dato escrito mientras lee' },
    });
    await act(async () => {
      resolveRead(JSON.stringify({ version: 1, values: { p1_seguro_viaje: 'Importado' } }));
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Seguro de viaje/)).toHaveValue('Dato escrito mientras lee');
    fireEvent.click(screen.getByRole('button', { name: 'Conservar formulario' }));
    expect(screen.getByLabelText(/Seguro de viaje/)).toHaveValue('Dato escrito mientras lee');
  });

  it('ignores an older import that finishes after a newer draft has loaded', async () => {
    setup();
    let resolveOlder!: (text: string) => void;
    const older = new File([], 'older.json', { type: 'application/json' });
    Object.defineProperty(older, 'text', {
      value: () =>
        new Promise<string>(resolve => {
          resolveOlder = resolve;
        }),
    });
    const newer = new File([], 'newer.json', { type: 'application/json' });
    Object.defineProperty(newer, 'text', {
      value: async () =>
        JSON.stringify({ version: 1, values: { p1_seguro_viaje: 'Borrador más reciente' } }),
    });
    fireEvent.change(screen.getByLabelText('Archivo de borrador MEDIF'), {
      target: { files: [older] },
    });
    fireEvent.change(screen.getByLabelText('Archivo de borrador MEDIF'), {
      target: { files: [newer] },
    });
    await waitFor(() =>
      expect(screen.getByLabelText(/Seguro de viaje/)).toHaveValue('Borrador más reciente')
    );
    await act(async () => {
      resolveOlder(JSON.stringify({ version: 1, values: { p1_seguro_viaje: 'Borrador antiguo' } }));
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Seguro de viaje/)).toHaveValue('Borrador más reciente');
  });

  it('keeps manual identity copies linked and emits exclusive X answers in the printable PDF', async () => {
    const { props } = setup();
    fireEvent.change(
      within(screen.getByRole('group', { name: 'Datos del pasajero' })).getByLabelText(
        /Nombre completo/
      ),
      {
        target: { value: 'Paciente manual de prueba' },
      }
    );
    expect(document.getElementById('medif-p2_nombre_paciente')).toHaveValue(
      'Paciente manual de prueba'
    );
    fireEvent.click(screen.getByRole('button', { name: /Asistencia y acompañante/ }));
    const wheelchair = screen.getByRole('group', { name: '¿Necesita silla de ruedas?' });
    expect(within(wheelchair).getByRole('radio', { name: 'Sí' })).not.toBeChecked();
    expect(within(wheelchair).getByRole('radio', { name: 'No' })).not.toBeChecked();
    fireEvent.click(within(wheelchair).getByRole('radio', { name: 'Sí' }));
    fireEvent.click(within(wheelchair).getByRole('radio', { name: 'No' }));
    fireEvent.click(screen.getByRole('button', { name: 'PDF imprimible' }));
    await waitFor(() => expect(props.onGeneratePdf).toHaveBeenCalledOnce());
    expect(props.onGeneratePdf.mock.calls[0][0]).toMatchObject({
      p1_nombre_pasajero: 'Paciente manual de prueba',
      p2_nombre_paciente: 'Paciente manual de prueba',
      p1_silla_si: '',
      p1_silla_no: 'X',
    });
    expect(props.onGeneratePdf.mock.calls[0][2]).toBe('print');
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('requires explicit replacement and never mixes data between census patients or manual entry', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Origen de los datos'), { target: { value: 'bed-1' } });
    fireEvent.change(screen.getByLabelText(/Seguro de viaje/), {
      target: { value: 'POLIZA-SOLO-A' },
    });
    fireEvent.change(screen.getByLabelText('Origen de los datos'), { target: { value: 'bed-2' } });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Datos del pasajero' })).getByLabelText(
        /Nombre completo/
      )
    ).toHaveValue('Paciente de prueba A');
    fireEvent.click(screen.getByRole('button', { name: 'Conservar formulario' }));
    expect(screen.getByLabelText('Origen de los datos')).toHaveValue('bed-1');
    fireEvent.change(screen.getByLabelText('Origen de los datos'), { target: { value: 'bed-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reemplazar todos los datos' }));
    expect(
      within(screen.getByRole('group', { name: 'Datos del pasajero' })).getByLabelText(
        /Nombre completo/
      )
    ).toHaveValue('Paciente de prueba B');
    expect(screen.getByLabelText(/Seguro de viaje/)).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Origen de los datos'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reemplazar todos los datos' }));
    expect(
      within(screen.getByRole('group', { name: 'Datos del pasajero' })).getByLabelText(
        /Nombre completo/
      )
    ).toHaveValue('');
    expect(document.getElementById('medif-p2_nombre_paciente')).toHaveValue('');
  });

  it('persists visibility only and allows hidden fields to be restored without losing the current draft', async () => {
    const { props, unmount } = setup();
    fireEvent.change(screen.getByLabelText(/Seguro de viaje/), {
      target: { value: 'VALOR-PRIVADO-PRUEBA' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Preferencias' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Seguro de viaje/ }));
    const saved = window.localStorage.getItem(MEDIF_PREFERENCES_STORAGE_KEY);
    expect(saved).toContain('p1_seguro_viaje');
    expect(saved).not.toContain('VALOR-PRIVADO-PRUEBA');
    fireEvent.click(screen.getByRole('tab', { name: 'Formulario' }));
    expect(screen.queryByLabelText(/Seguro de viaje/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PDF editable' }));
    await waitFor(() => expect(props.onGeneratePdf).toHaveBeenCalledOnce());
    expect(props.onGeneratePdf.mock.calls[0][1].hiddenFieldIds).toContain('p1_seguro_viaje');
    fireEvent.click(screen.getByRole('tab', { name: 'Preferencias' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Seguro de viaje/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Formulario' }));
    expect(screen.getByLabelText(/Seguro de viaje/)).toHaveValue('VALOR-PRIVADO-PRUEBA');
    fireEvent.click(screen.getByRole('tab', { name: 'Preferencias' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Seguro de viaje/ }));
    unmount();
    setup();
    expect(screen.queryByLabelText(/Seguro de viaje/)).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Datos del pasajero' })).getByLabelText(
        /Nombre completo/
      )
    ).toHaveValue('');
  });

  it('supports keyboard tabs and searchable documentation for all PDF variables', () => {
    setup();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Formulario' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Variables' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('137 variables');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar variable' }), {
      target: { value: 'anticoagulante' },
    });
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
    expect(screen.getAllByRole('row').length).toBeLessThan(10);
    expect(screen.queryByText('p1_nombre_pasajero')).not.toBeInTheDocument();
  });
});
