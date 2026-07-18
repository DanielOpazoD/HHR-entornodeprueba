/**
 * hhr-handoff-center.js
 *
 * Owns the Centro HHR Turno surface. The host content script keeps the shared
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
      clinicalWriteKey,
      hydrateClinicalWriteProtection,
      setClinicalGuardState,
      setSyncState,
      releaseClinicalWriteProtection,
      uncertainClinicalWrites,
      normalizedClinicalText,
      finishRouteChangeWrite,
      acknowledgeClinicalWrite,
      clinicalWriteRecoveryReady,
    } = dependencies || {};

    if (
      !helper ||
      !runtimeMessages ||
      typeof runClinicalTransition !== 'function' ||
      typeof normalizedText !== 'function' ||
      typeof sendMessage !== 'function' ||
      typeof clinicalWriteKey !== 'function' ||
      typeof hydrateClinicalWriteProtection !== 'function' ||
      typeof setClinicalGuardState !== 'function' ||
      typeof setSyncState !== 'function' ||
      typeof releaseClinicalWriteProtection !== 'function' ||
      !(uncertainClinicalWrites instanceof Map) ||
      typeof normalizedClinicalText !== 'function' ||
      typeof finishRouteChangeWrite !== 'function' ||
      typeof acknowledgeClinicalWrite !== 'function' ||
      typeof clinicalWriteRecoveryReady !== 'function'
    ) {
      throw new Error('No se pudo inicializar el Centro de Turno HHR.');
    }

  const renderHandoffCenter = (root, encId) => {
    const requestGeneration = String(Number(root.dataset.handoffRequestGeneration || 0) + 1);
    root.dataset.handoffRequestGeneration = requestGeneration;
    const main = root.querySelector('.hhr-center-main');
    main.innerHTML = `
      <div class="hhr-center-toolbar">
        <h2 class="hhr-center-heading">Entrega de turno</h2>
        <input class="hhr-center-search" type="search" placeholder="Buscar paciente, RUN o cama" aria-label="Buscar paciente">
        <select class="hhr-center-select hhr-handoff-station" aria-label="Estación de enfermería"><option value="0">Todas las estaciones</option></select>
        <button class="hhr-center-action hhr-handoff-print" type="button">Imprimir</button>
        <button class="hhr-center-action hhr-center-refresh" type="button">Actualizar</button>
      </div>
      <div class="hhr-center-content"><div class="hhr-center-empty">Leyendo entregas desde Eloísa…</div></div>
    `;
    const content = main.querySelector('.hhr-center-content');
    const search = main.querySelector('.hhr-center-search');
    const station = main.querySelector('.hhr-handoff-station');
    const printButton = main.querySelector('.hhr-handoff-print');
    main.querySelector('.hhr-center-refresh').addEventListener('click', () => {
      runClinicalTransition(root, () => renderHandoffCenter(root, encId), { allowUncertain: true });
    });

    const filterRows = () => {
      const query = normalizedText(search.value);
      content.querySelectorAll('tbody tr').forEach(row => {
        row.hidden = Boolean(query) && !String(row.dataset.search || '').includes(query);
      });
    };
    search.addEventListener('input', filterRows);
    printButton.addEventListener('click', async () => {
      printButton.disabled = true;
      printButton.textContent = 'Abriendo…';
      const result = await sendMessage({
        type: runtimeMessages.HANDOFF_REPORT_REQUEST,
        nurseStationId: station.value,
      });
      printButton.disabled = false;
      printButton.textContent = 'Imprimir';
      if (!result || result.error) {
        const notice = document.createElement('div');
        notice.className = 'hhr-center-notice';
        notice.textContent = (result && result.error) || 'No se pudo abrir el reporte de turno.';
        content.prepend(notice);
      }
    });

    sendMessage({ type: runtimeMessages.HANDOFF_OPTIONS_REQUEST, currentEncId: encId || '' }).then(response => {
      if (
        !root.isConnected ||
        root.dataset.activeModule !== 'handoff' ||
        root.dataset.handoffRequestGeneration !== requestGeneration
      ) return;
      content.innerHTML = '';
      if (!response || response.error) {
        const error = document.createElement('div');
        error.className = 'hhr-rx-error';
        error.textContent = (response && response.error) || 'No se pudieron leer las entregas.';
        content.appendChild(error);
        return;
      }
      const handoffLabel = response.handoffLabel || 'Entrega de turno';
      main.querySelector('.hhr-center-heading').textContent = handoffLabel;
      const nursingLane = response.handoffKind === 'nursing';
      station.hidden = !nursingLane;
      printButton.hidden = !response.canPrint;
      const identityNotice = document.createElement('div');
      identityNotice.className = 'hhr-center-notice';
      identityNotice.textContent = 'Sesión verificada: ' +
        [response.currentProfessionalRole, response.currentProfessional].filter(Boolean).join(' · ') +
        '. Ves las entregas médicas y de enfermería; solo puedes registrar ' + handoffLabel.toLowerCase() + '.';
      content.appendChild(identityNotice);
      (Array.isArray(response.nurseStations) ? response.nurseStations : []).forEach(item => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name;
        station.appendChild(option);
      });
      if (!response.canWrite) {
        const notice = document.createElement('div');
        notice.className = 'hhr-center-notice';
        notice.textContent = response.writeBlockedReason || 'La sesión permite lectura, pero no ingreso de entregas.';
        content.appendChild(notice);
      }
      const patients = Array.isArray(response.patients) ? response.patients : [];
      if (!patients.length) {
        content.insertAdjacentHTML('beforeend', '<div class="hhr-center-empty">No hay pacientes hospitalizados.</div>');
        return;
      }
      const table = document.createElement('table');
      table.className = 'hhr-center-table hhr-handoff-table';
      table.innerHTML = `
        <colgroup><col style="width:6%"><col style="width:15%"><col style="width:21%"><col style="width:21%"><col style="width:26%"><col style="width:11%"></colgroup>
        <thead><tr><th>Cama</th><th>Paciente / RUN</th><th>Entrega médica</th><th>Entrega enfermería</th><th>Nueva ${response.handoffKind === 'medical' ? 'entrega médica' : 'entrega de enfermería'}</th><th>Estado</th></tr></thead><tbody></tbody>
      `;
      const tbody = table.querySelector('tbody');
      patients.forEach(patient => {
        const handoffKey = clinicalWriteKey('handoff', patient.encounterId);
        const persistedProtection = patient.clinicalWriteProtection || null;
        const uncertainWrite = hydrateClinicalWriteProtection(handoffKey, persistedProtection);
        setClinicalGuardState(root, 'uncertain', handoffKey, Boolean(uncertainWrite));
        const row = document.createElement('tr');
        row.dataset.search = normalizedText([patient.name, patient.run, patient.bed, patient.room, patient.service].join(' '));
        const bedCell = document.createElement('td');
        bedCell.dataset.label = 'Cama';
        bedCell.textContent = patient.bed || patient.room || '-';
        const patientCell = document.createElement('td');
        patientCell.dataset.label = 'Paciente';
        const patientName = document.createElement('span');
        patientName.className = 'hhr-center-patient';
        patientName.textContent = patient.name || 'Paciente sin nombre';
        const patientMeta = document.createElement('span');
        patientMeta.className = 'hhr-center-meta';
        patientMeta.textContent = [patient.run, patient.service].filter(Boolean).join(' · ');
        patientCell.append(patientName, patientMeta);
        if (patient.diagnosis) {
          const diagnosis = document.createElement('span');
          diagnosis.className = 'hhr-handoff-diagnosis';
          diagnosis.textContent = 'Dg: ' + patient.diagnosis;
          patientCell.appendChild(diagnosis);
        }
        const medicalCell = document.createElement('td');
        medicalCell.dataset.label = 'Entrega médica';
        const nursingCell = document.createElement('td');
        nursingCell.dataset.label = 'Entrega enfermería';
        const laneEmptyText = patient.handoffUnavailableReason ? 'No disponible' : 'Sin entrega registrada';
        const fillLane = (cell, latest) => {
          cell.innerHTML = '';
          if (!latest) {
            cell.textContent = laneEmptyText;
            return;
          }
          cell.textContent = latest.observation;
          const meta = document.createElement('span');
          meta.className = 'hhr-center-meta';
          meta.textContent = [
            latest.author,
            helper.formatDateTimeLabel(latest.dateTime),
            latest.isSigned ? 'Firmado' : latest.requiresValidation ? 'Pendiente de validar' : 'Guardado',
          ].filter(Boolean).join(' · ');
          cell.appendChild(meta);
        };
        fillLane(medicalCell, patient.latestMedical || (response.handoffKind === 'medical' ? patient.latestHandoff : null));
        fillLane(nursingCell, patient.latestNursing || (response.handoffKind === 'nursing' ? patient.latestHandoff : null));
        const ownLaneCell = response.handoffKind === 'medical' ? medicalCell : nursingCell;
        const fillLatest = latest => fillLane(ownLaneCell, latest);
        const editorCell = document.createElement('td');
        editorCell.dataset.label = 'Nueva entrega';
        const textarea = document.createElement('textarea');
        textarea.className = 'hhr-handoff-input';
        textarea.maxLength = 255;
        textarea.placeholder = (response.handoffKind === 'medical' ? 'Nueva entrega médica' : 'Nueva entrega de enfermería') + ' (máx. 255 caracteres)';
        textarea.disabled = !response.canWrite || Boolean(patient.handoffUnavailableReason) || Boolean(uncertainWrite);
        const editorTools = document.createElement('div');
        editorTools.className = 'hhr-handoff-tools';
        const counter = document.createElement('span');
        counter.className = 'hhr-char-count';
        if (uncertainWrite) textarea.value = uncertainWrite.displayObservation || uncertainWrite.observation;
        counter.textContent = textarea.value.length + '/255';
        const save = document.createElement('button');
        save.className = 'hhr-row-save hhr-handoff-save';
        save.type = 'button';
        save.textContent = 'Guardar';
        save.disabled = true;
        editorTools.append(counter, save);
        editorCell.append(textarea, editorTools);
        const statusCell = document.createElement('td');
        statusCell.dataset.label = 'Estado';
        const sync = document.createElement('span');
        setSyncState(
          sync,
          patient.handoffUnavailableReason
            ? 'No disponible'
            : uncertainWrite
              ? uncertainWrite.state === 'awaiting-client-ack'
                ? 'Guardado · confirmar'
                : 'No verificado · protegido'
              : 'Sin cambios',
          patient.handoffUnavailableReason || uncertainWrite ? 'error' : ''
        );
        if (uncertainWrite) sync.title = uncertainWrite.error || 'La escritura permanece protegida hasta confirmar su estado en Eloísa.';
        statusCell.appendChild(sync);
        if (persistedProtection) {
          const release = document.createElement('button');
          release.type = 'button';
          release.className = 'hhr-row-save hhr-protection-action';
          release.textContent = clinicalWriteRecoveryReady(persistedProtection)
            ? 'Actualizar y revisar'
            : 'Espera y actualiza';
          release.disabled = Boolean(
            patient.handoffUnavailableReason || persistedProtection.error ||
              !persistedProtection.generationId ||
              !clinicalWriteRecoveryReady(persistedProtection)
          );
          release.title = release.disabled
            ? 'La lectura o la protección no pudo verificarse; actualiza antes de liberar.'
            : 'Libera únicamente después de revisar la última entrega visible.';
          release.addEventListener('click', async () => {
            release.disabled = true;
            setSyncState(sync, 'Verificando nuevamente…');
            const result = await releaseClinicalWriteProtection(handoffKey, persistedProtection);
            if (!root.isConnected) return;
            if (result && result.cancelled) {
              setSyncState(sync, 'Protegido · sin liberar', 'error');
              release.disabled = false;
              return;
            }
            if (!result || result.error) {
              setSyncState(sync, 'No se liberó', 'error');
              sync.title = String(result && result.error || 'No fue posible liberar la protección.');
              release.disabled = false;
              return;
            }
            uncertainClinicalWrites.delete(handoffKey);
            setClinicalGuardState(root, 'uncertain', handoffKey, false);
            renderHandoffCenter(root, encId);
          });
          statusCell.appendChild(release);
        }
        textarea.addEventListener('input', () => {
          counter.textContent = textarea.value.length + '/255';
          save.disabled = !textarea.value.trim();
          setClinicalGuardState(root, 'dirty', handoffKey, Boolean(textarea.value.trim()));
          setSyncState(sync, textarea.value.trim() ? 'Sin guardar' : 'Sin cambios', textarea.value.trim() ? 'pending' : '');
        });
        save.addEventListener('click', async () => {
          if (!textarea.value.trim()) return;
          const pendingText = textarea.value;
          const startedAt = Date.now();
          save.disabled = true;
          textarea.disabled = true;
          setClinicalGuardState(root, 'dirty', handoffKey, false);
          setClinicalGuardState(root, 'pending', handoffKey, true);
          setSyncState(sync, 'Guardando…', 'pending');
          const result = await sendMessage({
            type: runtimeMessages.HANDOFF_SAVE_REQUEST,
            batchId: response.batchId,
            encId: patient.encounterId,
            observation: pendingText,
          });
          setClinicalGuardState(root, 'pending', handoffKey, false);
          if (!result || result.error) {
            const mayHaveSucceeded = Boolean(result && result.writeMayHaveSucceeded);
            textarea.disabled = mayHaveSucceeded;
            save.disabled = mayHaveSucceeded || !textarea.value.trim();
            if (mayHaveSucceeded) {
              uncertainClinicalWrites.set(handoffKey, {
                observation: normalizedClinicalText(pendingText),
                displayObservation: pendingText,
                startedAt,
                error: result.error || '',
              });
              setClinicalGuardState(root, 'uncertain', handoffKey, true);
              setClinicalGuardState(root, 'dirty', handoffKey, false);
            } else {
              setClinicalGuardState(root, 'dirty', handoffKey, Boolean(textarea.value.trim()));
            }
            setSyncState(sync, mayHaveSucceeded ? 'No verificado · actualiza' : 'Error al guardar', 'error');
            sync.title = (result && result.error) || 'No se pudo guardar.';
            finishRouteChangeWrite(root, mayHaveSucceeded ? 'uncertain' : 'error');
            return;
          }
          uncertainClinicalWrites.delete(handoffKey);
          setClinicalGuardState(root, 'uncertain', handoffKey, false);
          setClinicalGuardState(root, 'dirty', handoffKey, false);
          fillLatest(result.record);
          textarea.value = '';
          counter.textContent = '0/255';
          textarea.disabled = false;
          const persistedState = result.finishConfirmed
            ? 'Terminado'
            : result.record && result.record.isSigned
              ? 'Firmado'
            : result.record && result.record.requiresValidation ? 'Pendiente de validar' : 'Guardado';
          const acknowledged = await acknowledgeClinicalWrite(result.clinicalWriteReceipt);
          if (!root.isConnected) return;
          if (acknowledged.error) {
            uncertainClinicalWrites.set(handoffKey, {
              observation: '',
              displayObservation: '',
              startedAt,
              error: 'El guardado fue verificado, pero falta confirmar su recepción local. ' +
                acknowledged.error,
            });
            textarea.disabled = true;
            save.disabled = true;
            setClinicalGuardState(root, 'uncertain', handoffKey, true);
            setSyncState(sync, 'Guardado · protegido', 'uncertain');
            sync.title = uncertainClinicalWrites.get(handoffKey).error;
            finishRouteChangeWrite(root, 'uncertain');
            return;
          }
          setSyncState(sync, 'Guardado en Eloísa · ' + persistedState, 'synced');
          finishRouteChangeWrite(root, 'synced');
        });
        row.append(bedCell, patientCell, medicalCell, nursingCell, editorCell, statusCell);
        tbody.appendChild(row);
      });
      content.appendChild(table);
      filterRows();
    });
  };

    return Object.freeze({ renderHandoffCenter });
  };

  globalThis.HhrHandoffCenterRuntime = Object.freeze({ create });
})();
