// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildCreatedRecipientList,
  resolveCreateRecipientListError,
  resolveDeleteRecipientListError,
  resolveRecipientListFallback,
  resolveRenamedRecipientListName,
} from '@/hooks/controllers/censusEmailRecipientListController';

describe('censusEmailRecipientListController', () => {
  it('validates create permissions and name', () => {
    expect(resolveCreateRecipientListError(false, 'Nueva')).toContain('permisos');
    expect(resolveCreateRecipientListError(true, '   ')).toContain('nombre');
    expect(resolveCreateRecipientListError(true, 'Nueva')).toBeNull();
  });

  it('builds a created recipient list with actor metadata', () => {
    const created = buildCreatedRecipientList('Lista Nueva', ['uno@test.com'], ['census-default'], {
      uid: 'u1',
      email: 'admin@test.com',
    });

    expect(created.id).toBe('lista-nueva');
    expect(created.updatedByEmail).toBe('admin@test.com');
    expect(created.recipients).toEqual(['uno@test.com']);
  });

  it('resolves default list rename and deletion fallback', () => {
    expect(resolveRenamedRecipientListName('census-default', 'Otro nombre')).toBe(
      'Censo diario (predeterminado)'
    );

    const fallback = resolveRecipientListFallback(
      [{ id: 'census-default' }, { id: 'secundaria' }] as never,
      'census-default'
    );

    expect(fallback?.id).toBe('secundaria');
    expect(
      resolveDeleteRecipientListError(true, [{ id: 'census-default' }] as never, 'census-default')
    ).toContain('al menos una');
  });
});
