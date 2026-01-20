
const fs = require('fs');
const rawReport = fs.readFileSync('lint-report.json', 'utf8');

// Find the start of the JSON array
const jsonStartIndex = rawReport.indexOf('[');
if (jsonStartIndex === -1) {
    console.error('CRITICAL: No JSON array found in lint-report.json');
    process.exit(1);
}

// Clean up any trailing text after the JSON
let jsonContent = rawReport.substring(jsonStartIndex);
// Find the last closing bracket that matches the structure
const jsonEndIndex = jsonContent.lastIndexOf(']');
if (jsonEndIndex !== -1) {
    jsonContent = jsonContent.substring(0, jsonEndIndex + 1);
}

let report;
try {
    report = JSON.parse(jsonContent);
} catch (e) {
    console.error('CRITICAL: Failed to parse extracted JSON:', e.message);
    process.exit(1);
}

// Filter for no-unused-vars in specific directories
const TARGET_RULE = '@typescript-eslint/no-unused-vars';
const IGNORE_PATTERN = /\/tests\/|\.test\.|\.spec\.|scripts\/|analyze-lint/;

const unusedVarFiles = [];

report.forEach(file => {
    const unusedVars = file.messages.filter(m => m.ruleId === TARGET_RULE);
    if (unusedVars.length > 0 && !IGNORE_PATTERN.test(file.filePath)) {
        unusedVarFiles.push({
            path: file.filePath,
            count: unusedVars.length,
            vars: unusedVars.map(m => m.message)
        });
    }
});

unusedVarFiles.sort((a, b) => b.count - a.count);

console.log('\n--- Unused Vars Analysis (Production Only) ---');
console.log(`Total Files: ${unusedVarFiles.length}`);
console.log('Top 20 Files:');

unusedVarFiles.slice(0, 20).forEach(f => {
    const shortPath = f.path.split('HHR-entornoprueba enero 2026/')[1] || f.path;
    console.log(`[${f.count}] ${shortPath}`);
});
