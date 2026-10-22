import { isMap, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import {
  PREVIEW_BOOTSTRAP_ARTIFACT,
  PREVIEW_BOOTSTRAP_PRODUCER_JOB,
} from './previewBootstrapEvidenceSupport.mjs';

export const RELEASE_EVIDENCE_RUNTIME_ARTIFACT = 'release-evidence-runtime';
export const RELEASE_EVIDENCE_RUNTIME_PRODUCER_JOB = 'quality-static-governance-snapshots';
export const RELEASE_EVIDENCE_RUNTIME_PATH = 'reports/release-evidence-runtime';
export const CRITICAL_COVERAGE_ARTIFACT = 'critical-coverage';
export const CRITICAL_COVERAGE_PRODUCER_JOB = 'critical-coverage-report';

const textOf = value => (typeof value === 'string' ? value : '');

/**
 * Parses the workflow with the YAML parser, so quoting, flow or block lists, key order and
 * folded commands cannot hide or invent a contract issue. Jobs and steps keep `body` /
 * `block`, their original text, for callers that still inspect or mutate it.
 */
export const parseWorkflowJobs = workflowText => {
  const lineCounter = new LineCounter();
  const document = parseDocument(workflowText, { lineCounter });
  const jobsNode = document.get('jobs', true);
  const jobs = new Map();
  if (!isMap(jobsNode)) {
    return jobs;
  }

  const lineAt = offset => lineCounter.linePos(offset).line;
  for (const pair of jobsNode.items) {
    const name = String(isScalar(pair.key) ? pair.key.value : pair.key);
    const start = pair.key?.range?.[0] ?? 0;
    const end = pair.value?.range?.[1] ?? start;
    const job = pair.value?.toJSON?.() ?? {};
    const stepsNode = isMap(pair.value) ? pair.value.get('steps', true) : null;
    const stepNodes = isSeq(stepsNode) ? stepsNode.items : [];
    const steps = stepNodes.map((node, index) => {
      const step = node?.toJSON?.() ?? {};
      const [stepStart = start, stepEnd = stepStart] = node?.range ?? [];
      return {
        index,
        line: lineAt(stepStart),
        name: textOf(step.name),
        uses: textOf(step.uses),
        run: textOf(step.run),
        with: step.with && typeof step.with === 'object' ? step.with : {},
        block: workflowText.slice(stepStart, stepEnd),
      };
    });
    const needs = job.needs == null ? [] : [job.needs].flat().map(String);
    jobs.set(name, {
      name,
      needs,
      steps,
      startLine: lineAt(start),
      endLine: lineAt(end),
      body: workflowText.slice(start, end),
    });
  }

  return jobs;
};

const actionName = step => step.uses.split('@')[0];

const collectActionSteps = (jobs, action) =>
  Array.from(jobs.values()).flatMap(job =>
    job.steps
      .filter(step => actionName(step) === action)
      .map(step => ({
        jobName: job.name,
        line: step.line,
        stepIndex: step.index,
        name: textOf(step.with.name).trim(),
        path: textOf(step.with.path).trim(),
        with: step.with,
        block: step.block,
        beforeActionBody: job.steps
          .slice(0, step.index)
          .map(previous => previous.run)
          .join('\n'),
      }))
  );

export const collectArtifactUploads = jobs => collectActionSteps(jobs, 'actions/upload-artifact');

export const collectArtifactDownloads = jobs =>
  collectActionSteps(jobs, 'actions/download-artifact');

export const collectTransitiveNeeds = (jobs, jobName, visited = new Set()) => {
  for (const neededJob of jobs.get(jobName)?.needs ?? []) {
    if (visited.has(neededJob)) {
      continue;
    }
    visited.add(neededJob);
    collectTransitiveNeeds(jobs, neededJob, visited);
  }

  return visited;
};

const isTrue = value => value === true || value === 'true';

/**
 * Position of the first step of `job` matching `predicate`, as [step, offset in its run]
 * so two commands of one multi-line step still compare in order; null when absent.
 */
const stepPosition = (job, predicate) => {
  for (const step of job?.steps ?? []) {
    const offset = predicate(step);
    if (offset !== -1 && offset !== false) {
      return [step.index, offset === true ? 0 : offset];
    }
  }
  return null;
};

const runPosition = (job, command) => stepPosition(job, step => step.run.indexOf(command));

const downloadPosition = (job, artifact) =>
  stepPosition(
    job,
    step => actionName(step) === 'actions/download-artifact' && step.with.name === artifact
  );

/** True when both positions exist and `left` comes before `right`. */
const isBefore = (left, right) =>
  Boolean(left && right) && (left[0] < right[0] || (left[0] === right[0] && left[1] < right[1]));

const normalizePath = artifactPath => String(artifactPath || '').replace(/\/+$/, '');

const isPathWithin = (candidatePath, rootPath) => {
  const candidate = normalizePath(candidatePath);
  const root = normalizePath(rootPath);
  return candidate === root || candidate.startsWith(`${root}/`);
};

export const collectCiArtifactContractIssues = workflowText => {
  const jobs = parseWorkflowJobs(workflowText);
  const uploads = collectArtifactUploads(jobs);
  const downloads = collectArtifactDownloads(jobs);
  const issues = [];

  for (const download of downloads) {
    if (!download.name) {
      issues.push(
        `${download.jobName}: download-artifact at line ${download.line} is missing name.`
      );
      continue;
    }

    const producers = uploads.filter(upload => upload.name === download.name);
    if (producers.length === 0) {
      issues.push(
        `${download.jobName}: downloads artifact "${download.name}" but no job uploads that artifact.`
      );
      continue;
    }

    const orderedProducerJobs = collectTransitiveNeeds(jobs, download.jobName);
    const orderedProducers = producers.filter(producer =>
      orderedProducerJobs.has(producer.jobName)
    );
    if (orderedProducers.length === 0) {
      issues.push(
        `${download.jobName}: downloads artifact "${download.name}" before declaring a needs chain to one of its producers (${producers
          .map(producer => producer.jobName)
          .join(', ')}).`
      );
    }
  }

  const distProducers = uploads.filter(upload => upload.name === 'dist');
  for (const producer of distProducers) {
    if (producer.jobName === 'build' && !isTrue(producer.with.overwrite)) {
      issues.push('build: dist upload must replace an artifact from an earlier run attempt.');
    }
    if (producer.jobName === 'build' && producer.with['if-no-files-found'] !== 'error') {
      issues.push('build: dist upload must fail when the new build is missing.');
    }
    const normalizedPath = normalizePath(producer.path);
    if (normalizedPath !== 'dist' && !normalizedPath.startsWith('dist/')) {
      issues.push(
        `${producer.jobName}: uploads artifact "dist" from "${producer.path || 'missing path'}"; expected dist/.`
      );
    }

    if (!producer.beforeActionBody.includes('npm run build')) {
      issues.push(
        `${producer.jobName}: uploads artifact "dist" without running npm run build earlier in the same job.`
      );
    }
  }

  const postmergeJob = jobs.get('postmerge-evidence');
  const releaseEvidenceProducerJob = jobs.get(RELEASE_EVIDENCE_RUNTIME_PRODUCER_JOB);
  const releaseEvidenceContractIsReferenced = workflowText.includes(
    RELEASE_EVIDENCE_RUNTIME_ARTIFACT
  );
  if (releaseEvidenceContractIsReferenced && !releaseEvidenceProducerJob) {
    issues.push(
      `Missing required producer job "${RELEASE_EVIDENCE_RUNTIME_PRODUCER_JOB}" for ` +
        `artifact "${RELEASE_EVIDENCE_RUNTIME_ARTIFACT}".`
    );
  }
  if (postmergeJob) {
    if (!runPosition(postmergeJob, 'npm run check:ci-artifact-contracts')) {
      issues.push(
        'postmerge-evidence: must run check:ci-artifact-contracts before downloading dist.'
      );
    }
    if (!runPosition(postmergeJob, 'scripts/verify-github-run-artifact.mjs')) {
      issues.push(
        'postmerge-evidence: must verify artifact availability before download-artifact.'
      );
    }

    const previewDownload = downloads.find(
      download =>
        download.jobName === 'postmerge-evidence' && download.name === PREVIEW_BOOTSTRAP_ARTIFACT
    );
    if (!previewDownload) {
      issues.push(`postmerge-evidence: must download artifact "${PREVIEW_BOOTSTRAP_ARTIFACT}".`);
    } else if (normalizePath(previewDownload.path) !== 'reports/e2e/preview-bootstrap') {
      issues.push(
        'postmerge-evidence: preview bootstrap must download to ' +
          '"reports/e2e/preview-bootstrap".'
      );
    }

    const verifyPreviewCommand =
      `scripts/verify-github-run-artifact.mjs --artifact ${PREVIEW_BOOTSTRAP_ARTIFACT} ` +
      `--producer ${PREVIEW_BOOTSTRAP_PRODUCER_JOB}`;
    const verifyPreview = runPosition(postmergeJob, verifyPreviewCommand);
    const downloadPreview = downloadPosition(postmergeJob, PREVIEW_BOOTSTRAP_ARTIFACT);
    const validatePreview = runPosition(postmergeJob, 'npm run check:preview-bootstrap-evidence');
    const generateEvidence = runPosition(postmergeJob, 'npm run postmerge:evidence');
    const builtContract = runPosition(postmergeJob, 'npm run check:release-evidence-contract:built');

    if (!verifyPreview) {
      issues.push(
        `postmerge-evidence: must verify "${PREVIEW_BOOTSTRAP_ARTIFACT}" from producer ` +
          `"${PREVIEW_BOOTSTRAP_PRODUCER_JOB}".`
      );
    } else if (isBefore(downloadPreview, verifyPreview)) {
      issues.push(`postmerge-evidence: must verify preview bootstrap before downloading it.`);
    }
    if (!validatePreview) {
      issues.push('postmerge-evidence: must validate downloaded preview bootstrap evidence.');
    } else {
      if (isBefore(validatePreview, downloadPreview)) {
        issues.push('postmerge-evidence: validates preview bootstrap before downloading it.');
      }
      if (isBefore(generateEvidence, validatePreview)) {
        issues.push('postmerge-evidence: validates preview bootstrap after generating evidence.');
      }
    }

    if (releaseEvidenceProducerJob) {
      const criticalCoverageDownload = downloads.find(
        download =>
          download.jobName === 'postmerge-evidence' && download.name === CRITICAL_COVERAGE_ARTIFACT
      );
      const verifyCriticalCoverageCommand =
        `scripts/verify-github-run-artifact.mjs --artifact ${CRITICAL_COVERAGE_ARTIFACT} ` +
        `--producer ${CRITICAL_COVERAGE_PRODUCER_JOB}`;
      const verifyCriticalCoverage = runPosition(postmergeJob, verifyCriticalCoverageCommand);
      const downloadCriticalCoverage = downloadPosition(postmergeJob, CRITICAL_COVERAGE_ARTIFACT);

      if (!criticalCoverageDownload) {
        issues.push(`postmerge-evidence: must download artifact "${CRITICAL_COVERAGE_ARTIFACT}".`);
      } else if (normalizePath(criticalCoverageDownload.path) !== 'reports') {
        issues.push('postmerge-evidence: critical coverage must download to "reports".');
      }
      if (!verifyCriticalCoverage) {
        issues.push(
          `postmerge-evidence: must verify "${CRITICAL_COVERAGE_ARTIFACT}" from producer ` +
            `"${CRITICAL_COVERAGE_PRODUCER_JOB}".`
        );
      } else if (isBefore(downloadCriticalCoverage, verifyCriticalCoverage)) {
        issues.push('postmerge-evidence: must verify critical coverage before downloading it.');
      }
      if (isBefore(generateEvidence, downloadCriticalCoverage)) {
        issues.push(
          'postmerge-evidence: must download critical coverage before generating evidence.'
        );
      }
      if (!builtContract) {
        issues.push('postmerge-evidence: must validate the release evidence embedded in dist.');
      } else if (isBefore(generateEvidence, builtContract)) {
        issues.push(
          'postmerge-evidence: must validate built release evidence before regenerating reports.'
        );
      }
    }
  }

  if (releaseEvidenceProducerJob) {
    const runtimeUploads = uploads.filter(
      upload => upload.name === RELEASE_EVIDENCE_RUNTIME_ARTIFACT
    );
    if (runtimeUploads.length !== 1) {
      issues.push(
        `${RELEASE_EVIDENCE_RUNTIME_PRODUCER_JOB}: must upload exactly one ` +
          `"${RELEASE_EVIDENCE_RUNTIME_ARTIFACT}" artifact.`
      );
    }
    for (const upload of runtimeUploads) {
      if (upload.jobName !== RELEASE_EVIDENCE_RUNTIME_PRODUCER_JOB) {
        issues.push(
          `${upload.jobName}: uploads "${RELEASE_EVIDENCE_RUNTIME_ARTIFACT}"; expected producer ` +
            `"${RELEASE_EVIDENCE_RUNTIME_PRODUCER_JOB}".`
        );
      }
      if (normalizePath(upload.path) !== RELEASE_EVIDENCE_RUNTIME_PATH) {
        issues.push(
          `${upload.jobName}: release evidence runtime artifact must upload from ` +
            `"${RELEASE_EVIDENCE_RUNTIME_PATH}".`
        );
      }
      if (!upload.beforeActionBody.includes('npm run report:release-evidence-contract')) {
        issues.push(`${upload.jobName}: uploads release evidence without generating its contract.`);
      }
      if (!upload.beforeActionBody.includes('npm run check:release-evidence-contract:strict')) {
        issues.push(`${upload.jobName}: uploads release evidence without strict validation.`);
      }
    }

    const buildJob = jobs.get('build');
    if (buildJob) {
      const runtimeDownload = downloads.find(
        download =>
          download.jobName === 'build' && download.name === RELEASE_EVIDENCE_RUNTIME_ARTIFACT
      );
      if (!runtimeDownload) {
        issues.push(`build: must download artifact "${RELEASE_EVIDENCE_RUNTIME_ARTIFACT}".`);
      } else {
        if (normalizePath(runtimeDownload.path) !== RELEASE_EVIDENCE_RUNTIME_PATH) {
          issues.push(
            `build: release evidence runtime must download to "${RELEASE_EVIDENCE_RUNTIME_PATH}".`
          );
        }
        const runtimeDownloadPosition = downloadPosition(buildJob, RELEASE_EVIDENCE_RUNTIME_ARTIFACT);
        const productionBuild = runPosition(buildJob, 'npm run build');
        if (!productionBuild) {
          issues.push('build: must run npm run build after downloading release evidence.');
        } else if (isBefore(productionBuild, runtimeDownloadPosition)) {
          issues.push('build: must download release evidence before building production assets.');
        }
      }
    }

    if (postmergeJob) {
      const postmergeRuntimeUploads = uploads.filter(
        upload =>
          upload.jobName === 'postmerge-evidence' &&
          isPathWithin(upload.path, RELEASE_EVIDENCE_RUNTIME_PATH)
      );
      if (postmergeRuntimeUploads.length > 0) {
        issues.push(
          'postmerge-evidence: must not republish regenerated release evidence as the build runtime contract.'
        );
      }
      const runtimeDownload = downloads.find(
        download =>
          download.jobName === 'postmerge-evidence' &&
          download.name === RELEASE_EVIDENCE_RUNTIME_ARTIFACT
      );
      const verifyRuntimeCommand =
        `scripts/verify-github-run-artifact.mjs --artifact ${RELEASE_EVIDENCE_RUNTIME_ARTIFACT} ` +
        `--producer ${RELEASE_EVIDENCE_RUNTIME_PRODUCER_JOB}`;
      const verifyRuntime = runPosition(postmergeJob, verifyRuntimeCommand);
      const downloadRuntime = downloadPosition(postmergeJob, RELEASE_EVIDENCE_RUNTIME_ARTIFACT);
      const builtContract = runPosition(
        postmergeJob,
        'npm run check:release-evidence-contract:built'
      );

      if (!runtimeDownload) {
        issues.push(
          `postmerge-evidence: must download artifact "${RELEASE_EVIDENCE_RUNTIME_ARTIFACT}".`
        );
      } else if (normalizePath(runtimeDownload.path) !== RELEASE_EVIDENCE_RUNTIME_PATH) {
        issues.push(
          `postmerge-evidence: release evidence runtime must download to ` +
            `"${RELEASE_EVIDENCE_RUNTIME_PATH}".`
        );
      }
      if (!verifyRuntime) {
        issues.push(
          `postmerge-evidence: must verify "${RELEASE_EVIDENCE_RUNTIME_ARTIFACT}" from producer ` +
            `"${RELEASE_EVIDENCE_RUNTIME_PRODUCER_JOB}".`
        );
      } else if (isBefore(downloadRuntime, verifyRuntime)) {
        issues.push('postmerge-evidence: must verify release evidence before downloading it.');
      }
      if (isBefore(builtContract, downloadRuntime)) {
        issues.push(
          'postmerge-evidence: validates built release evidence before downloading its source.'
        );
      }
    }
  }

  const previewUploads = uploads.filter(upload => upload.name === PREVIEW_BOOTSTRAP_ARTIFACT);
  if (previewUploads.length === 0) {
    issues.push(`No job uploads required artifact "${PREVIEW_BOOTSTRAP_ARTIFACT}".`);
  }
  for (const upload of previewUploads) {
    if (upload.jobName === PREVIEW_BOOTSTRAP_PRODUCER_JOB && !isTrue(upload.with.overwrite)) {
      issues.push(
        `${PREVIEW_BOOTSTRAP_PRODUCER_JOB}: preview bootstrap upload must replace an artifact ` +
          'from an earlier run attempt.'
      );
    }
    if (
      upload.jobName === PREVIEW_BOOTSTRAP_PRODUCER_JOB &&
      upload.with['if-no-files-found'] !== 'error'
    ) {
      issues.push(
        `${PREVIEW_BOOTSTRAP_PRODUCER_JOB}: preview bootstrap upload must fail when new evidence is missing.`
      );
    }
    if (upload.jobName !== PREVIEW_BOOTSTRAP_PRODUCER_JOB) {
      issues.push(
        `${upload.jobName}: uploads "${PREVIEW_BOOTSTRAP_ARTIFACT}"; expected producer ` +
          `"${PREVIEW_BOOTSTRAP_PRODUCER_JOB}".`
      );
    }
    if (!upload.beforeActionBody.includes('npm run write:preview-bootstrap-provenance')) {
      issues.push(`${upload.jobName}: uploads preview bootstrap without recording provenance.`);
    }
    if (!upload.beforeActionBody.includes('npm run check:preview-bootstrap-evidence')) {
      issues.push(`${upload.jobName}: uploads preview bootstrap without validating its evidence.`);
    }
    if (normalizePath(upload.path) !== 'reports/e2e/preview-bootstrap') {
      issues.push(
        `${upload.jobName}: preview bootstrap artifact must upload from ` +
          `"reports/e2e/preview-bootstrap/" so downloads preserve the canonical layout.`
      );
    }
  }

  return issues;
};
