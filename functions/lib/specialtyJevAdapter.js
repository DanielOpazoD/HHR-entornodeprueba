// TypeSafe System One Choice API, verified against docs.typesafe.ai/api and
// /primitives/choice on 2026-09-23. No model output can write a patient.
const MODEL = 'jev-1.13.0';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const PROMPT_VERSION = 'hhr-specialty-choice-v1';
const CHOICE_TO_SPECIALTY = Object.freeze({
  internal_medicine: 'Med Interna', surgery: 'Cirugía',
  traumatology: 'Traumatología', obstetrics_gynecology: 'Ginecobstetricia',
  psychiatry: 'Psiquiatría', pediatrics: 'Pediatría', dentistry: 'Odontología',
  review_required: null,
});
const OPTIONS = Object.keys(CHOICE_TO_SPECIALTY);

class JevAdapterError extends Error {
  constructor(code) { super(code); this.name = 'JevAdapterError'; this.code = code; }
}
const validRubrics = rubrics => rubrics && typeof rubrics === 'object' &&
  !Array.isArray(rubrics) && Object.keys(rubrics).sort().join('|') === OPTIONS.slice().sort().join('|') &&
  OPTIONS.every(key => typeof rubrics[key] === 'string' &&
    rubrics[key].trim().length >= 12 && rubrics[key].length <= 500);

const buildJevRequest = ({ code, canonicalLabel, rubrics }) => {
  if (!/^[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,4})?$/.test(code) ||
      typeof canonicalLabel !== 'string' || !canonicalLabel.trim() ||
      canonicalLabel.length > 160 || !validRubrics(rubrics)) {
    throw new JevAdapterError('JEV_NOT_CONFIGURED');
  }
  return {
    model: MODEL,
    state: { diagnosis: { code, label: canonicalLabel } },
    questions: {
      specialty: {
        type: 'choice',
        instructions: 'Suggest one operational specialty from this closed list using only the approved diagnosis label. Choose review_required if evidence is insufficient or ambiguous. Do not infer missing patient facts.',
        criteria: Object.fromEntries(OPTIONS.map(key => [key, rubrics[key]])),
      },
    },
  };
};

const validateResponse = payload => {
  if (!payload || payload.model !== MODEL || !payload.answers ||
      Object.keys(payload.answers).join('|') !== 'specialty') {
    throw new JevAdapterError('JEV_INVALID_RESPONSE');
  }
  const answer = payload.answers.specialty;
  const probabilities = answer?.probabilities;
  if (answer?.type !== 'choice' || !OPTIONS.includes(answer.choice) ||
      !probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities) ||
      Object.keys(probabilities).sort().join('|') !== OPTIONS.slice().sort().join('|') ||
      !OPTIONS.every(key => Number.isFinite(probabilities[key]) &&
        probabilities[key] >= 0 && probabilities[key] <= 1) ||
      Math.abs(OPTIONS.reduce((sum, key) => sum + probabilities[key], 0) - 1) > 1e-6 ||
      !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1 ||
      OPTIONS.some(key => probabilities[key] > probabilities[answer.choice] + 1e-9)) {
    throw new JevAdapterError('JEV_INVALID_RESPONSE');
  }
  return { model: MODEL, promptVersion: PROMPT_VERSION,
    choice: answer.choice, specialty: CHOICE_TO_SPECIALTY[answer.choice],
    probabilities: Object.fromEntries(OPTIONS.map(key => [key, probabilities[key]])),
    confidence: answer.confidence };
};

const readBoundedResponse = async response => {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > 64 * 1024) throw new JevAdapterError('JEV_RESPONSE_TOO_LARGE');
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 64 * 1024) throw new JevAdapterError('JEV_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const evaluateWithJev = async (request, { apiKey, fetchImpl = fetch } = {}) => {
  if (!apiKey) throw new JevAdapterError('JEV_NOT_CONFIGURED');
  if (request?.model !== MODEL || !validRubrics(request?.questions?.specialty?.criteria)) {
    throw new JevAdapterError('JEV_INVALID_REQUEST');
  }
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new JevAdapterError('JEV_UNAVAILABLE');
  }
  if (!response.ok) {
    throw new JevAdapterError(response.status === 429 || response.status === 529
      ? 'JEV_RATE_LIMITED' : 'JEV_PROVIDER_ERROR');
  }
  try {
    return validateResponse(await readBoundedResponse(response));
  } catch (error) {
    if (error instanceof JevAdapterError) throw error;
    throw new JevAdapterError('JEV_INVALID_RESPONSE');
  }
};

module.exports = { MODEL, PROMPT_VERSION, OPTIONS, CHOICE_TO_SPECIALTY,
  JevAdapterError, validRubrics, buildJevRequest, validateResponse, evaluateWithJev };
