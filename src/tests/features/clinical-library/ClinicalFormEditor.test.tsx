import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalFormEditor } from '@/features/clinical-library/components/tools/forms/ClinicalFormEditor';
import { CLINICAL_FORMS } from '@/features/clinical-library/domain/forms/clinicalFormCatalog';
import type {
  ClinicalFormId,
  ClinicalFormPatientOption,
} from '@/features/clinical-library/domain/forms/clinicalFormTypes';

const source = (name: string, key = name): ClinicalFormPatientOption => ({
  key,
  label: `R1 — ${name}`,
  values: {
    paciente_nombre_completo: name,
    paciente_rut: '11.111.111-1',
    paciente_documento_numero: '11.111.111-1',
    paciente_documento_tipo: 'RUT',
    diagnostico_texto: 'DIAGNÓSTICO PRUEBA',
    ingreso_fecha: '2026-10-13',
  },
  provenance: {},
  context: {
    recordDate: '2026-10-16',
    bedId: 'R1',
    location: 'bed',
    episodeId: key,
    identity: name,
    sourceLastUpdated: '2026-10-16T12:00:00Z',
  },
});
const patients = [source('ALFA'), source('BETA')];
const generate = vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
const mount = (initial: ClinicalFormId = 'consentimiento-informado', options = patients) => {
  function Wrapper({ sources }: { sources: ClinicalFormPatientOption[] }) {
    const [id, setId] = useState(initial);
    return (
      <ClinicalFormEditor
        formId={id}
        onFormChange={setId}
        patients={sources}
        onBack={vi.fn()}
        onClose={vi.fn()}
        onGeneratePdf={generate}
      />
    );
  }
  const view = render(<Wrapper sources={options} />);
  return {
    ...view,
    sources: (next: ClinicalFormPatientOption[]) => view.rerender(<Wrapper sources={next} />),
  };
};

