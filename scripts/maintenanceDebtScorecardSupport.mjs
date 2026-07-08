const resolveWatchlistLimit = ({ file, hookLimits, moduleLimits, rulesLimits }) => {
  if (typeof rulesLimits[file] === 'number') {
    return { limit: rulesLimits[file], limitSource: 'rules-governance' };
  }

  if (typeof hookLimits[file] === 'number') {
    return { limit: hookLimits[file], limitSource: 'hook-hotspot' };
  }

  if (typeof moduleLimits[file] === 'number') {
    return { limit: moduleLimits[file], limitSource: 'module-allowlist' };
  }

  return { limit: null, limitSource: null };
};

export const buildMaintenanceDebtWatchlistRows = ({
  watchlistFiles,
  countLines,
  hookLimits,
  moduleLimits,
  rulesLimits = {},
}) =>
  watchlistFiles
    .map(file => {
      const lines = countLines(file);
      const { limit, limitSource } = resolveWatchlistLimit({
        file,
        hookLimits,
        moduleLimits,
        rulesLimits,
      });

      return {
        file,
        lines,
        limit,
        limitSource,
        remainingLines: typeof limit === 'number' ? limit - lines : null,
      };
    })
    .sort((a, b) => b.lines - a.lines);

export const buildLegacyRetirementDebtRows = legacyRetirementDebt => {
  const rows = Array.isArray(legacyRetirementDebt?.surfaces)
    ? legacyRetirementDebt.surfaces.map(surface => ({
        id: surface.id,
        label: surface.label,
        owner: surface.owner,
        phase: surface.phase,
        status: surface.status,
        signal: surface.signal,
        nextAction: surface.nextAction,
      }))
    : [];

  return {
    status: legacyRetirementDebt?.status ?? 'missing',
    openSurfaceCount: legacyRetirementDebt?.openSurfaceCount ?? null,
    maxOpenSurfaces: legacyRetirementDebt?.maxOpenSurfaces ?? null,
    rows,
  };
};
