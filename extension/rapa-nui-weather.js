/** Fixed public weather request. The service worker never sends page or session data. */
(() => {
  'use strict';
  const endpoint = 'https://api.open-meteo.com/v1/forecast?latitude=-27.15&longitude=-109.43' +
    '&current=temperature_2m,weather_code,wind_speed_10m,is_day&hourly=temperature_2m,precipitation_probability,wind_gusts_10m' +
    '&forecast_hours=73&timeformat=unixtime&timezone=Pacific%2FEaster';
  const valid = values => values.length && values.every(Number.isFinite);
  const round = Math.round;

  function project(payload) {
    const { current, hourly } = payload ?? {};
    const { time, temperature_2m: temperature, precipitation_probability: rain, wind_gusts_10m: gusts } = hourly ?? {};
    if (![time, temperature, rain, gusts].every(series => Array.isArray(series) && series.length === 73 && valid(series)) ||
        !time.every((value, i) => !i || value - time[i - 1] === 3600) ||
        ![current?.time, current?.temperature_2m, current?.weather_code, current?.wind_speed_10m].every(Number.isFinite)) return null;
    const first = time.findIndex(value => value >= current.time);
    if (first < 0 || first + 72 > time.length) return null;
    const bands = [first, first + 24, first + 48].map(start => ({
      min: round(Math.min(...temperature.slice(start, start + 24))),
      max: round(Math.max(...temperature.slice(start, start + 24))),
      rain: round(Math.max(...rain.slice(start, start + 24))),
      gust: round(Math.max(...gusts.slice(start, start + 24))),
    }));
    return { current: round(current.temperature_2m), code: current.weather_code,
      wind: round(current.wind_speed_10m), isDay: current.is_day !== 0, bands };
  }

  let recent;
  let inFlight;
  function fetchForecast(_message, sender) {
    if (sender?.frameId !== 0 || !/^https:\/\/fichamedico\.rayensalud\.cl\/dashboard(?:\/|$)/.test(sender.url ?? '')) {
      return { error: 'Pronóstico no disponible.' };
    }
    if (recent && Date.now() - recent.updatedAt < 15 * 60_000) return recent;
    inFlight ||= fetch(endpoint, {
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(7000),
    }).then(async response => {
      const forecast = response.ok && project(await response.json());
      if (!forecast) return { error: 'Pronóstico no disponible.' };
      recent = { ...forecast, updatedAt: Date.now() };
      return recent;
    }).catch(() => ({ error: 'Pronóstico no disponible.' })).finally(() => { inFlight = undefined; });
    return inFlight;
  }
  globalThis.HhrRapaNuiWeather = { project, fetchForecast };
})();
