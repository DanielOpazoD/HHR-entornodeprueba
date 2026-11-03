// TEMPORARY timing probe for the RIS from this function's region; removed before any merge.
import { fetchWithHeaders, loginToMMRAD, MMRAD_BASE_URL } from './lib/mmrad-session';

export const handler = async () => {
  const t0 = performance.now();
  const { cookies, searchActionUrl } = await loginToMMRAD();
  const login = performance.now() - t0;
  const searches: number[] = [];
  for (let i = 0; i < 6; i++) {
    const s0 = performance.now();
    const response = await fetchWithHeaders(searchActionUrl ?? '', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookies,
        Referer: `${MMRAD_BASE_URL}/group/hhangaroa`,
      },
      body: new URLSearchParams({ idpaciente: `1111111${i}-${i}` }).toString(),
    });
    await response.text();
    searches.push(Math.round(performance.now() - s0));
  }
  const r0 = performance.now();
  await fetch('https://us-central1-hhr-pruebas.cloudfunctions.net/checkUserRole', {
    method: 'POST',
    headers: { Authorization: 'Bearer invalid', 'Content-Type': 'application/json' },
    body: '{"data":{}}',
  });
  const role = performance.now() - r0;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      region: process.env.AWS_REGION,
      loginMs: Math.round(login),
      searchMs: searches,
      roleCallableMs: Math.round(role),
    }),
  };
};
