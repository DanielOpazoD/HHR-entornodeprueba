/**
 * ExamPatientInfo Component Tests
 * Tests for the patient information display component.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExamPatientInfo } from '@/components/exam-request/ExamPatientInfo';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

describe('ExamPatientInfo', () => {
  const mockPatient: PatientData = {
    bedId: 'R1',
    patientName: 'Juan Pérez García',
    rut: '12.345.678-9',
    age: '45 años',
    birthDate: '1980-06-15',
    pathology: 'Neumonía adquirida en comunidad',
    status: PatientStatus.ESTABLE,
    admissionDate: '2026-01-01',
    insurance: 'Fonasa',
    biologicalSex: 'Masculino',
    specialty: Specialty.MEDICINA,
    admissionOrigin: 'Urgencias',
    origin: 'Residente',
    devices: [],
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    hasWristband: true,
    surgicalComplication: false,
    isUPC: false,
  };

  describe('Rendering', () => {
    it('should render patient name', () => {
      render(<ExamPatientInfo patient={mockPatient} />);

      expect(screen.getByText('Juan Pérez García')).toBeInTheDocument();
    });

    it('shows only the first three given names before the surnames', () => {
      render(
        <ExamPatientInfo
          patient={{
            ...mockPatient,
            patientName: 'Ana María de los Ángeles Valentina Rosa Elena Hotu Pakarati',
            firstName: 'Ana María de los Ángeles Valentina Rosa Elena',
            lastName: 'Hotu',
            secondLastName: 'Pakarati',
          }}
        />
      );

      expect(screen.getByText('Ana María de los Ángeles Hotu Pakarati')).toBeInTheDocument();
    });

    it('should render patient RUT', () => {
      render(<ExamPatientInfo patient={mockPatient} />);

      expect(screen.getByText('12.345.678-9')).toBeInTheDocument();
    });

    it('should render patient pathology', () => {
      render(<ExamPatientInfo patient={mockPatient} />);

      expect(screen.getByText('Neumonía adquirida en comunidad')).toBeInTheDocument();
    });

    it('should render formatted birth date', () => {
      render(<ExamPatientInfo patient={mockPatient} />);

      // formatDateDDMMYYYY should convert 1980-06-15 to 15-06-1980
      expect(screen.getByText('15-06-1980')).toBeInTheDocument();
    });

    it('should render the census record date instead of the computer date', () => {
      render(<ExamPatientInfo patient={mockPatient} recordDate="2026-04-30" />);

      expect(screen.getByText('FECHA:')).toBeInTheDocument();
      expect(screen.getByText('30-04-2026')).toBeInTheDocument();
    });
  });

  describe('Label Display', () => {
    it('should render all field labels', () => {
      render(<ExamPatientInfo patient={mockPatient} />);

      expect(screen.getByText('NOMBRES Y APELLIDOS:')).toBeInTheDocument();
      expect(screen.getByText('RUT:')).toBeInTheDocument();
      expect(screen.getByText('FECHA DE NACIMIENTO:')).toBeInTheDocument();
      expect(screen.getByText('FECHA:')).toBeInTheDocument();
      expect(screen.getByText('DIAGNOSTICO:')).toBeInTheDocument();
    });

    it('should render FICHA label', () => {
      render(<ExamPatientInfo patient={mockPatient} />);

      expect(screen.getByText('FICHA:')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle patient with no birth date', () => {
      const patientNoBirthDate = { ...mockPatient, birthDate: undefined };
      render(<ExamPatientInfo patient={patientNoBirthDate} />);

      // Should show dash for missing date
      expect(screen.getByText('-')).toBeInTheDocument();
    });

    it('should handle patient with empty pathology', () => {
      const patientNoPathology = { ...mockPatient, pathology: '' };
      const { container } = render(<ExamPatientInfo patient={patientNoPathology} />);

      // Component should still render without crashing
      expect(container).toBeInTheDocument();
    });
  });
});
