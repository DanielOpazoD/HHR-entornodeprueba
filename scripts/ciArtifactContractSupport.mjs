import {
  PREVIEW_BOOTSTRAP_ARTIFACT,
  PREVIEW_BOOTSTRAP_PRODUCER_JOB,
} from './previewBootstrapEvidenceSupport.mjs';

const parseScalar = value =>
  String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');

const parseInlineNeeds = rawNeeds => {
  const value = parseScalar(rawNeeds);
  if (!value) {
    return [];
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map(item => parseScalar(item))
      .filter(Boolean);
  }

  return [value];
};

const getField = (block, fieldName) => {
  const match = block.match(new RegExp(`^\\s+${fieldName}:\\s*(.+)$`, 'm'));
  return match ? parseScalar(match[1]) : '';
};

const extractActionBlocks = (job, actionName) => {
  const blocks = [];
  const actionPattern = new RegExp(`uses:\\s*${actionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const lines = job.body.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    if (!actionPattern.test(lines[index])) {
      continue;
    }

    const blockLines = [];
    for (let blockIndex = index; blockIndex < lines.length; blockIndex += 1) {
      if (blockIndex > index && /^\s{6}-\s/.test(lines[blockIndex])) {
        break;
      }
      blockLines.push(lines[blockIndex]);
    }

    blocks.push({
      jobName: job.name,
      line: job.startLine + index,
      beforeActionBody: lines.slice(0, index).join('\n'),
      block: blockLines.join('\n'),
    });
  }

  return blocks;
};

export const parseWorkflowJobs = workflowText => {
  const lines = workflowText.split(/\r?\n/);
  const jobs = new Map();
  let inJobs = false;
  let currentJob = null;

  const finishCurrentJob = endLine => {
    if (!currentJob) {
      return;
    }

    jobs.set(currentJob.name, {
      ...currentJob,
      endLine,
      body: lines.slice(currentJob.startLine - 1, endLine).join('\n'),
    });
    currentJob = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!inJobs) {
      inJobs = /^jobs:\s*$/.test(line);
      continue;
    }

    const jobMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (jobMatch) {
      finishCurrentJob(index);
      currentJob = {
        name: jobMatch[1],
        startLine: index + 1,
      };
    }
  }

  finishCurrentJob(lines.length);

  return jobs;
};

export const collectArtifactUploads = jobs =>
  Array.from(jobs.values()).flatMap(job =>
    extractActionBlocks(job, 'actions/upload-artifact').map(action => ({
      jobName: action.jobName,
      line: action.line,
      name: getField(action.block, 'name'),
      path: getField(action.block, 'path'),
      beforeActionBody: action.beforeActionBody,
      block: action.block,
    }))
  );

export const collectArtifactDownloads = jobs =>
  Array.from(jobs.values()).flatMap(job =>
    extractActionBlocks(job, 'actions/download-artifact').map(action => ({
      jobName: action.jobName,
      line: action.line,
      name: getField(action.block, 'name'),
      path: getField(action.block, 'path'),
      block: action.block,
    }))
  );

export const collectTransitiveNeeds = (jobs, jobName, visited = new Set()) => {
  const job = jobs.get(jobName);
  if (!job) {
    return visited;
  }

  const needsMatch = job.body.match(/^\s+needs:\s*(.+)$/m);
  const directNeeds = needsMatch ? parseInlineNeeds(needsMatch[1]) : [];
  for (const neededJob of directNeeds) {
    if (visited.has(neededJob)) {
      continue;
    }
    visited.add(neededJob);
    collectTransitiveNeeds(jobs, neededJob, visited);
  }

  return visited;
};

const normalizePath = artifactPath => artifactPath.replace(/\/+$/, '');

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
  if (postmergeJob) {
    if (!postmergeJob.body.includes('npm run check:ci-artifact-contracts')) {
      issues.push(
        'postmerge-evidence: must run check:ci-artifact-contracts before downloading dist.'
      );
    }
    if (!postmergeJob.body.includes('scripts/verify-github-run-artifact.mjs')) {
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
    const verifyPreviewIndex = postmergeJob.body.indexOf(verifyPreviewCommand);
    const downloadPreviewIndex = postmergeJob.body.indexOf(`name: ${PREVIEW_BOOTSTRAP_ARTIFACT}`);
    const validatePreviewIndex = postmergeJob.body.indexOf(
      'npm run check:preview-bootstrap-evidence'
    );
    const generateEvidenceIndex = postmergeJob.body.indexOf('npm run postmerge:evidence');

    if (verifyPreviewIndex === -1) {
      issues.push(
        `postmerge-evidence: must verify "${PREVIEW_BOOTSTRAP_ARTIFACT}" from producer ` +
          `"${PREVIEW_BOOTSTRAP_PRODUCER_JOB}".`
      );
    } else if (downloadPreviewIndex !== -1 && verifyPreviewIndex > downloadPreviewIndex) {
      issues.push(`postmerge-evidence: must verify preview bootstrap before downloading it.`);
    }
    if (validatePreviewIndex === -1) {
      issues.push('postmerge-evidence: must validate downloaded preview bootstrap evidence.');
    } else {
      if (downloadPreviewIndex !== -1 && validatePreviewIndex < downloadPreviewIndex) {
        issues.push('postmerge-evidence: validates preview bootstrap before downloading it.');
      }
      if (generateEvidenceIndex !== -1 && validatePreviewIndex > generateEvidenceIndex) {
        issues.push('postmerge-evidence: validates preview bootstrap after generating evidence.');
      }
    }
  }

  const previewUploads = uploads.filter(upload => upload.name === PREVIEW_BOOTSTRAP_ARTIFACT);
  if (previewUploads.length === 0) {
    issues.push(`No job uploads required artifact "${PREVIEW_BOOTSTRAP_ARTIFACT}".`);
  }
  for (const upload of previewUploads) {
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
