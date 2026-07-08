import React, { useState } from 'react';
import { useAuditData } from '@/hooks/useAuditData';
import { AuditHeader } from './internal/audit/AuditHeader';
import { AuditStatsDashboard } from './internal/audit/AuditStatsDashboard';
import { AuditFilters } from './internal/audit/AuditFilters';
import { AuditTable } from './internal/audit/AuditTable';
import { AccessRestricted } from './internal/AccessRestricted';
import { AuditSectionTabs } from './internal/audit/AuditSectionTabs';
import { AuditDynamicPanels } from './internal/audit/AuditDynamicPanels';
import { useAuditExport } from './hooks/useAuditExport';
import { useAuditConsolidation } from './hooks/useAuditConsolidation';
import { AUDIT_CLINICAL_SECTIONS, AUDIT_SYSTEM_SECTIONS } from '@/services/admin/auditViewConfig';
import { isAuditTableSection } from '@/services/admin/auditMetrics';
import {
  canAccessAuditSensitivePanels,
  canAccessAuditView,
  canExportAuditData,
} from '@/services/admin/auditAccessPolicy';
import { useAuth } from '@/context/AuthContext';

export const AuditView: React.FC = () => {
  const { role } = useAuth();

  // Use extracted hook for all audit data management
  const {
    logs,
    filteredLogs,
    displayLogs,
    paginatedLogs,
    patientPackages,
    paginatedPatientPackages,
    patientPackageFilterOptions,
    patientPackageIntentOptions,
    stats,
    loading,
    fetchLimit,
    canLoadMoreLogs,
    filters,
    setSearchTerm,
    setFilterAction,
    setStartDate,
    setEndDate,
    applyDateRangePreset,
    setActiveSection,
    setCompactView,
    setGroupedView,
    setActivePatientPackageFilter,
    setActivePatientPackageIntent,
    expandedRows,
    toggleRow,
    fetchLogs,
    loadMoreLogs,
    sections,
    currentPage,
    totalPages,
    setCurrentPage,
    ITEMS_PER_PAGE,
  } = useAuditData();

  const {
    searchTerm,
    filterAction,
    startDate,
    endDate,
    activeSection,
    compactView,
    groupedView,
    activePatientPackageFilter,
    activePatientPackageIntent,
  } = filters;

  // Export and dialog state
  const [, setShowComplianceInfo] = useState(false);

  const canSeeSensitivePanels = canAccessAuditSensitivePanels(role);
  const canExport = canExportAuditData(role);

  // Export hook
  const { isExporting, handleExcelExport, handlePdfExport } = useAuditExport({
    filteredLogs,
    patientPackages,
    exportMode: groupedView ? 'patient-packages' : 'raw-events',
    stats,
    startDate,
    endDate,
  });

  const { isConsolidating: consolidating, handleConsolidate } = useAuditConsolidation({
    onConsolidated: fetchLogs,
  });

  if (!canAccessAuditView(role)) {
    return <AccessRestricted />;
  }

  return (
    <div className="space-y-6 animate-fade-in pb-24 font-sans max-w-[1400px] mx-auto">
      {/* Header */}
      <AuditHeader
        onShowCompliance={() => setShowComplianceInfo(true)}
        onExport={canExport ? handleExcelExport : () => {}}
        onRefresh={fetchLogs}
        onConsolidate={canSeeSensitivePanels ? handleConsolidate : undefined}
        isExporting={isExporting}
        isLoading={loading}
        isConsolidating={consolidating}
        hasLogs={canExport && filteredLogs.length > 0}
        isAdmin={canSeeSensitivePanels}
      />

      {/* Dashboards */}
      <AuditStatsDashboard stats={stats} logs={logs} />

      {/* Navigation Tabs - Categorized */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <AuditSectionTabs
          sections={AUDIT_CLINICAL_SECTIONS}
          sectionConfig={sections}
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          variant="clinical"
        />
        <AuditSectionTabs
          sections={AUDIT_SYSTEM_SECTIONS.filter(
            key => canSeeSensitivePanels || key === 'SESSIONS'
          )}
          sectionConfig={sections}
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          variant="system"
        />
      </div>

      {/* Filters */}
      <AuditFilters
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        filterAction={filterAction}
        onFilterActionChange={setFilterAction}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        onDateRangePreset={applyDateRangePreset}
      />

      <AuditDynamicPanels
        activeSection={activeSection}
        logs={filteredLogs}
        canSeeSensitivePanels={canSeeSensitivePanels}
      />

      {/* Main Data Table */}
      {isAuditTableSection(activeSection) && (
        <AuditTable
          filteredLogs={filteredLogs}
          displayLogsCount={displayLogs.length}
          paginatedLogs={paginatedLogs}
          patientPackages={patientPackages}
          paginatedPatientPackages={paginatedPatientPackages}
          patientPackageFilterOptions={patientPackageFilterOptions}
          patientPackageIntentOptions={patientPackageIntentOptions}
          activePatientPackageFilter={activePatientPackageFilter}
          onPatientPackageFilterChange={setActivePatientPackageFilter}
          activePatientPackageIntent={activePatientPackageIntent}
          onPatientPackageIntentChange={setActivePatientPackageIntent}
          loading={loading}
          compactView={compactView}
          setCompactView={setCompactView}
          groupedView={groupedView}
          setGroupedView={setGroupedView}
          expandedRows={expandedRows}
          toggleRow={toggleRow}
          onPdfExport={handlePdfExport}
          onExcelExport={handleExcelExport}
          isExporting={isExporting}
          fetchLimit={fetchLimit}
          canLoadMoreLogs={canLoadMoreLogs}
          onLoadMoreLogs={loadMoreLogs}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          itemsPerPage={ITEMS_PER_PAGE}
        />
      )}
    </div>
  );
};
