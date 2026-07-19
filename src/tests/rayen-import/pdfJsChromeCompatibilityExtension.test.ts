// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const readJson = (file: string) => JSON.parse(readFileSync(path.resolve(file), 'utf8'));
const sha256 = (file: string) =>
  createHash('sha256')
    .update(readFileSync(path.resolve(file)))
    .digest('hex');

describe('PDF.js extension Chrome compatibility contract', () => {
  it('vendors the exact PDF.js 5.6.205 legacy artifacts and declares Chrome 118+', () => {
    const manifest = readJson('extension/manifest.json');
    const lock = readJson('extension/vendor-lock.json');
    const vendors = new Map(lock.vendors.map((vendor: { file: string }) => [vendor.file, vendor]));

    expect(manifest.minimum_chrome_version).toBe('118');
    for (const [file, source] of [
      ['pdf.min.mjs', 'pdfjs-dist/legacy/build/pdf.min.mjs'],
      ['pdf.worker.min.mjs', 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'],
    ]) {
      const vendor = vendors.get(file) as {
        package: string;
        version: string;
        variant: string;
        source: string;
        sha256: string;
      };
      expect(vendor).toMatchObject({
        package: 'pdfjs-dist',
        version: '5.6.205',
        variant: 'legacy',
        source,
      });
      expect(sha256(`extension/${file}`)).toBe(vendor.sha256);
      expect(readFileSync(path.resolve(`extension/${file}`))).toEqual(
        readFileSync(path.resolve(`node_modules/${source}`))
      );
      expect(readFileSync(path.resolve(`extension/${file}`))).not.toEqual(
        readFileSync(path.resolve(`node_modules/pdfjs-dist/build/${file}`))
      );
    }
  });

  it('matches the previous modern extraction when post-Chrome-118 APIs start undefined', () => {
    const files = [
      'extension/forms/encuesta-contraste.pdf',
      'extension/forms/solicitud-imagen.pdf',
      'public/docs/instrumento-cudyr.pdf',
    ];
    const script = `
      import { createHash } from 'node:crypto';
      import { readFileSync } from 'node:fs';
      import path from 'node:path';
      import { pathToFileURL } from 'node:url';
      const extract = async (pdfjs, files) => {
        const results = [];
        for (const file of files) {
          const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)) });
          const document = await task.promise;
          let text = '';
          for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
            const page = await document.getPage(pageNumber);
            const content = await page.getTextContent();
            text += content.items.map(item => String(item.str || '')).join(' ');
          }
          const normalizedText = text.replace(/\\s+/g, ' ').trim();
          results.push({
            file,
            pages: document.numPages,
            textLength: normalizedText.length,
            textSha256: createHash('sha256').update(normalizedText).digest('hex'),
          });
          await document.destroy();
        }
        return results;
      };
      // The modern browser build does not provide Node's DOMMatrix/ImageData shims. Load a separate
      // legacy module instance only to establish those browser globals, then use the untouched
      // modern artifacts for the extraction baseline.
      await import(
        pathToFileURL(path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.min.mjs')).href + '?node-bootstrap'
      );
      const modern = await import(
        pathToFileURL(path.resolve('node_modules/pdfjs-dist/build/pdf.min.mjs')).href + '?baseline-test'
      );
      modern.GlobalWorkerOptions.workerSrc = pathToFileURL(
        path.resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')
      ).href;
      const modernResults = await extract(modern, ${JSON.stringify(files)});
      Object.defineProperty(Promise, 'withResolvers', { value: undefined, configurable: true, writable: true });
      Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true, writable: true });
      Object.defineProperty(Uint8Array, 'fromBase64', { value: undefined, configurable: true, writable: true });
      const mainUrl = pathToFileURL(path.resolve('extension/pdf.min.mjs')).href + '?compat-test';
      const workerUrl = pathToFileURL(path.resolve('extension/pdf.worker.min.mjs')).href;
      const pdfjs = await import(mainUrl);
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const legacyResults = await extract(pdfjs, ${JSON.stringify(files)});
      console.log(JSON.stringify({
        polyfills: {
          promiseWithResolvers: typeof Promise.withResolvers === 'function',
          abortSignalAny: typeof AbortSignal.any === 'function',
          uint8ArrayFromBase64: typeof Uint8Array.fromBase64 === 'function',
        },
        modernResults,
        legacyResults,
      }));
    `;

    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout.trim().split('\n').at(-1) || '{}') as {
      polyfills: Record<string, boolean>;
      modernResults: Array<{
        file: string;
        pages: number;
        textLength: number;
        textSha256: string;
      }>;
      legacyResults: Array<{
        file: string;
        pages: number;
        textLength: number;
        textSha256: string;
      }>;
    };
    expect(report.polyfills).toEqual({
      promiseWithResolvers: true,
      abortSignalAny: true,
      uint8ArrayFromBase64: true,
    });
    expect(report.legacyResults).toEqual(report.modernResults);
    expect(report.legacyResults.map(item => item.file)).toEqual(files);
    report.legacyResults.forEach(item => {
      expect(item.pages).toBeGreaterThan(0);
      expect(item.textLength).toBeGreaterThan(100);
    });
  });
});
