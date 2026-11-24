const { createHash } = require('node:crypto');
const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('../runtime/runtimeConfig');
const { addCalendarDays, hospitalDateTimeParts } = require('../hospitalCalendarDay');
const { resolveClinicalDayForDateTime } = require('../generated/cudyrSourceParser.cjs');
const { templates } = require('./templates');
const {
  applicationFrom,
  codePattern,
  evolutionText,
  fail,
  key,
  patientForEncounter,
  templateFrom,
} = require('./model');

function createChecklistHandler({ firestore, resolveRoleForEmail, now = () => new Date() }) {
  const hospital = firestore.collection('hospitals').doc(HOSPITAL_ID);
  const catalog = hospital.collection('checklistTemplates');
  const records = hospital.collection('checklistApplications');
  const builtins = new Map(templates.map(template => [template.id, template]));
  return async (data, context) => {
    const uid = context?.auth?.uid;
    const email = context?.auth?.token?.email;
    if (!uid || !email) fail('unauthenticated', 'Inicia sesión en HHR.');
    const authorName = context.auth.token.name || email;
    const role = await resolveRoleForEmail(email, context);
    if (!['admin', 'nurse_hospital', 'doctor_urgency', 'doctor_specialist'].includes(role))
      fail('permission-denied', 'Tu cuenta no tiene acceso a las pautas clínicas.');
    const action = data?.action;
    if (action === 'templates') {
      const all = new Map(builtins);
      (await catalog.get()).forEach(doc => all.set(doc.id, doc.data()));
      const sorted = [...all.values()].sort((a, b) =>
        String(a?.title || '').localeCompare(String(b?.title || ''), 'es-CL')
      );
      return {
        templates: sorted,
        uid,
        authorName,
        manage: role === 'admin',
      };
    }
    if (action === 'configure') {
      if (role !== 'admin')
        fail('permission-denied', 'Se requiere administración para modificar las plantillas.');
      const updated = templateFrom(data.template);
      const ref = catalog.doc(updated.id);
      return firestore.runTransaction(async tx => {
        const current = (await tx.get(ref)).data() || builtins.get(updated.id);
        if ((current?.version ?? 0) !== data.version)
          fail('aborted', 'Otra persona modificó esta plantilla. Vuelve a abrirla.');
        const template = { ...updated, version: data.version + 1 };
        tx.set(ref, template);
        return { template };
      });
    }
    if (!codePattern.test(data?.code || ''))
      fail('invalid-argument', 'El código de verificación no es válido.');
    const code = data.code.toUpperCase();
    const ref = records.doc(code);
    if (action === 'get') {
      const snap = await ref.get();
      if (!snap.exists) fail('not-found', 'No hay una pauta con ese código.');
      return { record: snap.data().record };
    }
    if (
      action !== 'apply' ||
      data.uid !== uid ||
      !key(data.templateId) ||
      !Number.isInteger(data.version) ||
      !/^[1-9]\d{0,15}$/.test(data.episode) ||
      typeof data.episode !== 'string' ||
      typeof data.document !== 'string' ||
      !data.document.trim() ||
      data.document.length > 64 ||
      !data.answers ||
      typeof data.answers !== 'object' ||
      Array.isArray(data.answers) ||
      Object.keys(data.answers).length > 40 ||
      Object.values(data.answers).some(v => typeof v !== 'string' || v.length > 2000)
    )
      fail('failed-precondition', 'Reabre la pauta y comprueba el paciente y la cuenta de HHR.');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          uid,
          data.episode,
          data.document,
          data.templateId,
          data.version,
          Object.keys(data.answers)
            .sort()
            .map(key => [key, data.answers[key]]),
        ])
      )
      .digest('hex');
    return firestore.runTransaction(async tx => {
      const old = (await tx.get(ref)).data();
      if (old) {
        if (old.fingerprint !== fingerprint)
          fail('already-exists', 'Este código ya identifica otra aplicación.');
        return { record: old.record };
      }
      const instant = now();
      const { date, time } = hospitalDateTimeParts(instant);
      const censusDate = resolveClinicalDayForDateTime(date, time);
      const [current, daily, invalidEpisode] = await Promise.all([
        tx.get(catalog.doc(data.templateId)),
        tx.get(hospital.collection('dailyRecords').doc(censusDate)),
        tx.get(hospital.collection('invalidClinicalEpisodes').doc(data.episode)),
      ]);
      // Before morning bootstrap creates today's census record, fall back to the immediately
      // preceding clinical day while still enforcing exact episode + document verification.
      const previousCensusDate = addCalendarDays(censusDate, -1);
      const effectiveDaily = daily.exists
        ? { snap: daily, date: censusDate }
        : {
            snap: await tx.get(hospital.collection('dailyRecords').doc(previousCensusDate)),
            date: previousCensusDate,
          };
      const template = current.data() || builtins.get(data.templateId);
      if (!template || template.version !== data.version)
        fail(
          'failed-precondition',
          'La plantilla cambió. Reabre la pauta para revisar la versión vigente.'
        );
      if (invalidEpisode.exists)
        fail('failed-precondition', 'El episodio está marcado como no válido en HHR.');
      const patient = patientForEncounter(effectiveDaily.snap.data(), data.episode, data.document);
      const record = {
        code,
        savedAt: instant.toISOString(),
        censusDate: effectiveDaily.date,
        authorUid: uid,
        authorName,
        patient,
        template,
        ...applicationFrom(template, data.answers),
      };
      const result = { ...record, evolution: evolutionText(record) };
      tx.create(ref, { record: result, fingerprint });
      return { record: result };
    });
  };
}

function createClinicalChecklistFunctions(dependencies) {
  return {
    clinicalChecklists: functions
      .region('southamerica-east1')
      .https.onCall(createChecklistHandler(dependencies)),
  };
}
module.exports = { createChecklistHandler, createClinicalChecklistFunctions };
