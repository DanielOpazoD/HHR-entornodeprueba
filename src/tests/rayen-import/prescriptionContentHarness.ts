import { readFileSync } from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';

import '../../../extension/message-contract.js';
import '../../../extension/hhr-ui.js';
import '../../../extension/hhr-center-styles.js';
import '../../../extension/hhr-center-shell-runtime.js';
import '../../../extension/hhr-prescription-center.js';
import '../../../extension/hhr-hospitalized-documents-center.js';
import '../../../extension/hhr-handoff-center.js';
import '../../../extension/hhr-scores-presentation.js';
import '../../../extension/hhr-scores-center.js';
import '../../../extension/hhr-lab-request-patient.js';
import '../../../extension/hhr-lab-center.js';
import '../../../extension/hhr-clinical-write-client-runtime.js';
import '../../../extension/hhr-discharge-actions-runtime.js';
import '../../../extension/hhr-medication-actions-runtime.js';
import '../../../extension/hhr-connection-repair-controls.js';
import '../../../extension/hhr-connection-action-model.js';
import '../../../extension/hhr-connection-presentation.js';
import '../../../extension/hhr-connection-center-runtime.js';
import '../../../extension/prescription-print.js';
import '../../../extension/health-push-ordering-runtime.js';
import '../../../extension/hhr-prescription-content-runtime.js';

export const contentSource = readFileSync(
  path.resolve('extension/content-prescription-print.js'),
  'utf8'
);
export const NativeMutationObserver = globalThis.MutationObserver;
export const contentObservers = new Set<MutationObserver>();
const contentTimeouts = new Set<ReturnType<typeof globalThis.setTimeout>>();
const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);

export const setupContent = () => {
  vi.spyOn(window, 'setTimeout').mockImplementation((handler, timeout, ...args) => {
    const timeoutId = nativeSetTimeout(handler, timeout, ...args);
    contentTimeouts.add(timeoutId);
    return timeoutId;
  });
};

export const cleanupContent = () => {
  (
    globalThis as typeof globalThis & { __hhrPrescriptionPrintWaiter?: MutationObserver }
  ).__hhrPrescriptionPrintWaiter?.disconnect();
  delete (globalThis as typeof globalThis & { __hhrPrescriptionPrintWaiter?: MutationObserver })
    .__hhrPrescriptionPrintWaiter;
  contentObservers.forEach(observer => observer.disconnect());
  contentObservers.clear();
  contentTimeouts.forEach(timeoutId => globalThis.clearTimeout(timeoutId));
  contentTimeouts.clear();
  delete (globalThis as typeof globalThis & { __hhrPrescriptionPrintInjected?: boolean })
    .__hhrPrescriptionPrintInjected;
  delete (globalThis as typeof globalThis & { __hhrPrescriptionPrintRuntime?: unknown })
    .__hhrPrescriptionPrintRuntime;
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-hhr-prescription-print-script');
  document.documentElement.removeAttribute('data-hhr-prescription-print-state');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
};
