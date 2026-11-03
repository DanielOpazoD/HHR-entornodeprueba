// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  issueInstanceTicket,
  verifyInstanceTicket,
} from '../../../netlify/functions/lib/mmrad-dicom-policy';
import {
  openShareAccess,
  sealShareAccess,
  universitasInstanceRequest,
} from '../../../netlify/functions/lib/mmrad-universitas';
import { MMRAD_ALLOWED_ROLES } from '../../../netlify/functions/lib/mmrad-session';
import {
  SYNTHETIC_SERIES_UID,
  SYNTHETIC_STUDY_UID,
  syntheticSopUid,
} from '../fixtures/syntheticDicom';

const require = createRequire(import.meta.url);
const santiago = require('../../../functions/lib/mmrad/mmradInstanceAccess.js');
const {
  MMRAD_ALLOWED_ROLES: SANTIAGO_ROLES,
} = require('../../../functions/lib/mmrad/mmradDicomSantiagoFunction.js');

// Synthetic values with the shapes of MMRAD's Universitas viewer; no real session or secret.
const SECRET = 'synthetic-parity-secret';
const SESSION = '0123456789abcdef01234567';
const COOKIE = `cc_public_share_${SESSION}=synthetic-cookie-value`;
const SUBJECT = 'synthetic-user';
const base = {
  subject: SUBJECT,
  study: SYNTHETIC_STUDY_UID,
  series: SYNTHETIC_SERIES_UID,
  sop: syntheticSopUid(0),
  server: 'HHANGAROA',
};
const universitasTicket = (ttlMs = 9 * 60_000) =>
  issueInstanceTicket(
    {
      ...base,
      viewer: 'universitas',
      session: sealShareAccess({ session: SESSION, cookie: COOKIE }),
    },
    ttlMs
  );
const decode = (ticket: string) =>
  JSON.parse(Buffer.from(ticket.split('.')[0], 'base64url').toString()) as Record<string, unknown>;
const flipByte = (value: string, offset: number) => {
  const bytes = Buffer.from(value, 'base64url');
  bytes[offset] ^= 0x01;
  return bytes.toString('base64url');
};
const reencode = (ticket: string, patch: Record<string, unknown>) =>
  `${Buffer.from(JSON.stringify({ ...decode(ticket), ...patch })).toString('base64url')}.${
    ticket.split('.')[1]
  }`;

describe('MMRAD instance access shared by mmrad-dicom (Netlify) and the Santiago function', () => {
  beforeEach(() => vi.stubEnv('MMRAD_PASSWORD', SECRET));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('verifies and opens, in Santiago, what mmrad-dicom issued and sealed', () => {
    const ticket = universitasTicket();
    const issued = verifyInstanceTicket(ticket, SUBJECT);
    const verified = santiago.verifyUniversitasTicket(ticket, SUBJECT);
    expect(verified).toEqual(issued);
    expect(santiago.openShareAccess(verified.session)).toEqual(openShareAccess(issued.session!));
    expect(santiago.openShareAccess(verified.session)).toEqual({
      session: SESSION,
      cookie: COOKIE,
    });
    // The same single original, on the same host, with the same share cookie.
    expect(santiago.universitasInstanceRequest(verified)).toEqual(
      universitasInstanceRequest({ ...issued, session: issued.session! })
    );
  });

  it('refuses a tampered signature, payload or sealed session', () => {
    const ticket = universitasTicket();
    const [payload, signature] = ticket.split('.');
    const flipped = flipByte(signature, 0);
    for (const forged of [
      `${payload}.${flipped}`,
      reencode(ticket, { sop: syntheticSopUid(1) }),
      reencode(ticket, { expires: Date.now() + 60 * 60_000 }),
      `${payload}.`,
      payload,
      `${ticket}.extra`,
    ]) {
      expect(() => santiago.verifyUniversitasTicket(forged, SUBJECT)).toThrow(
        santiago.InstanceAccessError
      );
    }
    const sealed = String(decode(ticket).session);
    // IV, authentication tag and ciphertext each break the seal.
    for (const offset of [0, 12, 30]) {
      expect(() => santiago.openShareAccess(flipByte(sealed, offset))).toThrow(
        santiago.InstanceAccessError
      );
    }
    expect(() => santiago.openShareAccess('short')).toThrow(santiago.InstanceAccessError);
  });

  it('refuses the ticket of another user and of the legacy viewer', () => {
    const ticket = universitasTicket();
    expect(() => santiago.verifyUniversitasTicket(ticket, 'other-user')).toThrow(
      santiago.InstanceAccessError
    );
    expect(() => santiago.verifyUniversitasTicket(ticket, '')).toThrow(
      santiago.InstanceAccessError
    );
    // mmrad-dicom still serves the legacy viewer itself; that ticket never opens anything here.
    const session = String(decode(ticket).session);
    for (const legacy of [
      issueInstanceTicket(base),
      // Signed without the Universitas mark, even when it carries a sealed session.
      issueInstanceTicket({ ...base, session }),
    ]) {
      expect(verifyInstanceTicket(legacy, SUBJECT)).toMatchObject({ server: 'HHANGAROA' });
      expect(() => santiago.verifyUniversitasTicket(legacy, SUBJECT)).toThrow(
        santiago.InstanceAccessError
      );
    }
  });

  it('reads an authentic ticket whose time ran out as expired, like mmrad-dicom', () => {
    vi.useFakeTimers({ now: new Date('2026-11-03T12:00:00Z'), toFake: ['Date'] });
    const ticket = universitasTicket(60_000);
    vi.setSystemTime(new Date('2026-11-03T12:01:00Z'));
    expect(() => santiago.verifyUniversitasTicket(ticket, SUBJECT)).toThrow(
      santiago.InstanceTicketExpiredError
    );
    expect(() => verifyInstanceTicket(ticket, SUBJECT)).toThrow('venció');
    // Expiry is checked last: an expired ticket of another user is only invalid.
    expect(() => santiago.verifyUniversitasTicket(ticket, 'other-user')).toThrow(
      santiago.InstanceAccessError
    );
  });

  it('refuses everything when the secret differs or is missing', () => {
    const ticket = universitasTicket();
    const sealed = String(decode(ticket).session);
    vi.stubEnv('MMRAD_PASSWORD', `${SECRET}\n`);
    expect(() => santiago.verifyUniversitasTicket(ticket, SUBJECT)).toThrow(
      santiago.InstanceAccessError
    );
    expect(() => santiago.openShareAccess(sealed)).toThrow(santiago.InstanceAccessError);
    vi.stubEnv('MMRAD_PASSWORD', '');
    expect(() => santiago.verifyUniversitasTicket(ticket, SUBJECT)).toThrow(
      santiago.InstanceAccessError
    );
  });

  it('authorizes the same roles as mmrad-dicom', () => {
    expect([...SANTIAGO_ROLES].sort()).toEqual([...MMRAD_ALLOWED_ROLES].sort());
  });
});
