import { describe, expect, it } from 'vitest';
import {
  buildAuthorizedSharedAccessUser,
  resolveSharedCensusPathInfo,
} from '@/features/census/controllers/sharedCensusModeController';

describe('sharedCensusModeController', () => {
  describe('resolveSharedCensusPathInfo', () => {
    it('returns non-shared mode for unrelated paths', () => {
      expect(resolveSharedCensusPathInfo('/dashboard')).toEqual({
        isSharedCensusMode: false,
        invitationId: null,
      });
    });

    it('detects shared mode without invitation id on base paths', () => {
      expect(resolveSharedCensusPathInfo('/censo-compartido')).toEqual({
        isSharedCensusMode: true,
        invitationId: null,
      });
      expect(resolveSharedCensusPathInfo('/censo-publico/')).toEqual({
        isSharedCensusMode: true,
        invitationId: null,
      });
    });

    it('extracts invitation id when present', () => {
      expect(resolveSharedCensusPathInfo('/censo-compartido/abc123')).toEqual({
        isSharedCensusMode: true,
        invitationId: 'abc123',
      });
      expect(resolveSharedCensusPathInfo('/censo-publico/xyz987/details')).toEqual({
        isSharedCensusMode: true,
        invitationId: 'xyz987',
      });
    });
  });

  describe('buildAuthorizedSharedAccessUser', () => {
    it('builds normalized user with 60-day expiration', () => {
      const now = new Date('2026-02-15T10:00:00.000Z');
      const user = buildAuthorizedSharedAccessUser({
        uid: 'uid-1',
        email: 'Test@Hospital.CL',
        displayName: 'Test User',
        now,
      });

      expect(user).toMatchObject({
        id: 'uid-1',
        email: 'test@hospital.cl',
        displayName: 'Test User',
        role: 'viewer',
        createdAt: now,
        createdBy: 'local-auth',
        isActive: true,
      });
      expect((user.expiresAt as Date).toISOString()).toBe('2026-04-16T10:00:00.000Z');
    });
  });
});
