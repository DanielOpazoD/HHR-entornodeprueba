import type { TableColumnConfig } from '@/context/TableConfigContext';

export type CensusHeaderColumnKey = Exclude<keyof TableColumnConfig, 'actions'>;

export interface CensusHeaderColumnDefinition {
    key: CensusHeaderColumnKey;
    label: string;
    title?: string;
    className?: string;
}

export const CENSUS_HEADER_COLUMNS: readonly CensusHeaderColumnDefinition[] = [
    { key: 'bed', label: 'Cama' },
    { key: 'type', label: 'Tipo' },
    { key: 'name', label: 'Nombre Paciente' },
    { key: 'rut', label: 'RUT' },
    { key: 'age', label: 'Edad' },
    { key: 'diagnosis', label: 'Diagnóstico' },
    { key: 'specialty', label: 'Esp' },
    { key: 'status', label: 'Estado' },
    { key: 'admission', label: 'Ingreso' },
    { key: 'dmi', label: 'DMI', title: 'Dispositivos médicos invasivos' },
    { key: 'cqx', label: 'C.QX', title: 'Comp. Quirurgica' },
    { key: 'upc', label: 'UPC', className: 'border-r-0' }
] as const;
