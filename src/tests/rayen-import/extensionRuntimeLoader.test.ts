// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const loaderSource = readFileSync(path.resolve('extension/runtime-loader.js'), 'utf8');
const backgroundSource = readFileSync(path.resolve('extension/background.js'), 'utf8');
const clinicalWriteRecoveryPolicySource = readFileSync(
  path.resolve('extension/clinical-write-recovery-policy.js'),
  'utf8'
);
const patientContextSource = readFileSync(
  path.resolve('extension/fichamedico-patient-context.js'),
  'utf8'
);
const clinicalScoreRuntimeSource = readFileSync(
  path.resolve('extension/clinical-score-runtime.js'),
  'utf8'
);
const clinicalScoreWriteRuntimeSource = readFileSync(
  path.resolve('extension/clinical-score-write-runtime.js'),
  'utf8'
);
const clinicalScoreWriteModelSource = readFileSync(
  path.resolve('extension/clinical-score-write-model.js'),
  'utf8'
);
const clinicalHandoffRuntimeSource = readFileSync(
  path.resolve('extension/clinical-handoff-runtime.js'),
  'utf8'
);
const clinicalBatchPrintRuntimeSource = readFileSync(
  path.resolve('extension/clinical-batch-print-runtime.js'),
  'utf8'
);
const gestionCamasSource = readFileSync(path.resolve('extension/inject-gestioncamas.js'), 'utf8');
const gestionCamasRuntimeSource = readFileSync(
  path.resolve('extension/gestion-camas-runtime.js'),
  'utf8'
);
const fichaMedicoTransportSource = readFileSync(
  path.resolve('extension/fichamedico-transport-runtime.js'),
  'utf8'
);
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
    expect(scripts).toContain('hhr-center-styles.js');
    expect(scripts).toContain('exam-request-print.js');
    expect(scripts).toContain('content-exam-request-print.js');
    expect(scripts).toContain('hhr-discharge-actions-runtime.js');
    expect(scripts).toContain('hhr-medication-actions-runtime.js');
    expect(scripts).toContain('content-prescription-print.js');
    expect(scripts.indexOf('hhr-discharge-actions-runtime.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
    expect(scripts.indexOf('hhr-medication-actions-runtime.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
  });

  it('keeps clinical writes tied to a verified nursing or medical session role', () => {
    const identityGuards = [
      ...[backgroundSource, clinicalScoreRuntimeSource, clinicalHandoffRuntimeSource].flatMap(
        source => [...source.matchAll(/const identityReady = Boolean\(([\s\S]*?)\n {2,6}\);/g)]
      ),
    ].map(match => match[1]);

    expect(identityGuards).toHaveLength(3);
    identityGuards.forEach(guard => {
      expect(guard).toContain('info.identityVerified');
      expect(guard).not.toContain('info.isNursing');
      expect(guard).not.toContain('info.listSource');
    });
    expect(identityGuards.filter(guard => guard.includes('&& handoffKind'))).toHaveLength(2);
    expect(identityGuards.some(guard => guard.includes('&& clinicalRoleKind'))).toBe(true);
    expect(clinicalHandoffRuntimeSource).toContain('batch.batch.handoffKind !== handoffKind');
  });

  it('registers PDF and spreadsheet vendors during classic MV3 worker startup', () => {
    const startup = backgroundSource.slice(0, backgroundSource.indexOf('const REPORT_FILE'));

    expect(startup).toContain("'runtime-loader.js'");
    expect(startup).toContain("'jspdf.umd.min.js'");
    expect(startup).toContain("'pdf-lib.min.js'");
    expect(startup).toContain("'xlsx.full.min.js'");
    expect(startup).toContain("'gestion-camas-runtime.js'");
    expect(startup).toContain("'fichamedico-transport-runtime.js'");
    expect(startup).toContain("'clinical-score-runtime.js'");
    expect(startup).toContain("'clinical-write-recovery-policy.js'");
    expect(startup.indexOf("'clinical-write-recovery-policy.js'")).toBeLessThan(
      startup.indexOf("'clinical-write-runtime.js'")
    );
    expect(startup).toContain('!self.HhrClinicalWriteRecoveryPolicy ||');
    expect(clinicalWriteRecoveryPolicySource).toContain(
      'root.HhrClinicalWriteRecoveryPolicy = Object.freeze({'
    );
    expect(startup).toContain('No se pudo cargar el runtime de lectura de Scores.');
    expect(startup).toContain("'clinical-score-write-runtime.js'");
    expect(startup).toContain("'clinical-score-write-model.js'");
    expect(startup).toContain('!self.HhrClinicalScoreWriteModel ||');
    expect(clinicalScoreWriteModelSource).toContain(
      'root.HhrClinicalScoreWriteModel = Object.freeze({'
    );
    expect(startup).toContain('No se pudo cargar el runtime de escritura de Scores.');
    expect(clinicalScoreWriteRuntimeSource).toContain(
      'root.HhrClinicalScoreWriteRuntime = Object.freeze({ create, buildClinicalAge });'
    );
    expect(startup).toContain("'clinical-batch-print-runtime.js'");
    expect(startup).toContain('No se pudo cargar el runtime batch de documentos hospitalizados.');
    expect(clinicalBatchPrintRuntimeSource).toContain(
      'root.HhrClinicalBatchPrintRuntime = Object.freeze({ create });'
    );
  });

  it('only verifies already-registered runtimes and never performs a late import', () => {
    const context = vm.createContext({
      HhrPrescriptionPdf: {},
      HhrPdfPrint: {},
      HhrExamRequestPrintUi: {},
      HhrExamRequestPdf: {},
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
      fetch: globalThis.fetch,
      URL,
      Blob,
      atob,
      btoa,
      setTimeout,
      clearTimeout,
      chrome: {
        runtime: {
          getManifest: () => ({ version: '0.23.1' }),
          getURL: (value: string) => `chrome-extension://test/${value}`,
          onMessage: { addListener: () => undefined },
        },
        storage: { local: localStorage, session: localStorage },
        tabs: {
          query: async () => [],
          sendMessage: async () => undefined,
          update: async () => undefined,
          create: async () => undefined,
        },
        windows: { update: async () => undefined },
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
    expect(
      (context as unknown as { HhrExamRequestPrintUi?: unknown }).HhrExamRequestPrintUi
    ).toBeDefined();
    expect((context as unknown as { HhrExamRequestPdf?: unknown }).HhrExamRequestPdf).toBeDefined();
    expect((context as unknown as { HhrPdfPrint?: unknown }).HhrPdfPrint).toBeDefined();
    expect((context as unknown as { XLSX?: unknown }).XLSX).toBeDefined();
    expect(patientContextSource).toContain('firstTruthy(header.birthDate)');
    expect(patientContextSource).toContain('formatAgeLabel');
  });

  it('bounds backend and tab communication and settles every asynchronous message branch', () => {
    expect(backgroundSource).toContain('BACKEND_REQUEST_TIMEOUT_MS = 45_000');
    expect(backgroundSource).toContain('TAB_MESSAGE_TIMEOUT_MS = 50_000');
    expect(backgroundSource).toContain('HEALTH_PROBE_TIMEOUT_MS = 5_000');
    expect(fichaMedicoTransportSource).toMatch(/withTimeout\(\s*tabs\.sendMessage/);
    expect(fichaMedicoTransportSource).toContain('sendMessage: sendHealthProbe');
    expect(gestionCamasRuntimeSource).toContain('extensionHealth.orderTabs(tabs)');
    expect(fichaMedicoTransportSource).toContain('response && !response.error');
    expect(backgroundSource.match(/await fetch\(/g) || []).toHaveLength(1);
    expect(backgroundSource).not.toContain('.then(sendResponse)');
  });

  it('keeps the retained Gestion de Camas session verified and facility-bound', () => {
    expect(gestionCamasSource).toContain(
      "const sessionKey = [auth, base, facId, connectionAttemptId].join('|')"
    );
    expect(gestionCamasSource).toContain('!/^\\d+$/.test(facId)');
    expect(gestionCamasSource).toContain('auth !== capturedAuth');
    expect(gestionCamasSource).toContain('d.rehydrated === true');
    expect(gestionCamasSource).toContain('capturedAuthConnectionAttemptId');
    expect(gestionCamasSource).toContain(
      'this.__gcConnectionAttemptId = activeConnectionAttemptId'
    );
    expect(gestionCamasSource).not.toContain('verified: Boolean(verified)');
    expect(gestionCamasRuntimeSource).toContain('sameGestionCamasSession(current, record)');
    expect(gestionCamasRuntimeSource).toContain('record.sourceTabId = normalizedSourceTabId');
    expect(gestionCamasRuntimeSource).toContain('record.connectionAttemptId = suppliedAttemptId');
    expect(gestionCamasRuntimeSource).toContain('attemptId: crypto.randomUUID()');
    expect(gestionCamasRuntimeSource).toContain('RAYEN_GC_SET_CONNECTION_ATTEMPT');
    expect(backgroundSource).toContain('[RUNTIME_MESSAGES.GC_DOCUMENT_READY]: runtimeRoute(');
    expect(gestionCamasRuntimeSource).toContain('CONNECTION_CONTROL_STORAGE_KEY');
    expect(gestionCamasRuntimeSource).toContain('CLOSING_WINDOW_STORAGE_KEY');
    expect(gestionCamasRuntimeSource).toContain('clearUnusableGestionCamasSession');
    expect(gestionCamasRuntimeSource).toContain(
      'const verified = await verifyGestionCamasSession(candidate, verificationTimeoutMs)'
    );
    expect(gestionCamasRuntimeSource).toContain(
      'if (verified.record) return { record: verified.record }'
    );
    expect(gestionCamasRuntimeSource).toContain('isClosingGestionCamasWindow(closing, windowId)');
    expect(gestionCamasRuntimeSource).toContain('return { replaced: true }');
    expect(gestionCamasRuntimeSource).toMatch(
      /mutateGestionCamasSession\(async \(\) => \{\s+const pending = await readPendingGestionCamasConnection\(\)/
    );
    expect(backgroundSource).toContain('if (!verified)');
    expect(gestionCamasRuntimeSource).toContain("? 'expired' : 'changed'");
    expect(gestionCamasRuntimeSource).toContain('if (response.status === 401)');
    expect(gestionCamasRuntimeSource).toContain("if (response.status === 403) return 'forbidden'");
    expect(gestionCamasRuntimeSource).not.toContain(
      'response.status === 401 || response.status === 403'
    );
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
