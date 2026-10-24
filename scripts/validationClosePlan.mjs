const parseInvocation = command => {
  const match = /^npm run ([\w:-]+)(?: -- ([\w:./= -]+))?$/.exec(command.trim());
  return match ? { script: match[1], args: match[2]?.trim().split(/\s+/) || [] } : null;
};

export const buildValidationClosePlan = ({ scripts, confidence }) => {
  const expand = (invocation, parents = []) => {
    const { script, args } = invocation;
    const command = scripts[script];
    if (typeof command !== 'string' || !command.trim()) {
      throw new Error(`Missing npm script: ${script}`);
    }
    if (parents.includes(script)) throw new Error(`Cyclic npm script: ${script}`);
    // npm lifecycle hooks and argument forwarding belong to the original command.
    if (args.length || scripts[`pre${script}`] || scripts[`post${script}`]) return [invocation];
    const children = command.split(/\s*&&\s*/).map(parseInvocation);
    if (children.some(child => child === null)) return [invocation];
    return children.flatMap(child => expand(child, [...parents, script]));
  };

  const profile = confidence.profiles?.blocking;
  if (!Array.isArray(profile) || profile.length === 0) {
    throw new Error('Missing blocking release-confidence profile');
  }
  const steps = new Map();
  for (const step of confidence.steps || []) {
    if (!step.id || steps.has(step.id)) throw new Error('Invalid or duplicate confidence step');
    steps.set(step.id, step);
  }
  if (new Set(profile).size !== profile.length)
    throw new Error('Duplicate confidence profile step');
  const confidenceInvocations = profile.map(id => {
    const invocation = parseInvocation(steps.get(id)?.command || '');
    if (!invocation) throw new Error(`Invalid release-confidence step: ${id}`);
    return invocation;
  });

  const roots = [{ script: 'ci:merge-gate', args: [] }];
  if (scripts['pretest:release-confidence'] || scripts['posttest:release-confidence']) {
    roots.push({ script: 'test:release-confidence', args: [] });
  } else {
    if (
      scripts['test:release-confidence'] !==
      'node scripts/run-release-confidence-pack.mjs --profile blocking'
    ) {
      throw new Error('Release-confidence entrypoint changed; review the combined closure plan');
    }
    roots.push(...confidenceInvocations);
  }
  const seen = new Set();
  return roots
    .flatMap(root => expand(root))
    .filter(invocation => {
      const key = JSON.stringify(invocation);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};
