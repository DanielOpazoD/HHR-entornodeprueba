/**
 * hhr-prescription-center.js
 *
 * Owns the Centro HHR prescription surface for the current encounter and the
 * hospitalized census. The host content script supplies navigation, messaging,
 * formatting, and mounted-shell dependencies.
 */
(() => {
  'use strict';

  const create = dependencies => {
    const {
      helper,
      runtimeMessages,
      currentRouteEncounterId,
      prepareCenterModalRoot,
      runClinicalTransition,
      normalizedText,
      sendMessage,
      setLiveRegion,
      attachPatientListFilter,
      openHospitalizedDocuments,
    } = dependencies || {};

    if (
      !helper ||
      !runtimeMessages ||
      typeof currentRouteEncounterId !== 'function' ||
      typeof prepareCenterModalRoot !== 'function' ||
      typeof runClinicalTransition !== 'function' ||
      typeof normalizedText !== 'function' ||
      typeof sendMessage !== 'function' ||
      typeof setLiveRegion !== 'function' ||
      typeof attachPatientListFilter !== 'function' ||
      typeof openHospitalizedDocuments !== 'function'
    ) {
      throw new Error('No se pudo inicializar el Centro de Recetas HHR.');
    }

    const open = (encId, initialTab = '', existingRoot = null) => {
      const requestedEncId = /^\d+$/.test(String(encId || '')) ? String(encId) : '';
      // Module changes inside Centro HHR must keep the patient selected there, even when the
      // underlying Eloísa route still points at another encounter. Consult the route only when
      // opening a fresh modal without an explicit encounter.
      encId = requestedEncId || (!existingRoot ? currentRouteEncounterId() : '');
      const focusReturnTarget =
        existingRoot && existingRoot.__hhrFocusReturnTarget
          ? existingRoot.__hhrFocusReturnTarget
          : document.activeElement;
      const hasCurrentPatient = /^\d+$/.test(String(encId || ''));
      // A patient selected from the hospitalized list is a valid explicit context even when
      // Eloísa keeps another episode in the underlying route. This unlocks the same detailed
      // prescription options (including verified external prescriptions) without navigation.
      const currentPatientMatchesRoute = hasCurrentPatient;
      const root = prepareCenterModalRoot({
        existingRoot,
        activeModule: 'recipes',
        encId,
        focusReturnTarget,
      });
      if (!root) return;
      root.querySelector('.hhr-center-main').innerHTML = `
      <div class="hhr-center-toolbar hhr-recipes-toolbar">
        <h2 class="hhr-center-heading hhr-rx-title" id="hhr-rx-title">Recetas</h2>
        <div class="hhr-rx-tabs hhr-rx-module-tabs" role="tablist" aria-label="Sección de recetas">
          <button class="hhr-rx-tab" type="button" role="tab" data-rx-module="recipes" aria-selected="true">Recetas</button>
          <button class="hhr-rx-tab" type="button" role="tab" data-rx-module="indications" aria-selected="false">Indicaciones</button>
        </div>
        <div class="hhr-rx-tabs hhr-rx-scope-tabs" role="tablist" aria-label="Alcance de impresión">
          <button class="hhr-rx-tab" id="hhr-rx-tab-current" type="button" role="tab" data-tab="current" aria-controls="hhr-rx-tabpanel" aria-selected="true">Paciente actual</button>
          <button class="hhr-rx-tab" id="hhr-rx-tab-hospitalized" type="button" role="tab" data-tab="hospitalized" aria-controls="hhr-rx-tabpanel" aria-selected="false">Hospitalizados</button>
        </div>
      </div>
      <div class="hhr-center-content hhr-center-embed">
        <p class="hhr-rx-subtitle">Elige qué recetas necesitas y abre un único diálogo de impresión.</p>
        <div class="hhr-rx-body" id="hhr-rx-tabpanel" role="tabpanel" aria-labelledby="hhr-rx-tab-current"><div class="hhr-rx-status">Buscando recetas disponibles…</div></div>
      </div>
      <footer class="hhr-rx-footer">
        <button class="hhr-rx-action hhr-rx-cancel" type="button">Cancelar</button>
        <button class="hhr-rx-action hhr-rx-action-primary hhr-rx-submit" type="button" disabled>
          Imprimir receta completa
        </button>
      </footer>
    `;
      const body = root.querySelector('.hhr-rx-body');
      const submit = root.querySelector('.hhr-rx-submit');
      const cancel = root.querySelector('.hhr-rx-cancel');
      const subtitle = root.querySelector('.hhr-rx-subtitle');
      root.querySelector('[data-rx-module="indications"]').addEventListener('click', () => {
        runClinicalTransition(root, () => openHospitalizedDocuments('indications', encId, root));
      });
      const tabs = Array.from(root.querySelectorAll('.hhr-rx-scope-tabs .hhr-rx-tab'));
      const currentTab = tabs.find(tab => tab.dataset.tab === 'current');
      if (!currentPatientMatchesRoute && currentTab) {
        currentTab.disabled = true;
        currentTab.setAttribute('aria-disabled', 'true');
        currentTab.setAttribute('aria-selected', 'false');
        currentTab.title = 'Disponible al abrir Recetas desde el episodio activo en Ficha Médico';
      } else if (currentTab) {
        currentTab.disabled = false;
        currentTab.removeAttribute('aria-disabled');
        currentTab.removeAttribute('title');
      }
      let activeTab = currentPatientMatchesRoute ? 'current' : 'hospitalized';
      let viewGeneration = 0;
      let hospitalizedResponse = null;
      let hospitalizedRequest = null;
      cancel.addEventListener('click', root.__hhrDismiss);

      const renderError = message => {
        body.innerHTML = '';
        const error = document.createElement('div');
        error.className = 'hhr-rx-error';
        error.textContent = message;
        body.appendChild(error);
        submit.disabled = true;
      };

      const renderFormats = (name, checkedFormat = 'standard') => {
        const formatTitle = document.createElement('div');
        formatTitle.className = 'hhr-rx-format-title';
        formatTitle.textContent = 'Formato de impresión';
        const formats = document.createElement('div');
        formats.className = 'hhr-rx-formats';
        const addFormat = ({ value, title, meta }) => {
          const label = document.createElement('label');
          label.className = 'hhr-rx-format-option';
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = name;
          input.value = value;
          input.checked = value === checkedFormat;
          const details = document.createElement('span');
          const optionTitle = document.createElement('span');
          optionTitle.className = 'hhr-rx-date';
          optionTitle.textContent = title;
          const optionMeta = document.createElement('span');
          optionMeta.className = 'hhr-rx-meta';
          optionMeta.textContent = meta;
          details.append(optionTitle, optionMeta);
          label.append(input, details);
          formats.appendChild(label);
        };
        addFormat({
          value: 'standard',
          title: 'Estándar',
          meta: 'Documento oficial con lectura amplia',
        });
        addFormat({
          value: 'compact',
          title: 'Compacta',
          meta: 'Mismo contenido, hasta 22 fármacos por hoja',
        });
        body.append(formatTitle, formats);
        return formats;
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

      const renderCurrentPatient = async generation => {
        body.innerHTML = '<div class="hhr-rx-status">Buscando recetas disponibles…</div>';
        submit.disabled = true;
        submit.textContent = 'Imprimir receta completa';
        const response = await sendMessage({
          type: runtimeMessages.PRESCRIPTION_OPTIONS_REQUEST,
          encId,
        });
        if (!root.isConnected || generation !== viewGeneration) return;
        if (!response || response.error) {
          renderError((response && response.error) || 'No se encontraron recetas disponibles.');
          return;
        }
        const groups = Array.isArray(response.groups) ? response.groups : [];
        const externalGroups = Array.isArray(response.externalGroups)
          ? response.externalGroups
          : [];
        if (groups.length === 0) {
          body.innerHTML =
            '<div class="hhr-rx-status">No hay recetas farmacológicas disponibles para este episodio.</div>';
          return;
        }
        body.innerHTML = '';
        const patient =
          response.patient && typeof response.patient === 'object' ? response.patient : null;
        const patientContext = document.createElement('div');
        patientContext.className = 'hhr-rx-patient-context';
        patientContext.setAttribute('aria-label', 'Paciente de la receta');
        const patientName = document.createElement('strong');
        patientName.textContent =
          patient && patient.name ? patient.name : 'Episodio ' + String(encId || 'no identificado');
        const patientMeta = document.createElement('span');
        const location = [patient && patient.bed, patient && patient.room]
          .filter(Boolean)
          .join(' / ');
        const patientRun =
          patient && patient.run ? helper.formatRun(patient.run) || String(patient.run) : '';
        patientMeta.textContent =
          [
            patientRun ? 'RUN ' + patientRun : '',
            location ? 'Cama ' + location : '',
            patient && patient.service ? patient.service : '',
          ]
            .filter(Boolean)
            .join(' · ') || 'Identificación clínica no disponible';
        patientContext.append(patientName, patientMeta);
        body.appendChild(patientContext);
        if (response.medicationMetadataWarning) {
          const syncNote = document.createElement('div');
          syncNote.className = 'hhr-rx-sync-note';
          syncNote.textContent =
            'No se pudo verificar la etiqueta “Externo” en la tabla activa. Las demás recetas siguen disponibles.';
          body.appendChild(syncNote);
        }
        const list = document.createElement('div');
        list.className = 'hhr-rx-list';
        const selectableGroups = [...externalGroups, ...groups];
        const totalCount = groups.reduce((sum, group) => sum + (Number(group.count) || 0), 0);
        const currentValidation =
          response.validation && (response.validation.dateTime || response.validation.date)
            ? ' · validación ' +
              helper.formatDateTimeLabel(response.validation.dateTime || response.validation.date)
            : '';
        const addOption = ({ key, title, meta, checked = false, disabled = false }) => {
          const label = document.createElement('label');
          label.className = 'hhr-rx-option';
          if (disabled) label.classList.add('is-disabled');
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = 'hhr-prescription-selection';
          input.value = key;
          input.checked = checked;
          input.disabled = disabled;
          const details = document.createElement('span');
          const optionTitle = document.createElement('span');
          optionTitle.className = 'hhr-rx-date';
          optionTitle.textContent = title;
          const optionMeta = document.createElement('span');
          optionMeta.className = 'hhr-rx-meta';
          optionMeta.textContent = meta;
          details.append(optionTitle, optionMeta);
          label.append(input, details);
          list.appendChild(label);
        };
        addOption({
          key: 'complete',
          title: 'Receta completa',
          meta:
            'PDF oficial vigente · ' +
            totalCount +
            (totalCount === 1 ? ' fármaco' : ' fármacos') +
            (externalGroups.length
              ? ' · incluye ' +
                externalGroups.length +
                (externalGroups.length === 1 ? ' receta externa' : ' recetas externas')
              : '') +
            currentValidation,
          checked: true,
        });
        if (externalGroups.length) {
          const externalTitle = document.createElement('div');
          externalTitle.className = 'hhr-rx-format-title';
          externalTitle.textContent =
            externalGroups.length === 1
              ? 'Receta externa detectada'
              : 'Recetas externas detectadas';
          list.appendChild(externalTitle);
          externalGroups.forEach(group => {
            const printDateTime =
              helper.formatDateTimeLabel(group.printDateTime || group.validationDateTime) ||
              helper.formatDateLabel(group.printDate || group.validationDate);
            const printDateLabel =
              group.printDateSource === 'indication' ? 'emisión ' : 'última validación ';
            const identityReady = Boolean(group.prescriberVerified && group.professionalRun);
            const dateReady = Boolean(printDateTime);
            addOption({
              key: group.key,
              title: 'Externa · ' + (group.medication || 'Medicamento no informado'),
              meta:
                (group.professional || 'Profesional no informado') +
                (group.professionalRun ? ' · RUN ' + group.professionalRun : '') +
                (printDateTime ? ' · ' + printDateLabel + printDateTime : '') +
                (!identityReady
                  ? ' · identidad no verificable; usa receta completa'
                  : !dateReady
                    ? ' · sin fecha atribuible; usa receta completa'
                    : ''),
              disabled: !identityReady || !dateReady,
            });
          });
          const professionalTitle = document.createElement('div');
          professionalTitle.className = 'hhr-rx-format-title';
          professionalTitle.textContent = 'Recetas por fecha y hora de emisión';
          list.appendChild(professionalTitle);
        }
        groups.forEach(group => {
          const drugCount = Number(group.count) || 0;
          const printDateTime =
            helper.formatDateTimeLabel(group.printDateTime || group.validationDateTime) ||
            helper.formatDateLabel(group.printDate || group.validationDate);
          const printDateLabel =
            group.printDateSource === 'indication' ? 'emisión ' : 'última validación ';
          const identityReady = Boolean(group.prescriberVerified && group.professionalRun);
          const dateReady = Boolean(printDateTime);
          addOption({
            key: group.key,
            title: group.professional || 'Profesional no informado',
            meta:
              (group.professionalRun ? 'RUN ' + group.professionalRun + ' · ' : '') +
              drugCount +
              (drugCount === 1 ? ' fármaco' : ' fármacos') +
              (Number(group.externalCount) > 0
                ? ' · incluye ' +
                  group.externalCount +
                  (Number(group.externalCount) === 1 ? ' externo' : ' externos')
                : '') +
              (printDateTime ? ' · ' + printDateLabel + printDateTime : '') +
              (!identityReady
                ? ' · identidad no verificable; usa receta completa'
                : !dateReady
                  ? ' · sin fecha atribuible; usa receta completa'
                  : ''),
            disabled: !identityReady || !dateReady,
          });
        });
        body.appendChild(list);
        const formats = renderFormats('hhr-prescription-format');
        submit.disabled = false;

        const updateSubmitText = () => {
          const selected = list.querySelector('input:checked');
          const selectedFormat = formats.querySelector('input:checked');
          const group = selectableGroups.find(item => item.key === selected?.value);
          const compact = selectedFormat?.value === 'compact';
          submit.textContent = group
            ? group.external
              ? 'Imprimir receta externa' + (compact ? ' compacta' : '')
              : 'Imprimir receta' + (compact ? ' compacta' : '') + ' de ' + group.professional
            : 'Imprimir receta ' + (compact ? 'compacta completa' : 'completa');
        };
        list.addEventListener('change', updateSubmitText);
        formats.addEventListener('change', updateSubmitText);
        updateSubmitText();

        submit.onclick = async () => {
          const selected = list.querySelector('input:checked');
          const selectedFormat = formats.querySelector('input:checked');
          if (!selected || !selectedFormat) return;
          submit.disabled = true;
          cancel.disabled = true;
          submit.textContent = 'Generando receta…';
          const result = await sendMessage({
            type: runtimeMessages.PRESCRIPTION_PRINT_REQUEST,
            encId,
            selectionKey: selected.value,
            printFormat: selectedFormat.value,
          });
          if (!root.isConnected) return;
          if (!result || result.error) {
            cancel.disabled = false;
            submit.textContent = 'Reintentar impresión';
            renderError((result && result.error) || 'No se pudo abrir la receta para imprimir.');
            submit.disabled = false;
            return;
          }
          showSuccess(
            'La receta se abrió en una pestaña nueva con el diálogo de impresión. Puedes imprimir otra sin cerrar este panel.',
            updateSubmitText
          );
        };
      };

      const renderHospitalized = async generation => {
        submit.disabled = true;
        submit.textContent = 'Selecciona pacientes';
        if (!hospitalizedResponse) {
          body.innerHTML =
            '<div class="hhr-rx-status">Revisando pacientes hospitalizados y sus recetas activas…</div>';
          if (!hospitalizedRequest) {
            hospitalizedRequest = sendMessage({
              type: runtimeMessages.HOSPITALIZED_PRESCRIPTION_OPTIONS_REQUEST,
              currentEncId: encId,
            });
          }
          const requestedResponse = await hospitalizedRequest;
          if (!root.isConnected || generation !== viewGeneration) return;
          hospitalizedRequest = null;
          hospitalizedResponse = requestedResponse;
        }
        if (!root.isConnected || generation !== viewGeneration) return;
        if (!hospitalizedResponse || hospitalizedResponse.error) {
          const message = hospitalizedResponse && hospitalizedResponse.error;
          hospitalizedResponse = null;
          renderError(message || 'No se pudo revisar la lista de pacientes hospitalizados.');
          return;
        }
        const patients = Array.isArray(hospitalizedResponse.patients)
          ? hospitalizedResponse.patients
          : [];
        if (patients.length === 0) {
          body.innerHTML =
            '<div class="hhr-rx-status">No hay pacientes hospitalizados disponibles.</div>';
          return;
        }

        body.innerHTML = '';
        const toolbar = document.createElement('div');
        toolbar.className = 'hhr-rx-bulk-toolbar';
        const search = document.createElement('input');
        search.className = 'hhr-rx-search';
        search.type = 'search';
        search.placeholder = 'Buscar por paciente, RUN, cama o prescriptor';
        search.setAttribute('aria-label', 'Buscar pacientes hospitalizados');
        const selectVisible = document.createElement('button');
        selectVisible.className = 'hhr-rx-mini-action';
        selectVisible.type = 'button';
        selectVisible.textContent = 'Seleccionar todos';
        const clearSelection = document.createElement('button');
        clearSelection.className = 'hhr-rx-mini-action';
        clearSelection.type = 'button';
        clearSelection.textContent = 'Quitar selección';
        toolbar.append(search, selectVisible, clearSelection);

        const selectionSummary = document.createElement('div');
        selectionSummary.className = 'hhr-rx-selection-summary';
        const selectedText = document.createElement('span');
        const availableText = document.createElement('span');
        const printablePatients = patients.filter(
          patient => patient.medicationCount > 0 && !patient.unavailableReason
        );
        availableText.textContent = printablePatients.length + ' con receta disponible';
        selectionSummary.append(selectedText, availableText);

        const list = document.createElement('div');
        list.className = 'hhr-rx-patient-list';
        patients.forEach(patient => {
          const printable = patient.medicationCount > 0 && !patient.unavailableReason;
          const row = document.createElement('div');
          row.className = 'hhr-rx-patient' + (printable ? '' : ' is-disabled');
          row.dataset.search = normalizedText(
            [
              patient.name,
              patient.run,
              patient.bed,
              patient.room,
              patient.service,
              ...(patient.prescribers || []).map(item => item.professional),
            ].join(' ')
          );
          row.dataset.service = normalizedText(patient.service);
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.name = 'hhr-bulk-patient';
          input.value = patient.encounterId;
          input.disabled = !printable;
          input.id = 'hhr-rx-patient-' + patient.encounterId;
          const details = document.createElement('span');
          details.className = 'hhr-rx-patient-details';
          const selectionLabel = document.createElement('label');
          selectionLabel.className = 'hhr-rx-patient-selection';
          selectionLabel.htmlFor = input.id;
          const title = document.createElement('span');
          title.className = 'hhr-rx-patient-title';
          const bed = document.createElement('span');
          bed.className = 'hhr-rx-bed';
          bed.textContent = patient.bed || patient.room || 'Sin cama';
          const name = document.createElement('span');
          name.className = 'hhr-rx-name';
          name.textContent = patient.name || 'Paciente sin nombre';
          title.append(bed, name);
          if (patient.isCurrent) {
            const badge = document.createElement('span');
            badge.className = 'hhr-rx-badge';
            badge.textContent = 'Paciente actual';
            title.appendChild(badge);
          }
          const meta = document.createElement('span');
          meta.className = 'hhr-rx-meta';
          meta.textContent = [patient.run, patient.service].filter(Boolean).join(' · ');
          title.appendChild(meta);
          const prescribers = document.createElement('span');
          prescribers.className = 'hhr-rx-prescribers';
          if (patient.unavailableReason) {
            prescribers.textContent = 'No fue posible consultar la receta';
            row.title = patient.unavailableReason;
          } else if (!patient.medicationCount) {
            prescribers.textContent = 'Sin fármacos activos';
          } else {
            const items = patient.prescribers || [];
            prescribers.textContent = items
              .map(item => item.professional + ' (' + item.count + ')')
              .join(' · ');
            prescribers.title = items
              .map(item => {
                const dateTime = helper.formatDateTimeLabel(item.validationDateTime);
                return (
                  item.professional +
                  ' · ' +
                  item.count +
                  (item.count === 1 ? ' fármaco' : ' fármacos') +
                  (dateTime ? ' · ' + dateTime : '')
                );
              })
              .join('\n');
          }
          details.append(title, prescribers);
          selectionLabel.appendChild(details);
          row.append(input, selectionLabel);
          if (printable) {
            const stats = document.createElement('span');
            stats.className = 'hhr-rx-patient-stats';
            const medCount = document.createElement('span');
            medCount.className = 'hhr-rx-med-count';
            medCount.textContent =
              patient.medicationCount + (patient.medicationCount === 1 ? ' fármaco' : ' fármacos');
            stats.appendChild(medCount);
            const latest = (patient.prescribers || [])
              .map(item => item.validationDateTime)
              .filter(Boolean)
              .sort()
              .pop();
            const latestLabel = latest ? helper.formatDateTimeLabel(latest) : '';
            if (latestLabel) {
              const time = document.createElement('span');
              time.className = 'hhr-rx-stat-time';
              time.textContent = latestLabel;
              stats.appendChild(time);
            }
            row.appendChild(stats);
          }
          const openPatient = document.createElement('button');
          openPatient.type = 'button';
          openPatient.className = 'hhr-rx-mini-action hhr-rx-open-patient';
          openPatient.textContent = 'Abrir';
          openPatient.title = 'Abrir las opciones individuales de este paciente';
          openPatient.addEventListener('click', () => {
            open(patient.encounterId, 'current', root);
          });
          row.appendChild(openPatient);
          list.appendChild(row);
        });
        body.append(toolbar, selectionSummary, list);
        const formats = renderFormats('hhr-bulk-prescription-format');

        const availableCheckboxes = () => Array.from(list.querySelectorAll('input:not(:disabled)'));
        const selectedCheckboxes = () => Array.from(list.querySelectorAll('input:checked'));
        const updateSelection = () => {
          const count = selectedCheckboxes().length;
          selectedText.textContent =
            count === 1 ? '1 paciente seleccionado' : count + ' pacientes seleccionados';
          submit.disabled = count === 0;
          submit.textContent = count === 1 ? 'Imprimir 1 receta' : 'Imprimir ' + count + ' recetas';
        };
        attachPatientListFilter({
          toolbar,
          search,
          list,
          services: patients.map(patient => patient.service),
        });
        selectVisible.addEventListener('click', () => {
          availableCheckboxes().forEach(input => {
            input.checked = true;
          });
          updateSelection();
        });
        clearSelection.addEventListener('click', () => {
          selectedCheckboxes().forEach(input => {
            input.checked = false;
          });
          updateSelection();
        });
        list.addEventListener('change', updateSelection);
        updateSelection();

        submit.onclick = async () => {
          const selected = selectedCheckboxes();
          const selectedFormat = formats.querySelector('input:checked');
          if (!selected.length || !selectedFormat) return;
          submit.disabled = true;
          cancel.disabled = true;
          submit.textContent =
            'Preparando ' + selected.length + (selected.length === 1 ? ' receta…' : ' recetas…');
          const result = await sendMessage({
            type: runtimeMessages.HOSPITALIZED_PRESCRIPTION_PRINT_REQUEST,
            batchId: hospitalizedResponse.batchId,
            encIds: selected.map(input => input.value),
            printFormat: selectedFormat.value,
          });
          if (!root.isConnected) return;
          if (!result || result.error) {
            cancel.disabled = false;
            renderError(
              (result && result.error) || 'No se pudieron preparar las recetas seleccionadas.'
            );
            submit.textContent = 'Reintentar impresión';
            submit.disabled = false;
            return;
          }
          const skipped = Array.isArray(result.skipped) ? result.skipped.length : 0;
          const compactFallbackCount = Array.isArray(result.compactFallbacks)
            ? result.compactFallbacks.length
            : 0;
          showSuccess(
            'Se abrió un PDF con ' +
              result.count +
              (result.count === 1 ? ' receta' : ' recetas') +
              ' y el diálogo de impresión.' +
              (skipped
                ? ' No se pudieron incluir ' +
                  skipped +
                  (skipped === 1 ? ' paciente.' : ' pacientes.')
                : '') +
              (compactFallbackCount
                ? ' ' +
                  compactFallbackCount +
                  (compactFallbackCount === 1 ? ' receta conservó' : ' recetas conservaron') +
                  ' el formato oficial para evitar omitir contenido clínico.'
                : '') +
              ' Puedes ajustar la selección e imprimir nuevamente.',
            updateSelection
          );
        };
      };

      const activateTab = tabName => {
        const requestedTab = tabs.find(tab => tab.dataset.tab === tabName);
        if (!requestedTab || requestedTab.disabled) return;
        activeTab = tabName;
        viewGeneration += 1;
        const generation = viewGeneration;
        tabs.forEach(tab => {
          const selected = tab.dataset.tab === tabName;
          tab.setAttribute('aria-selected', String(selected));
          tab.tabIndex = selected ? 0 : -1;
        });
        body.setAttribute('aria-labelledby', requestedTab.id || '');
        subtitle.textContent =
          tabName === 'current'
            ? 'Elige la receta completa o solamente los fármacos indicados por un profesional.'
            : 'Selecciona uno, varios o todos. Se abrirá un único PDF, con fecha, hora y prescriptor por paciente.';
        if (tabName === 'current') renderCurrentPatient(generation);
        else renderHospitalized(generation);
      };
      tabs.forEach(tab =>
        tab.addEventListener('click', () => {
          if (tab.disabled) return;
          if (tab.dataset.tab !== activeTab) activateTab(tab.dataset.tab);
        })
      );
      tabs.forEach(tab =>
        tab.addEventListener('keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const enabledTabs = tabs.filter(candidate => !candidate.disabled);
          if (!enabledTabs.length) return;
          event.preventDefault();
          const currentIndex = Math.max(0, enabledTabs.indexOf(tab));
          const nextIndex =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? enabledTabs.length - 1
                : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + enabledTabs.length) %
                  enabledTabs.length;
          const nextTab = enabledTabs[nextIndex];
          if (nextTab.dataset.tab !== activeTab) activateTab(nextTab.dataset.tab);
          nextTab.focus();
        })
      );
      activateTab(
        initialTab === 'hospitalized' || !currentPatientMatchesRoute ? 'hospitalized' : 'current'
      );
    };

    return Object.freeze({ open });
  };

  globalThis.HhrPrescriptionCenterRuntime = Object.freeze({ create });
})();
