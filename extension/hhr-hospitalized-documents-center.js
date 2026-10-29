/**
 * hhr-hospitalized-documents-center.js
 *
 * Owns the hospitalized indications document surface.
 * The host content script keeps the shared Centro HHR shell and clinical
 * transition policy.
 */
(() => {
  'use strict';
  const create = dependencies => {
    const {
      helper, runtimeMessages, prepareCenterModalRoot, runClinicalTransition,
      normalizedText, sendMessage, setLiveRegion, attachPatientListFilter,
      openPrescriptionCenter,
    } = dependencies || {};
    if (!helper ||
      !runtimeMessages ||
      typeof prepareCenterModalRoot !== 'function' ||
      typeof runClinicalTransition !== 'function' ||
      typeof normalizedText !== 'function' ||
      typeof sendMessage !== 'function' ||
      typeof setLiveRegion !== 'function' ||
      typeof attachPatientListFilter !== 'function' ||
      typeof openPrescriptionCenter !== 'function') {
      throw new Error('No se pudo inicializar el Centro de Documentos Hospitalizados HHR.');
    }
    const open = (kind, encId, existingRoot = null) => {
      if (kind !== 'indications') return;
      const focusReturnTarget = existingRoot && existingRoot.__hhrFocusReturnTarget
        ? existingRoot.__hhrFocusReturnTarget
        : document.activeElement;
      // Indicaciones comparte la sección Recetas y conserva el mismo paciente seleccionado.
      const root = prepareCenterModalRoot({
        existingRoot,
        activeModule: 'recipes',
        encId,
        focusReturnTarget,
      });
      if (!root)
        return;
      root.querySelector('.hhr-center-main').innerHTML = `
      <div class="hhr-center-toolbar hhr-recipes-toolbar">
        <h2 class="hhr-center-heading hhr-rx-title" id="hhr-rx-title"></h2>
        <div class="hhr-rx-tabs hhr-rx-module-tabs" role="tablist" aria-label="Sección de recetas">
          <button class="hhr-rx-tab" type="button" role="tab" data-rx-module="recipes" aria-selected="false">Recetas</button>
          <button class="hhr-rx-tab" type="button" role="tab" data-rx-module="indications" aria-selected="true">Indicaciones</button>
        </div>
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
      title.textContent = 'Recetas';
      subtitle.textContent =
        'Selecciona uno, varios o todos los pacientes. Sus indicaciones oficiales se abrirán en un único PDF.';
      submit.textContent = 'Imprimir indicaciones';
      cancel.addEventListener('click', root.__hhrDismiss);
      root.querySelector('[data-rx-module="recipes"]').addEventListener('click', () => {
        runClinicalTransition(root, () => openPrescriptionCenter(encId, '', root));
      });
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
        if (typeof restoreSubmitState === 'function')
          restoreSubmitState();
        else
          submit.textContent = 'Imprimir nuevamente';
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
        selectVisible = document.createElement('button');
        selectVisible.type = 'button';
        selectVisible.className = 'hhr-rx-mini-action';
        selectVisible.textContent = 'Seleccionar todos';
        clearSelection = document.createElement('button');
        clearSelection.type = 'button';
        clearSelection.className = 'hhr-rx-mini-action';
        clearSelection.textContent = 'Limpiar';
        toolbar.append(selectVisible, clearSelection);
        const selectionSummary = document.createElement('div');
        selectionSummary.className = 'hhr-rx-selection-summary';
        const selectedText = document.createElement('span');
        const availableText = document.createElement('span');
        selectionSummary.append(selectedText, availableText);
        const list = document.createElement('div');
        list.className = 'hhr-rx-patient-list';
        patients.forEach(patient => {
          const row = document.createElement('label');
          row.className = 'hhr-rx-patient';
          row.dataset.search = normalizedText([
            patient.name,
            patient.run,
            patient.bed,
            patient.room,
            patient.service,
            patient.regimen && patient.regimen.diet,
            patient.regimen && patient.regimen.observation,
          ].join(' '));
          row.dataset.service = normalizedText(patient.service);
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.name = 'hhr-clinical-document-patient';
          input.value = patient.encounterId;
          input.checked = Boolean(patient.isCurrent);
          row.appendChild(input);
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
          row.appendChild(details);
          list.appendChild(row);
        });
        body.append(toolbar, selectionSummary, list);
        const availableInputs = () => Array.from(list.querySelectorAll('input'));
        const selectedInputs = () => Array.from(list.querySelectorAll('input:checked'));
        const updateSelection = () => {
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
        updateSelection();
        submit.onclick = async () => {
          const selected = selectedInputs();
          if (!selected.length)
            return;
          submit.disabled = true;
          cancel.disabled = true;
          submit.textContent =
            'Preparando ' +
              selected.length +
              (selected.length === 1 ? ' indicación…' : ' indicaciones…');
          const result = await sendMessage({
            type: runtimeMessages.HOSPITALIZED_INDICATIONS_PRINT_REQUEST,
            batchId: response.batchId,
            encIds: selected.map(input => input.value),
          });
          if (!root.isConnected)
            return;
          if (!result || result.error) {
            cancel.disabled = false;
            renderError((result && result.error) || 'No se pudo preparar el documento solicitado.');
            submit.disabled = false;
            submit.textContent = 'Reintentar impresión';
            return;
          }
          const skipped = Array.isArray(result.skipped) ? result.skipped.length : 0;
          showSuccess(('Se abrió un PDF con indicaciones de ' +
            result.count +
            (result.count === 1 ? ' paciente' : ' pacientes') +
            ' y el diálogo de impresión.' +
            (skipped
              ? ' No se pudieron incluir ' +
                skipped +
                (skipped === 1 ? ' paciente.' : ' pacientes.')
              : '')) + ' Puedes imprimir nuevamente sin cerrar este panel.', updateSelection);
        };
      };
      sendMessage({
        type: runtimeMessages.HOSPITALIZED_INDICATIONS_OPTIONS_REQUEST,
        currentEncId: encId || '',
      }).then(response => {
        if (!root.isConnected)
          return;
        if (!response || response.error) {
          renderError((response && response.error) || 'No se pudo leer la lista de hospitalizados.');
          return;
        }
        renderPatients(response);
      });
    };
    return Object.freeze({ open });
  };
  globalThis.HhrHospitalizedDocumentsCenterRuntime = Object.freeze({ create });
})();
