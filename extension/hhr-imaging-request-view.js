/** Markup for the official imaging request workspace. */
(() => {
  'use strict';
  const markup = (documents, encId) => `
        <div class="hhr-center-toolbar">
          <h2 class="hhr-center-heading">Imágenes</h2>
          <div class="hhr-rx-tabs hhr-flow-tabs" role="tablist" aria-label="Flujo de imágenes">
            <button class="hhr-rx-tab" type="button" role="tab" data-flow="request" aria-selected="true">Solicitar</button>
            <button class="hhr-rx-tab" type="button" role="tab" data-flow="reports" aria-selected="false">Ver informes</button>
          </div>
        </div>
        <div class="hhr-center-content">
          ${globalThis.HhrLabRequestPatient.sectionHtml(encId, true)}
          <div class="hhr-rx-tabs hhr-imaging-tabs" role="tablist" aria-label="Documento">
            ${Object.values(documents).map((doc, index) => `
              <button class="hhr-rx-tab" type="button" role="tab" data-doc="${doc.id}" aria-selected="${index === 0}">${doc.title}</button>
            `).join('')}
          </div>
          <div class="hhr-imaging-controls">
            <input class="hhr-center-search hhr-imaging-physician" type="text" maxlength="120"
              placeholder="Médico solicitante (nombre y apellido)" aria-label="Médico solicitante">
            <div class="hhr-imaging-tools" role="group" aria-label="Herramientas de marcado">
              <button class="hhr-center-action hhr-imaging-tool is-active" type="button" data-tool="cross" aria-pressed="true">✕ Cruz</button>
              <button class="hhr-center-action hhr-imaging-tool" type="button" data-tool="text" aria-pressed="false">T Texto</button>
              <button class="hhr-center-action hhr-imaging-undo" type="button">Deshacer</button>
            </div>
            <button class="hhr-center-action hhr-center-action-primary hhr-imaging-print" type="button" disabled>Imprimir</button>
          </div>
          <p class="hhr-imaging-hint" id="hhr-imaging-keyboard-hint">Haz clic para marcar, o mueve el cursor con las flechas y pulsa Enter.</p>
          <div class="hhr-imaging-stage">
            <div class="hhr-imaging-canvas" role="group" tabindex="0"
              aria-describedby="hhr-imaging-keyboard-hint"
              aria-label="Formulario de imágenes. Usa las flechas para mover el cursor y Enter para marcar.">
              <img class="hhr-imaging-image" alt="" draggable="false">
              <div class="hhr-imaging-overlays"></div>
            </div>
          </div>
          <div class="hhr-connection-feedback hhr-imaging-feedback" role="status" aria-live="polite"></div>
        </div>
      `;
  globalThis.HhrImagingRequestView = Object.freeze({ markup });
})();
