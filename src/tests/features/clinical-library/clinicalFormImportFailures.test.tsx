import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useClinicalFormDraft } from '@/features/clinical-library/components/tools/forms/useClinicalFormDraft';
import {
  exportClinicalFormDraft,
  importClinicalFormDraft,
} from '@/features/clinical-library/domain/forms/clinicalFormDraft';
import { getClinicalForm } from '@/features/clinical-library/domain/forms/clinicalFormCatalog';
import { parseClinicalFormPreferences } from '@/features/clinical-library/domain/forms/clinicalFormPreferences';
import { emptyClinicalFormPreferences } from '@/features/clinical-library/domain/forms/clinicalFormPreferences';
import { ClinicalFormSettings } from '@/features/clinical-library/components/tools/forms/ClinicalFormSettings';
import type { ClinicalFormPatientOption } from '@/features/clinical-library/domain/forms/clinicalFormTypes';

const form = getClinicalForm('consentimiento-informado');
const source: ClinicalFormPatientOption = {
  key: 'synthetic-episode',
  label: 'Cama sintética',
  provenance: {},
  values: { paciente_nombre_completo: 'PACIENTE SINTÉTICO', ingreso_fecha: '2026-10-20' },
  context: {
    bedId: 'R1',
    recordDate: '2026-10-23',
    location: 'bed',
    identity: 'synthetic-identity',
    episodeId: 'synthetic-episode',
    sourceLastUpdated: '2026-10-23T12:00:00Z',
  },
};
const file = (read: () => Promise<string>) => {
  const upload = new File(['synthetic'], 'borrador.json');
  Object.defineProperty(upload, 'text', { value: read });
  return upload;
};
const valid = exportClinicalFormDraft(form.id, {
  paciente_nombre_completo: 'IMPORTADO',
  consentimiento_decision: false,
});
const mount = () => {
  const changeForm = vi.fn();
  const view = renderHook(() => useClinicalFormDraft(form.id, [source], changeForm));
  act(() => {
    view.result.current.selectPatient(source.key);
    view.result.current.change('consentimiento_decision', false);
  });
  return { ...view, changeForm };
};

describe('clinical form import failures', () => {
  it.each(['', '{', '{"paciente_nombre_completo":"TEXTO SINTÉTICO PRIVADO",}'])(
    'reports malformed JSON without echoing the file contents: %j',
    text => {
      expect(() => importClinicalFormDraft(text)).toThrow(
        'El archivo de borrador no es un JSON válido.'
      );
      expect(() => parseClinicalFormPreferences(text, form)).toThrow(
        'El archivo de preferencias no es un JSON válido.'
      );
    }
  );

  it('bounds direct parsing as well as file upload size', () => {
    expect(() => importClinicalFormDraft(' '.repeat(1_000_001))).toThrow(
      'El borrador es demasiado grande.'
    );
    expect(() => parseClinicalFormPreferences(' '.repeat(100_001), form)).toThrow(
      'El archivo de preferencias es demasiado grande.'
    );
  });

  it.each([
    '{',
    JSON.stringify({ ...JSON.parse(valid), version: 999 }),
    JSON.stringify({ ...JSON.parse(valid), values: { paciente_nombre_completo: 123 } }),
    JSON.stringify({ ...JSON.parse(valid), values: { campo_desconocido: 'PRUEBA' } }),
  ])(
    'keeps the patient, edited answers and form selection intact after rejecting %j',
    async text => {
      const view = mount();
      const before = view.result.current.values;
      await act(async () => {
        await view.result.current.importFile(file(async () => text));
      });
      expect(view.result.current.values).toEqual(before);
      expect(view.result.current.source?.key).toBe(source.key);
      expect(view.result.current.replacement).toBeNull();
      expect(view.changeForm).not.toHaveBeenCalled();
      expect(view.result.current.notice).not.toBe('');
    }
  );

  it('recovers from a file read error and requires confirmation for a subsequent valid import', async () => {
    const view = mount();
    await act(async () => {
      await view.result.current.importFile(
        file(async () => {
          throw new Error('internal file error');
        })
      );
    });
    expect(view.result.current.notice).toBe(
      'No se pudo leer el archivo de borrador. Vuelve a intentarlo.'
    );
    expect(view.result.current.source?.key).toBe(source.key);
    await act(async () => {
      await view.result.current.importFile(file(async () => valid));
    });
    expect(view.result.current.values.paciente_nombre_completo).toBe('PACIENTE SINTÉTICO');
    expect(view.result.current.replacement?.source).toBeNull();
    expect(view.result.current.notice).toBe('');
    act(() => view.result.current.confirmReplacement());
    expect(view.result.current.values.paciente_nombre_completo).toBe('IMPORTADO');
    expect(view.result.current.values.consentimiento_decision).toBe(false);
    expect(view.result.current.source).toBeNull();
    expect(view.result.current.notice).toBe('');
  });

  it('ignores a file that finishes after a later manual edit', async () => {
    const view = mount();
    let finish!: (text: string) => void;
    const reading = new Promise<string>(resolve => {
      finish = resolve;
    });
    let importing!: Promise<void>;
    act(() => {
      importing = view.result.current.importFile(file(() => reading));
    });
    act(() => view.result.current.change('paciente_nombre_completo', 'EDICIÓN POSTERIOR'));
    await act(async () => {
      finish(valid);
      await importing;
    });
    expect(view.result.current.values.paciente_nombre_completo).toBe('EDICIÓN POSTERIOR');
    expect(view.result.current.replacement).toBeNull();
    expect(view.result.current.notice).toBe('');
  });

  it.each(['json', 'version', 'read'] as const)(
    'keeps visibility preferences after a %s error and accepts a valid retry',
    async failure => {
      const preferences = {
        ...emptyClinicalFormPreferences(form),
        hidden: ['paciente_nombre_completo'],
      };
      const onChange = vi.fn();
      const onNotice = vi.fn();
      render(
        <ClinicalFormSettings
          form={form}
          preferences={preferences}
          onChange={onChange}
          onNotice={onNotice}
        />
      );
      const upload = file(async () => {
        if (failure === 'read') throw new Error('internal file failure');
        return failure === 'json' ? '{' : JSON.stringify({ ...preferences, version: 999 });
      });
      fireEvent.change(screen.getByLabelText('Archivo de preferencias del formulario'), {
        target: { files: [upload] },
      });
      await waitFor(() => expect(onNotice).toHaveBeenCalledOnce());
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Mostrar Nombre y apellidos')).not.toBeChecked();
      expect(onNotice.mock.lastCall?.[0]).not.toContain('internal file failure');
      const next = { ...preferences, hidden: [] };
      fireEvent.change(screen.getByLabelText('Archivo de preferencias del formulario'), {
        target: { files: [file(async () => JSON.stringify(next))] },
      });
      await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith(next));
    }
  );
});
