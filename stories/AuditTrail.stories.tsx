import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import type { AuditTrailCategory, AuditTrailGrouping } from '@/types/auditTrailTypes';
import { normalizeAuditTrailEvents } from '@/services/admin/auditTrail/auditTrailNormalize';
import { buildAuditTrailSessions } from '@/services/admin/auditTrail/auditTrailSessions';
import { buildAuditTrailGroups } from '@/services/admin/auditTrail/auditTrailGroups';
import {
  buildAuditTrailActorOptions,
  filterAuditTrailEvents,
  summarizeAuditTrail,
} from '@/services/admin/auditTrail/auditTrailFilters';
import {
  DEFAULT_AUDIT_TRAIL_VIEW,
  type AuditTrailViewPreferences,
} from '@/services/admin/auditTrail/auditTrailPreferences';
import { buildAuditTrailPeriod } from '@/services/admin/auditTrail/auditTrailPeriod';
import { AUDIT_TRAIL_CATEGORY_ORDER } from '@/services/admin/auditTrail/auditTrailCatalog';
import type { AuditTrailScope } from '@/features/admin/hooks/useAuditTrail';
import { AuditTrailHeader } from '@/features/admin/components/internal/audit/AuditTrailHeader';
import { AuditTrailSummaryBar } from '@/features/admin/components/internal/audit/AuditTrailSummaryBar';
import { AuditTrailToolbar } from '@/features/admin/components/internal/audit/AuditTrailToolbar';
import { AuditTrailGroupList } from '@/features/admin/components/internal/audit/AuditTrailGroupList';
import { AuditTrailSessionTimeline } from '@/features/admin/components/internal/audit/AuditTrailSessionTimeline';
import { AUDIT_TRAIL_STORY_LOGS } from './auditTrailStoryData';

const events = normalizeAuditTrailEvents(AUDIT_TRAIL_STORY_LOGS);
const sessions = buildAuditTrailSessions(events);

/** The audit screen without data fetching, on a synthetic day. */
const AuditTrailPreview: React.FC<{
  grouping: AuditTrailGrouping;
  categories: AuditTrailCategory[];
  expandGroups: boolean;
}> = ({ grouping, categories, expandGroups }) => {
  const [period, setPeriod] = React.useState(buildAuditTrailPeriod('day', '2026-10-22'));
  const [scope, setScope] = React.useState<AuditTrailScope>({ search: '', reviewOnly: false });
  const [preferences, setPreferences] = React.useState<AuditTrailViewPreferences>({
    ...DEFAULT_AUDIT_TRAIL_VIEW,
    grouping,
    categories,
    expandGroups,
  });
  React.useEffect(
    () => setPreferences(current => ({ ...current, grouping, categories, expandGroups })),
    [grouping, categories, expandGroups]
  );

  const scoped = filterAuditTrailEvents(events, {
    categories: AUDIT_TRAIL_CATEGORY_ORDER,
    areas: scope.area ? [scope.area] : [],
    reviewOnly: scope.reviewOnly,
    actorKey: scope.actorKey,
    search: scope.search,
  });
  const visible = scoped.filter(event => preferences.categories.includes(event.category));
  const scopedSessions = sessions.filter(
    session => !scope.actorKey || session.actor.key === scope.actorKey
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-3 bg-slate-50 px-4 py-4 font-sans">
      <AuditTrailHeader
        period={period}
        onPeriodChange={setPeriod}
        loading={false}
        onRefresh={() => undefined}
        onExport={() => undefined}
        exporting={false}
        onToggleExportKeys={() => undefined}
        exportKeysOpen={false}
      />
      <AuditTrailSummaryBar
        summary={summarizeAuditTrail(scoped, scopedSessions)}
        categories={preferences.categories}
        onToggleCategory={category =>
          setPreferences(current => ({
            ...current,
            categories: current.categories.includes(category)
              ? current.categories.filter(item => item !== category)
              : [...current.categories, category],
          }))
        }
        reviewOnly={scope.reviewOnly}
        onToggleReview={() =>
          setScope(current => ({ ...current, reviewOnly: !current.reviewOnly }))
        }
      />
      <AuditTrailToolbar
        scope={scope}
        onScopeChange={patch => setScope(current => ({ ...current, ...patch }))}
        actorOptions={buildAuditTrailActorOptions(events)}
        preferences={preferences}
        onPreferencesChange={patch => setPreferences(current => ({ ...current, ...patch }))}
      />
      {preferences.grouping === 'session' && (
        <AuditTrailSessionTimeline sessions={scopedSessions} day={period.endDate} />
      )}
      <AuditTrailGroupList
        groups={buildAuditTrailGroups(visible, preferences.grouping, scopedSessions)}
        preferences={preferences}
        multiDay={false}
        onSelectActor={actorKey => setScope(current => ({ ...current, actorKey }))}
        onSelectPatient={search => setScope(current => ({ ...current, search }))}
      />
    </div>
  );
};

const meta: Meta<typeof AuditTrailPreview> = {
  title: 'Audit/AuditTrail',
  component: AuditTrailPreview,
  parameters: { layout: 'fullscreen' },
  args: {
    grouping: 'patient',
    categories: ['change', 'access'],
    expandGroups: true,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const ByPatient: Story = {};

export const ByStaffMember: Story = {
  args: { grouping: 'actor' },
};

export const Connections: Story = {
  args: { grouping: 'session', categories: ['change', 'access', 'connection'] },
};

export const Chronological: Story = {
  args: { grouping: 'time', categories: ['change', 'access', 'connection', 'system'] },
};
