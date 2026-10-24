const hospitalDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Easter',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const hospitalCalendarDay = (instant = new Date()) => {
  const parts = hospitalDayFormatter
    .formatToParts(instant)
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

module.exports = { hospitalCalendarDay };
