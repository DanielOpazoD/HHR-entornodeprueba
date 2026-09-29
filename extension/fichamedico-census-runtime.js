/** Clinical census reader for the Ficha Médico MAIN world (classic UMD for MV3). */
(function (root) {
  'use strict';
  const tick = () => root.performance?.now?.() ?? Date.now();
  const elapsed = (start, end) => Math.max(0, Math.round(end - start));
  const read = async ({
    getVerifiedClinicalContext, apiGet, getAuth, readClinicalCached,
    normalization, headerUrl, diagnosisUrl, isolationUrl,
    diagnosisCatalogCacheTtlMs, physicianNormalization, diagnosisCodingRuntime,
    documentRoot,
  }) => {
    const phaseStarted = tick();
    const context = await getVerifiedClinicalContext();
    const contextReady = tick();
    const base = context.base || new URL(context.apiOrigin);
    const physicianCatalogPromise = (physicianNormalization?.captureFromDocument || (async () => ({ physicians: [], physicianById: {}, physicianByEncounterId: {} })))({ apiGet, apiOrigin: context.apiOrigin, facilityId: context.identity.facilityId, auth: getAuth(), root: documentRoot }).catch(() => ({ physicians: [], physicianById: {}, physicianByEncounterId: {} }));
    const withFilter = ft => {
      const u = new URL(base);
      u.searchParams.set('filterType', ft);
      return u.toString();
    };
    // filterType=3 (sin médico + Servicio Todos) = full active census; filterType=2 = egresos.
    let active;
    let discharged;
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
      active = [...byEncounter.values()];
      discharged = [];
    } else {
      [active, discharged] = await Promise.all([
        apiGet(withFilter('3'), getAuth()),
        apiGet(withFilter('2'), getAuth()).catch(() => []),
      ]);
    }
    const rows = [
      ...(Array.isArray(active) ? active : []).map(item => ({ item, discharged: false })),
      ...(Array.isArray(discharged) ? discharged : []).map(item => ({ item, discharged: true })),
    ];
    const { physicians, physicianById, physicianByEncounterId } = await physicianCatalogPromise;
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
    const diagnosisCoding = diagnosisCodingRuntime.createEnricher(() =>
      readClinicalCached(`${context.apiOrigin}:diagnosis-catalog`,
        async () => normalization.indexDiagnosisCatalog(await apiGet(
          `${context.apiOrigin}/api/core/diagnosisClassify?tid=0`, getAuth()
        )), Date.now(), diagnosisCatalogCacheTtlMs));
    let cursor = 0;
    const worker = async () => {
      while (cursor < rows.length) {
        const index = cursor++;
        const { item, discharged: isDischarged } = rows[index];
        const cachePrefix = [
          context.identity.facilityId,
          context.identity.practitionerId,
          context.identity.practitionerRoleId,
          item.id,
        ].join(':');
        const [headerResult, diagnosisResult, isolationResult] = await Promise.allSettled([
          readClinicalCached(`${cachePrefix}:header`, () =>
            apiGet(headerUrl(base, item.id), getAuth())
          ),
          readClinicalCached(`${cachePrefix}:diagnosis`, () =>
            apiGet(diagnosisUrl(base, item.id, context.identity.practitionerId), getAuth())
          ),
          normalization.requiresIsolationDetails(item)
            ? readClinicalCached(`${cachePrefix}:isolation`, () =>
                apiGet(isolationUrl(base, item.id), getAuth())
              )
            : Promise.resolve([]),
        ]);
        const headerFailed = headerResult.status === 'rejected';
        const diagnosisFailed = diagnosisResult.status === 'rejected';
        const isolationFailed = isolationResult.status === 'rejected';
        if (headerFailed) clinicalCoverage.headerErrors += 1;
        if (diagnosisFailed) clinicalCoverage.diagnosisErrors += 1;
        if (isolationFailed) clinicalCoverage.isolationErrors += 1;
        if (headerFailed || diagnosisFailed || isolationFailed) clinicalCoverage.errors += 1;
        else clinicalCoverage.completed += 1;
        const header = headerResult.status === 'fulfilled' ? headerResult.value : null;
        const diagnosisRows = diagnosisResult.status === 'fulfilled' ? diagnosisResult.value : [];
        const isolationEntries = isolationResult.status === 'fulfilled' && Array.isArray(isolationResult.value)
          ? isolationResult.value : null;
        const itemWithIsolation = isolationEntries ? { ...item, isolationEntries } : item;
        const principalDiagnosis = normalization.selectPrincipalDiagnosis(
          diagnosisRows,
          header,
          itemWithIsolation
        );
        diagnosisCoding.queue(index, principalDiagnosis);
        encounters[index] = normalization.normalizeEncounter(
          itemWithIsolation,
          header,
          principalDiagnosis,
          isDischarged, physicianById, physicianByEncounterId
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, rows.length) }, () => worker()));
    const patientsReady = tick();
    await diagnosisCoding.apply(encounters);

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
