// @vitest-environment jsdom
/**
 * Origen del paciente en la solicitud de exámenes.
 *
 * Antes esta lógica vivía comprimida dentro del Centro de Laboratorio, en ternarios
 * encadenados de varios cientos de caracteres y sin cobertura propia. Estas pruebas fijan
 * las reglas que importan clínicamente: qué paciente se imprime y cuándo se puede imprimir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/hhr-lab-request-patient.js';

type Controller = {
  printablePatient: () => Record<string, string> | null;
  usesManualPatient: () => boolean;
  refresh: () => void;
  summaryText: () => string;
};

type Owner = {
  sectionHtml: (encId: string) => string;
  hasEpisode: (encId: string) => boolean;
  createController: (options: {
    main: HTMLElement;
    readEpisodePatient?: () => {
      patient: Record<string, string>;
      view?: Record<string, string>;
    } | null;
    onChange?: () => void;
  }) => Controller;
};

const owner = () => (globalThis as unknown as { HhrLabRequestPatient: Owner }).HhrLabRequestPatient;

const mount = (encId: string): HTMLElement => {
  const main = document.createElement('div');
  main.innerHTML = owner().sectionHtml(encId);
  document.body.replaceChildren(main);
  return main;
};

const setManual = (main: HTMLElement, key: string, value: string): void => {
  const field = main.querySelector<HTMLInputElement>(`[data-manual="${key}"]`);
  if (!field) throw new Error(`Falta el campo ${key}`);
  field.value = value;
};

const chooseSource = (main: HTMLElement, value: 'current' | 'manual'): void => {
  const input = main.querySelector<HTMLInputElement>(
    `input[name="hhr-labreq-patient-source"][value="${value}"]`
  );
  if (!input) throw new Error(`Falta el origen ${value}`);
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('origen del paciente en la solicitud de exámenes', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('con episodio abierto parte usando el paciente de Eloísa', () => {
    const main = mount('141121');
    const current = main.querySelector<HTMLInputElement>('input[value="current"]');
    const manual = main.querySelector<HTMLInputElement>('input[value="manual"]');

    expect(current?.checked).toBe(true);
    expect(current?.disabled).toBe(false);
    expect(manual?.checked).toBe(false);
    expect(main.querySelector<HTMLElement>('.hhr-labreq-manual-fields')?.hidden).toBe(true);
  });

  it('sin episodio obliga al paciente escrito a mano y no ofrece el de Eloísa', () => {
    const main = mount('');
    const current = main.querySelector<HTMLInputElement>('input[value="current"]');

    expect(current?.disabled).toBe(true);
    expect(main.querySelector<HTMLInputElement>('input[value="manual"]')?.checked).toBe(true);
    expect(main.querySelector<HTMLElement>('.hhr-labreq-manual-fields')?.hidden).toBe(false);
  });

  it('no entrega un paciente manual mientras falte el nombre', () => {
    const main = mount('');
    const controller = owner().createController({ main });

    expect(controller.printablePatient()).toBeNull();

    setManual(main, 'run', '12.345.678-5');
    expect(controller.printablePatient()).toBeNull();

    setManual(main, 'name', 'Paciente De Prueba');
    expect(controller.printablePatient()).toMatchObject({
      name: 'Paciente De Prueba',
      run: '12.345.678-5',
    });
  });

  it('usa los datos del episodio y nunca los mezcla con los escritos a mano', () => {
    const main = mount('141121');
    const controller = owner().createController({
      main,
      readEpisodePatient: () => ({
        patient: {
          name: 'Paciente Del Episodio',
          formattedRun: '9.876.543-2',
          diagnosis: 'Neumonía',
        },
        view: { nacimiento: '01-01-1970' },
      }),
    });

    setManual(main, 'name', 'Otro Nombre Escrito');

    expect(controller.printablePatient()).toEqual({
      name: 'Paciente Del Episodio',
      run: '9.876.543-2',
      birthDate: '01-01-1970',
      diagnosis: 'Neumonía',
      ficha: '',
    });

    chooseSource(main, 'manual');
    expect(controller.printablePatient()).toMatchObject({ name: 'Otro Nombre Escrito' });
  });

  it('no promete un paciente de Eloísa que todavía no llegó', () => {
    const main = mount('141121');
    const controller = owner().createController({ main, readEpisodePatient: () => null });

    expect(controller.printablePatient()).toBeNull();
    expect(controller.summaryText()).toContain('Cargando');
  });

  it('avisa al controlador cada vez que cambia el origen', () => {
    const main = mount('141121');
    const onChange = vi.fn();
    owner().createController({ main, readEpisodePatient: () => null, onChange });

    chooseSource(main, 'manual');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(main.querySelector<HTMLElement>('.hhr-labreq-manual-fields')?.hidden).toBe(false);

    chooseSource(main, 'current');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(main.querySelector<HTMLElement>('.hhr-labreq-manual-fields')?.hidden).toBe(true);
  });

  it('trata un campo ausente como vacío en vez de romper la pantalla', () => {
    const main = mount('');
    main.querySelector('[data-manual="run"]')?.remove();
    const controller = owner().createController({ main });

    setManual(main, 'name', 'Paciente Sin Campo RUT');
    expect(() => controller.printablePatient()).not.toThrow();
    expect(controller.printablePatient()).toMatchObject({
      name: 'Paciente Sin Campo RUT',
      run: '',
    });
  });
});
