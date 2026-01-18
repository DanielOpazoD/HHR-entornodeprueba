/**
 * CIE-10 Spanish Database
 * 
 * Common diagnoses with official CIE-10 codes and Spanish descriptions.
 * Based on MINSAL and WHO ICD-10 Spanish edition.
 */

export interface CIE10Entry {
    code: string;
    description: string;
    category?: string;
}

/**
 * Comprehensive list of common CIE-10 codes in Spanish
 * Organized by category for maintainability
 */
export const CIE10_SPANISH_DATABASE: CIE10Entry[] = [
    // === ENFERMEDADES INFECCIOSAS (A00-B99) ===
    { code: 'A09', description: 'Diarrea y gastroenteritis de presunto origen infeccioso', category: 'Infecciosas' },
    { code: 'A41.9', description: 'Septicemia, no especificada', category: 'Infecciosas' },
    { code: 'A46', description: 'Erisipela', category: 'Infecciosas' },
    { code: 'B34.9', description: 'Infección viral, no especificada', category: 'Infecciosas' },

    // === NEOPLASIAS (C00-D48) ===
    { code: 'C34.9', description: 'Tumor maligno del bronquio o del pulmón, parte no especificada', category: 'Neoplasias' },
    { code: 'C50.9', description: 'Tumor maligno de la mama, parte no especificada', category: 'Neoplasias' },
    { code: 'C61', description: 'Tumor maligno de la próstata', category: 'Neoplasias' },
    { code: 'C18.9', description: 'Tumor maligno del colon, parte no especificada', category: 'Neoplasias' },

    // === ENFERMEDADES DE LA SANGRE (D50-D89) ===
    { code: 'D50.9', description: 'Anemia por deficiencia de hierro, no especificada', category: 'Sangre' },
    { code: 'D64.9', description: 'Anemia, no especificada', category: 'Sangre' },

    // === TRASTORNOS ENDOCRINOS (E00-E90) ===
    { code: 'E10.9', description: 'Diabetes mellitus tipo 1, sin complicaciones', category: 'Endocrinas' },
    { code: 'E11.9', description: 'Diabetes mellitus tipo 2, sin complicaciones', category: 'Endocrinas' },
    { code: 'E11.5', description: 'Diabetes mellitus tipo 2 con complicaciones circulatorias periféricas (Pie diabético)', category: 'Endocrinas' },
    { code: 'E11.65', description: 'Diabetes mellitus tipo 2 con hiperglucemia', category: 'Endocrinas' },
    { code: 'E03.9', description: 'Hipotiroidismo, no especificado', category: 'Endocrinas' },
    { code: 'E05.9', description: 'Tirotoxicosis, no especificada', category: 'Endocrinas' },
    { code: 'E66.9', description: 'Obesidad, no especificada', category: 'Endocrinas' },
    { code: 'E86', description: 'Depleción del volumen (Deshidratación)', category: 'Endocrinas' },
    { code: 'E87.1', description: 'Hiponatremia', category: 'Endocrinas' },
    { code: 'E87.5', description: 'Hiperpotasemia (Hiperkalemia)', category: 'Endocrinas' },
    { code: 'E87.6', description: 'Hipopotasemia (Hipokalemia)', category: 'Endocrinas' },

    // === TRASTORNOS MENTALES (F00-F99) ===
    { code: 'F10.2', description: 'Trastornos mentales por uso de alcohol: Síndrome de dependencia', category: 'Mental' },
    { code: 'F20.9', description: 'Esquizofrenia, no especificada', category: 'Mental' },
    { code: 'F32.9', description: 'Episodio depresivo, no especificado', category: 'Mental' },
    { code: 'F41.9', description: 'Trastorno de ansiedad, no especificado', category: 'Mental' },

    // === SISTEMA NERVIOSO (G00-G99) ===
    { code: 'G40.9', description: 'Epilepsia, no especificada', category: 'Neurológicas' },
    { code: 'G45.9', description: 'Accidente isquémico transitorio, no especificado', category: 'Neurológicas' },
    { code: 'G93.4', description: 'Encefalopatía, no especificada', category: 'Neurológicas' },

    // === ENFERMEDADES DEL OJO (H00-H59) ===
    { code: 'H25.9', description: 'Catarata senil, no especificada', category: 'Oftalmológicas' },

    // === ENFERMEDADES DEL OÍDO (H60-H95) ===
    { code: 'H66.9', description: 'Otitis media, no especificada', category: 'Otorrinolaringológicas' },

    // === ENFERMEDADES CARDIOVASCULARES (I00-I99) ===
    { code: 'I10', description: 'Hipertensión esencial (primaria)', category: 'Cardiovascular' },
    { code: 'I11.9', description: 'Enfermedad cardíaca hipertensiva sin insuficiencia cardíaca', category: 'Cardiovascular' },
    { code: 'I20.9', description: 'Angina de pecho, no especificada', category: 'Cardiovascular' },
    { code: 'I21.9', description: 'Infarto agudo de miocardio, no especificado', category: 'Cardiovascular' },
    { code: 'I25.9', description: 'Enfermedad isquémica crónica del corazón, no especificada', category: 'Cardiovascular' },
    { code: 'I48.9', description: 'Fibrilación y aleteo auricular, no especificado', category: 'Cardiovascular' },
    { code: 'I50.9', description: 'Insuficiencia cardíaca, no especificada', category: 'Cardiovascular' },
    { code: 'I63.9', description: 'Infarto cerebral, no especificado (ACV isquémico)', category: 'Cardiovascular' },
    { code: 'I64', description: 'Accidente vascular encefálico, no especificado como hemorrágico o isquémico', category: 'Cardiovascular' },
    { code: 'I70.9', description: 'Aterosclerosis generalizada y no especificada', category: 'Cardiovascular' },
    { code: 'I74.3', description: 'Embolia y trombosis de arterias de los miembros inferiores', category: 'Cardiovascular' },
    { code: 'I80.2', description: 'Flebitis y tromboflebitis de otros vasos profundos de los miembros inferiores (TVP)', category: 'Cardiovascular' },
    { code: 'I26.9', description: 'Embolia pulmonar sin mención de cor pulmonale agudo (TEP)', category: 'Cardiovascular' },

    // === ENFERMEDADES RESPIRATORIAS (J00-J99) ===
    { code: 'J06.9', description: 'Infección aguda de las vías respiratorias superiores, no especificada', category: 'Respiratorias' },
    { code: 'J18.9', description: 'Neumonía, no especificada', category: 'Respiratorias' },
    { code: 'J15.9', description: 'Neumonía bacteriana, no especificada', category: 'Respiratorias' },
    { code: 'J44.1', description: 'Enfermedad pulmonar obstructiva crónica con exacerbación aguda', category: 'Respiratorias' },
    { code: 'J44.9', description: 'Enfermedad pulmonar obstructiva crónica, no especificada (EPOC)', category: 'Respiratorias' },
    { code: 'J45.9', description: 'Asma, no especificada', category: 'Respiratorias' },
    { code: 'J96.0', description: 'Insuficiencia respiratoria aguda', category: 'Respiratorias' },
    { code: 'J96.9', description: 'Insuficiencia respiratoria, no especificada', category: 'Respiratorias' },

    // === ENFERMEDADES DIGESTIVAS (K00-K93) ===
    { code: 'K21.0', description: 'Enfermedad por reflujo gastroesofágico con esofagitis', category: 'Digestivas' },
    { code: 'K25.9', description: 'Úlcera gástrica, no especificada', category: 'Digestivas' },
    { code: 'K29.7', description: 'Gastritis, no especificada', category: 'Digestivas' },
    { code: 'K35.9', description: 'Apendicitis aguda, no especificada', category: 'Digestivas' },
    { code: 'K40.9', description: 'Hernia inguinal unilateral o no especificada, sin obstrucción ni gangrena', category: 'Digestivas' },
    { code: 'K56.6', description: 'Obstrucción intestinal, sin especificar', category: 'Digestivas' },
    { code: 'K57.9', description: 'Enfermedad diverticular del intestino, parte no especificada', category: 'Digestivas' },
    { code: 'K70.3', description: 'Cirrosis hepática alcohólica', category: 'Digestivas' },
    { code: 'K74.6', description: 'Cirrosis del hígado, no especificada', category: 'Digestivas' },
    { code: 'K80.2', description: 'Cálculo de la vesícula biliar sin colecistitis (Colelitiasis)', category: 'Digestivas' },
    { code: 'K81.0', description: 'Colecistitis aguda', category: 'Digestivas' },
    { code: 'K85.9', description: 'Pancreatitis aguda, no especificada', category: 'Digestivas' },
    { code: 'K92.2', description: 'Hemorragia gastrointestinal, no especificada', category: 'Digestivas' },

    // === ENFERMEDADES DE LA PIEL (L00-L99) ===
    { code: 'L03.9', description: 'Celulitis, no especificada', category: 'Piel' },
    { code: 'L89.9', description: 'Úlcera por presión de sitio no especificado', category: 'Piel' },

    // === ENFERMEDADES OSTEOMUSCULARES (M00-M99) ===
    { code: 'M16.9', description: 'Coxartrosis (artrosis de cadera), no especificada', category: 'Osteomusculares' },
    { code: 'M17.9', description: 'Gonartrosis (artrosis de rodilla), no especificada', category: 'Osteomusculares' },
    { code: 'M54.5', description: 'Lumbago no especificado (Dolor lumbar)', category: 'Osteomusculares' },
    { code: 'M79.3', description: 'Paniculitis, no especificada', category: 'Osteomusculares' },

    // === ENFERMEDADES GENITOURINARIAS (N00-N99) ===
    { code: 'N17.9', description: 'Insuficiencia renal aguda, no especificada (AKI/IRA)', category: 'Genitourinarias' },
    { code: 'N18.9', description: 'Enfermedad renal crónica, no especificada (ERC)', category: 'Genitourinarias' },
    { code: 'N19', description: 'Insuficiencia renal no especificada', category: 'Genitourinarias' },
    { code: 'N39.0', description: 'Infección de vías urinarias, sitio no especificado (ITU)', category: 'Genitourinarias' },
    { code: 'N40', description: 'Hiperplasia de la próstata', category: 'Genitourinarias' },

    // === EMBARAZO Y PARTO (O00-O99) ===
    { code: 'O14.9', description: 'Preeclampsia, no especificada', category: 'Obstetricia' },
    { code: 'O42.9', description: 'Ruptura prematura de membranas, inicio del trabajo de parto sin especificar', category: 'Obstetricia' },
    { code: 'O60.1', description: 'Trabajo de parto prematuro con parto prematuro', category: 'Obstetricia' },
    { code: 'O80', description: 'Parto único espontáneo', category: 'Obstetricia' },
    { code: 'O82', description: 'Parto único por cesárea', category: 'Obstetricia' },
    { code: 'O72.1', description: 'Otras hemorragias postparto inmediatas', category: 'Obstetricia' },

    // === PERÍODO PERINATAL (P00-P96) ===
    { code: 'P07.3', description: 'Otros recién nacidos pretérmino', category: 'Perinatal' },
    { code: 'P22.0', description: 'Síndrome de dificultad respiratoria del recién nacido', category: 'Perinatal' },
    { code: 'P59.9', description: 'Ictericia neonatal, no especificada', category: 'Perinatal' },

    // === MALFORMACIONES CONGÉNITAS (Q00-Q99) ===
    { code: 'Q21.0', description: 'Comunicación interventricular', category: 'Congénitas' },

    // === SÍNTOMAS Y SIGNOS (R00-R99) ===
    { code: 'R00.0', description: 'Taquicardia, no especificada', category: 'Síntomas' },
    { code: 'R06.0', description: 'Disnea', category: 'Síntomas' },
    { code: 'R07.4', description: 'Dolor torácico, no especificado', category: 'Síntomas' },
    { code: 'R10.4', description: 'Dolor abdominal, otro y el no especificado', category: 'Síntomas' },
    { code: 'R11', description: 'Náusea y vómito', category: 'Síntomas' },
    { code: 'R50.9', description: 'Fiebre, no especificada', category: 'Síntomas' },
    { code: 'R55', description: 'Síncope y colapso', category: 'Síntomas' },
    { code: 'R57.9', description: 'Choque, no especificado', category: 'Síntomas' },

    // === TRAUMATISMOS Y FRACTURAS (S00-T98) ===
    // Cabeza
    { code: 'S00.9', description: 'Traumatismo superficial de la cabeza, no especificado', category: 'Traumatismos' },
    { code: 'S02.0', description: 'Fractura de bóveda del cráneo', category: 'Traumatismos' },
    { code: 'S02.1', description: 'Fractura de base del cráneo', category: 'Traumatismos' },
    { code: 'S02.2', description: 'Fractura de los huesos de la nariz', category: 'Traumatismos' },
    { code: 'S02.4', description: 'Fractura del malar y del hueso maxilar superior', category: 'Traumatismos' },
    { code: 'S02.6', description: 'Fractura del maxilar inferior (mandíbula)', category: 'Traumatismos' },
    { code: 'S02.9', description: 'Fractura del cráneo y de los huesos de la cara, no especificada', category: 'Traumatismos' },
    { code: 'S06.0', description: 'Conmoción cerebral', category: 'Traumatismos' },
    { code: 'S06.5', description: 'Hemorragia subdural traumática', category: 'Traumatismos' },
    { code: 'S06.6', description: 'Hemorragia subaracnoidea traumática', category: 'Traumatismos' },
    { code: 'S06.9', description: 'Traumatismo intracraneal, no especificado (TEC)', category: 'Traumatismos' },

    // Cuello y columna cervical
    { code: 'S12.9', description: 'Fractura del cuello, nivel no especificado (Columna cervical)', category: 'Traumatismos' },
    { code: 'S13.4', description: 'Esguince y torcedura de la columna cervical (Latigazo cervical)', category: 'Traumatismos' },
    { code: 'S14.1', description: 'Lesión de la médula espinal cervical', category: 'Traumatismos' },

    // Tórax
    { code: 'S22.3', description: 'Fractura de costilla', category: 'Traumatismos' },
    { code: 'S22.4', description: 'Fracturas múltiples de costillas', category: 'Traumatismos' },
    { code: 'S22.0', description: 'Fractura de vértebra torácica', category: 'Traumatismos' },
    { code: 'S22.2', description: 'Fractura del esternón', category: 'Traumatismos' },
    { code: 'S27.0', description: 'Neumotórax traumático', category: 'Traumatismos' },
    { code: 'S27.1', description: 'Hemotórax traumático', category: 'Traumatismos' },

    // Columna lumbar y pelvis
    { code: 'S32.0', description: 'Fractura de vértebra lumbar', category: 'Traumatismos' },
    { code: 'S32.1', description: 'Fractura del sacro', category: 'Traumatismos' },
    { code: 'S32.3', description: 'Fractura del ilion', category: 'Traumatismos' },
    { code: 'S32.4', description: 'Fractura del acetábulo', category: 'Traumatismos' },
    { code: 'S32.5', description: 'Fractura del pubis', category: 'Traumatismos' },
    { code: 'S32.8', description: 'Fractura de otras partes y de partes no especificadas de columna lumbosacra y pelvis', category: 'Traumatismos' },

    // Hombro y brazo
    { code: 'S42.0', description: 'Fractura de la clavícula', category: 'Traumatismos' },
    { code: 'S42.1', description: 'Fractura de la escápula (omóplato)', category: 'Traumatismos' },
    { code: 'S42.2', description: 'Fractura del extremo superior del húmero', category: 'Traumatismos' },
    { code: 'S42.3', description: 'Fractura de la diáfisis del húmero', category: 'Traumatismos' },
    { code: 'S42.4', description: 'Fractura del extremo inferior del húmero', category: 'Traumatismos' },
    { code: 'S43.0', description: 'Luxación de la articulación del hombro', category: 'Traumatismos' },

    // Codo y antebrazo
    { code: 'S52.0', description: 'Fractura del extremo superior del cúbito (olécranon)', category: 'Traumatismos' },
    { code: 'S52.1', description: 'Fractura del extremo superior del radio (cabeza del radio)', category: 'Traumatismos' },
    { code: 'S52.2', description: 'Fractura de la diáfisis del cúbito', category: 'Traumatismos' },
    { code: 'S52.3', description: 'Fractura de la diáfisis del radio', category: 'Traumatismos' },
    { code: 'S52.5', description: 'Fractura del extremo distal del radio (Fractura de Colles)', category: 'Traumatismos' },
    { code: 'S52.6', description: 'Fractura del extremo distal del cúbito y del radio', category: 'Traumatismos' },
    { code: 'S52.9', description: 'Fractura del antebrazo, parte no especificada', category: 'Traumatismos' },

    // Muñeca y mano
    { code: 'S62.0', description: 'Fractura del hueso escafoides de la mano (navicular)', category: 'Traumatismos' },
    { code: 'S62.1', description: 'Fractura de otro(s) hueso(s) del carpo', category: 'Traumatismos' },
    { code: 'S62.2', description: 'Fractura del primer metacarpiano', category: 'Traumatismos' },
    { code: 'S62.3', description: 'Fractura de otro metacarpiano', category: 'Traumatismos' },
    { code: 'S62.5', description: 'Fractura del pulgar', category: 'Traumatismos' },
    { code: 'S62.6', description: 'Fractura de otro dedo de la mano', category: 'Traumatismos' },

    // Cadera y muslo
    { code: 'S72.0', description: 'Fractura del cuello del fémur (Fractura de cadera)', category: 'Traumatismos' },
    { code: 'S72.1', description: 'Fractura pertrocantérica', category: 'Traumatismos' },
    { code: 'S72.2', description: 'Fractura subtrocantérica', category: 'Traumatismos' },
    { code: 'S72.3', description: 'Fractura de la diáfisis del fémur', category: 'Traumatismos' },
    { code: 'S72.4', description: 'Fractura del extremo inferior del fémur (supracondílea)', category: 'Traumatismos' },
    { code: 'S72.9', description: 'Fractura del fémur, parte no especificada', category: 'Traumatismos' },
    { code: 'S73.0', description: 'Luxación de la cadera', category: 'Traumatismos' },

    // Rodilla y pierna
    { code: 'S82.0', description: 'Fractura de la rótula', category: 'Traumatismos' },
    { code: 'S82.1', description: 'Fractura del extremo superior de la tibia (meseta tibial)', category: 'Traumatismos' },
    { code: 'S82.2', description: 'Fractura de la diáfisis de la tibia', category: 'Traumatismos' },
    { code: 'S82.3', description: 'Fractura del extremo inferior de la tibia (pilón tibial)', category: 'Traumatismos' },
    { code: 'S82.4', description: 'Fractura del peroné solamente', category: 'Traumatismos' },
    { code: 'S82.5', description: 'Fractura del maléolo interno (tibial)', category: 'Traumatismos' },
    { code: 'S82.6', description: 'Fractura del maléolo externo (peroneal)', category: 'Traumatismos' },
    { code: 'S82.8', description: 'Fractura de otras partes de la pierna (bimaleolar, trimaleolar)', category: 'Traumatismos' },
    { code: 'S82.9', description: 'Fractura de la pierna, parte no especificada', category: 'Traumatismos' },
    { code: 'S83.0', description: 'Luxación de la rótula', category: 'Traumatismos' },
    { code: 'S83.5', description: 'Esguince y torcedura de la rodilla (ligamento cruzado)', category: 'Traumatismos' },

    // Tobillo y pie
    { code: 'S92.0', description: 'Fractura del calcáneo (talón)', category: 'Traumatismos' },
    { code: 'S92.1', description: 'Fractura del astrágalo', category: 'Traumatismos' },
    { code: 'S92.3', description: 'Fractura del metatarsiano', category: 'Traumatismos' },
    { code: 'S92.4', description: 'Fractura del dedo gordo del pie', category: 'Traumatismos' },
    { code: 'S92.5', description: 'Fractura de otro dedo del pie', category: 'Traumatismos' },
    { code: 'S93.4', description: 'Esguince y torcedura del tobillo', category: 'Traumatismos' },

    // Otros traumatismos
    { code: 'T14.0', description: 'Traumatismo superficial de región del cuerpo no especificada', category: 'Traumatismos' },
    { code: 'T14.1', description: 'Herida de región del cuerpo no especificada', category: 'Traumatismos' },
    { code: 'T14.9', description: 'Traumatismo, no especificado', category: 'Traumatismos' },
    { code: 'T79.4', description: 'Embolia grasa traumática', category: 'Traumatismos' },

    // === COVID-19 (U07) ===
    { code: 'U07.1', description: 'COVID-19, virus identificado', category: 'COVID-19' },
    { code: 'U07.2', description: 'COVID-19, virus no identificado', category: 'COVID-19' },

    // === CAUSAS EXTERNAS (V01-Y98) - Para contexto ===
    { code: 'W19', description: 'Caída no especificada', category: 'Causas externas' },

    // === FACTORES QUE INFLUYEN (Z00-Z99) ===
    { code: 'Z51.1', description: 'Sesión de quimioterapia por tumor', category: 'Factores' },
    { code: 'Z96.1', description: 'Presencia de lentes intraoculares', category: 'Factores' },
];

import { preprocessQuery, scoreMatch, fuzzyMatch, normalizeText } from './nlpPreprocessor';

/**
 * Search CIE-10 codes in Spanish with NLP enhancement
 * Uses synonym expansion, fuzzy matching, and relevance scoring
 * @param query Search term
 * @returns Matching CIE-10 entries sorted by relevance
 */
export function searchCIE10Spanish(query: string): CIE10Entry[] {
    if (!query || query.length < 2) return [];

    const preprocessed = preprocessQuery(query);

    // Score all entries
    const scoredEntries = CIE10_SPANISH_DATABASE.map(entry => {
        const score = scoreMatch(entry.description, entry.code, preprocessed);
        return { entry, score };
    });

    // Filter entries with score > 0
    let results = scoredEntries
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ entry }) => entry);

    // If no results, try fuzzy matching as fallback
    if (results.length === 0) {
        results = CIE10_SPANISH_DATABASE.filter(entry => {
            const normalizedDesc = normalizeText(entry.description);
            return fuzzyMatch(preprocessed.normalized, normalizedDesc, 0.7);
        });
    }

    return results.slice(0, 15);
}
