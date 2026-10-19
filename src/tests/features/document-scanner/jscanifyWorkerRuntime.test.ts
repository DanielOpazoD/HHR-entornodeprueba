// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { describe, expect, it } from 'vitest';

interface WorkerTestScope {
  __resolveOpenCvForTest?: (candidate: unknown) => Promise<{ runtime: { Mat: new () => unknown } }>;
}

const loadOpenCvResolver = async (minified = false) => {
  const workerSource = fs.readFileSync(
    path.resolve(process.cwd(), 'public/document-scanner/jscanify-worker.js'),
    'utf8'
  );
  const scope: WorkerTestScope = {};
  const instrumented = `${workerSource}\nself.__resolveOpenCvForTest = resolveOpenCv;`;
  const code = minified
    ? (await transform(instrumented, { loader: 'js', minify: true, target: 'es2020' })).code
    : instrumented;
  vm.runInNewContext(code, {
    self: scope,
    OffscreenCanvas: class OffscreenCanvas {},
    Blob,
    createImageBitmap: () => undefined,
  });
  if (!scope.__resolveOpenCvForTest) throw new Error('No se pudo cargar el resolver de OpenCV.');
  return scope.__resolveOpenCvForTest;
};

describe('JScanify worker runtime', () => {
  it.each([false, true])(
    'awaits the Promise form exported by OpenCV.js (minified=%s)',
    async minified => {
      const resolveOpenCv = await loadOpenCvResolver(minified);
      const runtime = { Mat: class Mat {} };

      await expect(resolveOpenCv(Promise.resolve(runtime))).resolves.toEqual({ runtime });
    }
  );

  it('keeps the full-resolution pixel filter inside the worker', () => {
    const workerSource = fs.readFileSync(
      path.resolve(process.cwd(), 'public/document-scanner/jscanify-worker.js'),
      'utf8'
    );
    const scannerServiceSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/features/document-scanner/services/jscanifyDocumentScannerService.ts'
      ),
      'utf8'
    );

    expect(workerSource).toContain("message.type === 'filter'");
    expect(workerSource).toContain('context.getImageData');
    expect(scannerServiceSource).toContain('filterDocumentPage');
    expect(scannerServiceSource).not.toContain('getImageData');
  });

  it('integrity-pins the published JScanify source instead of dynamic minification', () => {
    const runtimeSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/features/document-scanner/services/jscanifyWorkerRuntime.ts'
      ),
      'utf8'
    );

    expect(runtimeSource).toContain('/src/jscanify.js');
    expect(runtimeSource).not.toContain('/src/jscanify.min.js');
  });
});
