import {
  convertPlainTextToClinicalDocumentHtml,
  normalizeClinicalDocumentContentForStorage,
  sanitizeClinicalDocumentHtml,
} from '@/features/clinical-documents/controllers/clinicalDocumentRichTextController';

export const normalizeClinicalDocumentPlanSubsectionContent = (value: string): string => {
  const normalized = normalizeClinicalDocumentContentForStorage(value).replace(/(<br>\s*)+$/i, '');
  return normalized === '<br>' ? '' : normalized;
};

const normalizePlaceholderText = (value: string | null | undefined): string =>
  (value || '').replace(/\u00a0/g, ' ').trim();

const removeLeadingEmptyListItems = (listElement: Element): boolean => {
  while (listElement.firstElementChild?.tagName.toUpperCase() === 'LI') {
    const firstItem = listElement.firstElementChild;
    if (normalizePlaceholderText(firstItem.textContent)) {
      break;
    }

    listElement.removeChild(firstItem);
  }

  return listElement.children.length === 0;
};

const removeLeadingPlanPlaceholderLine = (value: string): string => {
  const normalized = normalizeClinicalDocumentPlanSubsectionContent(value);
  if (!normalized) {
    return '';
  }

  if (typeof document === 'undefined') {
    return normalizeClinicalDocumentPlanSubsectionContent(
      normalized.replace(
        /^(?:(?:<div>\s*-\s*(?:<br>)?\s*<\/div>|<p>\s*-\s*(?:<br>)?\s*<\/p>|<[uo]l>\s*<li>(?:\s|&nbsp;|<br>)*<\/li>\s*<\/[uo]l>)\s*)+/i,
        ''
      )
    );
  }

  const container = document.createElement('div');
  container.innerHTML = normalized;

  while (container.firstChild) {
    const firstNode = container.firstChild;
    if (firstNode.nodeType === Node.ELEMENT_NODE) {
      const firstElement = firstNode as Element;
      const tagName = firstElement.tagName.toUpperCase();
      if (tagName === 'UL' || tagName === 'OL') {
        if (removeLeadingEmptyListItems(firstElement)) {
          container.removeChild(firstNode);
          continue;
        }

        break;
      }
    }

    const text = normalizePlaceholderText(firstNode.textContent);
    if (text !== '-') {
      break;
    }

    container.removeChild(firstNode);
  }

  return normalizeClinicalDocumentPlanSubsectionContent(container.innerHTML);
};

const normalizePlanIndicationLineText = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const withoutBullet = trimmed.replace(/^[-–—]\s*/, '').trim();
  return withoutBullet ? `- ${withoutBullet}` : '-';
};

const buildClinicalDocumentPlanIndicationLinesHtml = (value: string): string => {
  const lines = value
    .split(/\r?\n/)
    .map(normalizePlanIndicationLineText)
    .filter((line): line is string => Boolean(line));

  return lines.map(line => `<div>${convertPlainTextToClinicalDocumentHtml(line)}</div>`).join('');
};

export const appendClinicalDocumentPlanIndicationLine = (
  currentContent: string,
  indicationText: string
): string => {
  const nextLinesHtml = buildClinicalDocumentPlanIndicationLinesHtml(indicationText);
  if (!nextLinesHtml) {
    return normalizeClinicalDocumentPlanSubsectionContent(currentContent);
  }

  const normalizedCurrent = removeLeadingPlanPlaceholderLine(currentContent);

  if (!normalizedCurrent) {
    return normalizeClinicalDocumentPlanSubsectionContent(
      sanitizeClinicalDocumentHtml(nextLinesHtml)
    );
  }

  if (typeof document === 'undefined') {
    return sanitizeClinicalDocumentHtml(`${normalizedCurrent}${nextLinesHtml}`);
  }

  const container = document.createElement('div');
  container.innerHTML = normalizedCurrent;

  const removeTrailingEmptyNodes = () => {
    while (container.lastChild) {
      const lastNode = container.lastChild;
      if (lastNode.nodeType === Node.TEXT_NODE && !(lastNode.textContent || '').trim()) {
        container.removeChild(lastNode);
        continue;
      }

      if (lastNode.nodeType === Node.ELEMENT_NODE) {
        const wrapper = document.createElement('div');
        wrapper.appendChild(lastNode.cloneNode(true));
        const normalizedLastNode = normalizeClinicalDocumentPlanSubsectionContent(
          wrapper.innerHTML
        );
        if (!normalizedLastNode || normalizedLastNode === '<br>') {
          container.removeChild(lastNode);
          continue;
        }
      }
      break;
    }
  };

  removeTrailingEmptyNodes();

  const template = document.createElement('template');
  template.innerHTML = nextLinesHtml;
  container.appendChild(template.content.cloneNode(true));

  return normalizeClinicalDocumentPlanSubsectionContent(
    sanitizeClinicalDocumentHtml(container.innerHTML)
  );
};

export const getClinicalDocumentPlanNodeHtml = (node: ChildNode): string => {
  if (typeof document === 'undefined') {
    return '';
  }
  const wrapper = document.createElement('div');
  wrapper.appendChild(node.cloneNode(true));
  return wrapper.innerHTML;
};
