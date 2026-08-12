const isFullGitSha = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value.trim());

const isAbbreviatedGitSha = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{7,39}$/i.test(value.trim());

export const bindReleaseEvidenceToBuild = (
  source: string,
  buildGitSha: string,
  resolveEvidenceGitSha: (gitSha: string) => string = value => value
) => {
  const manifest = JSON.parse(source) as Record<string, unknown>;
  if (manifest.status !== 'current') {
    return source;
  }
  const manifestGitSha = typeof manifest.gitSha === 'string' ? manifest.gitSha.trim() : '';
  const evidenceGitSha = isFullGitSha(manifestGitSha)
    ? manifestGitSha
    : isAbbreviatedGitSha(manifestGitSha)
      ? resolveEvidenceGitSha(manifestGitSha).trim()
      : '';
  const normalizedBuildGitSha = buildGitSha.trim();
  if (
    isFullGitSha(evidenceGitSha) &&
    isFullGitSha(normalizedBuildGitSha) &&
    evidenceGitSha.toLowerCase() === normalizedBuildGitSha.toLowerCase()
  ) {
    return source;
  }

  const summary = manifest.summary as Record<string, unknown> | undefined;
  const decisionReports =
    summary && typeof summary.decisionReports === 'number' ? summary.decisionReports : 0;
  return JSON.stringify(
    {
      ...manifest,
      status: 'stale',
      summary: {
        decisionReports,
        currentReports: 0,
        staleReports: decisionReports,
      },
    },
    null,
    2
  );
};
