import type { ProfessionalCatalogItem } from '@/types/domain/professionals';

export interface DiscoveredTreatingPhysician {
  practitionerId: string;
  displayName: string;
}

const normalizedName = (value?: string): string =>
  (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('es-CL');

const byDisplayName = (left: ProfessionalCatalogItem, right: ProfessionalCatalogItem): number =>
  left.name.localeCompare(right.name, 'es-CL', { sensitivity: 'base' });

export interface TreatingPhysicianCatalogMerge {
  catalog: ProfessionalCatalogItem[];
  changed: boolean;
}

/**
 * Adds physicians discovered in Rayen without overwriting locally curated specialties.
 * Display-name equality never proves identity: manual entries remain separate from Rayen ids.
 */
export const mergeDiscoveredTreatingPhysicians = (
  current: ProfessionalCatalogItem[],
  discovered: DiscoveredTreatingPhysician[]
): TreatingPhysicianCatalogMerge => {
  const next = current.map(item => ({ ...item }));
  const byId = new Map(
    next
      .filter(item => item.rayenPractitionerId)
      .map(item => [item.rayenPractitionerId as string, item])
  );
  const byName = new Map<string, ProfessionalCatalogItem[]>();
  for (const item of next) {
    const key = normalizedName(item.name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), item]);
  }

  let changed = false;
  for (const physician of discovered) {
    const practitionerId = String(physician.practitionerId ?? '').trim();
    const displayName = String(physician.displayName ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!practitionerId || !displayName) continue;

    const exact = byId.get(practitionerId);
    if (exact) {
      if (exact.name !== displayName || exact.source !== 'rayen') {
        exact.name = displayName;
        exact.source = 'rayen';
        changed = true;
      }
      continue;
    }

    const legacyMatches = byName.get(normalizedName(displayName)) ?? [];

    const item: ProfessionalCatalogItem = {
      name: displayName,
      phone: '',
      rayenPractitionerId: practitionerId,
      source: 'rayen',
    };
    next.push(item);
    byId.set(practitionerId, item);
    byName.set(normalizedName(displayName), [...legacyMatches, item]);
    changed = true;
  }

  return { catalog: changed ? next.toSorted(byDisplayName) : current, changed };
};

const uniqueCatalogByName = (
  catalog: ProfessionalCatalogItem[]
): ReadonlyMap<string, ProfessionalCatalogItem> => {
  const grouped = new Map<string, ProfessionalCatalogItem[]>();
  for (const item of catalog) {
    const key = normalizedName(item.name);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return new Map(
    [...grouped.entries()]
      .filter(([, items]) => items.length === 1)
      .map(([key, items]) => [key, items[0]])
  );
};

export const findProfessionalByRayenIdentity = (
  catalog: ProfessionalCatalogItem[],
  practitionerId?: string,
  displayName?: string
): ProfessionalCatalogItem | undefined => {
  const byId = new Map(
    catalog
      .filter(item => item.rayenPractitionerId)
      .map(item => [item.rayenPractitionerId as string, item])
  );
  const id = practitionerId?.trim();
  // A stable Rayen id is authoritative. Falling back by name when that id is unknown could attach
  // a different homonymous physician (and their specialty) to the patient.
  if (id) return byId.get(id);
  return uniqueCatalogByName(catalog).get(normalizedName(displayName));
};

export const professionalCatalogKey = (item: ProfessionalCatalogItem): string =>
  item.rayenPractitionerId
    ? `rayen:${item.rayenPractitionerId}`
    : `manual:${encodeURIComponent(normalizedName(item.name))}:${encodeURIComponent(
        item.phone.trim()
      )}`;

export const findProfessionalByCatalogKey = (
  catalog: ProfessionalCatalogItem[],
  key: string
): ProfessionalCatalogItem | undefined =>
  catalog.find(item => professionalCatalogKey(item) === key);

/** Returns a new catalog with the selected physician mapped to the configured specialty. */
export const assignProfessionalSpecialty = (
  catalog: ProfessionalCatalogItem[],
  catalogKey: string,
  specialty?: string
): ProfessionalCatalogItem[] => {
  const normalizedSpecialty = specialty?.trim() || undefined;
  return catalog.map(item =>
    professionalCatalogKey(item) === catalogKey ? { ...item, specialty: normalizedSpecialty } : item
  );
};

/** Converts legacy catalog terminology to the canonical specialty shown in the HHR census. */
export const professionalSpecialtyToPatientSpecialty = (specialty?: string): string => {
  const value = specialty?.trim() ?? '';
  return value === 'Medicina Interna' ? 'Med Interna' : value;
};
