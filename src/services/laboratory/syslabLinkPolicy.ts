/**
 * How long a Syslab search can be reused.
 *
 * The links of a search stop working 15 minutes after the search that issued them (the extension
 * batch lifetime). A list is therefore searched again before that, leaving the report reads a
 * margin, and is kept in memory a while longer for the person who comes back to it. The viewer
 * modal and the clinical explorer read these numbers from here, not from their own copies.
 */
export const SYSLAB_LINK_LIFETIME_MS = 15 * 60_000;
export const SYSLAB_LIST_REUSE_MS = 10 * 60_000;
export const SYSLAB_LIST_RETENTION_MS = 30 * 60_000;
