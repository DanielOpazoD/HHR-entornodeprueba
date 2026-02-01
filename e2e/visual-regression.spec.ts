import { test, expect, Page } from '@playwright/test';

/**
 * Visual Regression Testing Specification
 */

const VRT_DATE = '2026-01-25';

async function injectVRTData(page: Page) {
    const dateStr = VRT_DATE;
    // 1. Pipe all console logs
    page.on('console', msg => console.log(`BROWSER LOG [${msg.type()}]: ${msg.text()}`));

    // 2. Inject specific VRT data using the built-in E2E override hook
    // We use addInitScript to ensure this is set BEFORE the app initializes.
    await page.addInitScript(({ dateStr }) => {
        const records = {
            [dateStr]: {
                date: dateStr,
                beds: {},
                lastUpdated: new Date().toISOString(),
                schemaVersion: 1,
                nursesDayShift: ["Enfermero VRT 1", "Enfermero VRT 2"],
                tensDayShift: ["TENS VRT 1", "TENS VRT 2", "TENS VRT 3"],
                activeExtraBeds: []
            }
        };

        // Initialize all 18 beds with dummy patient data
        // Explicitly naming the beds to match BEDS constant in the app
        const bedIds = [
            'R1', 'R2', 'R3', 'R4',
            'NEO1', 'NEO2',
            'H1C1', 'H1C2', 'H2C1', 'H2C2', 'H3C1', 'H3C2',
            'H4C1', 'H4C2', 'H5C1', 'H5C2', 'H6C1', 'H6C2'
        ];

        bedIds.forEach((bedId, i) => {
            (records[dateStr].beds as any)[bedId] = {
                id: bedId,
                bedId: bedId, // Some components might use bedId
                patientName: `Paciente VRT ${i + 1}`,
                rut: `12.345.678-${i + 1}`,
                age: "45",
                diagnosis: `Diagnóstico VRT para cama ${bedId}`,
                isOccupied: true,
                admissionDate: dateStr,
                daysHospitalized: i + 1,
                insurance: 'FONASA A',
                biologicalSex: i % 2 === 0 ? 'Femenino' : 'Masculino',
                bedMode: 'Adulto',
                status: 'Estable'
            };
        });

        // Set the override globally
        (window as any).__HHR_E2E_OVERRIDE__ = records;

        // Also inject mock user data for login
        const mockUser = {
            uid: 'e2e-test-editor-uid',
            email: 'hospitalizados@hospitalhangaroa.cl',
            role: 'nurse_hospital'
        };
        const mockPassport = {
            email: 'hospitalizados@hospitalhangaroa.cl',
            role: 'nurse_hospital',
            timestamp: Date.now()
        };

        localStorage.setItem('hhr_offline_user', JSON.stringify(mockUser));
        localStorage.setItem('hhr_offline_passport', JSON.stringify(mockPassport));

        console.warn(`[E2E] addInitScript injected override for ${dateStr}`);
    }, { dateStr });

    // 3. Navigate
    await page.goto(`/censo?date=${VRT_DATE}`);
    await page.waitForLoadState('domcontentloaded');
}

test.describe('Visual Regression Testing', () => {

    test('Login View baseline', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText('Hospital Hanga Roa')).toBeVisible({ timeout: 10000 });
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveScreenshot('login-view.png', {
            maxDiffPixelRatio: 0.01,
            animations: 'disabled'
        });
    });

    test('Census Dashboard baseline', async ({ page }) => {
        await injectVRTData(page);

        // Wait for table to be ready
        const table = page.getByTestId('census-table');
        await expect(table).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(2000); // Wait for React render

        // Mask dynamic data
        await expect(page).toHaveScreenshot('census-dashboard.png', {
            maxDiffPixelRatio: 0.02,
            animations: 'disabled',
            mask: [
                page.locator('.text-slate-400').filter({ hasText: /:/ }), // Potential clocks
                page.locator('nav').first(),
            ]
        });
    });

    test('3D Hospital Map baseline', async ({ page }) => {
        await injectVRTData(page);
        await page.goto(`/censo?date=${VRT_DATE}`);

        // Find the map toggle button by title
        const mapButton = page.locator('button[title="Ver Mapa 3D"]');
        await expect(mapButton).toBeVisible({ timeout: 10000 });
        await mapButton.click();

        // Wait for 3D loader to disappear
        const loader = page.locator('text=Cargando entorno 3D');
        await expect(loader).not.toBeVisible({ timeout: 30000 });

        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible({ timeout: 10000 });

        // Extra time for Three.js textures and lighting to settle
        await page.waitForTimeout(5000);

        await expect(page).toHaveScreenshot('hospital-3d-map.png', {
            maxDiffPixelRatio: 0.1,
            mask: [page.locator('.lucide-search'), page.locator('.lucide-box')] // Mask transient UI
        });
    });

    test('Patient Dialog UI baseline', async ({ page }) => {
        await injectVRTData(page);
        await page.goto(`/censo?date=${VRT_DATE}`);

        // Wait for table to be ready
        const table = page.getByTestId('census-table');
        await expect(table).toBeVisible({ timeout: 15000 });

        // Wait for data to load in the table - Use bed ID 'R1' which is stable text
        const patientRow = page.locator('tr').filter({ hasText: 'R1' });
        await expect(patientRow).toBeVisible({ timeout: 15000 });

        // Clicking the age field opens the Demographics Modal
        const ageField = patientRow.locator('input[placeholder="Edad"]');
        await ageField.click();

        const dialog = page.locator('role=dialog');
        await expect(dialog).toBeVisible({ timeout: 10000 });

        // Give time for animations
        await page.waitForTimeout(1000);

        await expect(dialog).toHaveScreenshot('patient-demographics-dialog.png', {
            maxDiffPixelRatio: 0.05
        });
    });
});
