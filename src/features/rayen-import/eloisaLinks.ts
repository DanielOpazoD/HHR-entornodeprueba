/**
 * Eloísa's own pages, opened from the mark in the census toolbar. A destination without a known
 * address stays in the ring, greyed out, until the hospital confirms which page it is.
 */

export type EloisaLinkKey = 'hospitalized' | 'beds' | 'outpatient' | 'emergency';

export interface EloisaLink {
  key: EloisaLinkKey;
  label: string;
  /** Written along the ring, where a long name does not fit. */
  ringLabel?: string;
  href: string | null;
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
  { key: 'outpatient', label: 'Ambulatoria', href: null },
  { key: 'emergency', label: 'Urgencias', href: null },
];
