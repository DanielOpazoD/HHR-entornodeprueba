/** Clinical census reader for the Ficha Médico MAIN world (classic UMD for MV3). */
(function (root) {
  'use strict';
  const tick = () => root.performance?.now?.() ?? Date.now();
  const elapsed = (start, end) => Math.max(0, Math.round(end - start));
  const createCaptureAbortError = () => {
    const error = new Error('Tiempo de espera agotado leyendo Rayen.');
    error.code = 'HHR_CAPTURE_ABORTED';
    error.timeoutStage = 'ficha_main_relay';
    return error;
  };
  const isAborted = signal => Boolean(signal && signal.aborted);
  const assertCaptureActive = signal => {
    if (isAborted(signal)) throw createCaptureAbortError();
  };
  const recordEncounterOutcome = ({
    item, isDischarged, results, clinicalCoverage, normalization, diagnosisCoding, index,
    physicianById, physicianByEncounterId,
  }) => {
    const [headerResult, diagnosisResult, isolationResult] = results;
    const headerFailed = headerResult.status === 'rejected';
    const diagnosisFailed = diagnosisResult.status === 'rejected';
    const isolationFailed = isolationResult.status === 'rejected';
    if (headerFailed) clinicalCoverage.headerErrors += 1;
    if (diagnosisFailed) clinicalCoverage.diagnosisErrors += 1;
    if (isolationFailed) clinicalCoverage.isolationErrors += 1;
    if (headerFailed || diagnosisFailed || isolationFailed) clinicalCoverage.errors += 1;
    else clinicalCoverage.completed += 1;
    const header = headerFailed ? null : headerResult.value;
    const diagnosisRows = diagnosisFailed ? [] : diagnosisResult.value;
    const isolationEntries = !isolationFailed && Array.isArray(isolationResult.value)
      ? isolationResult.value : null;
    const itemWithIsolation = isolationEntries ? { ...item, isolationEntries } : item;
    const principalDiagnosis = normalization.selectPrincipalDiagnosis(
      diagnosisRows, header, itemWithIsolation
    );
    diagnosisCoding.queue(index, principalDiagnosis);
    return normalization.normalizeEncounter(
      itemWithIsolation, header, principalDiagnosis, isDischarged, physicianById, physicianByEncounterId
    );
  };
  const readEncounterLists = async ({ context, base, apiGet, getAuth, signal }) => {
    if (context.listSource === 'nursing') {
      const lists = await Promise.all(
        ['noveltyNurseList', 'uneventfulNurseList', 'incomeNurseList'].map(list =>
          apiGet(
            `${context.apiOrigin}/api/encounter/${list}/${encodeURIComponent(context.identity.facilityId)}`,
            getAuth()
          )
        )
      );
      const byEncounter = new Map();
      lists.flat().forEach(item => {
        if (item && item.id != null) byEncounter.set(String(item.id), item);
      });
      return { active: [...byEncounter.values()], discharged: [] };
    }
    const withFilter = ft => {
      const u = new URL(base);
      u.searchParams.set('filterType', ft);
      return u.toString();
    };
    // filterType=3 (sin médico + Servicio Todos) = full active census; filterType=2 = egresos.
    const [active, discharged] = await Promise.all([
      apiGet(withFilter('3'), getAuth()),
      apiGet(withFilter('2'), getAuth()).catch(error => {
        if (signal && signal.aborted) throw error;
        return [];
      }),
    ]);
    return { active, discharged };
  };
  const createDiagnosisCodingEnricher = ({
    diagnosisCodingRuntime, readDiagnosisCatalog, readDiagnosisCatalogCached,
    apiOrigin, normalization, apiGet, getAuth, diagnosisCatalogCacheTtlMs,
  }) => {
    const fetchCatalog = async () =>
      normalization.indexDiagnosisCatalog(
        await apiGet(`${apiOrigin}/api/core/diagnosisClassify?tid=0`, getAuth())
      );
    if (typeof readDiagnosisCatalog === 'function') {
      return diagnosisCodingRuntime.createEnricher(
        () => readDiagnosisCatalog(apiOrigin, fetchCatalog, false),
        () => readDiagnosisCatalog(apiOrigin, fetchCatalog, true).then(res => (res && res.codes) || res)
      );
    }
    return diagnosisCodingRuntime.createEnricher(() =>
      readDiagnosisCatalogCached(`${apiOrigin}:diagnosis-catalog`, fetchCatalog, Date.now(), diagnosisCatalogCacheTtlMs)
    );
  };
  const read = async ({
    getVerifiedClinicalContext, apiGet, getAuth, readClinicalCached: readDiagnosisCatalogCached,
    readDiagnosisCatalog, normalization, headerUrl, diagnosisUrl, isolationUrl,
    diagnosisCatalogCacheTtlMs, physicianNormalization, diagnosisCodingRuntime,
    documentRoot, signal,
  }) => {
    const phaseStarted = tick();
    const context = await getVerifiedClinicalContext();
    assertCaptureActive(signal);
    const contextReady = tick();
    const base = context.base || new URL(context.apiOrigin);
    const physicianCatalogPromise = (physicianNormalization?.captureFromDocument || (async () => ({ physicians: [], physicianById: {}, physicianByEncounterId: {} })))({ apiGet, apiOrigin: context.apiOrigin, facilityId: context.identity.facilityId, auth: getAuth(), root: documentRoot }).catch(() => ({ physicians: [], physicianById: {}, physicianByEncounterId: {} }));
    const { active, discharged } = await readEncounterLists({ context, base, apiGet, getAuth, signal });
    assertCaptureActive(signal);
    const rows = [
      ...(Array.isArray(active) ? active : []).map(item => ({ item, discharged: false })),
      ...(Array.isArray(discharged) ? discharged : []).map(item => ({ item, discharged: true })),
    ];
    const readEncounterCached = root.HhrFichaMedicoCaptureCache.create();
    const { physicians, physicianById, physicianByEncounterId } = await physicianCatalogPromise;
    assertCaptureActive(signal);
    const listsReady = tick();
    // Keep a small concurrency ceiling: headers and diagnoses are independent, but the bridge
    // should not burst dozens of requests against Ficha Medico at once.
    const encounters = new Array(rows.length);
    const clinicalCoverage = {
      total: rows.length,
      completed: 0,
      errors: 0,
      headerErrors: 0,
      diagnosisErrors: 0,
      isolationErrors: 0,
    };
    const diagnosisCoding = createDiagnosisCodingEnricher({
      diagnosisCodingRuntime, readDiagnosisCatalog, readDiagnosisCatalogCached,
      apiOrigin: context.apiOrigin, normalization, apiGet, getAuth, diagnosisCatalogCacheTtlMs,
    });
    let cursor = 0;
    const worker = async () => {
      while (cursor < rows.length && !isAborted(signal)) {
        const index = cursor++;
        const { item, discharged: isDischarged } = rows[index];
        const cachePrefix = String(item.id);
        const results = await Promise.allSettled([
          readEncounterCached(`${cachePrefix}:header`, () =>
            apiGet(headerUrl(base, item.id), getAuth())
          ),
          readEncounterCached(`${cachePrefix}:diagnosis`, () =>
            apiGet(diagnosisUrl(base, item.id, context.identity.practitionerId), getAuth())
          ),
          normalization.requiresIsolationDetails(item)
            ? readEncounterCached(`${cachePrefix}:isolation`, () =>
                apiGet(isolationUrl(base, item.id), getAuth())
              )
            : Promise.resolve([]),
        ]);
        if (isAborted(signal)) return;
        encounters[index] = recordEncounterOutcome({
          item, isDischarged, results, clinicalCoverage, normalization, diagnosisCoding, index,
          physicianById, physicianByEncounterId,
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, rows.length) }, () => worker()));
    assertCaptureActive(signal);
    const patientsReady = tick();
    await diagnosisCoding.apply(encounters);
    assertCaptureActive(signal);

    return {
      capturedAt: new Date().toISOString(),
      facilityId: Number(context.identity.facilityId),
      // A complete list with incomplete patient reads is still unsafe: blank fallback fields could
      // otherwise erase valid clinical data or make a present patient look absent downstream.
      isComplete: clinicalCoverage.errors === 0,
      clinicalCoverage,
      encounters, physicians,
      capturePhasesMs: {
        fichaContext: elapsed(phaseStarted, contextReady),
        fichaListsAndCatalog: elapsed(contextReady, listsReady),
        fichaPatientReads: elapsed(listsReady, patientsReady),
        fichaDiagnosisCoding: elapsed(patientsReady, tick()),
      },
    };
  };
  root.HhrFichaMedicoCensusRuntime = Object.freeze({ read });
})(typeof self !== 'undefined' ? self : globalThis);
