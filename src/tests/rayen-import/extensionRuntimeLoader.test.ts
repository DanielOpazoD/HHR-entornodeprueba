// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const loaderSource = readFileSync(path.resolve('extension/runtime-loader.js'), 'utf8');
const backgroundSource = readFileSync(path.resolve('extension/background.js'), 'utf8');
const extensionDirectory = path.resolve('extension');

describe('extension heavy runtime loading', () => {
  it('registers PDF and spreadsheet vendors during classic MV3 worker startup', () => {
    const startup = backgroundSource.slice(0, backgroundSource.indexOf('const FICHAMEDICO_MATCH'));

    expect(startup).toContain("'runtime-loader.js'");
    expect(startup).toContain("'jspdf.umd.min.js'");
    expect(startup).toContain("'pdf-lib.min.js'");
    expect(startup).toContain("'xlsx.full.min.js'");
  });

  it('only verifies already-registered runtimes and never performs a late import', () => {
    const context = vm.createContext({
      HhrPrescriptionPdf: {},
      HhrPdfPrint: {},
      XLSX: {},
      RayenReportParser: {},
    });
    vm.runInContext(loaderSource, context);
    const runtime = (
      context as unknown as {
        HhrExtensionRuntime: { ensurePdf: () => void; ensureSpreadsheet: () => void };
      }
    ).HhrExtensionRuntime;

    runtime.ensurePdf();
    runtime.ensureSpreadsheet();
    const executableSource = loaderSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(executableSource).not.toMatch(/\bimportScripts\s*\(/);
  });

  it('fails with a reload instruction when startup registration is incomplete', () => {
    const context = vm.createContext({});
    vm.runInContext(loaderSource, context);
    const runtime = (
      context as unknown as {
        HhrExtensionRuntime: { ensurePdf: () => void };
      }
    ).HhrExtensionRuntime;

    expect(() => runtime.ensurePdf()).toThrow(/Recarga la extensión/);
  });

  it('evaluates the complete classic service worker with every declared startup runtime', () => {
    const localStorage = {
      get: async () => ({}),
      set: async () => undefined,
      remove: async () => undefined,
    };
    const context = vm.createContext({
      console,
      crypto: globalThis.crypto,
      TextEncoder,
      TextDecoder,
      URL,
      Blob,
      atob,
      btoa,
      setTimeout,
      clearTimeout,
      chrome: {
        runtime: {
          getManifest: () => ({ version: '0.21.3' }),
          getURL: (value: string) => `chrome-extension://test/${value}`,
          onMessage: { addListener: () => undefined },
        },
        storage: { local: localStorage, session: localStorage },
        tabs: {},
        windows: {},
        downloads: {},
      },
    });
    Object.assign(context, {
      self: context,
      importScripts: (...files: string[]) => {
        for (const file of files) {
          vm.runInContext(readFileSync(path.join(extensionDirectory, file), 'utf8'), context, {
            filename: file,
          });
        }
      },
    });

    vm.runInContext(backgroundSource, context, { filename: 'background.js' });

    expect((context as unknown as { jspdf?: { jsPDF?: unknown } }).jspdf?.jsPDF).toBeTypeOf(
      'function'
    );
    expect(
      (context as unknown as { PDFLib?: { PDFDocument?: unknown } }).PDFLib?.PDFDocument
    ).toBeDefined();
    expect(
      (context as unknown as { HhrPrescriptionPdf?: unknown }).HhrPrescriptionPdf
    ).toBeDefined();
    expect((context as unknown as { HhrPdfPrint?: unknown }).HhrPdfPrint).toBeDefined();
    expect((context as unknown as { XLSX?: unknown }).XLSX).toBeDefined();
    expect(backgroundSource).toContain("header.birthDate || ''");
    expect(backgroundSource).toContain('formatAgeLabel');
  });
});
