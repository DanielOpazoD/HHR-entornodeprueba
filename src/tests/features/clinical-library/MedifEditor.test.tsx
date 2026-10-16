import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MedifEditor } from '@/features/clinical-library/components/tools/medif/MedifEditor';
import {
  emptyMedifValues,
  setMedifFieldValue,
} from '@/features/clinical-library/domain/medifDraft';
import {
  defaultMedifPreferences,
  emptyMedifPreferences,
  MEDIF_PREFERENCES_STORAGE_KEY,
} from '@/features/clinical-library/domain/medifPreferences';
import { MEDIF_FORM_BLOCKS } from '@/features/clinical-library/domain/medifFormLayout';

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
  };
  return { ...render(<MedifEditor {...props} />), props };
};

const openSettings = (): void => {
  const button = screen.getByRole('button', { name: 'Configurar MEDIF' });
  if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button);
};

describe('MedifEditor', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // These existing interaction regressions deliberately expose every field.
    window.localStorage.setItem(
      MEDIF_PREFERENCES_STORAGE_KEY,
      JSON.stringify(emptyMedifPreferences())
    );
  });

  it('shows seven continuous blocks with the initial hidden selection and no page wizard', () => {
    window.localStorage.clear();
    setup();
    for (const block of MEDIF_FORM_BLOCKS) {
      expect(screen.getByRole('region', { name: block.title })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Anterior' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Siguiente' })).not.toBeInTheDocument();
    expect(document.getElementById('medif-p1_nombre_pasajero')).toBeInTheDocument();
    expect(document.getElementById('medif-p3_firma_medico_texto')).toBeInTheDocument();
    expect(document.getElementById('medif-p2_nombre_paciente')).not.toBeInTheDocument();
    expect(document.getElementById('medif-p2_edad')).not.toBeInTheDocument();
    for (const id of defaultMedifPreferences().hiddenFieldIds) {
      expect(document.getElementById(`medif-${id}`)).not.toBeInTheDocument();
    }
    expect(
      document.querySelectorAll('.medif-form-grid input, .medif-form-grid textarea')
    ).toHaveLength(89);
    expect(document.getElementById('medif-p2_instrucciones_si')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        /El formulario se mantiene|sin asociación a una cama|casilleros visibles con datos|Referencia del PDF original/
      )
    ).not.toBeInTheDocument();
    openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Preferencias' }));
    expect(screen.getByText(/44 de 137 casilleros ocultos/)).toBeInTheDocument();
  });

  it('restores the selected preset after showing all without erasing the draft', () => {
    window.localStorage.clear();
    setup();
    openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Preferencias' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todos' }));
    openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Formulario' }));
    fireEvent.change(screen.getByLabelText(/Seguro de viaje/), {
      target: { value: 'Valor conservado en sesión' },
    });
    openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Preferencias' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar selección MEDIF' }));
    expect(screen.getByRole('checkbox', { name: /Seguro de viaje/ })).not.toBeChecked();
    expect(JSON.parse(window.localStorage.getItem(MEDIF_PREFERENCES_STORAGE_KEY)!)).toEqual(
      defaultMedifPreferences()
    );
    openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Formulario' }));
    expect(screen.queryByLabelText(/Seguro de viaje/)).not.toBeInTheDocument();
    openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Preferencias' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todos' }));
    openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Formulario' }));
    expect(screen.getByLabelText(/Seguro de viaje/)).toHaveValue('Valor conservado en sesión');
  });

  it('shows one physician name under Datos del médico and fills both PDF declarations', async () => {
    const { props } = setup();
    const physician = screen.getByRole('textbox', {
      name: 'Nombre del médico tratante',
    });
    expect(
      within(screen.getByRole('group', { name: 'Datos del médico' })).getByRole('textbox', {
        name: 'Nombre del médico tratante',
      })
    ).toBe(physician);
    expect(screen.queryByRole('textbox', { name: 'Médico autorizado' })).not.toBeInTheDocument();
    expect(document.getElementById('medif-p3_medico_declaracion')).not.toBeInTheDocument();
    fireEvent.change(physician, { target: { value: 'Dra. Prueba Ñáñez' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'PDF editable' }));
    });
    expect(props.onGeneratePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        p2_nombre_medico: 'Dra. Prueba Ñáñez',
        p1_medico_autorizado: 'Dra. Prueba Ñáñez',
        p3_medico_declaracion: 'Dra. Prueba Ñáñez',
      }),
      expect.anything(),
      'editable'
    );
    fireEvent.change(physician, { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'PDF imprimible' }));
    });
    expect(props.onGeneratePdf).toHaveBeenLastCalledWith(
      expect.objectContaining({
        p2_nombre_medico: '',
        p1_medico_autorizado: '',
        p3_medico_declaracion: '',
      }),
      expect.anything(),
      'print'
    );
  });

  it.each([
    ['p2_nombre_paciente', 'p1_nombre_pasajero'],
    ['p2_edad', 'p1_edad'],
    ['p1_medico_autorizado', 'p2_nombre_medico'],
    ['p3_medico_declaracion', 'p2_nombre_medico'],
  ])('focuses the shared control when opening alias %s in the dictionary', (alias, canonical) => {
    setup();
    openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Variables' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar variable' }), {
      target: { value: alias },
    });
    fireEvent.click(within(screen.getByRole('table')).getByRole('button'));
    expect(screen.getByRole('tab', { name: 'Formulario' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(document.getElementById(`medif-${canonical}`)).toHaveFocus();
    expect(document.getElementById(`medif-${alias}`)).not.toBeInTheDocument();
  });

  it.each([
    ['p1_seguro_viaje', 'p1_seguro_viaje'],
    ['p2_estable_no', 'p2_estable_si'],
  ])(
    'opens the visibility preference for hidden variable %s without enabling it',
    (fieldId, preferenceId) => {
      window.localStorage.clear();
      setup();
      openSettings();
      fireEvent.click(screen.getByRole('tab', { name: 'Variables' }));
      fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar variable' }), {
        target: { value: fieldId },
      });
      fireEvent.click(within(screen.getByRole('table')).getByRole('button'));
      expect(screen.getByRole('tab', { name: 'Preferencias' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByRole('searchbox', { name: 'Buscar campo o sección' })).toHaveValue(
        preferenceId
      );
      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toHaveAttribute('id', `medif-preference-${preferenceId}`);
      expect(checkbox).toHaveFocus();
      expect(checkbox).not.toBeChecked();
      expect(window.localStorage.getItem(MEDIF_PREFERENCES_STORAGE_KEY)).toBeNull();
      openSettings();
      fireEvent.click(screen.getByRole('tab', { name: 'Formulario' }));
      expect(document.getElementById(`medif-${fieldId}`)).not.toBeInTheDocument();
    }
  );

  it('ignores delayed preference imports after manual changes or showing all fields', async () => {
    setup();
    openSettings();
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
    openSettings();
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
    openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Formulario' }));
    await act(async () => {
      resolveRead(JSON.stringify({ version: 1, hiddenFieldIds: ['p1_seguro_viaje'] }));
    });
    expect(screen.getByLabelText(/Seguro de viaje/)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(MEDIF_PREFERENCES_STORAGE_KEY)!)).toEqual(
      emptyMedifPreferences()
    );
  });

  it('guards browser navigation only while the draft contains data and removes the guard on unmount', () => {
    const { unmount } = setup();
    const insurance = within(
      screen.getByRole('group', { name: 'Datos del pasajero' })
    ).getByLabelText(/Seguro de viaje/);
    const navigationIsPrevented = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(navigationIsPrevented()).toBe(false);
    fireEvent.change(insurance, {
      target: { value: 'Borrador sin descargar' },
    });
    expect(navigationIsPrevented()).toBe(true);
    fireEvent.change(insurance, { target: { value: '' } });
    expect(navigationIsPrevented()).toBe(false);
    fireEvent.change(insurance, {
      target: { value: 'Borrador sin descargar' },
    });
    unmount();
    expect(navigationIsPrevented()).toBe(false);
  });

  it('confirms replacement when the user edits while a draft file is still being read', async () => {
    setup();
    const insurance = within(
      screen.getByRole('group', { name: 'Datos del pasajero' })
    ).getByLabelText(/Seguro de viaje/);
    let resolveRead!: (text: string) => void;
    const read = new Promise<string>(resolve => {
      resolveRead = resolve;
    });
    const file = new File([], 'draft.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => read });
    fireEvent.change(screen.getByLabelText('Archivo de borrador MEDIF'), {
      target: { files: [file] },
    });
    fireEvent.change(insurance, {
      target: { value: 'Dato escrito mientras lee' },
    });
    await act(async () => {
      resolveRead(JSON.stringify({ version: 1, values: { p1_seguro_viaje: 'Importado' } }));
      await read;
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(insurance).toHaveValue('Dato escrito mientras lee');
    fireEvent.click(screen.getByRole('button', { name: 'Conservar formulario' }));
    expect(insurance).toHaveValue('Dato escrito mientras lee');
  });

  it('ignores an older import that finishes after a newer draft has loaded', async () => {
    setup();
    const upload = screen.getByLabelText('Archivo de borrador MEDIF');
    const insurance = within(
      screen.getByRole('group', { name: 'Datos del pasajero' })
    ).getByLabelText(/Seguro de viaje/);
    let resolveOlder!: (text: string) => void;
    let resolveNewer!: (text: string) => void;
    const olderRead = new Promise<string>(resolve => {
      resolveOlder = resolve;
    });
    const newerRead = new Promise<string>(resolve => {
      resolveNewer = resolve;
    });
    const older = new File([], 'older.json', { type: 'application/json' });
    const newer = new File([], 'newer.json', { type: 'application/json' });
    const readOlder = vi.fn(() => olderRead);
    const readNewer = vi.fn(() => newerRead);
    Object.defineProperty(older, 'text', { value: readOlder });
    Object.defineProperty(newer, 'text', { value: readNewer });
    fireEvent.change(upload, { target: { files: [older] } });
    fireEvent.change(upload, { target: { files: [newer] } });
    expect(readOlder).toHaveBeenCalledOnce();
    expect(readNewer).toHaveBeenCalledOnce();
    expect(insurance).toHaveValue('');

    // Resolve the second read first and flush React before inspecting its controlled input.
    await act(async () => {
      resolveNewer(
        JSON.stringify({ version: 1, values: { p1_seguro_viaje: 'Borrador más reciente' } })
      );
      await newerRead;
    });
    expect(insurance).toHaveValue('Borrador más reciente');
    await act(async () => {
      resolveOlder(JSON.stringify({ version: 1, values: { p1_seguro_viaje: 'Borrador antiguo' } }));
      await olderRead;
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(insurance).toHaveValue('Borrador más reciente');
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
    expect(document.getElementById('medif-p2_nombre_paciente')).not.toBeInTheDocument();
    fireEvent.change(document.getElementById('medif-p1_edad')!, {
      target: { value: '7 meses' },
    });
    expect(document.getElementById('medif-p2_edad')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Asistencia y acompañante/ }));
    const wheelchair = screen.getByRole('group', {
      name: '¿Necesita silla de ruedas? · Declaración del pasajero',
    });
    expect(within(wheelchair).getByRole('radio', { name: 'Sí' })).not.toBeChecked();
    expect(within(wheelchair).getByRole('radio', { name: 'No' })).not.toBeChecked();
    fireEvent.click(within(wheelchair).getByRole('radio', { name: 'Sí' }));
    fireEvent.click(within(wheelchair).getByRole('radio', { name: 'No' }));
    fireEvent.click(screen.getByRole('button', { name: 'PDF imprimible' }));
    await waitFor(() => expect(props.onGeneratePdf).toHaveBeenCalledOnce());
    expect(props.onGeneratePdf.mock.calls[0][0]).toMatchObject({
      p1_nombre_pasajero: 'Paciente manual de prueba',
      p2_nombre_paciente: 'Paciente manual de prueba',
      p1_edad: '7 meses',
      p2_edad: '7 meses',
      p3_silla_ruedas_si: '',
      p3_silla_ruedas_no: '',
      p1_silla_si: '',
      p1_silla_no: 'X',
    });
    expect(props.onGeneratePdf.mock.calls[0][2]).toBe('print');
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('requires explicit replacement and never mixes data between census patients or manual entry', () => {
    setup();
    const origin = screen.getByLabelText('Origen de los datos');
    const passenger = within(screen.getByRole('group', { name: 'Datos del pasajero' }));
    const name = passenger.getByLabelText(/Nombre completo/);
    const insurance = passenger.getByLabelText(/Seguro de viaje/);
    fireEvent.change(origin, { target: { value: 'bed-1' } });
    fireEvent.change(insurance, {
      target: { value: 'POLIZA-SOLO-A' },
    });
    fireEvent.change(origin, { target: { value: 'bed-2' } });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(name).toHaveValue('Paciente de prueba A');
    fireEvent.click(screen.getByRole('button', { name: 'Conservar formulario' }));
    expect(origin).toHaveValue('bed-1');
    fireEvent.change(origin, { target: { value: 'bed-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reemplazar todos los datos' }));
    expect(name).toHaveValue('Paciente de prueba B');
    expect(insurance).toHaveValue('');
    fireEvent.change(origin, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reemplazar todos los datos' }));
    expect(name).toHaveValue('');
    expect(document.getElementById('medif-p2_nombre_paciente')).not.toBeInTheDocument();
  });

  it('persists visibility only and allows hidden fields to be restored without losing the current draft', async () => {
    const { props, unmount } = setup();
    openSettings();
    const tabs = within(screen.getByRole('tablist', { name: 'Vistas de MEDIF' }));
    const formTab = tabs.getByRole('tab', { name: 'Formulario' });
    const preferencesTab = tabs.getByRole('tab', { name: 'Preferencias' });
    fireEvent.change(screen.getByLabelText(/Seguro de viaje/), {
      target: { value: 'VALOR-PRIVADO-PRUEBA' },
    });
    fireEvent.click(preferencesTab);
    fireEvent.click(screen.getByRole('checkbox', { name: /Seguro de viaje/ }));
    const saved = window.localStorage.getItem(MEDIF_PREFERENCES_STORAGE_KEY);
    expect(saved).toContain('p1_seguro_viaje');
    expect(saved).not.toContain('VALOR-PRIVADO-PRUEBA');
    fireEvent.click(formTab);
    expect(screen.queryByLabelText(/Seguro de viaje/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PDF editable' }));
    await waitFor(() => expect(props.onGeneratePdf).toHaveBeenCalledOnce());
    expect(props.onGeneratePdf.mock.calls[0][1].hiddenFieldIds).toContain('p1_seguro_viaje');
    fireEvent.click(preferencesTab);
    fireEvent.click(screen.getByRole('checkbox', { name: /Seguro de viaje/ }));
    fireEvent.click(formTab);
    expect(screen.getByLabelText(/Seguro de viaje/)).toHaveValue('VALOR-PRIVADO-PRUEBA');
    fireEvent.click(preferencesTab);
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

  it('closes configuration back to the form without erasing values', () => {
    setup();
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del médico tratante' }), {
      target: { value: 'Dra. Prueba' },
    });
    openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Variables' }));
    fireEvent.click(screen.getByRole('button', { name: 'Configurar MEDIF' }));
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configurar MEDIF' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getByRole('textbox', { name: 'Nombre del médico tratante' })).toHaveValue(
      'Dra. Prueba'
    );
  });

  it('supports keyboard tabs and searchable documentation for all PDF variables', () => {
    setup();
    openSettings();
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
