import { fetchSyslabPdfArrayBuffer } from '@/services/laboratory/syslabService';
import type { LabResultRow, SyslabExamDetail, SyslabExamItem } from '@/types/domain/labExamTypes';
import { extractPdfText, normalizePdfText } from './labPdfTextSupport';

const CULTURE_PATTERN = /(CULTIVO CORRIENTE|ATB BACILOS|ANTIBIOGRAMA)/i;
const HEMOCULTURE_PATTERN = /HEMOCULTIVO/i;
const UROCULTURE_PATTERN = /UROCULTIVO/i;
const PCR_PANEL_PATTERN = /(PCR PANEL|PANEL RESPIRATORIO|PANEL VIRAL)/i;
const ARBOVIRUS_PATTERN = /PCR ARBOVIROSIS/i;
const VIRAL_FINDING_PATTERN =
  /(INFLUENZA|PARAINFLUENZA|METAPNEUMOVIRUS|RHINOVIRUS|RINOVIRUS|SINCICIAL|ADENOVIRUS|SARS|COVID|CORONAVIRUS)/i;
const ARBOVIRUS_FINDING_PATTERN = /(DENGUE|CHIKUNGUNYA|ZIKA|ARBOVIROSIS)/i;

const parseColonPairs = (lines: string[]): Array<{ analysis: string; result: string }> => {
  const pairs: Array<{ analysis: string; result: string }> = [];
  for (const line of lines) {
    if (!line.includes(':')) continue;
    const [analysis = '', ...resultParts] = line.split(':');
    const normalizedAnalysis = analysis.replace(/\s+/g, ' ').trim();
    const normalizedResult = resultParts.join(':').replace(/\s+/g, ' ').trim();
    if (!normalizedAnalysis || !normalizedResult) continue;
    pairs.push({ analysis: normalizedAnalysis, result: normalizedResult });
  }
  return pairs;
};

const shouldIgnoreMicrobiologyPair = (analysis: string): boolean =>
  /^N(?:[°ºoO])?\s*de ingreso/i.test(analysis) || /^Tipo de muestra/i.test(analysis);

export const parseMicrobiologyFindingsFromPdfText = (text: string): LabResultRow[] => {
  const normalized = normalizePdfText(text);
  const lines = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const headings = [
    { key: 'culture', pattern: /^CULTIVO CORRIENTE\b/i },
    { key: 'culture', pattern: /^HEMOCULTIVO\b/i },
    { key: 'culture', pattern: /^UROCULTIVO\b/i },
    { key: 'atb', pattern: /^ATB BACILOS GRAM\b/i },
    { key: 'antibiogram', pattern: /^ANTIBIOGRAMA EXTENDIDO\b/i },
    { key: 'pcr', pattern: /^PCR PANEL RESPIRATORIO\b/i },
    { key: 'arbovirus', pattern: /^PCR ARBOVIROSIS\b/i },
  ] as const;
  const sectionLines: Record<(typeof headings)[number]['key'], string[]> = {
    culture: [],
    atb: [],
    antibiogram: [],
    pcr: [],
    arbovirus: [],
  };
  let activeSection: (typeof headings)[number]['key'] | null = null;

  for (const line of lines) {
    const matchedHeading = headings.find(heading => heading.pattern.test(line));
    if (matchedHeading) {
      activeSection = matchedHeading.key;
      continue;
    }

    if (
      /^(Director Tecnico|Resultado Via WEB|HOSPITAL DE HANGA ROA|Laboratorio Clínico|Nombre :|Rut\/Fic:|Fecha y Hora|Fecha de impresión|E X A M E N E S)/i.test(
        line
      )
    ) {
      activeSection = null;
      continue;
    }

    if (activeSection) {
      sectionLines[activeSection].push(line);
    }
  }

  const findings: LabResultRow[] = [];

  for (const entry of parseColonPairs(sectionLines.culture)) {
    if (shouldIgnoreMicrobiologyPair(entry.analysis)) continue;
    if (/^cultivo$/i.test(entry.analysis)) {
      findings.push({
        section: 'MICROBIOLOGIA',
        analysis: 'Cultivo',
        result: entry.result,
        unit: '',
        refValue: '',
        qualitative: true,
      });
    }
  }

  for (const entry of [
    ...parseColonPairs(sectionLines.atb),
    ...parseColonPairs(sectionLines.antibiogram),
  ]) {
    if (shouldIgnoreMicrobiologyPair(entry.analysis)) continue;
    findings.push({
      section: 'MICROBIOLOGIA',
      analysis: entry.analysis,
      result: entry.result,
      unit: '',
      refValue: '',
      qualitative: true,
    });
  }

  for (const entry of parseColonPairs(sectionLines.pcr)) {
    if (shouldIgnoreMicrobiologyPair(entry.analysis)) continue;
    findings.push({
      section: 'MICROBIOLOGIA',
      analysis: entry.analysis,
      result: entry.result,
      unit: '',
      refValue: '',
      qualitative: true,
    });
  }

  for (const entry of parseColonPairs(sectionLines.arbovirus)) {
    if (shouldIgnoreMicrobiologyPair(entry.analysis)) continue;
    findings.push({
      section: 'MICROBIOLOGIA',
      analysis: entry.analysis,
      result: entry.result,
      unit: '',
      refValue: '',
      qualitative: true,
    });
  }

  return findings;
};

