import React from 'react';
import type { Reminder, ReminderShift } from '@/types/reminders';

export interface ReminderCenterContextValue {
  reminders: Reminder[];
  unreadReminders: Reminder[];
  unreadCount: number;
  hasUrgentUnread: boolean;
  currentShift: ReminderShift;
  currentDate: string;
  isOpen: boolean;
  loading: boolean;
  isAvailable: boolean;
  openCenter: () => void;
  closeCenter: () => void;
  markReminderAsRead: (reminderId: string) => Promise<void>;
}

const noopAsync = async () => undefined;

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const unavailableReminderCenterValue: ReminderCenterContextValue = {
  reminders: [],
  unreadReminders: [],
  unreadCount: 0,
  hasUrgentUnread: false,
  currentShift: 'day',
  currentDate: formatLocalDate(new Date()),
  isOpen: false,
  loading: true,
  isAvailable: false,
  openCenter: () => undefined,
  closeCenter: () => undefined,
  markReminderAsRead: noopAsync,
};

export const ReminderCenterContext = React.createContext<ReminderCenterContextValue>(
  unavailableReminderCenterValue
);

export const useReminderCenter = (): ReminderCenterContextValue =>
  React.useContext(ReminderCenterContext);
