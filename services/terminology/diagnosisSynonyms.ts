/**
 * Diagnosis Synonyms - Medical Term Mapping
 * 
 * Maps colloquial, abbreviated, and variant medical terms
 * to their official CIE-10 search terms in Spanish.
 */

/**
 * Synonym mappings: colloquial/abbreviated term → official search terms
 * Each key can map to multiple search terms for broader matches
 */
export const DIAGNOSIS_SYNONYMS: Record<string, string[]> = {
    // === ABBREVIATIONS (Medical) ===
    'iam': ['infarto agudo de miocardio', 'infarto miocardio'],
    'iamest': ['infarto agudo de miocardio con elevación', 'infarto st'],
    'iamsest': ['infarto agudo de miocardio sin elevación', 'infarto'],
    'nac': ['neumonía', 'neumonia adquirida comunidad'],
    'nih': ['neumonía intrahospitalaria', 'neumonia hospitalaria'],
    'tvp': ['trombosis venosa profunda', 'flebitis', 'tromboflebitis'],
    'tep': ['embolia pulmonar', 'tromboembolismo pulmonar'],
    'aki': ['insuficiencia renal aguda', 'lesión renal aguda'],
    'ira': ['insuficiencia renal aguda', 'insuficiencia respiratoria aguda'],
    'erc': ['enfermedad renal crónica', 'insuficiencia renal crónica'],
    'irc': ['enfermedad renal crónica', 'insuficiencia renal crónica'],
    'epoc': ['enfermedad pulmonar obstructiva crónica', 'epoc'],
    'copd': ['enfermedad pulmonar obstructiva crónica', 'epoc'],
    'itu': ['infección de vías urinarias', 'infección urinaria'],
    'ivu': ['infección de vías urinarias', 'infección urinaria'],
    'ave': ['accidente vascular encefálico', 'accidente cerebrovascular'],
    'acv': ['accidente cerebrovascular', 'infarto cerebral', 'ave'],
    'tia': ['accidente isquémico transitorio', 'isquemia transitoria'],
    'ait': ['accidente isquémico transitorio'],
    'hta': ['hipertensión', 'hipertension arterial', 'presión alta'],
    'ic': ['insuficiencia cardíaca', 'insuficiencia cardiaca'],
    'icc': ['insuficiencia cardíaca congestiva', 'insuficiencia cardiaca'],
    'fa': ['fibrilación auricular', 'aleteo auricular'],
    'dm': ['diabetes mellitus', 'diabetes'],
    'dm1': ['diabetes mellitus tipo 1', 'diabetes tipo 1'],
    'dm2': ['diabetes mellitus tipo 2', 'diabetes tipo 2'],
    'dbt': ['diabetes', 'diabético'],
    'tec': ['traumatismo encefalocraneano', 'traumatismo intracraneal', 'trauma craneal'],
    'gea': ['gastroenteritis aguda', 'diarrea', 'gastroenteritis'],
    'hda': ['hemorragia digestiva alta', 'hemorragia gastrointestinal'],
    'hdb': ['hemorragia digestiva baja', 'hemorragia gastrointestinal'],
    'sd': ['síndrome', 'sindrome'],
    'fx': ['fractura'],
    'ca': ['cáncer', 'tumor maligno', 'neoplasia'],
    'neo': ['neoplasia', 'tumor', 'cáncer'],
    'bcp': ['bronconeumonía', 'neumonia'],
    'sca': ['síndrome coronario agudo', 'infarto'],
    'sdra': ['síndrome de dificultad respiratoria', 'distress respiratorio'],
    'rn': ['recién nacido', 'neonato'],
    'rnpt': ['recién nacido pretérmino', 'prematuro'],
    'rnt': ['recién nacido término'],

    // === COLLOQUIAL CHILEAN TERMS ===
    'pulmonia': ['neumonía'],
    'neumonia': ['neumonía'],
    'pulmon': ['pulmonar', 'pulmón'],
    'presion alta': ['hipertensión', 'hipertension arterial'],
    'presion baja': ['hipotensión'],
    'azucar': ['diabetes', 'hiperglucemia'],
    'azucar alta': ['diabetes', 'hiperglucemia'],
    'ataque cardiaco': ['infarto agudo de miocardio', 'infarto'],
    'ataque al corazon': ['infarto agudo de miocardio', 'infarto'],
    'derrame': ['accidente cerebrovascular', 'hemorragia cerebral', 'ave'],
    'derrame cerebral': ['accidente cerebrovascular', 'hemorragia cerebral'],
    'embolia': ['embolia pulmonar', 'tromboembolismo'],
    'coagulo': ['trombosis', 'embolia'],
    'riñon': ['renal', 'riñón'],
    'rinon': ['renal', 'riñón'],
    'higado': ['hepático', 'hígado', 'cirrosis'],
    'vesicula': ['vesícula biliar', 'colecistitis', 'colelitiasis'],
    'apendicitis': ['apendicitis aguda'],
    'fractura cadera': ['fractura del cuello del fémur', 'fractura cadera'],
    'cadera rota': ['fractura del cuello del fémur', 'fractura cadera'],
    'pie diabetico': ['diabetes mellitus con complicaciones circulatorias', 'pie diabético'],
    'ulcera': ['úlcera'],
    'escaras': ['úlcera por presión'],
    'llagas': ['úlcera por presión', 'úlcera'],
    'infarto': ['infarto agudo de miocardio', 'infarto cerebral'],
    'neumotorax': ['neumotórax'],
    'hemotorax': ['hemotórax'],
    'colitis': ['enfermedad inflamatoria intestinal', 'colitis'],
    'pancreatitis': ['pancreatitis aguda'],
    'sepsis': ['septicemia', 'sepsis'],
    'shock': ['choque'],
    'shock septico': ['choque séptico', 'septicemia'],
    'falla respiratoria': ['insuficiencia respiratoria'],
    'falla cardiaca': ['insuficiencia cardíaca'],
    'falla renal': ['insuficiencia renal'],
    'cancer': ['cáncer', 'tumor maligno', 'neoplasia'],
    'tumor': ['tumor', 'neoplasia'],

    // === ORTHOGRAPHIC VARIANTS ===
    'diabetes': ['diabetes mellitus'],
    'hipertension': ['hipertensión'],
    'diarrea': ['diarrea y gastroenteritis'],
    'bronquitis': ['bronquitis'],
    'asma': ['asma'],
    'epilepsia': ['epilepsia'],
    'cirrosis': ['cirrosis del hígado', 'cirrosis hepática'],
    'anemia': ['anemia'],
    'celulitis': ['celulitis'],
    'trombosis': ['trombosis venosa', 'tromboflebitis'],
    'arritmia': ['arritmia', 'fibrilación', 'taquicardia'],
    'angina': ['angina de pecho'],
    'obesidad': ['obesidad'],
    'hipotiroidismo': ['hipotiroidismo'],
    'hipertiroidismo': ['tirotoxicosis', 'hipertiroidismo'],

    // === ENGLISH TERMS (commonly used) ===
    'stroke': ['accidente cerebrovascular', 'infarto cerebral'],
    'heart attack': ['infarto agudo de miocardio'],
    'heart failure': ['insuficiencia cardíaca'],
    'kidney failure': ['insuficiencia renal'],
    'pneumonia': ['neumonía'],
    'septic shock': ['choque séptico'],
    'covid': ['covid-19'],
    'coronavirus': ['covid-19'],
};

/**
 * Look up synonyms for a query term
 * Returns array of expanded search terms
 */
export function expandSynonyms(query: string): string[] {
    const normalized = query.toLowerCase().trim();

    // Direct match
    if (DIAGNOSIS_SYNONYMS[normalized]) {
        return DIAGNOSIS_SYNONYMS[normalized];
    }

    // Partial match for compound terms
    for (const [key, expansions] of Object.entries(DIAGNOSIS_SYNONYMS)) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return expansions;
        }
    }

    return [];
}

/**
 * Check if a term has synonym mappings
 */
export function hasSynonyms(query: string): boolean {
    const normalized = query.toLowerCase().trim();
    return normalized in DIAGNOSIS_SYNONYMS;
}
