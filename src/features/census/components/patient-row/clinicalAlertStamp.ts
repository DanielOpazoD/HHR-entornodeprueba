/** `recordedAt` of a chart alert is already the Rapa Nui wall clock (`YYYY-MM-DDTHH:mm`). */
export const clinicalAlertStamp = (recordedAt: string) => {
  const [day = '', time = ''] = recordedAt.split('T');
  const [year = '', month = '', date = ''] = day.split('-');
  return { day, short: `${date}-${month}`, full: `${date}-${month}-${year} ${time}` };
};
