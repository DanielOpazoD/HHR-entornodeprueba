export const EXAM_REQUEST_PRINT_STYLES = `
	@media print {
	    @page {
	        margin: 0;
    }

    html, body {
        height: auto !important;
        overflow: visible !important;
    }

	    body > * {
	        display: none !important;
	    }

	    body > [data-printable-modal-root] {
	        display: block !important;
	        visibility: visible !important;
	        position: static !important;
	        inset: auto !important;
	        min-height: auto !important;
	        margin: 0 !important;
	        padding: 0 !important;
	        overflow: visible !important;
	        background: white !important;
	        backdrop-filter: none !important;
	        animation: none !important;
	    }

	    [data-printable-modal-root] [data-module="exam-request"],
	    [data-printable-modal-root] [data-module="exam-request"] > div {
	        display: block !important;
	        margin: 0 !important;
	        padding: 0 !important;
	        overflow: visible !important;
        background: transparent !important;
    }

	    [data-printable-modal-root] [data-module="exam-request"] {
	        background: white !important;
	        padding: 0 !important;
	        margin: 0 !important;
	        height: auto !important;
	        width: 100% !important;
	        max-width: none !important;
	        overflow: visible !important;
	        backdrop-filter: none !important;
	        animation: none !important;
	    }

	    [data-printable-modal-root] [data-module="exam-request"] > div {
	        display: block !important;
	        position: static !important;
	        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        max-width: none !important;
        border: none !important;
        box-shadow: none !important;
        background: white !important;
        border-radius: 0 !important;
	        animation: none !important;
	    }

	    [data-printable-modal-root] [data-module="exam-request"] > div:first-child,
	    #modal-title,
	    [data-printable-modal-root] [data-module="exam-request"] h3,
	    [data-printable-modal-root] [data-module="exam-request"] button,
	    [data-printable-modal-root] [data-module="exam-request"] .sticky,
	    .modal-header,
	    .print\\:hidden {
	        display: none !important;
        height: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        overflow: hidden !important;
        visibility: hidden !important;
	        opacity: 0 !important;
	    }

	    [data-printable-modal-root] [data-module="exam-request"] .overflow-y-auto,
	    [data-printable-modal-root] [data-module="exam-request"] .p-6 {
	        padding: 0 !important;
	        margin: 0 !important;
	        overflow: visible !important;
        max-height: none !important;
        width: 100% !important;
    }

    #exam-request-form {
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 10mm !important;
        border: none !important;
        box-shadow: none !important;
        color: black !important;
    }

    .font-bold {
        color: black !important;
        -webkit-print-color-adjust: exact !important;
    }

    * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
    }
}
`;
