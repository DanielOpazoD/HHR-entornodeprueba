/** Versioned, deterministic offline transfer code shared with HHR. Base64 is encoding, not encryption. */
(function (root) {
  'use strict';
  const PREFIX = 'HHR-PACIENTE-1';
  const FORMAT_VERSION = 1;

  const text = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const canonicalize = value => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = canonicalize(value[key]);
      return result;
    }, {});
  };
  const base64Url = bytes => {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };
  const digest = async (cryptoApi, value) => {
    const hash = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return base64Url(new Uint8Array(hash));
  };
  const isoParts = value => {
    const source = text(value);
    const dateMatch = source.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if (dateMatch) return { date: dateMatch[1], time: dateMatch[2] };
    const parsed = new Date(source);
    if (!source || Number.isNaN(parsed.getTime())) return { date: '', time: '' };
    return { date: parsed.toISOString().slice(0, 10), time: parsed.toISOString().slice(11, 16) };
  };
  const biologicalSex = patient => {
    const value = text(patient.gender || patient.administrativeSex || patient.sex).toLowerCase();
    if (/femen|mujer|female/.test(value)) return 'Femenino';
    if (/mascul|hombre|male/.test(value)) return 'Masculino';
    return value ? 'Indeterminado' : undefined;
  };
  const deviceNames = entries => [...new Set((Array.isArray(entries) ? entries : [])
    .filter(entry => entry && entry.archived !== true && entry.deleted !== true && !entry.removedDatetime)
    .map(entry => text(entry.name))
    .filter(Boolean))];

  const buildPayload = ({ patient, deviceEntries, capturedAt }) => {
    const admission = isoParts(patient && patient.admissionDatetime);
    const payload = {
      version: FORMAT_VERSION,
      capturedAt: new Date(capturedAt == null ? Date.now() : capturedAt).toISOString(),
      encounterId: text(patient && patient.encounterId),
      firstName: text(patient && patient.firstGivenName),
      middleNames: text(patient && patient.nextGivenNames) || undefined,
      lastName: text(patient && patient.firstFamilyName),
      secondLastName: text(patient && patient.secondFamilyName) || undefined,
      rut: text(patient && patient.run),
      birthDate: text(patient && patient.birthDate).slice(0, 10) || undefined,
      biologicalSex: biologicalSex(patient || {}),
      admissionDate: admission.date,
      admissionTime: admission.time || undefined,
      diagnosis: text(patient && patient.diagnosis) || undefined,
      devices: deviceNames(deviceEntries),
    };
    const missing = ['encounterId', 'firstName', 'lastName', 'rut', 'admissionDate']
      .filter(field => !payload[field]);
    if (missing.length) {
      throw new Error('Eloísa no informó los datos obligatorios: ' + missing.join(', ') + '.');
    }
    return payload;
  };

  const createCode = async ({ payload, cryptoApi = root.crypto }) => {
    const json = JSON.stringify(canonicalize(payload));
    const encoded = base64Url(new TextEncoder().encode(json));
    const material = PREFIX + '.' + encoded;
    return material + '.' + await digest(cryptoApi, material);
  };

  const api = Object.freeze({ PREFIX, FORMAT_VERSION, canonicalize, buildPayload, createCode });
  root.HhrEloisaPatientCodeContract = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
