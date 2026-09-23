const crypto = require('node:crypto');
const { SPECIALTIES, getPatient } = require('./specialtyDecisionContract');
const { validRubrics } = require('./specialtyJevAdapter');

const text = value => typeof value === 'string' ? value.trim() : '';
const normalizeCode = value => text(value).toUpperCase().replace(/\s+/g, '');
const validCode = value => /^[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,4})?$/.test(value);
const validRuleId = value => /^[A-Za-z0-9_-]{1,80}$/.test(value);
const allowedSpecialty = value => SPECIALTIES.has(value) && value !== '' && value !== 'Otro';
const isCurrentRapaNuiDay = date => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Easter', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const calendar = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return date === `${calendar.year}-${calendar.month}-${calendar.day}`;
};

const validatePolicy = policy => {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) ||
      policy.schemaVersion !== 1 || !Number.isInteger(policy.revision) || policy.revision < 1 ||
      typeof policy.autoEnabled !== 'boolean' || typeof policy.memoryEnabled !== 'boolean' ||
      !['off', 'consultative'].includes(policy.aiMode) ||
      (policy.aiMode === 'consultative' &&
        (!validRubrics(policy.aiRubrics) || !policy.diagnosisLabels ||
         typeof policy.diagnosisLabels !== 'object' ||
         Array.isArray(policy.diagnosisLabels) ||
         Object.keys(policy.diagnosisLabels).length > 256 ||
         !Object.entries(policy.diagnosisLabels).every(([code, label]) =>
           validCode(code) && typeof label === 'string' &&
           label.trim().length >= 4 && label.length <= 160 &&
           !/[<>\r\n]/.test(label)) ||
         !Number.isInteger(policy.aiMonthlyLimit) || policy.aiMonthlyLimit < 1 ||
         policy.aiMonthlyLimit > 1000)) ||
      !Array.isArray(policy.rules) || !Array.isArray(policy.memory) ||
      policy.rules.length > 128 || policy.memory.length > 256) return false;
  const rules = [...policy.rules, ...policy.memory];
  if (new Set(rules.map(rule => rule?.id)).size !== rules.length) return false;
  return rules.every(rule => rule && validRuleId(rule.id) &&
    validCode(normalizeCode(rule.cie10Code)) && rule.scope === 'all' &&
    Number.isInteger(rule.revision) && rule.revision >= 1 &&
    ((rule.kind === 'review' && rule.specialty === undefined) ||
     (rule.kind === 'assign' && allowedSpecialty(rule.specialty))));
};

const exactMatches = (entries, code) => entries.filter(rule =>
  normalizeCode(rule.cie10Code) === code && rule.scope === 'all');
const uniqueAssignment = matches => {
  if (matches.some(rule => rule.kind === 'review')) return { kind: 'review', reason: 'manual_required' };
  const values = new Set(matches.map(rule => rule.specialty));
  if (values.size > 1) return { kind: 'review', reason: 'rule_conflict' };
  return values.size === 1 ? { kind: 'assign', rule: matches[0] } : null;
};

const resolvePendingSpecialty = (patient, policy) => {
  if (!policy?.autoEnabled || !validatePolicy(policy)) return { kind: 'keep' };
  if (patient?.isBlocked) return { kind: 'keep' };
  if (!text(patient?.clinicalEpisodeId)) return { kind: 'review', reason: 'episode_missing' };
  if (text(patient?.specialty) || patient?.specialtyAssignment != null) return { kind: 'keep' };
  const code = normalizeCode(patient?.cie10Code);
  if (!validCode(code)) return { kind: 'review', reason: 'diagnosis_missing_or_invalid' };
  const base = exactMatches(policy.rules, code);
  const hardReview = base.find(rule => rule.kind === 'review');
  if (hardReview) return { kind: 'review', reason: 'manual_required' };
  if (policy.memoryEnabled) {
    const remembered = uniqueAssignment(exactMatches(policy.memory, code));
    if (remembered) return remembered;
  }
  return uniqueAssignment(base) || { kind: 'review', reason: 'no_rule' };
};

const makeDecisionId = (mutationId, bedId, target) =>
  crypto.createHash('sha256').update(`${mutationId}|${bedId}|${target}`).digest('hex').slice(0, 40);

const applyPendingSpecialtyRules = ({ remoteRecord, candidate, policy, actorUid, mutationId, now,
  eligibleBedIds }) => {
  if (!policy?.autoEnabled || !validatePolicy(policy) || !text(mutationId)) return [];
  const decisions = [];
  for (const bedId of Object.keys(candidate?.beds || {})) {
    if (eligibleBedIds && !eligibleBedIds.includes(bedId)) continue;
    for (const target of ['bed', 'clinicalCrib']) {
      const patient = getPatient(candidate, bedId, target);
      if (!patient || typeof patient !== 'object') continue;
      const remote = getPatient(remoteRecord, bedId, target);
      // Only truly pending episodes. A legacy value, even without metadata, is protected.
      if (remote && text(remote.clinicalEpisodeId) === text(patient.clinicalEpisodeId) &&
          (text(remote.specialty) || remote.specialtyAssignment != null)) continue;
      const outcome = resolvePendingSpecialty(patient, policy);
      if (outcome.kind !== 'assign') continue;
      const rule = outcome.rule;
      const decisionId = makeDecisionId(mutationId, bedId, target);
      patient.specialty = rule.specialty;
      patient.specialtyAssignment = {
        schemaVersion: 3, episodeId: patient.clinicalEpisodeId, decisionId,
        recordDate: candidate.date,
        source: 'rule', actorUid: text(actorUid) || 'system', decidedAt: now,
        rule: { id: rule.id, revision: rule.revision || 1, catalogRevision: policy.revision },
      };
      decisions.push({ bedId, target, episodeId: patient.clinicalEpisodeId, decisionId,
        recordDate: candidate.date,
        metadata: patient.specialtyAssignment,
        previousValue: '', value: rule.specialty, source: 'rule',
        actorUid: text(actorUid) || 'system', decidedAt: now,
        ruleId: rule.id, catalogRevision: policy.revision });
    }
  }
  return decisions;
};

module.exports = { normalizeCode, validCode, validatePolicy, resolvePendingSpecialty,
  applyPendingSpecialtyRules, makeDecisionId, isCurrentRapaNuiDay };
