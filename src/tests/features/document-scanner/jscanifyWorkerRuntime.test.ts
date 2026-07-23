import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

interface WorkerTestScope {
  __resolveOpenCvForTest?: (candidate: unknown) => Promise<{ runtime: { Mat: new () => unknown } }>;
}

const loadOpenCvResolver = () => {
  const workerSource = fs.readFileSync(
    path.resolve(process.cwd(), 'public/document-scanner/jscanify-worker.js'),
    'utf8'
  );
  const scope: WorkerTestScope = {};
  vm.runInNewContext(`${workerSource}\nself.__resolveOpenCvForTest = resolveOpenCv;`, {
    self: scope,
    OffscreenCanvas: class OffscreenCanvas {},
    Blob,
    createImageBitmap: () => undefined,
  });
  if (!scope.__resolveOpenCvForTest) throw new Error('No se pudo cargar el resolver de OpenCV.');
  return scope.__resolveOpenCvForTest;
};

describe('JScanify worker runtime', () => {
  it('awaits the Promise form exported by OpenCV.js', async () => {
    const resolveOpenCv = loadOpenCvResolver();
    const runtime = { Mat: class Mat {} };

    await expect(resolveOpenCv(Promise.resolve(runtime))).resolves.toEqual({ runtime });
  });

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
