#!/bin/bash

# ============================================
# HHR Project Cleanup Script
# Removes temporary coverage and test files
# ============================================

echo "🧹 HHR Project Cleanup Script"
echo "=============================="

# Count files before cleanup
BEFORE=$(ls -1 coverage_*.txt coverage_*.json test_*.txt test_*.json tsc_*.txt final_coverage*.txt 2>/dev/null | wc -l)

# Remove coverage files
echo "📊 Removing coverage report files..."
rm -f coverage_*.txt
rm -f coverage_*.json
rm -f coverage-report.json
rm -f final_coverage*.txt
rm -f hook_coverage.txt
rm -f useBedOps_coverage.txt
rm -f usePatRow_coverage.txt
rm -f usePatVal_coverage.txt

# Remove test result files
echo "🧪 Removing test result files..."
rm -f test_*.txt
rm -f test_*.json

# Remove TypeScript check output
echo "📝 Removing TypeScript check files..."
rm -f tsc_*.txt
rm -f tsc_*.log

# Count files after cleanup
AFTER=$(ls -1 coverage_*.txt coverage_*.json test_*.txt test_*.json tsc_*.txt final_coverage*.txt 2>/dev/null | wc -l)

echo ""
echo "✅ Cleanup complete!"
echo "   Removed $((BEFORE - AFTER)) temporary files"
echo ""
echo "💡 Tip: Run 'npm run clean' to execute this script anytime"
