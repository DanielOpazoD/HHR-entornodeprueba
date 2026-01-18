/**
 * Diagnosis Abbreviations
 * 
 * Maps common diagnoses to their medical abbreviations
 * for compact display in the census table.
 */

/**
 * Abbreviation mapping: full name → abbreviation
 * Case-insensitive matching
 */
const ABBREVIATION_MAP: Record<string, string> = {
    // Diabetes
    'diabetes mellitus tipo 1': 'DM1',
    'diabetes mellitus tipo 2': 'DM2',
    'diabetes mellitus tipo 2, sin complicaciones': 'DM2',
    'diabetes mellitus tipo 2 con complicaciones circulatorias periféricas (pie diabético)': 'Pie diabético',
    'diabetes mellitus tipo 2 con hiperglucemia': 'DM2 + Hiperglicemia',

    // Cardiovascular
    'hipertensión esencial (primaria)': 'HTA',
    'hipertensión arterial': 'HTA',
    'insuficiencia cardíaca, no especificada': 'IC',
    'insuficiencia cardíaca': 'IC',
    'infarto agudo de miocardio, no especificado': 'IAM',
    'infarto agudo de miocardio': 'IAM',
    'fibrilación y aleteo auricular, no especificado': 'FA',
    'fibrilación auricular': 'FA',
    'accidente vascular encefálico, no especificado como hemorrágico o isquémico': 'AVE',
    'infarto cerebral, no especificado (acv isquémico)': 'ACV isquémico',
    'embolia pulmonar sin mención de cor pulmonale agudo (tep)': 'TEP',
    'trombosis venosa profunda': 'TVP',
    'flebitis y tromboflebitis de otros vasos profundos de los miembros inferiores (tvp)': 'TVP',

    // Respiratorio
    'neumonía, no especificada': 'NAC',
    'neumonía bacteriana, no especificada': 'NAC bacteriana',
    'enfermedad pulmonar obstructiva crónica, no especificada (epoc)': 'EPOC',
    'enfermedad pulmonar obstructiva crónica con exacerbación aguda': 'EPOC exacerbado',
    'asma, no especificada': 'Asma',
    'insuficiencia respiratoria aguda': 'IRA',
    'insuficiencia respiratoria, no especificada': 'IR',

    // Renal
    'insuficiencia renal aguda, no especificada (aki/ira)': 'AKI',
    'insuficiencia renal aguda': 'AKI',
    'enfermedad renal crónica, no especificada (erc)': 'ERC',
    'enfermedad renal crónica': 'ERC',
    'infección de vías urinarias, sitio no especificado (itu)': 'ITU',
    'infección de vías urinarias': 'ITU',

    // Digestivo
    'colecistitis aguda': 'Colecistitis',
    'pancreatitis aguda, no especificada': 'Pancreatitis',
    'hemorragia gastrointestinal, no especificada': 'HDA/HDB',
    'cirrosis del hígado, no especificada': 'Cirrosis',
    'obstrucción intestinal, sin especificar': 'Obstrucción intestinal',

    // Neurológico
    'traumatismo intracraneal, no especificado (tec)': 'TEC',
    'accidente isquémico transitorio, no especificado': 'TIA',
    'epilepsia, no especificada': 'Epilepsia',
    'encefalopatía, no especificada': 'Encefalopatía',

    // Infeccioso
    'septicemia, no especificada': 'Sepsis',
    'celulitis, no especificada': 'Celulitis',
    'covid-19, virus identificado': 'COVID-19',

    // Traumatismos comunes
    'fractura del cuello del fémur (fractura de cadera)': 'Fx cadera',
    'fractura de la clavícula': 'Fx clavícula',
    'fractura de vértebra lumbar': 'Fx lumbar',
    'fractura del antebrazo, parte no especificada': 'Fx antebrazo',
    'fractura de la pierna, parte no especificada': 'Fx pierna',
    'fractura de costilla': 'Fx costilla',
    'fractura de la rótula': 'Fx rótula',
    'fractura del extremo distal del radio (fractura de colles)': 'Fx Colles',
    'esguince y torcedura del tobillo': 'Esguince tobillo',

    // Obstetricia
    'parto único espontáneo': 'Parto vaginal',
    'parto único por cesárea': 'Cesárea',
    'preeclampsia, no especificada': 'Preeclampsia',

    // Síntomas
    'disnea': 'Disnea',
    'dolor torácico, no especificado': 'Dolor torácico',
    'síncope y colapso': 'Síncope',
    'fiebre, no especificada': 'Fiebre',

    // Otros
    'depleción del volumen (deshidratación)': 'Deshidratación',
    'diarrea y gastroenteritis de presunto origen infeccioso': 'GEA',
    'anemia, no especificada': 'Anemia',
};

/**
 * Get abbreviation for a diagnosis
 * Returns the abbreviation if found, otherwise returns the original text
 * 
 * @param fullDiagnosis The full diagnosis text
 * @returns The abbreviated form or original if no abbreviation exists
 */
export function abbreviateDiagnosis(fullDiagnosis: string): string {
    if (!fullDiagnosis) return '';

    const normalized = fullDiagnosis.toLowerCase().trim();

    // Direct match
    if (ABBREVIATION_MAP[normalized]) {
        return ABBREVIATION_MAP[normalized];
    }

    // Try partial matching for longer descriptions
    for (const [key, abbrev] of Object.entries(ABBREVIATION_MAP)) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return abbrev;
        }
    }

    // If no abbreviation found, try to shorten long text
    if (fullDiagnosis.length > 30) {
        // Remove common suffixes
        const shortened = fullDiagnosis
            .replace(/, no especificad[ao]/gi, '')
            .replace(/, parte no especificada/gi, '')
            .replace(/\s*\([^)]*\)/g, '') // Remove parenthetical content
            .trim();

        return shortened.length < fullDiagnosis.length ? shortened : fullDiagnosis;
    }

    return fullDiagnosis;
}

/**
 * Check if a diagnosis has an abbreviation
 */
export function hasAbbreviation(fullDiagnosis: string): boolean {
    if (!fullDiagnosis) return false;
    const normalized = fullDiagnosis.toLowerCase().trim();
    return normalized in ABBREVIATION_MAP;
}