const shouldFetchMicrobiologyPdfFallback = (
  exam: SyslabExamItem,
  detail: SyslabExamDetail
): boolean => {
  const examNames = exam.exams.join(' ');
  if (!exam.link) return false;

  const needsCultureFallback =
    (CULTURE_PATTERN.test(examNames) ||
      HEMOCULTURE_PATTERN.test(examNames) ||
      UROCULTURE_PATTERN.test(examNames)) &&
    !detail.findings.some(finding =>
      /(CULTIVO|SUSCEPTIBLE|SUCEPTIBLE|RESISTENTE|AMIKACINA|CEFTAZIDIMA|IMIPENEM|ERTAPENEM|PIPERACILINA|CEFEPIME)/i.test(
        `${finding.analysis} ${finding.result}`
      )
    );

  const needsPcrFallback =
    PCR_PANEL_PATTERN.test(examNames) &&
    !detail.findings.some(finding =>
      VIRAL_FINDING_PATTERN.test(`${finding.analysis} ${finding.result}`)
    );

  const needsArbovirusFallback =
    ARBOVIRUS_PATTERN.test(examNames) &&
    !detail.findings.some(finding =>
      ARBOVIRUS_FINDING_PATTERN.test(`${finding.analysis} ${finding.result}`)
    );

  return needsCultureFallback || needsPcrFallback || needsArbovirusFallback;
};

const dedupeFindings = (findings: LabResultRow[]): LabResultRow[] => {
  const seen = new Set<string>();
  return findings.filter(finding => {
    const key = `${finding.section}::${finding.analysis}::${finding.result}`.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const enrichMicrobiologyDetailsFromPdf = async (
  details: SyslabExamDetail[],
  examList: SyslabExamItem[]
): Promise<SyslabExamDetail[]> => {
  const detailMap = new Map(details.map(detail => [detail.url, detail]));
  const enriched = await Promise.all(
    details.map(async detail => {
      const exam = examList.find(candidate => candidate.link === detail.url);
      if (!exam?.link || !shouldFetchMicrobiologyPdfFallback(exam, detail)) {
        return detail;
      }

      try {
        const buffer = await fetchSyslabPdfArrayBuffer(exam.link);
        const text = await extractPdfText(buffer);
        const fallbackFindings = parseMicrobiologyFindingsFromPdfText(text);
        if (fallbackFindings.length === 0) return detail;

        return {
          ...detail,
          findings: dedupeFindings([...detail.findings, ...fallbackFindings]),
        };
      } catch {
        return detailMap.get(detail.url) || detail;
      }
    })
  );

  return enriched;
};
