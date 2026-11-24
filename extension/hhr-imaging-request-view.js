/** Markup for the official imaging request workspace. */
(() => {
  'use strict';
  const markup = (documents, encId) => `
        <div class="hhr-center-toolbar hhr-request-toolbar">
          <h2 class="hhr-center-heading">Imágenes</h2>
          <div class="hhr-rx-tabs hhr-flow-tabs" role="tablist" aria-label="Flujo de imágenes">
            <button class="hhr-rx-tab" type="button" role="tab" data-flow="request" aria-selected="true">Solicitar</button>
            <button class="hhr-rx-tab" type="button" role="tab" data-flow="reports" aria-selected="false">Informes</button>
          </div>
          ${globalThis.HhrLabRequestPatient.printActionsHtml('imaging')}
        </div>
        <div class="hhr-center-content">
          ${globalThis.HhrLabRequestPatient.sectionHtml(encId, true)}
          <div class="hhr-imaging-patient-summary" hidden>
            <div class="hhr-imaging-patient-identity"><strong class="hhr-imaging-patient-name"></strong><span class="hhr-imaging-patient-id" hidden></span></div>
            <button class="hhr-center-action hhr-imaging-edit" type="button">Editar</button>
          </div>
          <div class="hhr-imaging-controls">
            <div class="hhr-imaging-document-tools">
              <div class="hhr-rx-tabs hhr-imaging-tabs" role="tablist" aria-label="Documento">
                ${Object.values(documents).map((doc, index) => `
                  <button class="hhr-rx-tab" type="button" role="tab" data-doc="${doc.id}"
                    aria-label="${doc.title}" aria-selected="${index === 0}">${doc.tabLabel || doc.title}</button>
                `).join('')}
              </div>
              <div class="hhr-imaging-fit" role="group" aria-label="Tamaño de la hoja">
                <button type="button" data-sheet-fit="width" aria-label="Ajustar al ancho" title="Ajustar al ancho" aria-pressed="true">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5v14M21 5v14M6 12h12m-9-3-3 3 3 3m6-6 3 3-3 3"/></svg>
                  <span>Ancho</span>
                </button>
                <button type="button" data-sheet-fit="page" aria-label="Hoja completa" title="Hoja completa" aria-pressed="false">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6V3h3m6 0h3v3m0 12v3h-3m-6 0H6v-3"/><rect x="8" y="6" width="8" height="12" rx="1"/></svg>
                  <span>Hoja completa</span>
                </button>
              </div>
            </div>
            <input class="hhr-center-search hhr-imaging-physician" type="text" maxlength="120"
              placeholder="Médico solicitante" aria-label="Médico solicitante">
            <div class="hhr-imaging-tools" role="group" aria-label="Herramientas de marcado">
              <button class="hhr-center-action hhr-imaging-tool is-active" type="button" data-tool="cross" aria-pressed="true" aria-label="Cruz" title="Cruz"><span>Cruz</span></button>
              <button class="hhr-center-action hhr-imaging-tool" type="button" data-tool="text" aria-pressed="false" aria-label="Texto" title="Texto"><span>Texto</span></button>
              <button class="hhr-center-action hhr-imaging-undo" type="button" aria-label="Deshacer" title="Deshacer"><span>Deshacer</span></button>
            </div>
          </div>
          <div class="hhr-imaging-stage" data-fit="width">
            <div class="hhr-imaging-canvas" role="group" tabindex="0"
              aria-label="Formulario de imágenes" aria-describedby="hhr-imaging-keyboard-hint">
              <span id="hhr-imaging-keyboard-hint">Flechas para mover · Enter para marcar</span>
              <img class="hhr-imaging-image" alt="" draggable="false">
              <div class="hhr-imaging-overlays"></div>
            </div>
          </div>
          <div class="hhr-connection-feedback hhr-imaging-feedback" role="status" aria-live="polite"></div>
        </div>
      `;
  const reports = () => `
    <div class="hhr-labreq-patient-source hhr-census-anchor">
      <strong>Paciente</strong>
      ${globalThis.HhrLabRequestPatient.pickerButtonHtml()}
      ${globalThis.HhrLabRequestPatient.routeNoticeHtml}
    </div>
    <div class="hhr-imaging-reports">
      <a class="hhr-center-action hhr-center-action-primary" href="${globalThis.HhrFavoriteLinks.mmradUrl}"
        target="_blank" rel="noopener noreferrer">Abrir MMRAD <span aria-hidden="true">↗</span></a>
      <span class="hhr-rx-meta">Selecciona al paciente en el portal de radiología.</span>
    </div>`;
  const bindSheet = (main, patient, onEdit) => {
    const stage = main.querySelector('.hhr-imaging-stage');
    const patientFields = main.querySelector('.hhr-labreq-patient');
    const summary = main.querySelector('.hhr-imaging-patient-summary');
    const name = summary.querySelector('.hhr-imaging-patient-name');
    const identifier = summary.querySelector('.hhr-imaging-patient-id');
    const fitButtons = main.querySelectorAll('[data-sheet-fit]');
    const showSummary = collapsed => {
      const identity = patient.printablePatient();
      patientFields.hidden = collapsed && Boolean(identity);
      summary.hidden = !patientFields.hidden;
      name.textContent = summary.hidden ? '' : identity.name || identity.run ||
        (patient.source() === 'blank' ? 'Sin identificación' : 'Datos personalizados');
      name.title = name.textContent;
      identifier.textContent = !summary.hidden && identity.run && identity.run !== name.textContent ? identity.run : '';
      identifier.hidden = !identifier.textContent;
    };
    const setFit = mode => {
      stage.dataset.fit = mode === 'page' ? 'page' : 'width';
      fitButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sheetFit === stage.dataset.fit)));
      stage.scrollTop = 0;
    };
    summary.querySelector('button').addEventListener('click', () => {
      showSummary(false);
      onEdit('collapsed');
      const field = patient.source() === 'manual' ? '[data-manual="name"]' :
        patient.source() === 'blank' ? 'input[value="blank"]' : '.hhr-census-trigger';
      patientFields.querySelector(field).focus();
    });
    fitButtons.forEach(button => button.addEventListener('click', () => {
      setFit(button.dataset.sheetFit);
      onEdit('fit');
    }));
    return {
      marked() { showSummary(true); onEdit('collapsed'); },
      refresh() { showSummary(patientFields.hidden); },
      capture() { return { collapsed: patientFields.hidden, fit: stage.dataset.fit }; },
      restore(state) { showSummary(state.collapsed === true); setFit(state.fit); },
    };
  };
  globalThis.HhrImagingRequestView = Object.freeze({ markup, reports, bindSheet });
})();
