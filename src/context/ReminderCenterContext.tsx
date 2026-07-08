import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { createReminderUseCases } from '@/application/reminders/reminderUseCases';
import {
  ReminderCenterContext,
  type ReminderCenterContextValue,
  useReminderCenter as useReminderCenterContract,
} from './reminderCenterContextContract';
import {
  filterVisibleReminders,
  getReminderUnreadCount,
  hasUrgentVisibleReminders,
  sortRemindersByPriority,
} from '@/shared/reminders/reminderVisibility';
import { getCurrentShift } from '@/services/admin/attributionService';
import type { Reminder } from '@/types/reminders';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildUserName = (displayName?: string | null, email?: string | null): string =>
  displayName?.trim() || email?.trim() || 'Usuario del sistema';

const reminderUseCases = createReminderUseCases();

export const ReminderCenterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, role, isAuthenticated, remoteSyncStatus } = useAuth();
  const [reminders, setReminders] = React.useState<Reminder[]>([]);
  const [readReminderIds, setReadReminderIds] = React.useState<string[]>([]);
  const [isOpen, setIsOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [isAvailable, setIsAvailable] = React.useState(true);
  const [now, setNow] = React.useState(() => new Date());
  const readReminderIdsRef = React.useRef<string[]>([]);

  React.useEffect(() => {
    readReminderIdsRef.current = readReminderIds;
  }, [readReminderIds]);

  React.useEffect(() => {
    const timeoutId = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timeoutId);
  }, []);

  const currentDate = React.useMemo(() => formatLocalDate(now), [now]);
  const currentShift = React.useMemo(() => getCurrentShift(now), [now]);
  const visibleReminders = React.useMemo(
    () =>
      sortRemindersByPriority(
        reminders.filter(
          reminder =>
            filterVisibleReminders([reminder], {
              role,
              shift: currentShift,
              currentDate,
            }).length > 0
        )
      ),
    [currentDate, currentShift, reminders, role]
  );
  const unreadReminders = React.useMemo(
    () =>
      filterVisibleReminders(visibleReminders, {
        role,
        shift: currentShift,
        currentDate,
        readReminderIds,
      }),
    [currentDate, currentShift, readReminderIds, role, visibleReminders]
  );

  React.useEffect(() => {
    if (!isAuthenticated) {
      setReadReminderIds([]);
      setReminders([]);
      setLoading(false);
      setIsAvailable(true);
      return;
    }

    if (remoteSyncStatus !== 'ready') {
      setReadReminderIds([]);
      setReminders([]);
      setLoading(false);
      setIsAvailable(false);
      setIsOpen(false);
      return;
    }

    setLoading(true);
    setIsAvailable(true);
    const unsubscribe = reminderUseCases.subscribeToReminderFeed({
      onOutcome: outcome => {
        const nextReminders = outcome.data;
        setReminders(nextReminders);
        setLoading(false);
        if (outcome.status === 'success') {
          setIsAvailable(true);
          recordOperationalTelemetry(
            {
              category: 'reminders',
              operation: 'center_subscription_ready',
              status: 'success',
              context: {
                count: nextReminders.length,
              },
            },
            { allowSuccess: true }
          );
          return;
        }

        if (outcome.status === 'degraded' || outcome.status === 'failed') {
          setLoading(false);
          setIsAvailable(false);
          setIsOpen(false);
          recordOperationalTelemetry({
            category: 'reminders',
            operation: 'center_subscription_ready',
            status: 'degraded',
            issues: outcome.issues.map(issue => issue.userSafeMessage || issue.message) || [
              'El centro de avisos quedo temporalmente no disponible.',
            ],
          });
        }
      },
    });

    return unsubscribe;
  }, [isAuthenticated, remoteSyncStatus]);

  React.useEffect(() => {
    if (!isAvailable || !currentUser?.uid || visibleReminders.length === 0) {
      setReadReminderIds([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      const result = await reminderUseCases.resolveReminderReadStates({
        reminders: visibleReminders,
        userId: currentUser.uid,
        shift: currentShift,
        dateKey: currentDate,
      });

      if (cancelled) return;
      setReadReminderIds(result.data);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentDate, currentShift, currentUser?.uid, isAvailable, visibleReminders]);

  const markReminderAsRead = React.useCallback(
    async (reminderId: string) => {
      if (!currentUser?.uid) return;
      if (readReminderIdsRef.current.includes(reminderId)) return;

      const result = await reminderUseCases.markReminderAsRead({
        reminderId,
        receipt: reminderUseCases.buildReadReceipt({
          userId: currentUser.uid,
          userName: buildUserName(currentUser.displayName, currentUser.email),
          shift: currentShift,
          dateKey: currentDate,
        }),
      });

      if (result.status === 'failed') {
        return;
      }

      setReadReminderIds(previous =>
        previous.includes(reminderId) ? previous : [...previous, reminderId]
      );
    },
    [currentDate, currentShift, currentUser]
  );

  const value = React.useMemo<ReminderCenterContextValue>(
    () => ({
      reminders: visibleReminders,
      unreadReminders,
      unreadCount: getReminderUnreadCount(visibleReminders, {
        role,
        shift: currentShift,
        currentDate,
        readReminderIds,
      }),
      hasUrgentUnread: hasUrgentVisibleReminders(visibleReminders, {
        role,
        shift: currentShift,
        currentDate,
        readReminderIds,
      }),
      currentShift,
      currentDate,
      isOpen,
      loading,
      isAvailable,
      openCenter: () => setIsOpen(true),
      closeCenter: () => setIsOpen(false),
      markReminderAsRead,
    }),
    [
      currentDate,
      isAvailable,
      currentShift,
      isOpen,
      loading,
      markReminderAsRead,
      readReminderIds,
      role,
      unreadReminders,
      visibleReminders,
    ]
  );

  return <ReminderCenterContext.Provider value={value}>{children}</ReminderCenterContext.Provider>;
};

export const useReminderCenter = useReminderCenterContract;
