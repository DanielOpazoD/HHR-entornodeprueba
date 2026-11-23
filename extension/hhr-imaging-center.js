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
      globalThis.HhrRequestDrafts?.checkpoint(root);
      root.dataset.selectedEncounterId = String(encId || '');
      const main = root.querySelector('.hhr-center-main');
      if (!requestForms) {
        main.innerHTML = '<div class="hhr-center-toolbar"><h2 class="hhr-center-heading">Imágenes</h2></div>' +
          '<div class="hhr-center-content"><div class="hhr-rx-error">Los formularios de solicitud no quedaron cargados. Recarga la extensión y la pestaña.</div></div>';
        return;
      }
      const documents = requestForms.IMAGING_DOCUMENTS;
      main.innerHTML = globalThis.HhrImagingRequestView.markup(documents, encId);
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
      let selectedDoc = 'solicitud';
      let toolMode = 'cross';
      let episodePatient;
      let printing = false;
      const patient = globalThis.HhrLabRequestPatient.createController({ main, readEpisodePatient: () => episodePatient });
      const refreshPatient = () => {
        const local = patient.usesLocalPatient();
        const chosen = patient.printablePatient();
        globalThis.HhrCenterPatientContext?.set(root, {
          encId: local ? '' : encId,
          patient: local ? { ...chosen, name: chosen?.name || patient.localLabel() } : episodePatient?.patient,
        });
        globalThis.HhrCenterPatientContext?.refreshRoute(root, globalThis.HhrPrescriptionPrint?.resolveEncounterId(location.href) || '');
        patient.refresh();
        printButton.disabled = printing || !chosen;
        renderOverlays();
      };
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
        const patientView = patient.usesLocalPatient()
          ? requestForms.buildPatientView(patient.printablePatient() || {}) : episodePatient?.view;
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
      const draft = globalThis.HhrRequestDrafts?.attach({ root, main, kind: 'imaging', encId,
        isManual: value => ['manual', 'blank'].includes(value.source),
        fieldForEvent: event => event.target.dataset.manual ? ['custom', event.target.dataset.manual] :
          event.target.name === 'hhr-labreq-patient-source' ? 'source' : event.target === physicianInput ? 'physician' :
          event.target.matches('.hhr-imaging-text-editor') ? ['marksByDoc', selectedDoc] : null,
        capture: () => ({ selectedDoc, toolMode, physician: physicianInput.value, marksByDoc,
          source: patient.source(), custom: Object.fromEntries(Array.from(main.querySelectorAll('[data-manual]'), input => [input.dataset.manual, input.value])) }),
        restore: state => {
          const sources = [...main.querySelectorAll('[name="hhr-labreq-patient-source"]')];
          const restored = sources.find(input => input.value === state.source && !input.disabled);
          if (restored) restored.checked = true;
          for (const input of main.querySelectorAll('[data-manual]')) input.value = state.custom?.[input.dataset.manual] || '';
          if (documents[state.selectedDoc]) selectedDoc = state.selectedDoc;
          toolMode = state.toolMode === 'text' ? 'text' : 'cross'; physicianInput.value = state.physician;
          Object.keys(marksByDoc).forEach(key => { marksByDoc[key] = state.marksByDoc[key] || []; });
          main.querySelectorAll('.hhr-imaging-tool').forEach(button => {
            const active = button.dataset.tool === toolMode; button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
          });
          refreshPatient(); renderDocument();
        } });

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
            draft?.markEdited(['marksByDoc', selectedDoc]);
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
        if (!patient.printablePatient()) return;
        if (event.target.closest('.hhr-imaging-text-editor')) return;
        draft?.markEdited(['marksByDoc', selectedDoc]);
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
        else if ((event.key === 'Enter' || event.key === ' ') && patient.printablePatient()) {
          event.preventDefault();
          draft?.markEdited(['marksByDoc', selectedDoc]);
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
          draft?.markEdited('toolMode');
          toolMode = button.dataset.tool;
          main.querySelectorAll('.hhr-imaging-tool').forEach(candidate => {
            const active = candidate === button;
            candidate.classList.toggle('is-active', active);
            candidate.setAttribute('aria-pressed', String(active));
          });
        });
      });
      undoButton.addEventListener('click', () => {
        draft?.markEdited(['marksByDoc', selectedDoc]);
        marksByDoc[selectedDoc].pop();
        renderOverlays();
      });
      docTabs.forEach(tab => tab.addEventListener('click', () => {
        if (tab.dataset.doc === selectedDoc) return;
        draft?.markEdited('selectedDoc');
        selectedDoc = tab.dataset.doc;
        renderDocument();
      }));
      physicianInput.addEventListener('input', () => {
        renderOverlays();
      });

      printButton.addEventListener('click', async () => {
        if (printing || !patient.printablePatient()) return;
        printing = true;
        printButton.disabled = true;
        printButton.textContent = 'Generando PDF…';
        setFeedback('Rellenando la plantilla oficial…');
        const result = await sendMessage({
          ...(patient.usesLocalPatient()
            ? { type: runtimeMessages.LOCAL_IMAGING_FORM_PRINT_REQUEST, source: patient.source(), patient: patient.printablePatient() }
            : { type: runtimeMessages.IMAGING_FORM_PRINT_REQUEST, encId }),
          doc: selectedDoc,
          physician: physicianInput.value.trim(),
          marks: marksByDoc[selectedDoc],
        });
        if (!printButton.isConnected) return;
        printing = false; refreshPatient();
        printButton.textContent = 'Imprimir';
        if (!result || result.error) {
          setFeedback(result?.error || 'No se pudo generar el formulario.', true);
          globalThis.HhrReadRecovery?.attach({ root, host: feedback, response: result,
            isCurrent: () => printButton.isConnected && root.dataset.selectedEncounterId === String(encId),
            retry: loadPatient, sendMessage, runtimeMessages });
          return;
        }
        setFeedback('Se abrió el PDF con el diálogo de impresión. Puedes seguir marcando e imprimir de nuevo.');
      });

      renderDocument();
      const loadPatient = async () => {
        setFeedback('');
        const result = await fetchPatientHeaderView(encId);
        if (!printButton.isConnected || root.dataset.activeModule !== 'imaging') return;
        if (result.error) {
          if (patient.usesLocalPatient()) return;
          setFeedback(result.error, true);
          globalThis.HhrReadRecovery?.attach({ root, host: feedback, response: result,
            isCurrent: () => printButton.isConnected && root.dataset.selectedEncounterId === String(encId),
            retry: loadPatient, sendMessage, runtimeMessages });
          return;
        }
        episodePatient = result;
        if (!patient.usesLocalPatient()) draft?.confirm(result.patient.patientId, result.actorId);
        refreshPatient();
      };
      main.querySelector('.hhr-labreq-patient').addEventListener('input', event => {
        if (event.target.dataset.manual) refreshPatient();
      });
      main.querySelector('.hhr-labreq-patient-source').addEventListener('change', () => {
        setFeedback('');
        if (patient.usesLocalPatient()) draft?.confirmManual();
        else if (episodePatient) draft?.confirm(episodePatient.patient.patientId, episodePatient.actorId);
        else void loadPatient();
        refreshPatient();
      });
      if (!encId) draft?.confirmManual();
      refreshPatient();
      if (encId) void loadPatient();
    };

    return Object.freeze({ renderImagingCenter });
  };

  globalThis.HhrImagingCenterRuntime = Object.freeze({ create });
})();
