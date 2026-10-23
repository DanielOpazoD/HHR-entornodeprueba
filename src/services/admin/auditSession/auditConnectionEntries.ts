import type { AuditLogEntry } from '@/types/auditLogTypes';
import {
  buildAuditConnectionEventId,
  type AuditConnectionEvent,
} from '@/services/admin/auditSession/auditConnectionTracker';

export const AUDIT_SCHEMA_VERSION = 2;

export interface AuditConnectionEntryEnvironment {
  ipAddress?: string;
  device?: string;
}

const iso = (epochMs: number): string => new Date(epochMs).toISOString();
const seconds = (milliseconds: number): number => Math.max(0, Math.round(milliseconds / 1000));

/**
 * Stored form of a connection event. Dated when it happened (a retroactive "Desconexión" carries
 * the last heartbeat), so period queries over `timestamp` place it correctly.
 */
export const buildAuditConnectionEntry = (
  event: AuditConnectionEvent,
  environment: AuditConnectionEntryEnvironment = {}
): AuditLogEntry => {
  const { record } = event;
  const base = {
    id: buildAuditConnectionEventId(event),
    schemaVersion: AUDIT_SCHEMA_VERSION,
    userId: record.email,
    userDisplayName: record.name,
    userUid: record.uid,
    ipAddress: record.ipAddress ?? environment.ipAddress,
    device: record.device ?? environment.device,
    entityType: 'user' as const,
    entityId: record.email,
    sessionId: record.id,
  };

  switch (event.kind) {
    case 'start':
      return {
        ...base,
        timestamp: iso(record.startedAt),
        action: 'USER_LOGIN',
        details: { sessionId: record.id, start: event.start },
      };
    case 'end':
      return {
        ...base,
        timestamp: iso(event.endedAt),
        action: 'USER_LOGOUT',
        details: {
          sessionId: record.id,
          reason: event.reason,
          startedAt: iso(record.startedAt),
          endedAt: iso(event.endedAt),
          durationSeconds: seconds(event.endedAt - record.startedAt),
        },
      };
    case 'interruption':
      return {
        ...base,
        timestamp: iso(event.to),
        action: 'CONNECTION_INTERRUPTED',
        details: {
          sessionId: record.id,
          offlineFrom: iso(event.from),
          offlineTo: iso(event.to),
          durationSeconds: seconds(event.to - event.from),
        },
      };
  }
};
