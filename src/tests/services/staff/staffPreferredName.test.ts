import { expect, it } from 'vitest';
import {
  reconcileNurseCatalogNames,
  reconcileSelectedNurseName,
} from '@/services/staff/nurseIdentity';
import { mergeStaffCatalog, type EloisaStaffIdentity } from '@/services/staff/eloisaStaffIdentity';
import { planSharedStaffCatalog } from '@/services/staff/sharedEloisaStaffCatalog';

it.each([
  ['Ana Pena', 'Ana Peña', 'Ana Peña'],
  ['Ana Peña', 'Ana Pena', 'Ana Peña'],
  ['Jose Nuñez', 'José Núñez', 'José Núñez'],
  ['Aina Vergues', 'Aïna Vergües', 'Aïna Vergües'],
  ['Begoña Muñoz', 'BEGONA MUNOZ', 'Begoña Muñoz'],
  ['Ana Peña', '  ANA   PEÑA ', 'Ana Peña'],
])('keeps the accented catalog spelling: %s / %s', (saved, incoming, preferred) => {
  const entries: EloisaStaffIdentity[] = [
    { key: 'nurse:synthetic', role: 'nurse', name: incoming, aliases: [incoming] },
  ];
  expect(mergeStaffCatalog([saved], entries, 'nurse')).toEqual([preferred]);
  expect(planSharedStaffCatalog([], entries, [saved], []).nurseNames).toEqual([preferred]);
  expect(reconcileNurseCatalogNames([saved, incoming])).toEqual([preferred]);
  expect(reconcileSelectedNurseName(saved, [incoming, preferred])).toBe(preferred);
});
it('keeps distinct full identities and leaves historical input unchanged', () => {
  const historical = ['Ana Pena Soto', 'Ana Peña Rojas'];
  expect(reconcileNurseCatalogNames(historical)).toEqual(historical);
  expect(historical).toEqual(['Ana Pena Soto', 'Ana Peña Rojas']);
});

it('groups historical shift spellings without changing stored selections', async () => {
  const { buildResolvedStaffSelectionOptions, resolveStaffSelectionValue } =
    await import('@/services/staff/staffSelectionPresentation');
  const selected = ['Ana Pena'];
  const options = buildResolvedStaffSelectionOptions(['Ana Peña'], selected);
  expect(options).toEqual(['Vacante', 'Ana Peña']);
  expect(resolveStaffSelectionValue(selected[0], [], 'tens', options)).toBe('Ana Peña');
  expect(selected).toEqual(['Ana Pena']);
});
