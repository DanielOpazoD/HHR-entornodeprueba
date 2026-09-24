const crypto = require('node:crypto');
const { normalizeCode, validCode } = require('./specialtyRules');
const { MODEL, PROMPT_VERSION, buildJevRequest } = require('./specialtyJevAdapter');
const { resolveCie10Label } = require('./specialtyCie10Catalog');

const buildJevEvidence = ({ date, bedId, target, patient, policy }) => {
  const episodeId = typeof patient?.clinicalEpisodeId === 'string'
    ? patient.clinicalEpisodeId.trim() : '';
  const code = normalizeCode(patient?.cie10Code);
  const label = resolveCie10Label(code);
  if (!episodeId || !validCode(code) || typeof label !== 'string' || !label.trim()) {
    return null;
  }
  const request = buildJevRequest({ code, canonicalLabel: label, rubrics: policy.aiRubrics });
  const scope = { date, bedId, target, episodeId, policyRevision: policy.revision,
    model: MODEL, promptVersion: PROMPT_VERSION, request };
  const digest = crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex');
  return { digest, episodeId, code, request };
};

module.exports = { buildJevEvidence };
