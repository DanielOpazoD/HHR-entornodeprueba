export const resolveDailyRecordAuthorityReleaseMode = env => {
  const explicitMode = String(env.VITE_DAILY_RECORD_AUTHORITY_MODE || '').trim();
  if (explicitMode === 'enforced' || explicitMode === 'shadow' || explicitMode === 'client_only') {
    return explicitMode;
  }

  return env.VITE_DAILY_RECORD_AUTHORITY_CALLABLE === 'true' ? 'enforced' : 'client_only';
};

export const evaluateDailyRecordAuthorityReleaseGate = env => {
  const mode = resolveDailyRecordAuthorityReleaseMode(env);
  if (mode === 'enforced') {
    return {
      ok: true,
      mode,
      message: 'Daily record authority callable is enforced for release writes.',
    };
  }

  return {
    ok: false,
    mode,
    message:
      'Daily record release writes require VITE_DAILY_RECORD_AUTHORITY_MODE=enforced ' +
      'or VITE_DAILY_RECORD_AUTHORITY_CALLABLE=true. client_only/shadow modes are degraded.',
  };
};
