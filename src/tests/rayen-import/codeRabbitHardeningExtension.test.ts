// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const readExtension = (file: string): string =>
  readFileSync(path.resolve('extension', file), 'utf8');

const backgroundSource = readExtension('background.js');
const clinicalPanelRuntimeSource = readExtension('clinical-panel-runtime.js');
const gestionCamasRuntimeSource = readExtension('gestion-camas-runtime.js');
const syslabRuntimeSource = readExtension('syslab-runtime.js');
const contentSource = [
  'content-prescription-print.js',
  'hhr-center-shell-runtime.js',
  'hhr-prescription-center.js',
  'hhr-hospitalized-documents-center.js',
  'hhr-handoff-scores-center.js',
  'hhr-lab-center.js',
]
  .map(readExtension)
  .join('\n');
const fichaSource = readExtension('inject-fichamedico.js');
const readmeSource = readExtension('README.md');

describe('CodeRabbit clinical integration hardening', () => {
  it('uses the short health budget for both tab and backend session verification', () => {
    expect(gestionCamasRuntimeSource).toContain('verificationTimeoutMs: healthProbeTimeoutMs');
    expect(gestionCamasRuntimeSource).toContain('tabTimeoutMs: healthProbeTimeoutMs');
    expect(gestionCamasRuntimeSource).toContain(
      'verifyGestionCamasSession(record, healthProbeTimeoutMs)'
    );
  });

  it('separates expired and forbidden sessions and only forwards approved egreso metadata', () => {
    expect(gestionCamasRuntimeSource).toContain('if (response.status === 401)');
    expect(gestionCamasRuntimeSource).toContain("if (response.status === 403) return 'forbidden'");
    expect(backgroundSource).toContain('GESTION_CAMAS_EGRESO_METADATA_FIELDS');
    expect(backgroundSource).not.toContain('GESTION_CAMAS_PHI_FIELDS');
    const picker = backgroundSource.slice(
      backgroundSource.indexOf('const pickGestionCamasEncounterMetadata'),
      backgroundSource.indexOf('const handleEgresoLookup')
    );
    expect(picker).not.toContain('Object.keys');
  });

  it('fails the clinical panel closed when daily treatment validation is unavailable', () => {
    expect(clinicalPanelRuntimeSource).toContain("{ label: 'validación diaria del tratamiento'");
    expect(clinicalPanelRuntimeSource).toContain('validationSource && validationSource.error');
  });

  it('requires server claims for medical and nursing handoff access', () => {
    expect(backgroundSource).not.toContain("handoffKind === 'medical' ? { claims: [] }");
    expect(backgroundSource).not.toContain("handoffKind === 'medical' || hasFichaClaim");
    expect(backgroundSource).toContain("hasFichaClaim(claimsResult, 'Ingresar_Cambio_Turno')");
  });

  it('discards stale identity refreshes and compares against the previous binding', () => {
    expect(fichaSource).toContain('revision !== sessionBindingRevision');
    expect(fichaSource).toContain('const previousAuth = capturedAuth');
    expect(fichaSource).toContain('previousAuth === sessionToken');
  });

  it('binds corrected discharge PDFs to a valid patient before allocating the payload', () => {
    expect(backgroundSource).toContain('No se pudo validar el RUN del paciente seleccionado.');
    expect(backgroundSource).toContain('{ expectedPatientRun: normalizedPatientRun }');
    expect(contentSource).toContain('if (!expectedPatientRun)');
    expect(fichaSource).toContain('MAX_EPICRISIS_BASE64_LENGTH = 20 * 1024 * 1024');
    expect(fichaSource).toContain(
      'Math.ceil(Number(value.size || 0) / 3) * 4 > MAX_EPICRISIS_BASE64_LENGTH'
    );
  });

  it('restores reconnect after forgetting a session and documents retained metadata', () => {
    const forgetHandler = contentSource.slice(
      contentSource.indexOf("forget.addEventListener('click'"),
      contentSource.indexOf(
        'void load();',
        contentSource.indexOf("forget.addEventListener('click'")
      )
    );
    expect(forgetHandler.indexOf('connect.disabled = false')).toBeGreaterThan(
      forgetHandler.indexOf('await sendMessage')
    );
    expect(readmeSource).toContain('metadatos mínimos de sesión');
    expect(readmeSource).toContain('identidad derivada');
  });

  it('isolates Ficha lookups and patient caches by sender session', () => {
    expect(backgroundSource).toContain(
      'const getFichaFetchInfo = sender => getFichaFetchInfoUncached(sender)'
    );
    expect(backgroundSource).not.toContain('fichaFetchInfoInflight');
    expect(backgroundSource).toContain('const fichaSessionCacheKey = async (info, sender) =>');
    expect(backgroundSource).toContain("self.crypto.subtle.digest('SHA-256'");
    expect(syslabRuntimeSource).toContain('const censusAllowlistCache = new Map()');
    expect(syslabRuntimeSource).toContain('getClinicalReportContext(encId, null, null, sender)');
  });

  it('preserves selected patient context and rejects stale async renders', () => {
    expect(contentSource).toContain(
      'switchCenterModule(root, target, root.dataset.selectedEncounterId || encId'
    );
    expect(contentSource).toContain('const requestedEncId = selected');
    expect(contentSource).toContain('root.dataset.handoffRequestGeneration !== requestGeneration');
    expect(contentSource).toContain('root.dataset.vitalsRequestGeneration !== requestGeneration');
  });

  it('keeps transient request selections out of the clinical-write guard', () => {
    expect(contentSource).not.toContain("clinicalWriteKey('request-draft-imaging', encId)");
    expect(contentSource).not.toContain("clinicalWriteKey('request-draft-lab', encId)");
    expect(contentSource).toContain("printWindow.addEventListener('load', openPrintDialog");
    expect(contentSource).toContain('printWindow.print()');
    expect(contentSource).toContain('class="hhr-imaging-canvas" role="group" tabindex="0"');
    expect(contentSource).toContain("event.key === 'Enter' || event.key === ' '");
    expect(contentSource).toContain('selectedKeys().length + (othersInput.value.trim() ? 1 : 0)');
    const textEditorKeys = contentSource.slice(
      contentSource.indexOf("editor.addEventListener('keydown'"),
      contentSource.indexOf('overlaysHost.appendChild(editor)')
    );
    expect(textEditorKeys).toContain('event.stopPropagation()');
    expect(textEditorKeys).toContain('restoreCanvasFocus = true');
    expect(contentSource).toContain('canvas.focus({ preventScroll: true })');
  });

  it('keeps prescription batches reusable for the verified Ficha session', () => {
    const prescriptionBatch = backgroundSource.slice(
      backgroundSource.indexOf('const handleHospitalizedPrescriptionOptionsRequest'),
      backgroundSource.indexOf("// Keep Eloisa's official Jasper prescription")
    );
    expect(prescriptionBatch).toContain('const sessionKey = await fichaSessionCacheKey');
    expect(prescriptionBatch).toContain('isPrescriptionBatchSessionValid(batch, sessionKey');
    expect(prescriptionBatch).not.toContain('30 * 60 * 1000');
    expect(prescriptionBatch).toContain('[storageKey]: { ...batch, lastUsedAt: Date.now() }');
    expect(backgroundSource).toContain('const PRESCRIPTION_BATCH_LIMIT = 24');
    expect(backgroundSource).toContain('.slice(Math.max(0, PRESCRIPTION_BATCH_LIMIT))');
    expect(backgroundSource).not.toContain('PRESCRIPTION_BATCH_LIMIT - 1');
    expect(backgroundSource).toContain('await sweepPrescriptionBatches()');
    expect(backgroundSource).toContain("allowOfficialFallback: format === 'compact'");
    expect(backgroundSource).toContain('compactFallbackReason');
    expect(backgroundSource).toContain('officialResult.buffer.slice(0)');
    expect(fichaSource).toContain(
      'expiresAt: normalization.normalizeSessionExpiry(session, payload)'
    );
    expect(contentSource).toContain('el formato oficial para evitar omitir contenido clínico');
  });
});
