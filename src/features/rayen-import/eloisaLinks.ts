/** Eloísa's own pages, opened from the mark in the census toolbar. */

export type EloisaLinkKey = 'hospitalized' | 'beds' | 'outpatient' | 'emergency';

export interface EloisaLink {
  key: EloisaLinkKey;
  label: string;
  /** Written along the ring, where a long name does not fit. */
  ringLabel?: string;
  href: string;
}

export const ELOISA_LINKS: readonly EloisaLink[] = [
  {
    key: 'hospitalized',
    label: 'Hospitalizados',
    href: 'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse',
  },
  {
    key: 'beds',
    label: 'Gestión de camas',
    ringLabel: 'Camas',
    href: 'https://hospitalizado.rayensalud.cl/',
  },
  { key: 'outpatient', label: 'Ambulatoria', href: 'https://clinicohangaroa.eloisa.cl/' },
  { key: 'emergency', label: 'Urgencias', href: 'https://urgencia.saludenred.cl/' },
];
