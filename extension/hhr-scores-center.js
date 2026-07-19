/**
 * hhr-scores-center.js
 *
 * Owns the Centro HHR Scores surface. The host content script keeps the shared
 * shell, navigation, patient context, and clinical transition policy.
 */
(() => {
  'use strict';

  const scoresPresentation = globalThis.HhrScoresPresentation;

  const create = dependencies => {
    const {
      helper,
      runtimeMessages,
      runClinicalTransition,
      normalizedText,
      sendMessage,
      setLiveRegion,
      clinicalWriteKey,
      hydrateClinicalWriteProtection,
      setClinicalGuardState,
      releaseClinicalWriteProtection,
      uncertainClinicalWrites,
      finishRouteChangeWrite,
      acknowledgeClinicalWrite,
      clinicalWriteRecoveryReady,
      getActiveUncertainWrite,
      showPageNotice,
      trapModalFocus,
    } = dependencies || {};

    const presentationFunctions = [
      'buildPatientPresentation', 'scoreFieldPresentation', 'mergeSavedScore',
      'recoveryResultPresentation',
    ];
    const dependencyFunctions = [
      runClinicalTransition, normalizedText, sendMessage, setLiveRegion, clinicalWriteKey,
      hydrateClinicalWriteProtection, setClinicalGuardState, releaseClinicalWriteProtection,
      finishRouteChangeWrite, acknowledgeClinicalWrite, clinicalWriteRecoveryReady,
      getActiveUncertainWrite, showPageNotice, trapModalFocus,
    ];
    if (!scoresPresentation || !helper || !runtimeMessages ||
      presentationFunctions.some(name => typeof scoresPresentation[name] !== 'function') ||
      dependencyFunctions.some(value => typeof value !== 'function') ||
      !(uncertainClinicalWrites instanceof Map)) {
      throw new Error('No se pudo inicializar el Centro de Scores HHR.');
    }

  const renderDescriptor = descriptor => {
    const element = document.createElement(descriptor.tag);
    if (descriptor.className) element.className = descriptor.className;
    if (descriptor.title) element.title = descriptor.title;
    element.textContent = descriptor.text || '';
    Object.assign(element, descriptor.properties || {});
    Object.entries(descriptor.attributes || {}).forEach(([name, value]) => {
      element.setAttribute(name, value);
    });
    Object.entries(descriptor.dataset || {}).forEach(([key, value]) => {
      element.dataset[key] = value;
    });
    (descriptor.children || []).forEach(child => {
      element.appendChild(renderDescriptor(child));
    });
    return element;
  };

  const renderScoresCenter = (root, encId) => {
    const main = root.querySelector('.hhr-center-main');
    main.innerHTML = `
      <div class="hhr-center-toolbar">
        <h2 class="hhr-center-heading">Scores</h2>
        <select class="hhr-center-select hhr-score-selector" aria-label="Instrumento global">
          <option value="CUDYR">CUDYR</option><option value="DOWNTON">Downton</option><option value="BRADEN">Braden</option>
        </select>
        <input class="hhr-center-search" type="search" placeholder="Buscar paciente, RUN o cama" aria-label="Buscar paciente">
        <button class="hhr-center-action hhr-center-refresh" type="button">Actualizar</button>
      </div>
      <div class="hhr-center-content"><div class="hhr-center-empty">Leyendo instrumentos desde Eloísa…</div></div>
    `;
    const content = main.querySelector('.hhr-center-content');
    const selector = main.querySelector('.hhr-score-selector');
    const search = main.querySelector('.hhr-center-search');
    main.querySelector('.hhr-center-refresh').addEventListener('click', () => {
      runClinicalTransition(root, () => renderScoresCenter(root, encId), { allowUncertain: true });
    });

    sendMessage({ type: runtimeMessages.SCORES_OPTIONS_REQUEST, currentEncId: encId || '' }).then(response => {
      if (!root.isConnected || root.dataset.activeModule !== 'scores') return;
      if (!response || response.error) {
        content.innerHTML = '';
        const error = renderDescriptor({
          tag: 'div', className: 'hhr-rx-error',
          text: (response && response.error) || 'No se pudieron leer los instrumentos.',
        });
        content.appendChild(error);
        return;
      }
      const patients = Array.isArray(response.patients) ? response.patients : [];
      const openScoreForm = (patient, instrument, rerender) => {
        const focusReturnTarget = document.activeElement;
        const scoreKey = clinicalWriteKey('score', patient.encounterId, instrument);
        if (getActiveUncertainWrite(scoreKey)) {
          showPageNotice(
            'Esta aplicación no pudo confirmarse y permanece protegida hasta revisar su estado en Eloísa.',
            { title: instrument + ' · verificación pendiente' }
          );
          return;
        }
        const previous = main.querySelector('.hhr-score-form');
        if (previous) {
          runClinicalTransition(root, () => {
            previous.remove();
            openScoreForm(patient, instrument, rerender);
          }, { allowUncertain: true });
          return;
        }
        const panel = document.createElement('section');
        panel.className = 'hhr-score-form';
        panel.setAttribute('aria-label', 'Registrar ' + instrument);
        panel.innerHTML = `
          <div class="hhr-score-form-header"><strong></strong><button class="hhr-score-form-close" type="button" aria-label="Cerrar">&times;</button></div>
          <div class="hhr-score-form-body"><div class="hhr-center-empty">Cargando formulario oficial…</div></div>
          <div class="hhr-score-form-footer"><span class="hhr-score-preview" role="status" aria-live="polite" aria-atomic="true">Sin calcular</span><button class="hhr-center-action hhr-center-action-primary hhr-score-save" type="button" disabled>Guardar</button></div>
        `;
        panel.querySelector('strong').textContent = instrument + ' · ' + (patient.name || 'Paciente');
        const state = { saving: false, saved: false, uncertain: false };
        const panelClose = panel.querySelector('.hhr-score-form-close');
        const closePanel = () => {
          runClinicalTransition(root, () => {
            panel.remove();
            if (focusReturnTarget && focusReturnTarget.isConnected && typeof focusReturnTarget.focus === 'function') {
              focusReturnTarget.focus();
            } else if (selector && selector.isConnected) {
              selector.focus();
            }
          });
        };
        panelClose.addEventListener('click', closePanel);
        panel.addEventListener('keydown', event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closePanel();
            return;
          }
          trapModalFocus(panel, event);
        });
        main.appendChild(panel);
        panelClose.focus();
        sendMessage({
          type: runtimeMessages.SCORE_FORM_REQUEST,
          batchId: response.batchId,
          encId: patient.encounterId,
          instrument,
        }).then(formResponse => {
          if (!panel.isConnected) return;
          const body = panel.querySelector('.hhr-score-form-body');
          const save = panel.querySelector('.hhr-score-save');
          const preview = panel.querySelector('.hhr-score-preview');
          body.innerHTML = '';
          if (!formResponse || formResponse.error) {
            const error = renderDescriptor({
              tag: 'div', className: 'hhr-rx-error',
              text: (formResponse && formResponse.error) || 'No se pudo cargar el instrumento.',
            });
            error.setAttribute('role', 'alert');
            body.appendChild(error);
            return;
          }
          const definition = formResponse.definition;
          const controls = [];
          let calculatedValue = '';
          (Array.isArray(definition.fields) ? definition.fields : []).forEach((field, index) => {
            const fieldView = scoresPresentation.scoreFieldPresentation({
              field, index, encounterId: patient.encounterId, instrument,
            });
            const wrapper = renderDescriptor(fieldView.descriptor);
            const control = wrapper.querySelector('.hhr-score-control');
            body.appendChild(wrapper);
            controls.push({ field, control });
          });
          const readAnswers = () => Object.fromEntries(controls.map(({ field, control }) => [
            field.id,
            control.multiple
              ? Array.from(control.selectedOptions).map(option => option.value).join(',')
              : control.value,
          ]));
          const setControlsDisabled = disabled => controls.forEach(({ control }) => {
            control.disabled = disabled;
          });
          const updatePreview = () => {
            if (state.saving || state.saved || state.uncertain) {
              save.disabled = true;
              return;
            }
            const answered = controls.some(({ control }) => control.multiple
              ? control.selectedOptions.length > 0
              : Boolean(control.value));
            setClinicalGuardState(root, 'dirty', scoreKey, answered);
            const requiredControls = controls.filter(item => item.field.required !== false);
            const complete = requiredControls.length > 0 && requiredControls.every(({ control }) =>
              control.multiple ? control.selectedOptions.length > 0 : Boolean(control.value.trim())
            );
            save.disabled = !complete;
            calculatedValue = '';
            if (!complete) {
              setLiveRegion(preview, answered ? 'Faltan respuestas' : 'Sin calcular');
              return;
            }
            if (instrument === 'CUDYR') {
              let dependency = 0;
              let risk = 0;
              controls.forEach(({ field, control }) => {
                if (Number(field.typeId) === 1) dependency += Number(control.value || 0);
                if (Number(field.typeId) === 2) risk += Number(control.value || 0);
              });
              const dependencyClass = dependency <= 6 ? 3 : dependency <= 12 ? 2 : 1;
              const riskClass = risk <= 5 ? 'D' : risk <= 11 ? 'C' : risk <= 18 ? 'B' : 'A';
              calculatedValue = riskClass + dependencyClass;
              setLiveRegion(preview, 'Resultado ' + calculatedValue + ' · D ' + dependency + ' / R ' + risk);
              return;
            }
            let total = 0;
            controls.forEach(({ control }) => {
              Array.from(control.selectedOptions || []).forEach(option => { total += Number(option.dataset.score || 0); });
            });
            const result = (definition.results || []).find(item => total >= item.minScore && total <= item.maxScore);
            calculatedValue = String(total);
            setLiveRegion(
              preview,
              'Puntaje ' + total + (result && result.valueName ? ' · ' + result.valueName : '')
            );
          };
          controls.forEach(({ control }) => control.addEventListener('change', updatePreview));
          controls.forEach(({ control }) => control.addEventListener('input', updatePreview));
          updatePreview();
          save.addEventListener('click', async () => {
            if (state.saving || state.saved || state.uncertain || !calculatedValue) return;
            const submittedAnswers = readAnswers();
            const submittedValue = calculatedValue;
            const startedAt = Date.now();
            state.saving = true;
            save.disabled = true;
            save.textContent = 'Guardando…';
            setLiveRegion(preview, 'Verificando en Eloísa…');
            setControlsDisabled(true);
            setClinicalGuardState(root, 'dirty', scoreKey, false);
            setClinicalGuardState(root, 'pending', scoreKey, true);
            const result = await sendMessage({
              type: runtimeMessages.SCORE_SAVE_REQUEST,
              batchId: response.batchId,
              encId: patient.encounterId,
              instrument,
              answers: submittedAnswers,
            });
            setClinicalGuardState(root, 'pending', scoreKey, false);
            if (!result || result.error) {
              const mayHaveSucceeded = Boolean(result && result.writeMayHaveSucceeded);
              state.saving = false;
              state.uncertain = mayHaveSucceeded;
              if (mayHaveSucceeded) {
                uncertainClinicalWrites.set(scoreKey, {
                  expectedValue: submittedValue,
                  startedAt,
                  error: result.error || '',
                });
                setClinicalGuardState(root, 'uncertain', scoreKey, true);
                setClinicalGuardState(root, 'dirty', scoreKey, false);
              } else {
                setControlsDisabled(false);
                setClinicalGuardState(root, 'dirty', scoreKey, true);
              }
              if (!panel.isConnected) return;
              save.textContent = mayHaveSucceeded ? 'Bloqueado' : 'Reintentar';
              save.disabled = mayHaveSucceeded;
              setLiveRegion(
                preview,
                mayHaveSucceeded ? 'No verificado · protegido' : 'Error al guardar',
                mayHaveSucceeded ? 'uncertain' : 'error'
              );
              const error = renderDescriptor({
                tag: 'div', className: 'hhr-center-notice',
                text: (result && result.error) || 'No se pudo guardar el instrumento.',
              });
              error.setAttribute('role', 'alert');
              body.prepend(error);
              finishRouteChangeWrite(root, mayHaveSucceeded ? 'uncertain' : 'error');
              if (mayHaveSucceeded) renderScoresCenter(root, encId);
              return;
            }
            state.saving = false;
            state.saved = true;
            uncertainClinicalWrites.delete(scoreKey);
            setClinicalGuardState(root, 'uncertain', scoreKey, false);
            setClinicalGuardState(root, 'dirty', scoreKey, false);
            setControlsDisabled(true);
            patient.scores[instrument] = scoresPresentation.mergeSavedScore({
              instrument,
              currentScore: patient.scores[instrument],
              record: result.record,
              currentProfessional: response.currentProfessional,
            });
            const acknowledged = await acknowledgeClinicalWrite(result.clinicalWriteReceipt);
            if (!panel.isConnected) return;
            if (acknowledged.error) {
              state.saved = false;
              state.uncertain = true;
              uncertainClinicalWrites.set(scoreKey, {
                expectedValue: submittedValue,
                startedAt,
                error: 'El guardado fue verificado, pero falta confirmar su recepción local. ' +
                  acknowledged.error,
              });
              setClinicalGuardState(root, 'uncertain', scoreKey, true);
              save.textContent = 'Bloqueado';
              save.disabled = true;
              setLiveRegion(preview, 'Guardado · protegido', 'uncertain');
              finishRouteChangeWrite(root, 'uncertain');
              renderScoresCenter(root, encId);
              return;
            }
            setLiveRegion(preview, 'Sincronizado en Eloísa');
            save.textContent = 'Guardado';
            save.disabled = true;
            finishRouteChangeWrite(root, 'synced');
            rerender();
            panelClose.focus();
          });
        });
      };

      const renderTable = () => {
        content.innerHTML = '';
        const canWriteInstrument = response.canWriteByInstrument
          ? Boolean(response.canWriteByInstrument[selector.value])
          : Boolean(response.canWrite);
        if (!canWriteInstrument) {
          const notice = renderDescriptor({
            tag: 'div', className: 'hhr-center-notice',
            text: response.writeBlockedReason ||
              'La sesión permite lectura, pero no registro de este instrumento.',
          });
          content.appendChild(notice);
        }
        if (selector.value === 'CUDYR') {
          const notice = renderDescriptor({
            tag: 'div', className: 'hhr-center-notice',
            text: globalThis.HhrPrescriptionPrint.cudyrSourceNotice(response),
          });
          content.appendChild(notice);
        }
        const table = document.createElement('table');
        table.className = 'hhr-center-table hhr-scores-table';
        table.innerHTML = `
          <colgroup><col style="width:7%"><col style="width:25%"><col style="width:13%"><col style="width:15%"><col style="width:17%"><col style="width:14%"><col style="width:9%"></colgroup>
          <thead><tr><th>Cama</th><th>Paciente / RUN</th><th>Último valor</th><th>Última aplicación</th><th>Profesional</th><th>Historia</th><th>Acción</th></tr></thead><tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');
        patients.forEach(patient => {
          const instrument = selector.value;
          const scoreKey = clinicalWriteKey('score', patient.encounterId, instrument);
          const persistedProtection = patient.scoreProtections && patient.scoreProtections[instrument] || null;
          const unavailableReason = patient.scoreUnavailableReasons && patient.scoreUnavailableReasons[instrument] || '';
          const uncertainWrite = hydrateClinicalWriteProtection(scoreKey, persistedProtection);
          setClinicalGuardState(root, 'uncertain', scoreKey, Boolean(uncertainWrite));
          const presentation = scoresPresentation.buildPatientPresentation({
            patient,
            instrument,
            unavailableReason,
            persistedProtection,
            uncertainWrite,
            canWriteInstrument,
            recoveryReady: persistedProtection
              ? clinicalWriteRecoveryReady(persistedProtection)
              : false,
            formatDateTimeLabel: helper.formatDateTimeLabel,
          });
          const row = document.createElement('tr');
          row.dataset.search = normalizedText(presentation.identity.search);
          const action = document.createElement('button');
          action.type = 'button';
          action.className = 'hhr-center-action';
          action.textContent = presentation.action.text;
          action.disabled = presentation.action.disabled;
          if (presentation.action.title) action.title = presentation.action.title;
          if (presentation.action.kind === 'recovery') {
            action.addEventListener('click', async () => {
              action.disabled = true;
              action.textContent = 'Verificando…';
              const result = await releaseClinicalWriteProtection(scoreKey, persistedProtection);
              if (!root.isConnected) return;
              const recoveryResult = scoresPresentation.recoveryResultPresentation(result);
              if (!recoveryResult.complete) {
                action.textContent = recoveryResult.text;
                action.title = recoveryResult.title;
                action.disabled = false;
                return;
              }
              uncertainClinicalWrites.delete(scoreKey);
              setClinicalGuardState(root, 'uncertain', scoreKey, false);
              renderScoresCenter(root, encId);
            });
          } else {
            action.addEventListener('click', () => openScoreForm(patient, instrument, renderTable));
          }
          const actionCell = renderDescriptor({ tag: 'td', dataset: { label: 'Acción' } });
          actionCell.appendChild(action);
          row.append(...presentation.rowCells.map(renderDescriptor), actionCell);
          tbody.appendChild(row);
        });
        content.appendChild(table);
        const query = normalizedText(search.value);
        tbody.querySelectorAll('tr').forEach(row => { row.hidden = Boolean(query) && !row.dataset.search.includes(query); });
      };
      let selectedInstrument = selector.value;
      selector.addEventListener('change', () => {
        const nextInstrument = selector.value;
        selector.value = selectedInstrument;
        runClinicalTransition(root, () => {
          selectedInstrument = nextInstrument;
          selector.value = nextInstrument;
          const openPanel = main.querySelector('.hhr-score-form');
          if (openPanel) openPanel.remove();
          renderTable();
        }, { allowUncertain: true });
      });
      search.addEventListener('input', renderTable);
      renderTable();
    });
  };

    return Object.freeze({ renderScoresCenter });
  };

  globalThis.HhrScoresCenterRuntime = Object.freeze({ create });
})();
