// One notice and connectivity poll serve both rejected edits and queued Functions work.
const reasons = new Set<string>();
const listeners = new Set<() => void>();
export const isModuleReloadRequired = (reason: string) => reasons.has(reason);
export const getModuleReloadReason = () =>
  [...reasons].some(reason => reason !== 'functions')
    ? 'save'
    : reasons.has('functions')
      ? 'functions'
      : null;
export const subscribeModuleRecovery = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const setModuleReloadRequired = (reason: string, value: boolean) => {
  if (reasons.has(reason) === value) return;
  if (value) reasons.add(reason);
  else reasons.delete(reason);
  listeners.forEach(listener => listener());
};
