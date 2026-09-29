import { expect, Page } from '@playwright/test';

interface WaitForPersistedBedFieldsInput {
  page: Page;
  date: string;
  bedId: string;
  expected: Record<string, string | boolean | number | null>;
}

const isNavigationContextReset = (error: unknown) => {
  const message = String((error as Error)?.message || error);
  return (
    message.includes('Execution context was destroyed') ||
    message.includes('Cannot find context with specified id')
  );
};

const isStorageAccessDenied = (error: unknown) => {
  const message = String((error as Error)?.message || error);
  return (
    message.includes('SecurityError') ||
    (message.includes('localStorage') && message.includes('Access is denied'))
  );
};

export const waitForPersistedBedFields = async ({
  page,
  date,
  bedId,
  expected,
}: WaitForPersistedBedFieldsInput) => {
  const expectedKeys = Object.keys(expected);
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(
            ({ evalDate, evalBedId, evalExpectedKeys }) => {
              const records = JSON.parse(
                window.localStorage.getItem('hanga_roa_hospital_data') || '{}'
              ) as Record<string, { beds?: Record<string, Record<string, unknown>> }>;
              const bed = records?.[evalDate]?.beds?.[evalBedId] || {};
              return Object.fromEntries(
                evalExpectedKeys.map(key => [
                  key,
                  (bed[key] as string | boolean | number | null) ?? null,
                ])
              );
            },
            {
              evalDate: date,
              evalBedId: bedId,
              evalExpectedKeys: expectedKeys,
            }
          );
        } catch (error) {
          if (!isNavigationContextReset(error) && !isStorageAccessDenied(error)) {
            throw error;
          }

          return Object.fromEntries(expectedKeys.map(key => [key, null]));
        }
      },
      {
        timeout: 20_000,
      }
    )
    .toMatchObject(expected);
};
