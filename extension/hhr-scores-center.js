/**
 * hhr-scores-center.js
 *
 * Owns the Centro HHR Scores surface. The host content script keeps the shared
 * shell, navigation, patient context, and clinical transition policy.
 */
(() => {
  'use strict';

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

    if (
      !helper ||
      !runtimeMessages ||
      typeof runClinicalTransition !== 'function' ||
      typeof normalizedText !== 'function' ||
      typeof sendMessage !== 'function' ||
      typeof setLiveRegion !== 'function' ||
      typeof clinicalWriteKey !== 'function' ||
      typeof hydrateClinicalWriteProtection !== 'function' ||
      typeof setClinicalGuardState !== 'function' ||
      typeof releaseClinicalWriteProtection !== 'function' ||
      !(uncertainClinicalWrites instanceof Map) ||
      typeof finishRouteChangeWrite !== 'function' ||
      typeof acknowledgeClinicalWrite !== 'function' ||
      typeof clinicalWriteRecoveryReady !== 'function' ||
      typeof getActiveUncertainWrite !== 'function' ||
      typeof showPageNotice !== 'function' ||
      typeof trapModalFocus !== 'function'
    ) {
      throw new Error('No se pudo inicializar el Centro de Scores HHR.');
    }

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
        const error = document.createElement('div');
        error.className = 'hhr-rx-error';
        error.textContent = (response && response.error) || 'No se pudieron leer los instrumentos.';
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
            const error = document.createElement('div');
            error.className = 'hhr-rx-error';
            error.setAttribute('role', 'alert');
            error.textContent = (formResponse && formResponse.error) || 'No se pudo cargar el instrumento.';
            body.appendChild(error);
            return;
          }
          const definition = formResponse.definition;
          const controls = [];
          let calculatedValue = '';
          (Array.isArray(definition.fields) ? definition.fields : []).forEach((field, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'hhr-score-field';
            const label = document.createElement('label');
            label.textContent = (index + 1) + '. ' + (field.label || field.id) +
              (field.required === false ? ' (opcional)' : '');
            const safeFieldId = String(field.id || index).replace(/[^a-z0-9_-]/gi, '-');
            const controlId = 'hhr-score-' + patient.encounterId + '-' + instrument.toLowerCase() + '-' + safeFieldId + '-' + index;
            label.htmlFor = controlId;
            wrapper.appendChild(label);
            let explanation = null;
            if (field.explanation) {
              explanation = document.createElement('span');
              explanation.className = 'hhr-score-explanation';
              explanation.id = controlId + '-help';
              explanation.textContent = field.explanation;
              wrapper.appendChild(explanation);
            }
            let control;
            if (Array.isArray(field.options) && field.options.length) {
              control = document.createElement('select');
              control.className = 'hhr-score-control';
              if (field.type === 7) control.multiple = true;
              const placeholder = document.createElement('option');
              placeholder.value = '';
              placeholder.textContent = 'Seleccionar…';
              if (!control.multiple) control.appendChild(placeholder);
              field.options.forEach(option => {
                const item = document.createElement('option');
                item.value = String(instrument === 'CUDYR' ? option.value : option.id);
                item.dataset.optionId = String(option.id);
                item.dataset.score = option.score == null ? '' : String(option.score);
                item.textContent = (instrument === 'CUDYR' ? '[' + option.value + '] ' : '') + option.description;
                control.appendChild(item);
              });
            } else {
              control = document.createElement('input');
              control.className = 'hhr-score-control';
              control.type = field.type === 3 || field.type === 6 ? 'number' : field.type === 4 ? 'date' : field.type === 5 ? 'datetime-local' : 'text';
            }
            control.id = controlId;
            control.required = field.required !== false;
            if (explanation) control.setAttribute('aria-describedby', explanation.id);
            control.dataset.fieldId = field.id;
            control.dataset.typeId = field.typeId == null ? '' : String(field.typeId);
            wrapper.appendChild(control);
            body.appendChild(wrapper);
            controls.push({ field, control });
          });
          const readAnswers = () => {
            const answers = {};
            controls.forEach(({ field, control }) => {
              if (control.multiple) {
                answers[field.id] = Array.from(control.selectedOptions).map(option => option.value).join(',');
              } else {
                answers[field.id] = control.value;
              }
            });
            return answers;
          };
          const setControlsDisabled = disabled => {
            controls.forEach(({ control }) => { control.disabled = disabled; });
          };
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
              const error = document.createElement('div');
              error.className = 'hhr-center-notice';
              error.setAttribute('role', 'alert');
              error.textContent = (result && result.error) || 'No se pudo guardar el instrumento.';
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
            if (instrument === 'CUDYR') {
              const savedHistoryEntry = {
                category: String(result.record.total),
                recordedAt: result.record.dateTime,
                author: response.currentProfessional || '',
                authorRole: 'Enfermería',
                dependencyScore: result.record.dependency,
                riskScore: result.record.risk,
                items: [],
              };
              patient.scores.CUDYR = {
                crdValue: savedHistoryEntry.category,
                crdDateTime: savedHistoryEntry.recordedAt,
                author: savedHistoryEntry.author,
                authorRole: savedHistoryEntry.authorRole,
                source: 'ficha_medico',
                history: [savedHistoryEntry].concat(
                  patient.scores.CUDYR && Array.isArray(patient.scores.CUDYR.history)
                    ? patient.scores.CUDYR.history
                    : []
                ).slice(0, 20),
              };
            } else {
              patient.scores[instrument] = [result.record].concat(patient.scores[instrument] || []).slice(0, 8);
            }
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
          const notice = document.createElement('div');
          notice.className = 'hhr-center-notice';
          notice.textContent = response.writeBlockedReason || 'La sesión permite lectura, pero no registro de este instrumento.';
          content.appendChild(notice);
        }
        if (selector.value === 'CUDYR') {
          const notice = document.createElement('div');
          notice.className = 'hhr-center-notice';
          notice.textContent = globalThis.HhrPrescriptionPrint.cudyrSourceNotice(response);
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
          const raw = patient.scores && patient.scores[instrument];
          const unavailableReason = patient.scoreUnavailableReasons && patient.scoreUnavailableReasons[instrument] || '';
          const history = unavailableReason
            ? []
            : instrument === 'CUDYR'
              ? raw && Array.isArray(raw.history) && raw.history.length
                ? raw.history.map(item => ({
                    total: item.category,
                    dateTime: item.recordedAt,
                    author: item.author || '',
                    authorRole: item.authorRole || '',
                    dependencyScore: item.dependencyScore,
                    riskScore: item.riskScore,
                  }))
                : raw && raw.crdValue
                  ? [{
                      total: raw.crdValue,
                      dateTime: raw.crdDateTime,
                      author: raw.author || '',
                      authorRole: raw.authorRole || '',
                    }]
                  : []
              : Array.isArray(raw) ? raw : [];
          const latest = history[0] || null;
          const uncertainWrite = hydrateClinicalWriteProtection(scoreKey, persistedProtection);
          setClinicalGuardState(root, 'uncertain', scoreKey, Boolean(uncertainWrite));
          const row = document.createElement('tr');
          row.dataset.search = normalizedText([patient.name, patient.run, patient.bed, patient.room, patient.service].join(' '));
          const values = [
            patient.bed || patient.room || '-',
            '',
            unavailableReason ? 'No verificable' : latest ? String(latest.total) + (latest.severity ? ' · ' + latest.severity : '') : 'Sin aplicación',
            unavailableReason ? '-' : latest ? helper.formatDateTimeLabel(latest.dateTime) || '-' : '-',
            unavailableReason ? '-' : latest && latest.author ? latest.author : '-',
          ];
          const bed = document.createElement('td'); bed.dataset.label = 'Cama'; bed.textContent = values[0];
          const patientCell = document.createElement('td');
          patientCell.dataset.label = 'Paciente';
          const name = document.createElement('span'); name.className = 'hhr-center-patient'; name.textContent = patient.name || 'Paciente sin nombre';
          const meta = document.createElement('span'); meta.className = 'hhr-center-meta'; meta.textContent = [patient.run, patient.service].filter(Boolean).join(' · ');
          patientCell.append(name, meta);
          const valueCell = document.createElement('td'); valueCell.dataset.label = 'Último valor'; valueCell.textContent = values[2];
          const dateCell = document.createElement('td'); dateCell.dataset.label = 'Última aplicación'; dateCell.textContent = values[3];
          const authorCell = document.createElement('td');
          authorCell.dataset.label = 'Profesional';
          authorCell.textContent = latest && (latest.author || latest.authorRole) && !unavailableReason
            ? latest.author || latest.authorRole
            : values[4];
          if (!unavailableReason && latest && latest.author && latest.authorRole) {
            const roleMeta = document.createElement('span');
            roleMeta.className = 'hhr-center-meta';
            roleMeta.textContent = latest.authorRole;
            authorCell.appendChild(roleMeta);
          }
          const historyCell = document.createElement('td');
          historyCell.dataset.label = 'Historia';
          const details = document.createElement('details'); details.className = 'hhr-history';
          const summary = document.createElement('summary');
          summary.textContent = uncertainWrite
            ? 'Protegido · revisa el último valor'
            : unavailableReason
            ? 'Lectura no disponible'
            : instrument === 'CUDYR'
              ? history.length + (history.length === 1 ? ' categorización' : ' categorizaciones')
              : history.length + (history.length === 1 ? ' visible' : ' visibles') + ' · máx. 8/120 días';
          if (uncertainWrite) details.title = uncertainWrite.error || 'La escritura permanece protegida hasta confirmar su estado en Eloísa.';
          else if (unavailableReason) details.title = unavailableReason;
          details.appendChild(summary);
          if (!unavailableReason && history.length) {
            const list = document.createElement('ol');
            history.forEach(item => {
              const li = document.createElement('li');
              li.textContent = String(item.total) +
                (item.severity ? ' · ' + item.severity : '') + ' · ' +
                helper.formatDateTimeLabel(item.dateTime) +
                (item.author ? ' · ' + item.author : '') +
                (item.authorRole ? ' (' + item.authorRole + ')' : '') +
                (item.dependencyScore != null && item.riskScore != null
                  ? ' · Dependencia ' + item.dependencyScore + ' / Riesgo ' + item.riskScore
                  : '');
              list.appendChild(li);
            });
            details.appendChild(list);
          }
          historyCell.appendChild(details);
          const actionCell = document.createElement('td');
          actionCell.dataset.label = 'Acción';
          const action = document.createElement('button');
          action.type = 'button';
          action.className = 'hhr-center-action';
          if (persistedProtection) {
            action.textContent = clinicalWriteRecoveryReady(persistedProtection)
              ? 'Actualizar y revisar'
              : 'Espera y actualiza';
            action.disabled = Boolean(
              unavailableReason || persistedProtection.error ||
                !persistedProtection.generationId ||
                !clinicalWriteRecoveryReady(persistedProtection)
            );
            action.title = action.disabled
              ? 'La lectura o la protección no pudo verificarse; actualiza antes de liberar.'
              : 'Libera únicamente después de revisar el último valor e historial visibles.';
            action.addEventListener('click', async () => {
              action.disabled = true;
              action.textContent = 'Verificando…';
              const result = await releaseClinicalWriteProtection(scoreKey, persistedProtection);
              if (!root.isConnected) return;
              if (result && result.cancelled) {
                action.textContent = 'Protegido';
                action.title = 'La protección se mantuvo porque no se confirmó la lectura fresca.';
                action.disabled = false;
                return;
              }
              if (!result || result.error) {
                action.textContent = 'No se liberó';
                action.title = String(result && result.error || 'No fue posible liberar la protección.');
                action.disabled = false;
                return;
              }
              uncertainClinicalWrites.delete(scoreKey);
              setClinicalGuardState(root, 'uncertain', scoreKey, false);
              renderScoresCenter(root, encId);
            });
          } else {
            action.textContent = 'Registrar';
            action.disabled = !canWriteInstrument || Boolean(uncertainWrite) || Boolean(unavailableReason);
            if (uncertainWrite) action.title = 'Revisa el estado en Eloísa antes de registrar otra aplicación.';
            else if (unavailableReason) action.title = 'No se puede registrar mientras el historial completo no sea verificable.';
            action.addEventListener('click', () => openScoreForm(patient, instrument, renderTable));
          }
          actionCell.appendChild(action);
          row.append(bed, patientCell, valueCell, dateCell, authorCell, historyCell, actionCell);
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
