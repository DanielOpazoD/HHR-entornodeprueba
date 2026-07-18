/**
 * hhr-imaging-center.js
 *
 * Owns the Centro HHR imaging request surface. The host content script keeps
 * the shared shell, navigation, and patient context orchestration.
 */
(() => {
  'use strict';

  if (globalThis.HhrImagingCenterRuntime) return;

  const create = dependencies => {
    const {
      requestForms,
      runtimeMessages,
      sendMessage,
      setLiveRegion,
      fetchPatientHeaderView,
    } = dependencies || {};

    if (
      !runtimeMessages ||
      typeof sendMessage !== 'function' ||
      typeof setLiveRegion !== 'function' ||
      typeof fetchPatientHeaderView !== 'function'
    ) {
      throw new Error('No se pudo inicializar el Centro de Imágenes HHR.');
    }

    const renderImagingCenter = (root, encId) => {
      const main = root.querySelector('.hhr-center-main');
      if (!requestForms) {
        main.innerHTML = '<div class="hhr-center-toolbar"><h2 class="hhr-center-heading">Imágenes</h2></div>' +
          '<div class="hhr-center-content"><div class="hhr-rx-error">Los formularios de solicitud no quedaron cargados. Recarga la extensión y la pestaña.</div></div>';
        return;
      }
      const documents = requestForms.IMAGING_DOCUMENTS;
      main.innerHTML = `
        <div class="hhr-center-toolbar">
          <h2 class="hhr-center-heading">Imágenes</h2>
          <div class="hhr-rx-tabs hhr-flow-tabs" role="tablist" aria-label="Flujo de imágenes">
            <button class="hhr-rx-tab" type="button" role="tab" data-flow="request" aria-selected="true">Solicitar</button>
            <button class="hhr-rx-tab" type="button" role="tab" data-flow="reports" aria-selected="false">Ver informes</button>
          </div>
        </div>
        <div class="hhr-center-content">
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
          <p class="hhr-imaging-hint" id="hhr-imaging-keyboard-hint">Los datos del paciente se completan solos. Haz clic sobre el formulario o usa las flechas para mover el cursor y Enter para marcar; lo que agregues se imprime en el PDF oficial.</p>
          <div class="hhr-imaging-stage">
            <div class="hhr-imaging-canvas" role="group" tabindex="0"
              aria-describedby="hhr-imaging-keyboard-hint"
              aria-label="Vista previa del formulario. Usa las flechas para mover el cursor y Enter para marcar.">
              <img class="hhr-imaging-image" alt="" draggable="false">
              <div class="hhr-imaging-overlays"></div>
            </div>
          </div>
          <div class="hhr-connection-feedback hhr-imaging-feedback" role="status" aria-live="polite"></div>
        </div>
      `;
      const physicianInput = main.querySelector('.hhr-imaging-physician');
      const printButton = main.querySelector('.hhr-imaging-print');
      const undoButton = main.querySelector('.hhr-imaging-undo');
      const canvas = main.querySelector('.hhr-imaging-canvas');
      const image = main.querySelector('.hhr-imaging-image');
      const overlaysHost = main.querySelector('.hhr-imaging-overlays');
      const feedback = main.querySelector('.hhr-imaging-feedback');
      const docTabs = Array.from(main.querySelectorAll('.hhr-imaging-tabs .hhr-rx-tab'));
      const contentHost = main.querySelector('.hhr-center-content');
      main.querySelector('.hhr-flow-tabs [data-flow="reports"]').addEventListener('click', event => {
        main.querySelectorAll('.hhr-flow-tabs .hhr-rx-tab').forEach(tab =>
          tab.setAttribute('aria-selected', String(tab === event.currentTarget)));
        contentHost.innerHTML = `
          <div class="hhr-connection-grid" style="padding-top:12px">
            <section class="hhr-connection-card">
              <div class="hhr-connection-card-header">
                <span class="hhr-connection-icon">IMG</span>
                <div><h3>Visualizar informes</h3><span class="hhr-connection-status">En preparación</span></div>
              </div>
              <div class="hhr-connection-user">Resultados de imagenología
                <span class="hhr-connection-detail">La visualización de informes radiológicos dentro de este panel está en preparación. Por ahora revísalos en el visor habitual del servicio; la solicitud sigue disponible en la pestaña «Solicitar».</span>
              </div>
            </section>
          </div>`;
      });
      main.querySelector('.hhr-flow-tabs [data-flow="request"]').addEventListener('click', () =>
        renderImagingCenter(root, encId)
      );
      if (!/^\d+$/.test(String(encId || ''))) {
        main.querySelector('.hhr-center-content').innerHTML =
          '<div class="hhr-center-empty">Selecciona un paciente con «Cambiar paciente» en la franja superior para autocompletar y solicitar imágenes.</div>';
        return;
      }

      let selectedDoc = 'solicitud';
      let toolMode = 'cross';
      let patientView = null;
      const marksByDoc = { solicitud: [], encuesta: [], consentimiento: [] };
      const keyboardPoint = { x: 50, y: 50 };
      let keyboardActive = false;

      const setFeedback = (message, error = false) => {
        feedback.className = 'hhr-connection-feedback hhr-imaging-feedback' + (error ? ' is-error' : '');
        setLiveRegion(feedback, message, error ? 'error' : '');
      };

      const renderOverlays = () => {
        overlaysHost.innerHTML = '';
        const doc = documents[selectedDoc];
        if (patientView) {
          doc.overlays(patientView, physicianInput.value.trim()).forEach(overlay => {
            if (!overlay.text) return;
            const node = document.createElement('div');
            node.className = 'hhr-imaging-overlay' +
              (overlay.bold ? ' is-bold' : '') + (overlay.small ? ' is-small' : '');
            node.textContent = overlay.text;
            node.style.left = overlay.left;
            node.style.top = overlay.top;
            overlaysHost.appendChild(node);
          });
        }
        marksByDoc[selectedDoc].forEach(mark => {
          const node = document.createElement('div');
          node.className = 'hhr-imaging-mark' + (mark.text ? ' is-text' : '');
          node.textContent = mark.text ? mark.text.toUpperCase() : 'X';
          node.style.left = mark.x + '%';
          node.style.top = mark.y + '%';
          overlaysHost.appendChild(node);
        });
        if (keyboardActive) {
          const cursor = document.createElement('div');
          cursor.className = 'hhr-imaging-keyboard-cursor';
          cursor.style.left = keyboardPoint.x + '%';
          cursor.style.top = keyboardPoint.y + '%';
          cursor.setAttribute('aria-hidden', 'true');
          overlaysHost.appendChild(cursor);
        }
        undoButton.disabled = marksByDoc[selectedDoc].length === 0;
      };

      const renderDocument = () => {
        const doc = documents[selectedDoc];
        canvas.style.aspectRatio = doc.aspectRatio.replace(/\s/g, '');
        try {
          image.src = chrome.runtime.getURL(doc.image);
        } catch (_error) {}
        docTabs.forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.doc === selectedDoc)));
        renderOverlays();
      };

      const openTextEditor = (x, y) => {
        const editor = document.createElement('input');
        let restoreCanvasFocus = false;
        editor.type = 'text';
        editor.maxLength = 80;
        editor.className = 'hhr-imaging-text-editor';
        editor.style.left = x + '%';
        editor.style.top = y + '%';
        editor.setAttribute('aria-label', 'Texto libre sobre el formulario');
        const commit = () => {
          const text = editor.value.trim();
          editor.remove();
          if (text) {
            marksByDoc[selectedDoc].push({ x, y, text });
          }
          if (!restoreCanvasFocus) keyboardActive = false;
          renderOverlays();
          if (restoreCanvasFocus && canvas.isConnected) {
            window.setTimeout(() => canvas.focus({ preventScroll: true }), 0);
          }
        };
        editor.addEventListener('blur', commit);
        editor.addEventListener('keydown', event => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            restoreCanvasFocus = true;
            editor.blur();
          }
          if (event.key === 'Escape') {
            editor.value = '';
            restoreCanvasFocus = true;
            editor.blur();
          }
        });
        overlaysHost.appendChild(editor);
        editor.focus();
      };

      canvas.addEventListener('click', event => {
        if (!patientView) return;
        if (event.target.closest('.hhr-imaging-text-editor')) return;
        const rect = canvas.getBoundingClientRect();
        const x = Math.round(((event.clientX - rect.left) / rect.width) * 1000) / 10;
        const y = Math.round(((event.clientY - rect.top) / rect.height) * 1000) / 10;
        if (toolMode === 'text') openTextEditor(x, y);
        else {
          marksByDoc[selectedDoc].push({ x, y });
          renderOverlays();
        }
      });
      canvas.addEventListener('focus', () => {
        keyboardActive = true;
        renderOverlays();
      });
      canvas.addEventListener('blur', event => {
        if (
          event.relatedTarget &&
          typeof event.relatedTarget.closest === 'function' &&
          event.relatedTarget.closest('.hhr-imaging-text-editor')
        ) return;
        keyboardActive = false;
        renderOverlays();
      });
      canvas.addEventListener('keydown', event => {
        const step = event.shiftKey ? 5 : 1;
        if (event.key === 'ArrowLeft') keyboardPoint.x = Math.max(0, keyboardPoint.x - step);
        else if (event.key === 'ArrowRight') keyboardPoint.x = Math.min(100, keyboardPoint.x + step);
        else if (event.key === 'ArrowUp') keyboardPoint.y = Math.max(0, keyboardPoint.y - step);
        else if (event.key === 'ArrowDown') keyboardPoint.y = Math.min(100, keyboardPoint.y + step);
        else if ((event.key === 'Enter' || event.key === ' ') && patientView) {
          event.preventDefault();
          if (toolMode === 'text') openTextEditor(keyboardPoint.x, keyboardPoint.y);
          else {
            marksByDoc[selectedDoc].push({ x: keyboardPoint.x, y: keyboardPoint.y });
            renderOverlays();
          }
          return;
        } else return;
        event.preventDefault();
        keyboardActive = true;
        renderOverlays();
      });
      main.querySelectorAll('.hhr-imaging-tool').forEach(button => {
        button.addEventListener('click', () => {
          toolMode = button.dataset.tool;
          main.querySelectorAll('.hhr-imaging-tool').forEach(candidate => {
            const active = candidate === button;
            candidate.classList.toggle('is-active', active);
            candidate.setAttribute('aria-pressed', String(active));
          });
        });
      });
      undoButton.addEventListener('click', () => {
        marksByDoc[selectedDoc].pop();
        renderOverlays();
      });
      docTabs.forEach(tab => tab.addEventListener('click', () => {
        if (tab.dataset.doc === selectedDoc) return;
        selectedDoc = tab.dataset.doc;
        renderDocument();
      }));
      physicianInput.addEventListener('input', () => {
        renderOverlays();
      });

      printButton.addEventListener('click', async () => {
        printButton.disabled = true;
        printButton.textContent = 'Generando PDF…';
        setFeedback('Rellenando la plantilla oficial…');
        const result = await sendMessage({
          type: runtimeMessages.IMAGING_FORM_PRINT_REQUEST,
          encId,
          doc: selectedDoc,
          physician: physicianInput.value.trim(),
          marks: marksByDoc[selectedDoc],
        });
        if (!root.isConnected) return;
        printButton.disabled = false;
        printButton.textContent = 'Imprimir';
        if (!result || result.error) {
          setFeedback((result && result.error) || 'No se pudo generar el formulario.', true);
          return;
        }
        setFeedback('Se abrió el PDF con el diálogo de impresión. Puedes seguir marcando e imprimir de nuevo.');
      });

      renderDocument();
      fetchPatientHeaderView(encId).then(result => {
        if (!root.isConnected || root.dataset.activeModule !== 'imaging') return;
        if (result.error) {
          setFeedback(result.error, true);
          return;
        }
        patientView = result.view;
        printButton.disabled = false;
        renderDocument();
      });
    };

    return Object.freeze({ renderImagingCenter });
  };

  globalThis.HhrImagingCenterRuntime = Object.freeze({ create });
})();
