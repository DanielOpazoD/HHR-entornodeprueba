/**
 * hhr-hospitalized-documents-center.js
 *
 * Owns the hospitalized indications and Regimen + BRADEN document surfaces.
 * The host content script keeps the shared Centro HHR shell and clinical
 * transition policy.
 */
(() => {
  'use strict';

  const create = dependencies => {
    const {
      helper,
      runtimeMessages,
      prepareCenterModalRoot,
      runClinicalTransition,
      normalizedText,
      sendMessage,
      setLiveRegion,
      attachPatientListFilter,
      openPrescriptionCenter,
    } = dependencies || {};

    if (
      !helper ||
      !runtimeMessages ||
      typeof prepareCenterModalRoot !== 'function' ||
      typeof runClinicalTransition !== 'function' ||
      typeof normalizedText !== 'function' ||
      typeof sendMessage !== 'function' ||
      typeof setLiveRegion !== 'function' ||
      typeof attachPatientListFilter !== 'function' ||
      typeof openPrescriptionCenter !== 'function'
    ) {
      throw new Error('No se pudo inicializar el Centro de Documentos Hospitalizados HHR.');
    }

    const open = (kind, encId, existingRoot = null) => {
      const focusReturnTarget =
        existingRoot && existingRoot.__hhrFocusReturnTarget
          ? existingRoot.__hhrFocusReturnTarget
          : document.activeElement;
      const isRegimen = kind === 'regimen';
      // Indicaciones comparte la sección Recetas y conserva el mismo paciente seleccionado.
      const root = prepareCenterModalRoot({
        existingRoot,
        activeModule: isRegimen ? kind : 'recipes',
        encId,
        focusReturnTarget,
      });
      if (!root) return;
      root.querySelector('.hhr-center-main').innerHTML = `
      <div class="hhr-center-toolbar${isRegimen ? '' : ' hhr-recipes-toolbar'}">
        <h2 class="hhr-center-heading hhr-rx-title" id="hhr-rx-title"></h2>
        ${
          isRegimen
            ? ''
            : `
          <div class="hhr-rx-tabs hhr-rx-module-tabs" role="tablist" aria-label="Sección de recetas">
            <button class="hhr-rx-tab" type="button" role="tab" data-rx-module="recipes" aria-selected="false">Recetas</button>
            <button class="hhr-rx-tab" type="button" role="tab" data-rx-module="indications" aria-selected="true">Indicaciones</button>
          </div>
        `
        }
      </div>
      <div class="hhr-center-content hhr-center-embed">
        <p class="hhr-rx-subtitle"></p>
        <div class="hhr-rx-body"><div class="hhr-rx-status">Buscando pacientes hospitalizados…</div></div>
      </div>
      <footer class="hhr-rx-footer">
        <button class="hhr-rx-action hhr-rx-cancel" type="button">Cancelar</button>
        <button class="hhr-rx-action hhr-rx-action-primary hhr-rx-submit" type="button" disabled></button>
      </footer>
    `;
      const title = root.querySelector('.hhr-rx-title');
      const subtitle = root.querySelector('.hhr-rx-subtitle');
      const body = root.querySelector('.hhr-rx-body');
      const submit = root.querySelector('.hhr-rx-submit');
      const cancel = root.querySelector('.hhr-rx-cancel');
      title.textContent = isRegimen ? 'Regímenes y BRADEN' : 'Recetas';
      subtitle.textContent = isRegimen
        ? 'Genera una tabla única con régimen vigente, observación, fecha, valor BRADEN, clasificación y fecha de escala.'
        : 'Selecciona uno, varios o todos los pacientes. Sus indicaciones oficiales se abrirán en un único PDF.';
      submit.textContent = isRegimen ? 'Imprimir regímenes + BRADEN' : 'Imprimir indicaciones';
      cancel.addEventListener('click', root.__hhrDismiss);
      if (!isRegimen) {
        root.querySelector('[data-rx-module="recipes"]').addEventListener('click', () => {
          runClinicalTransition(root, () => openPrescriptionCenter(encId, '', root));
        });
      }

      const renderError = message => {
        body.innerHTML = '';
        const error = document.createElement('div');
        error.className = 'hhr-rx-error';
        error.textContent = message;
        body.appendChild(error);
        submit.disabled = true;
      };
      const showSuccess = (message, restoreSubmitState) => {
        let status = body.querySelector('.hhr-rx-print-feedback');
        if (!status) {
          status = document.createElement('div');
          status.className = 'hhr-rx-status hhr-rx-print-feedback';
          body.prepend(status);
        }
        setLiveRegion(status, message);
        cancel.disabled = false;
        cancel.textContent = 'Cerrar';
        submit.disabled = false;
        if (typeof restoreSubmitState === 'function') restoreSubmitState();
        else submit.textContent = 'Imprimir nuevamente';
      };

      const renderPatients = response => {
        const patients = Array.isArray(response.patients) ? response.patients : [];
        body.innerHTML = '';
        if (!patients.length) {
          body.innerHTML =
            '<div class="hhr-rx-status">No hay pacientes hospitalizados disponibles.</div>';
          return;
        }
        const toolbar = document.createElement('div');
        toolbar.className = 'hhr-rx-bulk-toolbar';
        const search = document.createElement('input');
        search.className = 'hhr-rx-search';
        search.type = 'search';
        search.placeholder = 'Buscar por paciente, RUN o cama';
        search.setAttribute('aria-label', 'Buscar pacientes hospitalizados');
        toolbar.appendChild(search);
        let selectVisible = null;
        let clearSelection = null;
        if (!isRegimen) {
          selectVisible = document.createElement('button');
          selectVisible.type = 'button';
          selectVisible.className = 'hhr-rx-mini-action';
          selectVisible.textContent = 'Seleccionar todos';
          clearSelection = document.createElement('button');
          clearSelection.type = 'button';
          clearSelection.className = 'hhr-rx-mini-action';
          clearSelection.textContent = 'Limpiar';
          toolbar.append(selectVisible, clearSelection);
        }

        const selectionSummary = document.createElement('div');
        selectionSummary.className = 'hhr-rx-selection-summary';
        const selectedText = document.createElement('span');
        const availableText = document.createElement('span');
        selectionSummary.append(selectedText, availableText);
        const list = document.createElement('div');
        list.className = 'hhr-rx-patient-list';

        patients.forEach(patient => {
          const row = document.createElement(isRegimen ? 'div' : 'label');
          row.className = 'hhr-rx-patient' + (isRegimen ? ' hhr-rx-patient-summary' : '');
          row.dataset.search = normalizedText(
            [
              patient.name,
              patient.run,
              patient.bed,
              patient.room,
              patient.service,
              patient.regimen && patient.regimen.diet,
              patient.regimen && patient.regimen.observation,
            ].join(' ')
          );
          row.dataset.service = normalizedText(patient.service);
          if (!isRegimen) {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.name = 'hhr-clinical-document-patient';
            input.value = patient.encounterId;
            input.checked = Boolean(patient.isCurrent);
            row.appendChild(input);
          }
          const details = document.createElement('span');
          details.className = 'hhr-rx-patient-details';
          const patientTitle = document.createElement('span');
          patientTitle.className = 'hhr-rx-patient-title';
          const bed = document.createElement('span');
          bed.className = 'hhr-rx-bed';
          bed.textContent = patient.bed || patient.room || 'Sin cama';
          const patientName = document.createElement('span');
          patientName.className = 'hhr-rx-name';
          patientName.textContent = patient.name || 'Paciente sin nombre';
          patientTitle.append(bed, patientName);
          if (patient.isCurrent) {
            const badge = document.createElement('span');
            badge.className = 'hhr-rx-badge';
            badge.textContent = 'Paciente actual';
            patientTitle.appendChild(badge);
          }
          const meta = document.createElement('span');
          meta.className = 'hhr-rx-meta';
          meta.textContent = [patient.run, patient.service].filter(Boolean).join(' · ');
          patientTitle.appendChild(meta);
          details.append(patientTitle);
          if (isRegimen) {
            const regimenLine = document.createElement('span');
            regimenLine.className = 'hhr-rx-braden-line';
            if (patient.regimenUnavailableReason) {
              regimenLine.classList.add('hhr-rx-braden-missing');
              regimenLine.textContent = 'Régimen no verificable en esta consulta';
            } else if (patient.regimen) {
              const regimenName = document.createElement('strong');
              regimenName.textContent = 'Régimen: ' + patient.regimen.diet;
              const regimenMeta = document.createElement('span');
              regimenMeta.textContent = [
                patient.regimen.observation,
                helper.formatDateTimeLabel(patient.regimen.dateTime),
              ]
                .filter(Boolean)
                .join(' · ');
              regimenLine.append(regimenName, regimenMeta);
            } else {
              regimenLine.classList.add('hhr-rx-braden-missing');
              regimenLine.textContent = 'Sin régimen vigente';
            }
            details.appendChild(regimenLine);
            const bradenLine = document.createElement('span');
            bradenLine.className = 'hhr-rx-braden-line';
            if (patient.braden) {
              const score = document.createElement('span');
              score.className = 'hhr-rx-braden-score';
              score.textContent = 'BRADEN ' + patient.braden.total;
              const bradenMeta = document.createElement('span');
              bradenMeta.textContent = [
                patient.braden.severity,
                helper.formatDateTimeLabel(patient.braden.dateTime),
                patient.braden.author,
              ]
                .filter(Boolean)
                .join(' · ');
              bradenLine.append(score, bradenMeta);
            } else {
              bradenLine.classList.add('hhr-rx-braden-missing');
              bradenLine.textContent = patient.bradenUnavailableReason
                ? 'BRADEN no disponible en esta consulta'
                : 'Sin resultado BRADEN registrado';
            }
            details.appendChild(bradenLine);
          }
          row.appendChild(details);
          list.appendChild(row);
        });
        body.append(toolbar, selectionSummary, list);

        const availableInputs = () => Array.from(list.querySelectorAll('input'));
        const selectedInputs = () => Array.from(list.querySelectorAll('input:checked'));
        const updateSelection = () => {
          if (isRegimen) {
            const regimenCount = Number.isFinite(Number(response.regimenCount))
              ? Number(response.regimenCount)
              : patients.filter(patient => patient.regimen).length;
            const bradenCount = Number.isFinite(Number(response.bradenCount))
              ? Number(response.bradenCount)
              : patients.filter(patient => patient.braden).length;
            selectedText.textContent =
              patients.length +
              (patients.length === 1 ? ' paciente hospitalizado' : ' pacientes hospitalizados');
            availableText.textContent =
              regimenCount + ' con régimen · ' + bradenCount + ' con BRADEN';
            submit.disabled =
              Number(response.regimenErrorCount || 0) > 0 ||
              Number(response.unavailableCount || 0) > 0;
            submit.textContent = 'Imprimir regímenes y BRADEN';
            if (submit.disabled)
              submit.title = 'Actualiza: faltan regímenes o resultados BRADEN por verificar.';
            return;
          }
          const count = selectedInputs().length;
          selectedText.textContent =
            count === 1 ? '1 paciente seleccionado' : count + ' pacientes seleccionados';
          availableText.textContent = patients.length + ' disponibles';
          submit.disabled = count === 0;
          submit.textContent =
            count === 1 ? 'Imprimir 1 paciente' : 'Imprimir ' + count + ' pacientes';
        };
        attachPatientListFilter({
          toolbar,
          search,
          list,
          services: patients.map(patient => patient.service),
        });
        if (!isRegimen) {
          selectVisible.addEventListener('click', () => {
            availableInputs().forEach(input => {
              input.checked = true;
            });
            updateSelection();
          });
          clearSelection.addEventListener('click', () => {
            selectedInputs().forEach(input => {
              input.checked = false;
            });
            updateSelection();
          });
          list.addEventListener('change', updateSelection);
        }
        updateSelection();

        submit.onclick = async () => {
          const selected = isRegimen ? [] : selectedInputs();
          if (!isRegimen && !selected.length) return;
          submit.disabled = true;
          cancel.disabled = true;
          submit.textContent = isRegimen
            ? 'Preparando regímenes y BRADEN…'
            : 'Preparando ' +
              selected.length +
              (selected.length === 1 ? ' indicación…' : ' indicaciones…');
          const result = await sendMessage(
            isRegimen
              ? { type: runtimeMessages.HOSPITALIZED_REGIMEN_PRINT_REQUEST }
              : {
                  type: runtimeMessages.HOSPITALIZED_INDICATIONS_PRINT_REQUEST,
                  batchId: response.batchId,
                  encIds: selected.map(input => input.value),
                }
          );
          if (!root.isConnected) return;
          if (!result || result.error) {
            cancel.disabled = false;
            renderError((result && result.error) || 'No se pudo preparar el documento solicitado.');
            submit.disabled = false;
            submit.textContent = 'Reintentar impresión';
            return;
          }
          const skipped = Array.isArray(result.skipped) ? result.skipped.length : 0;
          showSuccess(
            (isRegimen
              ? 'Se abrió el régimen integrado de ' +
                result.count +
                ' pacientes: ' +
                result.regimenCount +
                ' con régimen vigente y ' +
                result.bradenCount +
                ' con BRADEN disponible.'
              : 'Se abrió un PDF con indicaciones de ' +
                result.count +
                (result.count === 1 ? ' paciente' : ' pacientes') +
                ' y el diálogo de impresión.' +
                (skipped
                  ? ' No se pudieron incluir ' +
                    skipped +
                    (skipped === 1 ? ' paciente.' : ' pacientes.')
                  : '')) + ' Puedes imprimir nuevamente sin cerrar este panel.',
            updateSelection
          );
        };
      };

      sendMessage({
        type: isRegimen
          ? runtimeMessages.HOSPITALIZED_REGIMEN_OPTIONS_REQUEST
          : runtimeMessages.HOSPITALIZED_INDICATIONS_OPTIONS_REQUEST,
        currentEncId: encId || '',
      }).then(response => {
        if (!root.isConnected) return;
        if (!response || response.error) {
          renderError(
            (response && response.error) || 'No se pudo leer la lista de hospitalizados.'
          );
          return;
        }
        renderPatients(response);
      });
    };

    return Object.freeze({ open });
  };

  globalThis.HhrHospitalizedDocumentsCenterRuntime = Object.freeze({ create });
})();
