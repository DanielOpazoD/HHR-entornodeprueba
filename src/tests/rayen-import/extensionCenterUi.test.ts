// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const contentSource = [
  'content-prescription-print.js',
  'hhr-center-shell-runtime.js',
  'hhr-prescription-center.js',
  'hhr-hospitalized-documents-center.js',
  'hhr-clinical-write-client-runtime.js',
  'hhr-handoff-center.js',
  'hhr-scores-center.js',
  'hhr-lab-center.js',
  'hhr-imaging-center.js',
  'hhr-vitals-center.js',
  'hhr-discharge-actions-runtime.js',
]
  .map(file => readFileSync(path.resolve('extension', file), 'utf8'))
  .join('\n');
const medicationActionsSource = readFileSync(
  path.resolve('extension/hhr-medication-actions-runtime.js'),
  'utf8'
);
const stylesSource = readFileSync(path.resolve('extension/hhr-center-styles.js'), 'utf8');
const backgroundSource = readFileSync(path.resolve('extension/background.js'), 'utf8');
const messageContractSource = readFileSync(path.resolve('extension/message-contract.js'), 'utf8');

describe('Centro HHR navigation and vital-signs overview', () => {
  it('keeps the Centro root mounted while switching modules', () => {
    const navigation = contentSource.slice(
      contentSource.indexOf('const wireCenterNavButtons'),
      contentSource.indexOf("const regimenButton = root.querySelector('.hhr-center-regimen-print')")
    );

    expect(navigation).toContain('switchCenterModule(root, target');
    expect(navigation).not.toContain('root.remove()');
    expect(contentSource).toContain('const prepareCenterModalRoot');
    expect(contentSource).toContain('if (isNew) root.dataset.encounterId');
    expect(contentSource).toContain(
      'root.querySelector(\'.hhr-center-nav-button[aria-current="page"]\')?.focus()'
    );
    expect(contentSource).toContain(
      "encId = requestedEncId || (!existingRoot ? currentRouteEncounterId() : '')"
    );
    expect(stylesSource).toContain(
      '#hhr-prescription-print-modal [hidden] { display: none !important; }'
    );
    expect(stylesSource).not.toContain('animation: hhr-modal-pop');
    expect(stylesSource).not.toContain('animation: hhr-modal-fade');
  });

  it('opens vital signs with a census summary and preserves patient drill-down', () => {
    expect(contentSource).toContain('type: runtimeMessages.VITALS_CENSUS_REQUEST');
    expect(messageContractSource).toContain("VITALS_CENSUS_REQUEST: 'RAYEN_VITALS_CENSUS_REQUEST'");
    expect(contentSource).toContain('Última toma disponible por paciente');
    expect(contentSource).toContain("openVitalsView(root, patient.encounterId, 'detail')");
    expect(contentSource).toContain('Todos los pacientes');
    expect(contentSource).toContain("bed.className = 'hhr-vitals-bed'");
    expect(contentSource).toContain("values.className = 'hhr-vitals-values'");
    expect(contentSource).toContain('row.append(bed, identity)');
    expect(contentSource).toContain(
      'root.dataset.vitalsCensusRequestGeneration !== requestGeneration'
    );
    expect(contentSource).toContain('row.disabled = Boolean(patient.unavailableReason)');
    expect(contentSource).toContain('if (!patient.unavailableReason) {');
    expect(backgroundSource).toContain('const handleVitalsCensusRequest');
    expect(backgroundSource).toContain('mapWithConcurrency(result.patients || [], 4');
    expect(backgroundSource).toContain('[RUNTIME_MESSAGES.VITALS_CENSUS_REQUEST]: runtimeRoute(');
  });

  it('opens any selected hospitalized patient with the complete individual recipe flow', () => {
    expect(contentSource).toContain('const currentPatientMatchesRoute = hasCurrentPatient');
    expect(contentSource).toContain(
      "initialTab === 'hospitalized' || !currentPatientMatchesRoute ? 'hospitalized' : 'current'"
    );
    expect(contentSource).toContain("openPatient.textContent = 'Abrir'");
    expect(contentSource).toContain("open(patient.encounterId, 'current', root)");
    expect(contentSource).not.toContain('El episodio cambió. Cierra este panel');
    expect(contentSource).toContain("currentTab.removeAttribute('aria-disabled')");
    expect(contentSource).toContain("currentTab.removeAttribute('title')");
    expect(contentSource).toContain('if (!requestedTab || requestedTab.disabled) return');
  });

  it('keeps Reg + BRADEN inside the mounted clinical center', () => {
    expect(contentSource).toContain("createHospitalizedDocumentsModal('regimen', encId, root)");
    const home = contentSource.slice(
      contentSource.indexOf('const renderHomeCenter'),
      contentSource.indexOf('const barPart')
    );
    expect(home).not.toContain('root.remove()');
    expect(home).not.toContain('createRegimenQuickDialog()');
  });

  it('integrates handoff diagnosis and the latest vital-sign timestamp with patient identity', () => {
    expect(contentSource).toContain("diagnosis.textContent = 'Dg: ' + patient.diagnosis");
    expect(contentSource).toContain("time.className = 'hhr-vitals-patient-time'");
    expect(contentSource).toContain("'Última toma · ' + latest.recordedAt");
    expect(contentSource).not.toContain("time.className = 'hhr-vitals-summary-time'");
  });

  it('resolves a nursing medical epicrisis against the exact discharged patient', () => {
    expect(contentSource).toContain('Imprimir epicrisis médica');
    expect(contentSource).toContain(
      'type: runtimeMessages.NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST'
    );
    expect(backgroundSource).toContain('const resolveDischargedEncounterIdByRun');
    expect(backgroundSource).toContain("url.searchParams.set('filterType', '2')");
    expect(backgroundSource).toContain('contextRun !== normalizedPatientRun');
    expect(backgroundSource).toContain('{ expectedPatientRun: normalizedPatientRun }');
    expect(backgroundSource).toContain('getFichaFetchInfo(sender)');
    expect(backgroundSource).toContain('&& !rowRun(row)');
    expect(backgroundSource).not.toContain('.slice(0, 60)');
    expect(contentSource).toContain('item.dataset.hhrPatientRun = patientContext.patientRun');
    expect(contentSource).not.toContain(
      'openMenuPatient.found ? openMenuPatient.patientRun : lastDischargePatientRun'
    );
  });

  it('keeps imaging tools visible and nests indications inside recipes', () => {
    expect(stylesSource).toContain(
      '#hhr-prescription-print-modal .hhr-imaging-controls {\n        position: sticky; top: 0;'
    );
    expect(contentSource).not.toContain("clinicalWriteKey('request-draft-imaging', encId)");
    expect(contentSource).toContain('<h2 class="hhr-center-heading">Imágenes</h2>');
    expect(contentSource).not.toContain("key: 'indications', label: 'Indicaciones'");
    expect(contentSource).toContain("activeModule: isRegimen ? kind : 'recipes'");
    expect(contentSource).toContain('data-rx-module="indications"');
    expect(contentSource).toContain('hhr-rx-module-tabs');
    expect(contentSource).not.toContain('data-module="indications"');
  });

  it('uses integrated feedback instead of native browser alerts or confirms', () => {
    expect(contentSource).toContain('const showPageNotice =');
    expect(contentSource).toContain('const requestPageConfirmation =');
    expect(contentSource).toContain("confirmLabel: 'Descartar y continuar'");
    expect(contentSource).toContain('if (root.isConnected) action()');
    expect(contentSource).not.toMatch(/window\.(?:alert|confirm)\s*\(/);
  });

  it('opens laboratory on the exam-request view by default', () => {
    expect(contentSource).toContain(
      "else if (activeModule === 'lab') labCenterRuntime.renderLabRequestView(root, targetEncId)"
    );
    expect(contentSource).toContain(
      "main.querySelector('.hhr-flow-tabs [data-flow=\"results\"]').addEventListener('click', () => {"
    );
    expect(contentSource).toContain(
      'runClinicalTransition(root, () => renderLabCenter(root, encId))'
    );
  });

  it('adds breathing room to laboratory requests and uses consistent select-all labels', () => {
    expect(contentSource).toContain('class="hhr-center-content hhr-labreq-content"');
    expect(stylesSource).toContain(
      '#hhr-prescription-print-modal .hhr-center-content { min-height: 0; flex: 1; overflow: auto; padding: 14px clamp(20px,1.8vw,28px) 22px; }'
    );
    expect(stylesSource).toContain(
      '#hhr-prescription-print-modal .hhr-labreq-content { padding: 18px clamp(32px,3vw,44px) 32px; }'
    );
    expect(contentSource).toContain("selectVisible.textContent = 'Seleccionar todos'");
    expect(contentSource).toMatch(
      /availableCheckboxes\(\)\.forEach\(input => \{\s*input\.checked = true;/
    );
    expect(contentSource).toMatch(
      /availableInputs\(\)\.forEach\(input => \{\s*input\.checked = true;/
    );
    expect(contentSource).toContain(
      'exams.slice(0, LAB_MAX_SELECTED_EXAMS).forEach(exam => selected.add(exam.id))'
    );
    expect(contentSource).toContain("? 'Quitar todos' : 'Seleccionar todos'");
    expect(contentSource).not.toContain('Seleccionar visibles');
    expect(contentSource).not.toContain('Quitar visibles');
  });

  it('keeps the route-independent favorites dialog open during route reconciliation', () => {
    const favoritesDialog = medicationActionsSource.slice(
      medicationActionsSource.indexOf('const createFavoritesDialog'),
      medicationActionsSource.indexOf('return Object.freeze')
    );
    expect(favoritesDialog).toContain("root.dataset.routeIndependent = 'true'");
    expect(contentSource).toContain("modal && modal.dataset.routeIndependent !== 'true' &&");
  });
});
