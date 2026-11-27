import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Returns true only when this module is executed directly as the Node CLI entrypoint. */
export const isDirectCliEntry = importMetaUrl => {
  const entrypoint = process.argv[1];
  if (!entrypoint) return false;
  try {
    return importMetaUrl === pathToFileURL(fs.realpathSync(entrypoint)).href;
  } catch {
    return false;
  }
};

/** Prints a governance check result and sets exit status consistently. */
export const runIssueListCli = ({ tag, failureHeader, issues, okMessage }) => {
  if (issues.length > 0) {
    console.error(`[${tag}] ${failureHeader}`);
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }
  console.log(`[${tag}] ${okMessage}`);
};
