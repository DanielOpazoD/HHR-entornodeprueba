// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const extensionFile = (name: string) => readFileSync(path.resolve('extension', name), 'utf8');

describe('native Eloisa laboratory viewer wiring', () => {
  it('wires direct Syslab requests through expiring encounter-bound batches and exposes Lab', () => {
    const background = extensionFile('background.js');
    const runtime = extensionFile('syslab-runtime.js');
    const sessionTransport = extensionFile('syslab-session-transport.js');
    const content = ['content-prescription-print.js', 'hhr-center-shell-runtime.js']
      .map(extensionFile)
      .join('\n');
    const labCenter = extensionFile('hhr-lab-center.js');
    const manifest = extensionFile('manifest.json');
    const bridge = extensionFile('syslab-bridge.js');
    const offscreen = extensionFile('syslab-offscreen.js');
    const offscreenHtml = extensionFile('syslab-offscreen.html');
    const login = extensionFile('syslab-login.js');
    const loginHtml = extensionFile('syslab-login.html');
    const loginWindow = extensionFile('syslab-login-window.js');

    expect(background).not.toContain('localhost:3001');
    expect(background).toContain("'syslab-session-transport.js'");
    expect(background).toContain("'clinical-history-coverage.js'");
    expect(background).toContain("'syslab-login-window.js'");
    expect(background).toContain("'syslab-runtime.js'");
    expect(background).toContain('self.HhrSyslabPdfBundle.createRuntime({');
    expect(background).toContain("'syslab-pdf-bundle.js'");
    expect(background).toContain("'syslab-pdf-filename.js'");
    expect(runtime).toContain('LAB_BATCH_TTL_MS = 15 * 60 * 1000');
    expect(runtime).toContain('sweepExpiredLabBatches');
    expect(runtime).toContain('Puedes analizar como máximo 24 informes por operación.');
    expect(runtime).toContain('LAB_REPORT_TIMEOUT_MS = 90_000');
    expect(runtime).toContain('LAB_DETAILS_TIMEOUT_MS = 600_000');
    expect(runtime).toContain('searchSyslabDirectly');
    expect(background).toContain('[RUNTIME_MESSAGES.SYSLAB_STATUS_REQUEST]: runtimeRoute(');
    expect(loginWindow).toContain('messageContract.types.SYSLAB_LOGIN_OPEN_REQUEST');
    expect(loginWindow).toContain('messageContract.createRuntimeRouter');
    expect(background).toContain('[RUNTIME_MESSAGES.SYSLAB_LOGIN_REQUEST]: runtimeRoute(');
    expect(runtime).toContain("SYSLAB_OFFSCREEN_PATH = 'syslab-offscreen.html'");
    expect(runtime).toContain('chromeApi.offscreen.createDocument');
    expect(runtime).toContain("reasons: ['IFRAME_SCRIPTING']");
    expect(runtime).toContain('context.documentUrl === offscreenUrl');
    expect(runtime).toContain('const current = await readOffscreenContexts()');
    expect(runtime).toContain('sendToSyslabOffscreen');
    expect(runtime).not.toContain('SYSLAB_TAB_STORAGE_KEY');
    expect(runtime).not.toContain('focusSyslabTab');
    expect(sessionTransport).toContain('previousBridgeId');
    expect(sessionTransport).toContain('status.bridgeId !== previousBridgeId');
    expect(sessionTransport).toContain("SYSLAB_TAB_PATTERN = 'http://10.4.69.90/syslab/*'");
    expect(sessionTransport).toContain("kind: 'visible-tab'");
    expect(runtime).toContain('RAYEN_SYSLAB_READ_DETAILS');
    expect(runtime).toContain('linksByExamId');
    expect(background).toContain('[RUNTIME_MESSAGES.LAB_SEARCH_REQUEST]: runtimeRoute(');
    expect(background).toContain('[RUNTIME_MESSAGES.LAB_DETAILS_REQUEST]: runtimeRoute(');
    expect(runtime).toContain('validateDetailBatch');
    expect(runtime).toContain('const reportRequests = exams.map(exam => ({');
    expect(runtime).toContain('exams: reportRequests');
    expect(runtime).not.toContain('getClinicalReportContext');
    expect(runtime).not.toContain('getFichaFetchInfo');
    expect(runtime).toContain('rutBody !== String(requestedRutBody');
    expect(runtime).toContain('examRowsMatchRut(payload.exams, rutBody)');
    expect(runtime).toContain('Syslab no confirmó que los informes correspondan al RUN solicitado');
    expect(background).toContain(
      'syslabRuntime.details({ batchId: message.batchId, examIds: message.examIds, sender })'
    );
    expect(background).toContain('syslabRuntime.openPdf({ ...message, sender })');
    expect(background).toContain('[RUNTIME_MESSAGES.LAB_PDF_OPEN_REQUEST]: runtimeRoute(');
    expect(runtime).toContain('base64: validation.pdfBase64');
    expect(runtime).toContain('print-pdf.html?job=');
    expect(runtime).not.toMatch(/17752753|SYSLAB_PASS|SYSLAB_USER/);
    expect(bridge).toContain("SYSLAB_ORIGIN = 'http://10.4.69.90'");
    expect(bridge).toContain("credentials: 'include'");
    expect(bridge).toContain('MAX_BODY_BYTES = 6 * 1024 * 1024');
    expect(bridge).toContain("import(chrome.runtime.getURL('pdf.min.mjs'))");
    expect(bridge).toContain("typeof globalThis.crypto.randomUUID === 'function'");
    expect(bridge).toContain('HTTP fallback; correlation only.');
    expect(bridge).toContain("message.type === 'RAYEN_SYSLAB_LOGIN'");
    expect(bridge).toContain('extractRutBodyFromReportText');
    expect(bridge).toContain('includeValidatedPdf: true');
    expect(bridge).toContain('pdfBase64: detail.pdfBase64');
    expect(bridge).toContain("FRAME_REQUEST = 'HHR_SYSLAB_FRAME_REQUEST'");
    expect(bridge).toContain('event.origin !== EXTENSION_ORIGIN');
    expect(bridge).not.toMatch(/17752753|SYSLAB_PASS|SYSLAB_USER/);
    expect(offscreenHtml).toContain('src="http://10.4.69.90/syslab/"');
    expect(offscreenHtml).toContain('sandbox="allow-forms allow-same-origin allow-scripts"');
    expect(offscreenHtml).not.toContain('allow-modals');
    expect(offscreenHtml).toContain('syslab-offscreen.js');
    expect(offscreen).toContain("REQUEST_TARGET = 'hhr-syslab-offscreen'");
    expect(offscreen).toContain('event.origin !== FRAME_ORIGIN');
    expect(offscreen).not.toContain('Math.min(1_500');
    expect(content).toContain("key: 'exams'");
    expect(content).toContain('hhr-exams-lab');
    expect(content).not.toContain('class="module hhr-ops-lab"');
    expect(labCenter).toContain('hhr-syslab-access');
    expect(labCenter).toContain('hhr-syslab-access-form');
    expect(labCenter).toContain('type="password"');
    expect(labCenter).toContain('runtimeMessages.SYSLAB_LOGIN_REQUEST');
    expect(labCenter).toContain("syslabPassword.value = ''");
    expect(labCenter).not.toContain('target="_blank"');
    expect(labCenter).not.toContain('<iframe class="hhr-syslab-login"');
    expect(content).not.toContain('input name="password"');
    expect(loginHtml).toContain('No se guardan en la extensión');
    expect(login).toContain('type: runtimeMessages.SYSLAB_LOGIN_REQUEST');
    expect(login).toContain("candidate === 'https://fichamedico.rayensalud.cl'");
    expect(login).toContain('Vuelve a la pantalla de Laboratorio.');
    expect(login).not.toContain('localStorage');
    expect(login).not.toContain('sessionStorage');
    expect(content).toContain("key: 'connection'");
    expect(content).toContain(
      "['scores', 'connection', 'lab', 'imaging', 'vitals', 'home'].includes(module)"
    );
    expect(content).toContain(
      "else if (activeModule === 'lab') labCenterRuntime.renderLabRequestView(root, targetEncId)"
    );
    expect(content).toContain('else renderConnectionCenter(root, targetEncId)');
    expect(labCenter).toContain('Comparación');
    expect(labCenter).toContain('Tendencias');
    expect(labCenter).toContain('Por informe');
    expect(labCenter).toContain('requestGeneration');
    expect(labCenter).toContain('invalidateLabAnalysis');
    expect(labCenter).toContain("batchId = ''");
    expect(manifest).toContain('"lab-result-parser.js"');
    expect(manifest).toContain('"lab-viewer.js"');
    expect(manifest.indexOf('"lab-result-parser.js"')).toBeLessThan(
      manifest.indexOf('"lab-viewer.js"')
    );
    expect(background).toContain("'lab-result-parser.js', 'lab-viewer.js'");
    expect(manifest).toContain('"syslab-bridge.js"');
    expect(manifest).toContain('"http://10.4.69.90/syslab/*"');
    expect(manifest).toContain('"offscreen"');
    expect(manifest).toContain('"clipboardWrite"');
    expect(manifest).toContain('"all_frames": true');
    expect(manifest).toContain('"syslab-login.html"');
    expect(manifest).toContain('"version": "0.48.2"');
  });
});
