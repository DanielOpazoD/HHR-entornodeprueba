type DateProvider = () => Date;

export const formatClockTimeHHMM = (date: Date): string => date.toTimeString().slice(0, 5);

export const getCurrentClockTimeHHMM = (dateProvider: DateProvider = () => new Date()): string =>
  formatClockTimeHHMM(dateProvider());
