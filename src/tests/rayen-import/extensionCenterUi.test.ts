// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const contentSource = readFileSync(path.resolve('extension/content-prescription-print.js'), 'utf8');
const backgroundSource = readFileSync(path.resolve('extension/background.js'), 'utf8');

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
    expect(contentSource).toContain('#${MODAL_ID} [hidden] { display: none !important; }');
    expect(contentSource).not.toContain('animation: hhr-modal-pop');
    expect(contentSource).not.toContain('animation: hhr-modal-fade');
  });

  it('opens vital signs with a census summary and preserves patient drill-down', () => {
    expect(contentSource).toContain("type: 'RAYEN_VITALS_CENSUS_REQUEST'");
    expect(contentSource).toContain('Última toma disponible por paciente');
    expect(contentSource).toContain("vitalsView: 'detail'");
    expect(contentSource).toContain('Todos los pacientes');
    expect(contentSource).toContain("bed.className = 'hhr-vitals-bed'");
    expect(contentSource).toContain("values.className = 'hhr-vitals-values'");
    expect(contentSource).toContain('row.append(bed, identity)');
    expect(backgroundSource).toContain('const handleVitalsCensusRequest');
    expect(backgroundSource).toContain('mapWithConcurrency(result.patients || [], 4');
    expect(backgroundSource).toContain("msg.type === 'RAYEN_VITALS_CENSUS_REQUEST'");
  });

  it('keeps imaging tools visible without a false draft guard and separates indications', () => {
    expect(contentSource).toContain(
      '#${MODAL_ID} .hhr-imaging-controls {\n        position: sticky; top: 0;'
    );
    expect(contentSource).not.toContain("clinicalWriteKey('request-draft-imaging', encId)");
    expect(contentSource).toContain('<h2 class="hhr-center-heading">Imágenes</h2>');
    expect(contentSource).toContain("key: 'indications', label: 'Indicaciones'");
    expect(contentSource).toContain("activeModule: isRegimen ? kind : 'indications'");
    expect(contentSource).not.toContain('id="hhr-rx-tab-indications"');
  });

  it('opens laboratory on the exam-request view by default', () => {
    expect(contentSource).toContain(
      "else if (activeModule === 'lab') renderLabRequestView(root, targetEncId)"
    );
    expect(contentSource).toContain(
      "main.querySelector('.hhr-flow-tabs [data-flow=\"results\"]').addEventListener('click', () => {"
    );
    expect(contentSource).toContain('renderLabCenter(root, encId);');
  });

  it('adds breathing room to laboratory requests and uses consistent select-all labels', () => {
    expect(contentSource).toContain('class="hhr-center-content hhr-labreq-content"');
    expect(contentSource).toContain(
      '#${MODAL_ID} .hhr-center-content { min-height: 0; flex: 1; overflow: auto; padding: 14px clamp(20px,1.8vw,28px) 22px; }'
    );
    expect(contentSource).toContain(
      '#${MODAL_ID} .hhr-labreq-content { padding: 18px clamp(32px,3vw,44px) 32px; }'
    );
    expect(contentSource).toContain("selectVisible.textContent = 'Seleccionar todos'");
    expect(contentSource).toContain(
      'availableCheckboxes().forEach(input => { input.checked = true; })'
    );
    expect(contentSource).toContain(
      'availableInputs().forEach(input => { input.checked = true; })'
    );
    expect(contentSource).toContain(
      'exams.slice(0, LAB_MAX_SELECTED_EXAMS).forEach(exam => selected.add(exam.id))'
    );
    expect(contentSource).toContain("? 'Quitar todos' : 'Seleccionar todos'");
    expect(contentSource).not.toContain('Seleccionar visibles');
    expect(contentSource).not.toContain('Quitar visibles');
  });
});
