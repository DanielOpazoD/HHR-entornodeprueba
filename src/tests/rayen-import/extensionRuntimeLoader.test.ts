// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const loaderSource = readFileSync(path.resolve('extension/runtime-loader.js'), 'utf8');
const backgroundSource = readFileSync(path.resolve('extension/background.js'), 'utf8');
const extensionManifest = JSON.parse(
  readFileSync(path.resolve('extension/manifest.json'), 'utf8')
) as {
  content_scripts?: Array<{ matches?: string[]; js?: string[]; run_at?: string }>;
};
const healthBridgeSource = readFileSync(
  path.resolve('src/features/rayen-import/bridge/extensionHealthBridge.ts'),
  'utf8'
);
const extensionDirectory = path.resolve('extension');

describe('extension heavy runtime loading', () => {
  it('injects the Ficha Medico session bridge and operations UI on every route', () => {
    const fichaEntries = (extensionManifest.content_scripts || []).filter(entry =>
      entry.matches?.includes('https://fichamedico.rayensalud.cl/*')
    );
    const scripts = fichaEntries.flatMap(entry => entry.js || []);

    expect(fichaEntries).toHaveLength(2);
    expect(fichaEntries.every(entry => entry.run_at === 'document_start')).toBe(true);
    expect(scripts).toContain('inject-fichamedico.js');
    expect(scripts).toContain('content-fichamedico.js');
    expect(scripts).toContain('content-prescription-print.js');
  });

  it('keeps nursing clinical writes tied to the verified session role', () => {
    const identityGuards = [
      ...backgroundSource.matchAll(/const identityReady = Boolean\(([\s\S]*?)\n {2}\);/g),
    ].map(match => match[1]);

    expect(identityGuards).toHaveLength(3);
    identityGuards.forEach(guard => {
      expect(guard).toContain('info.identityVerified');
      expect(guard).toContain("/enfermer/i.test(String(info.role || ''))");
      expect(guard).not.toContain('info.isNursing');
      expect(guard).not.toContain('info.listSource');
    });
  });

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
      AbortController,
      URL,
      Blob,
      atob,
      btoa,
      setTimeout,
      clearTimeout,
      chrome: {
        runtime: {
          getManifest: () => ({ version: '0.22.0' }),
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

  it('bounds backend and tab communication and settles every asynchronous message branch', () => {
    expect(backgroundSource).toContain('BACKEND_REQUEST_TIMEOUT_MS = 45_000');
    expect(backgroundSource).toContain('TAB_MESSAGE_TIMEOUT_MS = 50_000');
    expect(backgroundSource).toContain('HEALTH_PROBE_TIMEOUT_MS = 5_000');
    expect(backgroundSource).toMatch(/withTimeout\(\s*chrome\.tabs\.sendMessage/);
    expect(backgroundSource).toContain('sendMessage: sendHealthProbe');
    expect(backgroundSource).toContain('self.HhrExtensionHealth.orderTabs(tabs)');
    expect(backgroundSource).toContain('response && !response.error');
    expect(backgroundSource.match(/await fetch\(/g) || []).toHaveLength(1);
    expect(backgroundSource).not.toContain('.then(sendResponse)');
  });

  it('keeps the application and extension health protocol versions aligned', () => {
    const extensionVersion = backgroundSource.match(
      /\bEXTENSION_PROTOCOL_VERSION\s*=\s*(\d+)/
    )?.[1];
    const applicationVersion = healthBridgeSource.match(
      /\bRAYEN_EXTENSION_PROTOCOL_VERSION\s*=\s*(\d+)/
    )?.[1];

    expect(extensionVersion).toBeDefined();
    expect(applicationVersion).toBe(extensionVersion);
  });
});
