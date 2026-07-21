import { describe, expect, it } from 'vitest';
import {
  buildNurseCatalogIdentities,
  reconcileNurseCatalogNames,
  reconcileSelectedNurseName,
  resolveNurseIdentity,
} from '@/services/staff/nurseIdentity';

describe('nurseIdentity', () => {
  it('normalizes exact duplicates without deleting potentially distinct full identities', () => {
    expect(
      reconcileNurseCatalogNames([
        'Pedro Moreno',
        'Pedro Moreno Opazo',
        'CAMILA SOTO ALEGRIA',
        'camila soto alegria',
      ])
    ).toEqual(['Pedro Moreno', 'Pedro Moreno Opazo', 'Camila Soto Alegria']);
  });

  it('preserves distinct full identities when a short alias would be ambiguous', () => {
    expect(reconcileNurseCatalogNames(['Ana Pérez Soto', 'Ana Pérez Rojas'])).toEqual([
      'Ana Pérez Soto',
      'Ana Pérez Rojas',
    ]);
    expect(buildNurseCatalogIdentities(['Ana Pérez Soto', 'Ana Pérez Rojas'])).toHaveLength(2);
  });

  it('matches a full Eloísa name to the unique local given name and surname', () => {
    const catalog = buildNurseCatalogIdentities(['María Soto', 'María Pérez']);

    expect(
      resolveNurseIdentity('María José Soto Alegría', catalog, {
        firstGivenName: 'María',
        firstSurname: 'Soto',
      })
    ).toMatchObject({
      displayName: 'María Soto',
      catalogMatched: true,
    });
  });

  it('prefers an exact full-name match when catalog entries share name and surname', () => {
    const catalog = buildNurseCatalogIdentities(['Ana Pérez', 'Ana Pérez Soto', 'Ana Pérez Rojas']);

    expect(resolveNurseIdentity('Ana Pérez Rojas', catalog)).toMatchObject({
      displayName: 'Ana Pérez Rojas',
      catalogMatched: true,
    });
  });

  it('does not replace an exact full catalog identity with its short alias', () => {
    const catalog = buildNurseCatalogIdentities(['Ana Pérez', 'Ana Pérez Rojas']);

    expect(resolveNurseIdentity('Ana Pérez Rojas', catalog)?.displayName).toBe('Ana Pérez Rojas');
  });

  it('does not re-admit a blocked short alias through the fallback matcher', () => {
    const catalog = buildNurseCatalogIdentities(['Ana Pérez', 'Ana Pérez Soto']);

    expect(resolveNurseIdentity('Ana Pérez Rojas', catalog)).toMatchObject({
      displayName: 'Ana Pérez Rojas',
      catalogMatched: false,
    });
  });

  it('preserves selected aliases and unknown manual names without unsafe token guessing', () => {
    const catalog = ['Pedro Moreno'];

    expect(reconcileSelectedNurseName('Pedro Moreno Opazo', catalog)).toBe('Pedro Moreno Opazo');
    expect(reconcileSelectedNurseName('Nombre Manual Extendido', catalog)).toBe(
      'Nombre Manual Extendido'
    );
  });

  it('does not confuse a second given name with the catalog surname', () => {
    const catalog = buildNurseCatalogIdentities(['Juan Pablo']);

    expect(
      resolveNurseIdentity('Juan Pablo Pérez Soto', catalog, {
        firstGivenName: 'Juan',
        firstSurname: 'Pérez',
      })
    ).toMatchObject({
      displayName: 'Juan Pablo Pérez Soto',
      catalogMatched: false,
    });
  });

  it('does not choose a short identity when a compatible full catalog identity exists', () => {
    const catalog = buildNurseCatalogIdentities(['Pedro Moreno', 'Pedro Moreno Opazo']);

    expect(
      resolveNurseIdentity('Pedro Andrés Moreno Opazo', catalog, {
        firstGivenName: 'Pedro',
        firstSurname: 'Moreno',
      })
    ).toBeNull();
  });

  it('rejects an unparsed Eloísa date label instead of inventing a nurse', () => {
    const catalog = buildNurseCatalogIdentities(['Pedro Moreno']);
    expect(
      resolveNurseIdentity('20-07-2026 - 09:25:48 - Pedro Moreno - Enfermera(o)', catalog)
    ).toBeNull();
  });
});
