// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/hhr-prescription-content-runtime.js';
import { cleanupContent } from './prescriptionContentHarness';

describe('orphaned clinical modal recovery', () => {
  afterEach(cleanupContent);

  it('preserva el modal previo y reintenta al cerrarlo', async () => {
    document.body.innerHTML = '<div id="hhr-prescription-print-modal"></div>';
    const runtime = (
      globalThis as typeof globalThis & {
        HhrPrescriptionContentRuntime: {
          preparePrevious: () => boolean;
          waitForModalClosure: (callback: () => void) => void;
        };
      }
    ).HhrPrescriptionContentRuntime;
    expect(runtime.preparePrevious()).toBe(false);
    const retry = vi.fn();
    runtime.waitForModalClosure(retry);
    expect(retry).not.toHaveBeenCalled();
    document.body.innerHTML = '';
    await vi.waitFor(() => expect(retry).toHaveBeenCalledOnce());
    expect(runtime.preparePrevious()).toBe(true);
  });
});
