/** Pure projection of Ficha Médico history into minimal scale and staffing metadata. */
(function (root) {
  'use strict';
  const SCALE_FORM_RE = /braden|downton/i;
  const text = value => String(value || '').trim();
  const list = value => Array.isArray(value) ? value : [];
  const authorFromParts = item => ['HCP_FGN', 'HCP_NGN', 'HCP_FFN', 'HCP_SFN']
    .map(key => item && item[key]).map(text).filter(Boolean).join(' ');
  const authorIdentityFromParts = item => {
    const firstGivenName = text(item && item.HCP_FGN);
    const firstSurname = text(item && item.HCP_FFN);
    return firstGivenName && firstSurname ? { firstGivenName, firstSurname } : null;
  };
  const PUBLISHED_AUTHOR_RE = /^(\d{2})-(\d{2})-(\d{4})\s+-\s+(\d{2}:\d{2}(?::\d{2})?)\s+-\s+(.+?)\s+-\s+.+$/;
  const publishedParts = value => text(value).match(PUBLISHED_AUTHOR_RE);
  const authorFromPublishedLabel = value => text(publishedParts(value)?.[5] || value);
  const publishedAtFromLabel = value => { const match = publishedParts(value); return match ? `${match[3]}-${match[2]}-${match[1]}T${match[4]}` : ''; };
  const flag = value => value === true || value === 1 || /^(?:true|1|s|si|sí)$/i.test(text(value));
  const activityFrom = (item, source, recordedAt) => {
    if (!item) return null;
    const author = authorFromParts(item) || text(item.HCP_NAME) || authorFromPublishedLabel(item.PUBLISH_DATE_HCP_NAME);
    const role = text(item.HCPR_NAME || item.HCPR_ROLE || item.HCP_ROLE || item.PRACTITIONER_ROLE);
    const timestamp = text(recordedAt);
    if (!author || !role || !timestamp) return null;
    const authorIdentity = authorIdentityFromParts(item);
    const practitionerId = text(item.authorHealthCarePractitionerId || item.healthCarePractitionerId || item.HCP_ID);
    return {
      author,
      ...(practitionerId && practitionerId !== '0' ? { practitionerId } : {}),
      ...(authorIdentity ? { authorIdentity } : {}),
      role,
      recordedAt: timestamp,
      source,
      archived: flag(item.ARCHIVED),
      crossedOut: flag(item.IS_CROSSED_OUT),
    };
  };
  const collectActivity = (rows, source, recordedAt) => list(rows)
    .map(item => activityFrom(item, source, recordedAt(item))).filter(Boolean);
  const projectScaleEvent = event => {
    const resume = list(event && event.evaluationInstrumentsResume).filter(
      item => item && SCALE_FORM_RE.test(text(item.FORM_NAME))
    );
    if (!resume.length) return null;
    return {
      publishDatetime: event.publishDatetime || '',
      evaluationInstrumentsResume: resume.map(item => ({
        FORM_NAME: item.FORM_NAME,
        LABEL: item.LABEL,
        VALUE: item.VALUE,
        ARCHIVED: item.ARCHIVED,
        MCAM_ID: item.MCAM_ID,
        PUBLISH_DATE_HCP_NAME: item.PUBLISH_DATE_HCP_NAME,
        PRACTITIONER_ROLE: item.PRACTITIONER_ROLE,
      })),
    };
  };
  const project = payload => {
    const events = [];
    const nursingActivity = [];
    for (const event of list(payload)) {
      const activitySources = [
        [event && event.evolutionResume, 'evolution', item => item && item.OBE_PUBLISH_DATETIME || event && event.publishDatetime],
        [event && event.shiftChangeResume, 'shift-change', item => item && item.PUBLISH_DATETIME || event && event.publishDatetime],
        [event && event.pharmaPerformedActivityResume, 'medication-administration', item => item && item.PUBLISH_DATETIME || event && event.publishDatetime],
        [event && event.vitalSignObsResume, 'vital-signs', item => item && item.PUBLISH_DATE || event && event.publishDatetime],
      ];
      nursingActivity.push(...activitySources.flatMap(([rows, source, at]) => collectActivity(rows, source, at)));
      const scaleEvent = projectScaleEvent(event);
      if (!scaleEvent) continue;
      events.push(scaleEvent);
      nursingActivity.push(...collectActivity(
        list(event.evaluationInstrumentsResume).filter(item =>
          item && SCALE_FORM_RE.test(text(item.FORM_NAME))
        ), 'evaluation-scale', item => publishedAtFromLabel(item.PUBLISH_DATE_HCP_NAME) || event.publishDatetime
      ));
    }
    return { events, nursingActivity };
  };
  root.HhrFichaMedicoHistoryReadModel = { project };
})(typeof globalThis !== 'undefined' ? globalThis : self);
