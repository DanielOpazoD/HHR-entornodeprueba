const isCompatibleGitSha = (left: unknown, right: unknown) => {
  const normalizedLeft = typeof left === 'string' ? left.trim().toLowerCase() : '';
  const normalizedRight = typeof right === 'string' ? right.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{7,40}$/.test(normalizedLeft) || !/^[0-9a-f]{7,40}$/.test(normalizedRight)) {
    return false;
  }
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(normalizedRight) ||
    normalizedRight.startsWith(normalizedLeft)
  );
};

export const bindReleaseEvidenceToBuild = (source: string, buildGitSha: string) => {
  const manifest = JSON.parse(source) as Record<string, unknown>;
  if (manifest.status !== 'current' || isCompatibleGitSha(manifest.gitSha, buildGitSha)) {
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
