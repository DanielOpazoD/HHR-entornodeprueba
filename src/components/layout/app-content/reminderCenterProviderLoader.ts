import React from 'react';

export type ReminderCenterProviderComponent = React.FC<{ children: React.ReactNode }>;

export const loadReminderCenterProvider = async (): Promise<ReminderCenterProviderComponent> => {
  const module = await import('@/context/ReminderCenterContext');
  return module.ReminderCenterProvider;
};
