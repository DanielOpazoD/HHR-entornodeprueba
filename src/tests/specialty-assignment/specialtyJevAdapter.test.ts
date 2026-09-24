import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { buildJevRequest, validateResponse, evaluateWithJev, OPTIONS } =
  require('../../../functions/lib/specialtyJevAdapter.js');
const rubrics = Object.fromEntries(OPTIONS.map((key: string) => [key,
  `${key}: criterio operacional aprobado para prueba sintética.`]));
const probabilities = Object.fromEntries(OPTIONS.map((key: string) => [key,
  key === 'internal_medicine' ? 1 : 0]));
const response = { model: 'jev-1.13.0', answers: { specialty: {
  type: 'choice', choice: 'internal_medicine', probabilities, confidence: 0.83,
} } };

describe('Jev adapter with synthetic evidence only', () => {
  it('builds a closed Choice request from a code and approved label', () => {
    const request = buildJevRequest({ code: 'J18.9', canonicalLabel: 'Neumonía sintética', rubrics });
    expect(request.state).toEqual({ diagnosis: { code: 'J18.9', label: 'Neumonía sintética' } });
    expect(Object.keys(request.questions.specialty.criteria)).toEqual(OPTIONS);
    expect(JSON.stringify(request)).not.toMatch(/patientName|rut|episodeId/);
  });

  it('rejects malformed or unapproved output instead of assigning it', () => {
    expect(validateResponse(response).specialty).toBe('Med Interna');
    expect(() => validateResponse({ ...response, model: 'other' })).toThrow();
    expect(() => validateResponse({ ...response, answers: { specialty: {
      ...response.answers.specialty, choice: 'invented',
    } } })).toThrow();
    expect(() => validateResponse({ ...response, answers: { specialty: {
      ...response.answers.specialty, confidence: 3,
    } } })).toThrow();
  });

  it('uses the documented endpoint and treats provider errors as non-decisions', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, body: null,
      text: async () => JSON.stringify(response) });
    const request = buildJevRequest({ code: 'J18.9', canonicalLabel: 'Neumonía sintética', rubrics });
    const result = await evaluateWithJev(request, { apiKey: 'test', fetchImpl });
    expect(result.specialty).toBe('Med Interna');
    expect(fetchImpl).toHaveBeenCalledWith('https://api.typesafe.ai/v1/systemone',
      expect.objectContaining({ method: 'POST' }));
    await expect(evaluateWithJev(request, { apiKey: 'test',
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 429 }) })).rejects.toMatchObject({
      code: 'JEV_RATE_LIMITED',
    });
  });
});
