// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const readExtension = (file: string): string =>
  readFileSync(path.resolve('extension', file), 'utf8');

const backgroundSource = readExtension('background.js');
const contentSource = readExtension('content-prescription-print.js');
const fichaSource = readExtension('inject-fichamedico.js');
const readmeSource = readExtension('README.md');

describe('CodeRabbit clinical integration hardening', () => {
  it('uses the short health budget for both tab and backend session verification', () => {
    expect(backgroundSource).toContain('verificationTimeoutMs: HEALTH_PROBE_TIMEOUT_MS');
    expect(backgroundSource).toContain('tabTimeoutMs: HEALTH_PROBE_TIMEOUT_MS');
    expect(backgroundSource).toContain(
      'verifyGestionCamasSession(record, HEALTH_PROBE_TIMEOUT_MS)'
    );
  });

  it('separates expired and forbidden sessions and only forwards approved egreso metadata', () => {
    expect(backgroundSource).toContain('if (response.status === 401)');
    expect(backgroundSource).toContain("if (response.status === 403) return 'forbidden'");
    expect(backgroundSource).toContain('GESTION_CAMAS_EGRESO_METADATA_FIELDS');
    expect(backgroundSource).not.toContain('GESTION_CAMAS_PHI_FIELDS');
    const picker = backgroundSource.slice(
      backgroundSource.indexOf('const pickGestionCamasEncounterMetadata'),
      backgroundSource.indexOf('const handleEgresoLookup')
    );
    expect(picker).not.toContain('Object.keys');
  });

  it('fails the clinical panel closed when daily treatment validation is unavailable', () => {
    expect(backgroundSource).toContain(
      "{ label: 'validación diaria del tratamiento', result: validationResult }"
    );
    expect(backgroundSource).toContain('validationSource && validationSource.error');
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
    expect(backgroundSource).toContain('const censusAllowlistCache = new Map()');
    expect(backgroundSource).toContain('getClinicalReportContext(encId, null, null, sender)');
  });

  it('preserves selected patient context and rejects stale async renders', () => {
    expect(contentSource).toContain(
      'openCenterModule(target, root.dataset.selectedEncounterId || encId'
    );
    expect(contentSource).toContain('const requestedEncId = selected');
    expect(contentSource).toContain('root.dataset.handoffRequestGeneration !== requestGeneration');
    expect(contentSource).toContain('root.dataset.vitalsRequestGeneration !== requestGeneration');
  });

  it('protects request drafts and exposes imaging marking to keyboard users', () => {
    expect(contentSource).toContain("clinicalWriteKey('request-draft-imaging', encId)");
    expect(contentSource).toContain("clinicalWriteKey('request-draft-lab', encId)");
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
});
