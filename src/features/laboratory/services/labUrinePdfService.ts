import { fetchSyslabPdfArrayBuffer } from '@/services/laboratory/syslabService';
import type { LabResultRow, SyslabExamDetail, SyslabExamItem } from '@/types/domain/labExamTypes';
import { normalizeAnalysisName } from '../controllers/labFormattingController';
import { extractPdfText, normalizePdfText } from './labPdfTextSupport';

const URINE_SECTION_HEADINGS = [
  { section: 'QUIMICA/ORINA', pattern: /^QUIMICA\/ORINA$/i },
  { section: 'RELAC. ALBUMINA/CREATINURIA', pattern: /^RELAC\.\s*ALBUMINA\/CREATINURIA$/i },
] as const;

const isIgnoredPdfMetadata = (line: string): boolean =>
  /^(Director Tecnico|Resultado Via WEB|HOSPITAL DE HANGA ROA|Laboratorio Clínico|Nombre :|Rut\/Fic:|Fecha y Hora|Fecha de impresión|E X A M E N E S|Resultado Unidad Valor de Referencia)$/i.test(
    line
  );

const parsePdfRatioFinding = (
  section: string,
  line: string
): Pick<LabResultRow, 'section' | 'analysis' | 'result' | 'unit' | 'refValue'> | null => {
  if (!line.includes(':')) {
    return null;
  }

  const [analysis = '', ...resultParts] = line.split(':');
  const normalizedAnalysis = analysis.replace(/\s+/g, ' ').trim();
  const normalizedResult = resultParts.join(':').replace(/\s+/g, ' ').trim();
  const analysisToken = normalizedAnalysis
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();

  const canonicalAnalysis = /PROTEINURIA\s*\/\s*CREATININURIA/.test(analysisToken)
    ? 'RPC'
    : /(RELACION|RELAC\.)\s*ALBUMINA\s*\/\s*CREATININURI/.test(analysisToken)
      ? 'RAC'
      : null;

  if (!canonicalAnalysis) {
    return null;
  }

  const resultMatch = normalizedResult.match(/-?\d[\d.,]*/);
  if (!resultMatch || resultMatch.index === undefined) {
    return null;
  }

  return {
    section,
    analysis: normalizedAnalysis,
    result: resultMatch[0],
    unit: '',
    refValue: normalizedResult.slice(resultMatch.index + resultMatch[0].length).trim(),
  };
};

export const parseUrineRatioFindingsFromPdfText = (text: string): LabResultRow[] => {
  const lines = normalizePdfText(text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  let activeSection: string | null = null;
  const findings: LabResultRow[] = [];

  for (const line of lines) {
    const matchedHeading = URINE_SECTION_HEADINGS.find(heading => heading.pattern.test(line));
    if (matchedHeading) {
      activeSection = matchedHeading.section;
      continue;
    }

    if (isIgnoredPdfMetadata(line)) {
      continue;
    }

    if (!activeSection) {
      continue;
    }

    const parsed = parsePdfRatioFinding(activeSection, line);
    if (parsed) {
      findings.push({
        ...parsed,
        qualitative: false,
      });
    }
  }

  return findings;
};

const dedupeFindings = (findings: LabResultRow[]): LabResultRow[] => {
  const seen = new Set<string>();
  return findings.filter(finding => {
    const normalized = normalizeAnalysisName(finding.analysis, finding.section);
    const key = `${normalized}::${finding.result}::${finding.refValue}`.toUpperCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const shouldFetchUrineRatioPdfFallback = (
  exam: SyslabExamItem,
  detail: SyslabExamDetail
): boolean => {
  if (!exam.link) {
    return false;
  }

  const normalizedNames = new Set(
    detail.findings.map(finding => normalizeAnalysisName(finding.analysis, finding.section))
  );

  if (normalizedNames.has('RPC') && normalizedNames.has('RAC')) {
    return false;
  }

  const clinicalSignature = `${exam.exams.join(' ')} ${detail.findings
    .map(finding => `${finding.section} ${finding.analysis}`)
    .join(' ')}`.toUpperCase();

  return (
    clinicalSignature.includes('ORINA') ||
    clinicalSignature.includes('PROTEINURIA') ||
    clinicalSignature.includes('ALBUMINA/CREATINURIA') ||
    clinicalSignature.includes('MICROALBUMINURIA') ||
    clinicalSignature.includes('CREATININURIA')
  );
};

export const enrichUrineRatioDetailsFromPdf = async (
  details: SyslabExamDetail[],
  examList: SyslabExamItem[]
): Promise<SyslabExamDetail[]> =>
  Promise.all(
    details.map(async detail => {
      const exam = examList.find(candidate => candidate.link === detail.url);
      if (!exam?.link || !shouldFetchUrineRatioPdfFallback(exam, detail)) {
        return detail;
      }

      try {
        const buffer = await fetchSyslabPdfArrayBuffer(exam.link);
        const pdfText = await extractPdfText(buffer);
        const ratioFindings = parseUrineRatioFindingsFromPdfText(pdfText);
        if (ratioFindings.length === 0) {
          return detail;
        }

        return {
          ...detail,
          findings: dedupeFindings([...detail.findings, ...ratioFindings]),
        };
      } catch {
        return detail;
      }
    })
  );
