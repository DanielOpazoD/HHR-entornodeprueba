// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/hhr-medication-actions-runtime.js';

type MedicationActionsRuntime = {
  findPharmaHeading: () => Element | null;
  downloadIndications: (encId: string, button: HTMLButtonElement) => Promise<void>;
  hasVisibleNursingRole: () => boolean;
  findToolbarAnchor: (heading: Element) => Element;
  createRegimenQuickDialog: () => void;
  readFavorites: () => Promise<Array<{ name: string; url: string }> | null | undefined>;
  writeFavorites: (list: Array<{ name: string; url: string }>) => Promise<boolean>;
  normalizeFavoriteUrl: (raw: string) => string;
  createFavoritesDialog: () => void;
};

type MedicationActionsOwner = {
  create: (dependencies: Record<string, unknown>) => MedicationActionsRuntime;
};

const owner = () =>
  (globalThis as typeof globalThis & { HhrMedicationActionsRuntime: MedicationActionsOwner })
    .HhrMedicationActionsRuntime;

const normalizedText = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const makeRuntime = (options: {
  currentEncounter?: string;
  sendMessage?: (message: Record<string, unknown>) => Promise<Record<string, unknown>>;
  storedFavorites?: Array<{ name: string; url: string }> | null;
  storageReadError?: boolean;
  storageWriteError?: boolean;
} = {}) => {
  const writes: Array<Array<{ name: string; url: string }>> = [];
  const feedback = vi.fn();
  const liveRegion = vi.fn((element: HTMLElement, text: string, state = '') => {
    element.textContent = text;
    element.dataset.state = state;
  });
  const runtimeState: { lastError?: { message: string } } = {};
  const chromeApi = {
    runtime: runtimeState,
    storage: {
      local: {
        get: vi.fn((_key: string, callback: (stored: Record<string, unknown>) => void) => {
          if (options.storageReadError) runtimeState.lastError = { message: 'read failed' };
          callback(
            options.storedFavorites === null
              ? {}
              : { hhrFavorites: options.storedFavorites || [] }
          );
          delete runtimeState.lastError;
        }),
        set: vi.fn(
          (
            stored: { hhrFavorites: Array<{ name: string; url: string }> },
            callback: () => void
          ) => {
            writes.push(stored.hhrFavorites.map(item => ({ ...item })));
            if (options.storageWriteError) runtimeState.lastError = { message: 'write failed' };
            callback();
            delete runtimeState.lastError;
          }
        ),
      },
    },
  };
  const runtime = owner().create({
    documentRef: document,
    windowRef: window,
    chromeApi,
    modalId: 'hhr-prescription-print-modal',
    normalizedText,
    currentRouteEncounterId: () => options.currentEncounter || '141',
    createFeedbackModal: feedback,
    sendMessage: options.sendMessage || vi.fn(async () => ({})),
    runtimeMessages: {
      INDICATIONS_PRINT_REQUEST: 'RAYEN_INDICATIONS_PRINT_REQUEST',
      HOSPITALIZED_REGIMEN_OPTIONS_REQUEST: 'RAYEN_HOSPITALIZED_REGIMEN_OPTIONS_REQUEST',
      HOSPITALIZED_REGIMEN_PRINT_REQUEST: 'RAYEN_HOSPITALIZED_REGIMEN_PRINT_REQUEST',
    },
    closeModal: () => true,
    ensureStyles: vi.fn(),
    modalDismissWithFocusRestore: (root: HTMLElement, target: Element | null) => () => {
      root.remove();
      if (target instanceof HTMLElement) target.focus();
    },
    trapModalFocus: vi.fn(),
    setLiveRegion: liveRegion,
  });
  return { runtime, feedback, liveRegion, chromeApi, writes };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('HHR medication actions runtime', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('owns medication behavior, fails closed and loads before its consumer', () => {
    const runtimeSource = readFileSync(
      path.resolve('extension/hhr-medication-actions-runtime.js'),
      'utf8'
    );
    const contentSource = readFileSync(
      path.resolve('extension/content-prescription-print.js'),
      'utf8'
    );
    const manifest = JSON.parse(
      readFileSync(path.resolve('extension/manifest.json'), 'utf8')
    ) as { content_scripts: Array<{ matches?: string[]; js?: string[] }> };
    const scripts = manifest.content_scripts
      .filter(entry => entry.matches?.includes('https://fichamedico.rayensalud.cl/*'))
      .flatMap(entry => entry.js || []);

    expect(Object.isFrozen(owner())).toBe(true);
    expect(() => owner().create({})).toThrow(
      'No se pudo inicializar el runtime de acciones de medicación HHR.'
    );
    expect(scripts.indexOf('hhr-medication-actions-runtime.js')).toBeGreaterThanOrEqual(0);
    expect(scripts.indexOf('hhr-medication-actions-runtime.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
    expect(contentSource).toContain('const medicationActionsOwner = globalThis.HhrMedicationActionsRuntime');
    expect(contentSource).toContain('!medicationActionsOwner ||');
    expect(contentSource).toContain('medicationActionsOwner.create({');
    [
      'const findPharmaHeading =',
      'const downloadIndications =',
      'const hasVisibleNursingRole =',
      'const findToolbarAnchor =',
      'const createRegimenQuickDialog =',
      "const FAVORITES_STORAGE_KEY = 'hhrFavorites'",
      'const createFavoritesDialog =',
    ].forEach(definition => {
      expect(runtimeSource).toContain(definition);
      expect(contentSource).not.toContain(definition);
    });
  });

  it('detects the nursing medication view and preserves indications route safety', async () => {
    document.body.innerHTML = `
      <span>Enfermera(o)</span>
      <section class="MuiPaper-root">
        <h2><span>Fármacos</span></h2>
        <label><input type="checkbox"> Mostrar Suspendidos</label>
      </section>
    `;
    let finishRequest: ((result: Record<string, unknown>) => void) | undefined;
    const sendMessage = vi.fn(
      () => new Promise<Record<string, unknown>>(resolve => { finishRequest = resolve; })
    );
    const { runtime, feedback } = makeRuntime({ sendMessage });
    const heading = runtime.findPharmaHeading();
    const button = document.createElement('button');

    expect(heading?.tagName).toBe('SPAN');
    expect(runtime.hasVisibleNursingRole()).toBe(true);
    expect(runtime.findToolbarAnchor(heading as Element).tagName).toBe('LABEL');
    const pending = runtime.downloadIndications('141', button);
    expect(button.disabled).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'RAYEN_INDICATIONS_PRINT_REQUEST',
      encId: '141',
    });
    finishRequest?.({ ok: true });
    await pending;
    expect(button.disabled).toBe(false);
    expect(feedback).toHaveBeenLastCalledWith({
      title: 'Indicaciones',
      message: 'PDF de indicaciones descargado. Ábrelo desde Descargas para imprimir.',
    });

    const stale = makeRuntime({ currentEncounter: '999', sendMessage });
    await stale.runtime.downloadIndications('141', button);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(stale.feedback).toHaveBeenCalledWith(
      expect.objectContaining({ error: true, title: 'Indicaciones' })
    );
  });

  it('keeps the regimen dialog contract and re-enables consecutive printing', async () => {
    const sendMessage = vi.fn(async message => {
      if (message.type === 'RAYEN_HOSPITALIZED_REGIMEN_OPTIONS_REQUEST') {
        return {
          patients: [{ regimen: true, braden: true }, { regimen: false, braden: true }],
          regimenCount: 1,
          bradenCount: 2,
          regimenErrorCount: 0,
          unavailableCount: 0,
        };
      }
      return { count: 2, regimenCount: 1, bradenCount: 2 };
    });
    const { runtime, liveRegion } = makeRuntime({ sendMessage });

    runtime.createRegimenQuickDialog();
    await flushPromises();
    const root = document.getElementById('hhr-prescription-print-modal') as HTMLElement;
    const submit = root.querySelector('.hhr-rx-submit') as HTMLButtonElement;
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    expect(root.textContent).toContain('2 pacientes hospitalizados');
    expect(root.textContent).toContain('1 con régimen vigente');
    expect(root.textContent).toContain('2 con BRADEN');
    expect(submit.disabled).toBe(false);

    submit.click();
    await flushPromises();
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'RAYEN_HOSPITALIZED_REGIMEN_PRINT_REQUEST',
    });
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe('Imprimir nuevamente');
    submit.click();
    await flushPromises();
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'RAYEN_HOSPITALIZED_REGIMEN_PRINT_REQUEST',
    });
    expect(liveRegion).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'Se abrió el régimen integrado de 2 pacientes: 1 con régimen vigente y 2 con BRADEN disponible.'
    );
  });

  it('preserves favorites storage, validation, rendering and listeners', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { runtime, liveRegion, writes } = makeRuntime({
      storedFavorites: [{ name: 'Guía', url: 'https://example.test/guia' }],
    });

    expect(runtime.normalizeFavoriteUrl('example.com')).toBe('https://example.com/');
    expect(runtime.normalizeFavoriteUrl('javascript:alert(1)')).toBe('');
    runtime.createFavoritesDialog();
    await flushPromises();
    const root = document.getElementById('hhr-prescription-print-modal') as HTMLElement;
    expect(root.dataset.routeIndependent).toBe('true');
    (root.querySelector('.hhr-fav-open') as HTMLButtonElement).click();
    expect(open).toHaveBeenCalledWith('https://example.test/guia', '_blank', 'noopener');

    const name = root.querySelector('.hhr-fav-name') as HTMLInputElement;
    const url = root.querySelector('.hhr-fav-url') as HTMLInputElement;
    const add = root.querySelector('.hhr-fav-add') as HTMLButtonElement;
    url.value = 'https://[invalido';
    add.click();
    expect(liveRegion).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      'Ingresa una dirección web válida (http o https).',
      'error'
    );

    name.value = 'Portal';
    url.value = 'portal.test';
    add.click();
    await flushPromises();
    expect(writes.at(-1)).toEqual([
      { name: 'Guía', url: 'https://example.test/guia' },
      { name: 'Portal', url: 'https://portal.test/' },
    ]);
    expect(document.activeElement).toBe(name);
    expect(root.querySelectorAll('.hhr-fav-row')).toHaveLength(2);

    (root.querySelector('.hhr-fav-remove') as HTMLButtonElement).click();
    await flushPromises();
    expect(root.querySelectorAll('.hhr-fav-row')).toHaveLength(1);
    expect(writes.at(-1)).toEqual([{ name: 'Portal', url: 'https://portal.test/' }]);
  });

  it('keeps favorites unchanged when storage reads or writes fail', async () => {
    const failedRead = makeRuntime({
      storedFavorites: [{ name: 'Privado', url: 'https://private.test/' }],
      storageReadError: true,
    });
    failedRead.runtime.createFavoritesDialog();
    await flushPromises();
    let root = document.getElementById('hhr-prescription-print-modal') as HTMLElement;
    expect(root.querySelectorAll('.hhr-fav-row')).toHaveLength(0);
    expect(failedRead.writes).toHaveLength(0);
    expect(failedRead.liveRegion).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'No se pudieron leer los favoritos guardados.',
      'error'
    );

    root.remove();
    const failedWrite = makeRuntime({
      storedFavorites: [{ name: 'Guía', url: 'https://example.test/guia' }],
      storageWriteError: true,
    });
    failedWrite.runtime.createFavoritesDialog();
    await flushPromises();
    root = document.getElementById('hhr-prescription-print-modal') as HTMLElement;
    const name = root.querySelector('.hhr-fav-name') as HTMLInputElement;
    const url = root.querySelector('.hhr-fav-url') as HTMLInputElement;
    name.value = 'Portal';
    url.value = 'portal.test';
    (root.querySelector('.hhr-fav-add') as HTMLButtonElement).click();
    await flushPromises();
    expect(root.querySelectorAll('.hhr-fav-row')).toHaveLength(1);
    expect(name.value).toBe('Portal');
    expect(url.value).toBe('portal.test');
    expect(failedWrite.liveRegion).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      'No se pudo guardar el favorito.',
      'error'
    );

    (root.querySelector('.hhr-fav-remove') as HTMLButtonElement).click();
    await flushPromises();
    expect(root.querySelectorAll('.hhr-fav-row')).toHaveLength(1);
    expect(failedWrite.liveRegion).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      'No se pudo eliminar el favorito.',
      'error'
    );
  });
});
