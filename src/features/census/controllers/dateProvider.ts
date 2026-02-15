export type DateProvider = () => Date;

export const systemDateProvider: DateProvider = () => new Date();
