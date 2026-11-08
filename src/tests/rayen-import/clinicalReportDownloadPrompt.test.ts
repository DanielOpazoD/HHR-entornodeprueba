// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadFactory, createDependencies } from './clinicalReportRuntimeExtension.fixture';

describe('clinical report download destination', () => {
  it.each([true, undefined])(
    'passes the explicit save destination choice while preserving the default (%s)',
    async saveAs => {
      const deps = createDependencies();
      const runtime = loadFactory().create(deps);
      expect(
        await runtime.downloadPdfBuffer({
          buffer: new ArrayBuffer(1),
          filename: 'DAU_synthetic.pdf',
          saveAs,
        })
      ).toEqual({ ok: true, downloadId: 71 });
      expect(deps.chrome.downloads.download).toHaveBeenCalledWith({
        url: 'data:application/pdf;base64,UERG',
        filename: 'DAU_synthetic.pdf',
        saveAs: saveAs === true,
        conflictAction: 'uniquify',
      });
    }
  );
});
