import { GoogleGenAI } from "@google/genai";
import { DailyRecord } from "@/types";
import { calculateStats } from "../calculations/statsCalculator";
import { aiRequestManager } from "../ai/aiRequestManager";

const initializeGenAI = () => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please set REACT_APP_GEMINI_API_KEY in your environment.");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const generateShiftReport = async (record: DailyRecord): Promise<string | undefined> => {
  const stats = calculateStats(record.beds);

  // Filter only occupied beds for the prompt to save tokens
  const occupiedData = Object.values(record.beds)
    .filter(b => b.patientName || b.isBlocked)
    .map(b => ({
      bed: b.bedId,
      status: b.isBlocked ? 'BLOCKED' : 'OCCUPIED',
      diagnosis: b.pathology,
      specialty: b.specialty,
      condition: b.status,
      age: b.age,
      devices: b.devices.join(', '),
      daysAdmitted: b.admissionDate ? Math.floor((new Date(record.date).getTime() - new Date(b.admissionDate).getTime()) / (1000 * 3600 * 24)) : 0
    }));

  const prompt = `
    Actúa como una enfermera supervisora jefe experta en gestión clínica.
    Analiza los datos del turno del Hospital Hanga Roa para el día ${record.date}.
    
    Estadísticas Generales:
    - Total Pacientes: ${stats.totalHospitalized}
    - Camas Bloqueadas: ${stats.blockedBeds}
    - Disponibilidad: ${stats.serviceCapacity - stats.totalHospitalized - stats.blockedBeds} camas libres.

    Detalle de Pacientes (JSON simplificado):
    ${JSON.stringify(occupiedData)}

    Genera un reporte conciso en formato HTML (sin etiquetas markdown, solo tags html básicos como <p>, <ul>, <strong>) con las siguientes secciones:
    1. **Resumen de Ocupación**: Breve análisis de la carga del servicio.
    2. **Alertas Clínicas**: Destaca pacientes Graves o de cuidado, y aquellos con múltiples dispositivos invasivos.
    3. **Gestión de Camas**: Comentarios sobre camas bloqueadas o eficiencia del uso de recursos.
    4. **Recomendaciones**: Sugerencias breves para el siguiente turno.

    Mantén el tono profesional, clínico y directo.
  `;

  try {
    // Use rate-limited request manager to prevent 429 errors
    return await aiRequestManager.enqueue(
      `shift-report-${record.date}`,
      async () => {
        const ai = initializeGenAI();
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
        });
        return response.text;
      }
    );
  } catch (error) {
    console.error("Error generating AI report:", error);
    return "<p>No se pudo generar el reporte de IA. Verifique la conexión o la clave API.</p>";
  }
};