describe('clinical forms editor', () => {
  beforeEach(() => {
    localStorage.clear();
    generate.mockClear();
    URL.createObjectURL = vi.fn(() => 'blob:clinical-form-test');
    URL.revokeObjectURL = vi.fn();
  });

  it('works manually without a bed and commits calendar dates before preparing a PDF', async () => {
    mount('consentimiento-informado', []);
    fireEvent.change(screen.getByLabelText('Nombre y apellidos'), {
      target: { value: 'MANUAL DE PRUEBA' },
    });
    fireEvent.input(screen.getByLabelText('Fecha', { exact: true }), {
      target: { value: '2026-10-16' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Vista previa' }));
    await waitFor(() => expect(generate).toHaveBeenCalledOnce());
    expect(generate.mock.calls[0][1]).toMatchObject({
      paciente_nombre_completo: 'MANUAL DE PRUEBA',
      formulario_fecha_emision: '2026-10-16',
    });
    expect(generate.mock.calls[0][1]).not.toHaveProperty('cama_id');
    await waitFor(() =>
      expect(
        screen.getByTitle('Consentimiento informado general · PDF para imprimir')
      ).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Nombre y apellidos'), {
      target: { value: 'NOMBRE REVISADO' },
    });
    expect(
      screen.queryByTitle('Consentimiento informado general · PDF para imprimir')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled();
  });

  it.each(['census', 'manual'] as const)(
    'offers only VMI patient identification for %s entry and printing',
    async mode => {
      mount('planilla-monitorizacion-ventilatoria', mode === 'manual' ? [] : patients);
      if (mode === 'census') {
        fireEvent.change(screen.getByLabelText('Origen de los datos'), {
          target: { value: 'ALFA' },
        });
      } else {
        fireEvent.change(screen.getByLabelText('Nombre y apellidos'), {
          target: { value: 'ALFA' },
        });
        fireEvent.change(screen.getByLabelText('RUT', { exact: true }), {
          target: { value: '11.111.111-1' },
        });
        fireEvent.input(screen.getByLabelText('Fecha de ingreso'), {
          target: { value: '2026-10-13' },
        });
      }
      expect(screen.getByLabelText('Nombre y apellidos')).toHaveValue('ALFA');
      expect(screen.getByLabelText('RUT', { exact: true })).toHaveValue('11.111.111-1');
      expect(screen.getByLabelText('Fecha de ingreso')).toHaveValue('2026-10-13');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Fecha del registro')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Talla (cm)')).not.toBeInTheDocument();
      expect(screen.queryByText('Turno largo')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Variables y preferencias' }));
      expect(screen.getAllByRole('checkbox')).toHaveLength(3);
      expect(screen.getByRole('checkbox', { name: 'Mostrar Nombre y apellidos' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Mostrar RUT' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Mostrar Fecha de ingreso' })).toBeChecked();
      fireEvent.click(screen.getByRole('button', { name: 'Variables y preferencias' }));
      fireEvent.click(screen.getByRole('button', { name: 'Vista previa' }));
      await waitFor(() => expect(generate).toHaveBeenCalledOnce());
      expect(generate.mock.calls[0][1]).toMatchObject({
        paciente_nombre_completo: 'ALFA',
        paciente_rut: '11.111.111-1',
        ingreso_fecha: '2026-10-13',
      });
    }
  );

  it('shares canonical variables across all nine templates and does not preselect clinical answers', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Origen de los datos'), { target: { value: 'ALFA' } });
    for (const form of CLINICAL_FORMS) {
      fireEvent.change(screen.getByLabelText('Formulario clínico'), { target: { value: form.id } });
      expect(screen.getByRole('heading', { name: form.title })).toBeInTheDocument();
      if (form.fields.some(field => field.id === 'paciente_nombre_completo')) {
        expect(screen.getByLabelText('Nombre y apellidos')).toHaveValue('ALFA');
      }
      expect(screen.getByLabelText('Origen de los datos')).toHaveValue('ALFA');
      expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
    }
  });

  it('requires a deliberate replacement before changing patients or starting a blank manual form', () => {
    mount('encuesta-contraste');
    fireEvent.change(screen.getByLabelText('Origen de los datos'), { target: { value: 'ALFA' } });
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '000000000' } });
    fireEvent.change(screen.getByLabelText('Origen de los datos'), { target: { value: 'BETA' } });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Conservar formulario' }));
    expect(screen.getByLabelText('Nombre y apellidos')).toHaveValue('ALFA');
    fireEvent.change(screen.getByLabelText('Origen de los datos'), { target: { value: 'BETA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reemplazar datos' }));
    expect(screen.getByLabelText('Nombre y apellidos')).toHaveValue('BETA');
    expect(screen.getByLabelText('Teléfono')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Origen de los datos'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reemplazar datos' }));
    expect(screen.getByLabelText('Nombre y apellidos')).toHaveValue('');
  });

  it('keeps the issue date per document while sharing the patient identity', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Nombre y apellidos'), { target: { value: 'PRUEBA' } });
    fireEvent.input(screen.getByLabelText('Fecha', { exact: true }), {
      target: { value: '2026-10-16' },
    });
    fireEvent.change(screen.getByLabelText('Formulario clínico'), {
      target: { value: 'solicitud-laboratorio-policlinico' },
    });
    expect(screen.getByLabelText('Nombre y apellidos')).toHaveValue('PRUEBA');
    expect(screen.getByLabelText('Fecha de solicitud')).toHaveValue('');
    fireEvent.input(screen.getByLabelText('Fecha de solicitud'), {
      target: { value: '2026-10-17' },
    });
    fireEvent.change(screen.getByLabelText('Formulario clínico'), {
      target: { value: 'consentimiento-informado' },
    });
    expect(screen.getByLabelText('Fecha', { exact: true })).toHaveValue('2026-10-16');
  });

  it('keeps edited answers on refresh and blocks printing when the episode disappears', async () => {
    const view = mount('encuesta-contraste');
    fireEvent.change(screen.getByLabelText('Origen de los datos'), { target: { value: 'ALFA' } });
    fireEvent.change(screen.getByLabelText('Nombre y apellidos'), { target: { value: 'EDITADO' } });
    fireEvent.click(screen.getByRole('button', { name: '¿Tiene alguna alergia?: No' }));
    const updated = {
      ...patients[0],
      values: { ...patients[0].values, diagnostico_texto: 'CAMBIO DEL CENSO' },
    };
    view.sources([updated, patients[1]]);
    expect(screen.getByRole('button', { name: 'Vista previa' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Completar sólo vacíos' }));
    expect(screen.getByLabelText('Nombre y apellidos')).toHaveValue('EDITADO');
    expect(screen.getByRole('button', { name: '¿Tiene alguna alergia?: No' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    view.sources([source('OTRO', 'new-episode')]);
    expect(screen.getByRole('alert')).toHaveTextContent('episodio');
    expect(screen.getByRole('button', { name: 'PDF imprimible' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'continuar como borrador manual' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vista previa' }));
    await waitFor(() => expect(generate).toHaveBeenCalledOnce());
    expect(generate.mock.calls[0][1].contraste_alergia).toBe(false);
  });

  it('hides a populated variable via preferences while keeping its draft value', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Origen de los datos'), { target: { value: 'ALFA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Variables y preferencias' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar Nombre y apellidos' }));
    const stored = Array.from({ length: localStorage.length }, (_, i) =>
      localStorage.getItem(localStorage.key(i)!)
    ).join('');
    expect(stored).not.toContain('ALFA');
    expect(stored).toContain('paciente_nombre_completo');
    fireEvent.click(screen.getByRole('button', { name: 'Variables y preferencias' }));
    expect(screen.queryByLabelText('Nombre y apellidos')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vista previa' }));
    await waitFor(() => expect(generate).toHaveBeenCalledOnce());
    expect(generate.mock.calls[0][1].paciente_nombre_completo).toBe('ALFA');
    expect(generate.mock.calls[0][2]).toContain('paciente_nombre_completo');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Variables y preferencias' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Variables y preferencias' }));
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Variables y preferencias' })).getByRole(
        'checkbox',
        { name: 'Mostrar Nombre y apellidos' }
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Variables y preferencias' }));
    expect(screen.getByLabelText('Nombre y apellidos')).toHaveValue('ALFA');
  });

  it('does not request a clinical review for an unrelated technical census update', () => {
    const view = mount();
    fireEvent.change(screen.getByLabelText('Origen de los datos'), { target: { value: 'ALFA' } });
    view.sources([
      {
        ...patients[0],
        values: { ...patients[0].values, censo_actualizado_en: '2026-10-16T13:00:00Z' },
      },
      patients[1],
    ]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vista previa' })).toBeEnabled();
  });
});
