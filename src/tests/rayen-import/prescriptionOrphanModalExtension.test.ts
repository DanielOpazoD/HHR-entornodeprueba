// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/hhr-prescription-ui-lifecycle.js';
import { cleanupContent } from './prescriptionContentHarness';

describe('orphaned clinical modal recovery', () => {
  afterEach(cleanupContent);

  it('preserva el modal previo y reintenta al cerrarlo', async () => {
    document.body.innerHTML = '<div id="hhr-prescription-print-modal"></div>';
    const runtime = (
      globalThis as typeof globalThis & {
        HhrPrescriptionUiLifecycle: {
          create: () => {
            preparePrevious: () => boolean;
            waitForModalClosure: (callback: () => void) => void;
          };
        };
      }
    ).HhrPrescriptionUiLifecycle.create();
    expect(runtime.preparePrevious()).toBe(false);
    const retry = vi.fn();
    runtime.waitForModalClosure(retry);
    expect(retry).not.toHaveBeenCalled();
    document.body.innerHTML = '';
    await vi.waitFor(() => expect(retry).toHaveBeenCalledOnce());
    expect(runtime.preparePrevious()).toBe(true);
  });

  it('retira un diagnóstico de conexión huérfano sin bloquear la nueva interfaz', () => {
    document.body.innerHTML =
      '<div id="hhr-prescription-print-modal" data-active-module="connection"></div>' +
      '<aside id="hhr-clinical-operations-bar"></aside>';
    const runtime = (
      globalThis as typeof globalThis & {
        HhrPrescriptionUiLifecycle: { create: () => { preparePrevious: () => boolean } };
      }
    ).HhrPrescriptionUiLifecycle.create();
    expect(runtime.preparePrevious()).toBe(true);
    expect(document.getElementById('hhr-prescription-print-modal')).toBeNull();
    expect(document.getElementById('hhr-clinical-operations-bar')).toBeNull();
  });

  it('reintenta liberar una interfaz anterior cuando el panel de conexión la bloquea', () => {
    document.body.innerHTML =
      '<div id="hhr-prescription-print-modal" data-active-module="connection"></div>';
    const dispose = vi.fn(() => !document.getElementById('hhr-prescription-print-modal'));
    (
      globalThis as typeof globalThis & {
        __hhrPrescriptionPrintRuntime?: { dispose: () => boolean };
      }
    ).__hhrPrescriptionPrintRuntime = { dispose };
    const runtime = (
      globalThis as typeof globalThis & {
        HhrPrescriptionUiLifecycle: { create: () => { preparePrevious: () => boolean } };
      }
    ).HhrPrescriptionUiLifecycle.create();
    expect(runtime.preparePrevious()).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(document.getElementById('hhr-prescription-print-modal')).toBeNull();
  });

  it('continúa si la interfaz previa no puede disponer sus controles y no hay edición clínica', () => {
    document.body.innerHTML = '<aside id="hhr-clinical-operations-bar"></aside>';
    const dispose = vi.fn(() => {
      throw new Error('old extension context invalidated');
    });
    (
      globalThis as typeof globalThis & {
        __hhrPrescriptionPrintRuntime?: { dispose: () => boolean };
      }
    ).__hhrPrescriptionPrintRuntime = { dispose };
    const runtime = (
      globalThis as typeof globalThis & {
        HhrPrescriptionUiLifecycle: { create: () => { preparePrevious: () => boolean } };
      }
    ).HhrPrescriptionUiLifecycle.create();
    expect(runtime.preparePrevious()).toBe(true);
    expect(document.getElementById('hhr-clinical-operations-bar')).toBeNull();
  });

  it('conserva un formulario clínico si falla la disposición del contexto anterior', () => {
    document.body.innerHTML =
      '<div id="hhr-prescription-print-modal" data-active-module="vitals"></div>';
    (
      globalThis as typeof globalThis & {
        __hhrPrescriptionPrintRuntime?: { dispose: () => boolean };
      }
    ).__hhrPrescriptionPrintRuntime = {
      dispose: () => {
        throw new Error('old context');
      },
    };
    const runtime = (
      globalThis as typeof globalThis & {
        HhrPrescriptionUiLifecycle: { create: () => { preparePrevious: () => boolean } };
      }
    ).HhrPrescriptionUiLifecycle.create();
    expect(runtime.preparePrevious()).toBe(false);
    expect(document.getElementById('hhr-prescription-print-modal')).not.toBeNull();
  });
});
