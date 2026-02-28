export interface RawDocument {
  DOC_ID: string;
  FILE_NAME: string;
  DOC_TYPE: "TIMESHEET" | "SUBSUB_INVOICE" | "MY_INVOICE";
  STAGE_PATH: string;
  OCR_TEXT: string | null;
  INGESTED_TS: string;
  PROCESSED: boolean;
}

export interface ExtractedLine {
  LINE_ID: string;
  DOC_ID: string;
  WORKER: string | null;
  WORK_DATE: string | null;
  PROJECT: string | null;
  PROJECT_CODE: string | null;
  HOURS: number | null;
  EXTRACTION_CONFIDENCE: number | null;
  RAW_TEXT: string | null;
  EXTRACTED_AT: string;
}

export interface ValidationResult {
  RESULT_ID: string;
  DOC_ID: string;
  LINE_ID: string | null;
  CHECK_NAME: string;
  STATUS: "PASS" | "FAIL" | "WARN";
  MESSAGE: string | null;
  CHECKED_AT: string;
}

export interface LedgerApproval {
  APPROVAL_ID: string;
  LINE_ID: string;
  DOC_ID: string;
  DECISION: "APPROVED" | "REJECTED" | "CORRECTED";
  CORRECTED_HOURS: number | null;
  CORRECTED_DATE: string | null;
  CORRECTED_PROJECT: string | null;
  ANALYST_NOTE: string | null;
  DECIDED_AT: string;
}

export interface ReconSummary {
  RECON_ID: string;
  PERIOD_MONTH: string;
  WORKER: string | null;
  APPROVED_HOURS: number;
  HOURLY_RATE: number | null;
  COMPUTED_AMOUNT: number;
  INVOICE_AMOUNT: number | null;
  VARIANCE: number | null;
  VARIANCE_PCT: number | null;
  STATUS: string | null;
  CREATED_AT: string;
}

export interface AccuracyRow {
  DOC_ID: string;
  WORKER: string | null;
  WORK_DATE: string | null;
  EXTRACTED_HOURS: number | null;
  GT_HOURS: number | null;
  HOURS_DELTA: number | null;
  EXTRACTION_CONFIDENCE: number | null;
}

export interface GroundTruthLine {
  GT_ID: string;
  DOC_ID: string;
  WORKER: string;
  WORK_DATE: string;
  PROJECT: string | null;
  PROJECT_CODE: string | null;
  HOURS: number;
  ENTERED_BY: string | null;
  ENTERED_AT: string;
}

export interface TrustedLedgerRow {
  LINE_ID: string;
  DOC_ID: string;
  WORKER: string | null;
  WORK_DATE: string | null;
  PROJECT: string | null;
  PROJECT_CODE: string | null;
  HOURS: number;
  DECISION: "APPROVED" | "CORRECTED";
  CORRECTED_HOURS: number | null;
  ANALYST_NOTE: string | null;
}

export interface PipelineStatus {
  DOC_ID: string;
  FILE_NAME: string;
  DOC_TYPE: string;
  OCR_DONE: boolean;
  EXTRACTION_DONE: boolean;
  VALIDATION_DONE: boolean;
  APPROVAL_DONE: boolean;
}

export interface ProjectCodeMerge {
  MERGE_ID: string;
  SOURCE_CODE: string;
  TARGET_CODE: string;
  SOURCE_NAME: string | null;
  TARGET_NAME: string | null;
  MERGE_REASON: string | null;
  MERGED_BY: string | null;
  MERGED_AT: string;
}

export interface CuratedProject {
  PROJECT_CODE: string;
  PROJECT_NAME: string | null;
  CONFIRMED: boolean;
  IS_ACTIVE: boolean;
  FIRST_SEEN: string | null;
  ADDED_AT: string;
  CURATION_SOURCE: "auto_extracted" | "fuzzy_match" | "manual";
  CURATION_NOTE: string | null;
  MATCHED_FROM_CODE: string | null;
}

export interface CuratedWorker {
  WORKER_KEY: string;
  DISPLAY_NAME: string | null;
  CONFIRMED: boolean;
  IS_ACTIVE: boolean;
  FIRST_SEEN: string | null;
  ADDED_AT: string;
  CURATION_SOURCE: "auto_extracted" | "fuzzy_match" | "manual";
  CURATION_NOTE: string | null;
}

export interface ProjectCodeSuspect {
  DOC_ID: string;
  LINE_ID: string;
  EXTRACTED_CODE: string;
  MASTER_CODE: string;
  MASTER_NAME: string | null;
  EDIT_DIST: number;
}

export interface MergeProvenanceRow {
  CANONICAL_CODE: string;
  CANONICAL_NAME: string | null;
  CANONICAL_ACTIVE: boolean;
  SOURCE_CODE: string;
  SOURCE_NAME: string | null;
  MERGE_REASON: string | null;
  MERGED_BY: string | null;
  MERGED_AT: string;
  LINES_AFFECTED: number;
}

export interface WorkerNameSuspect {
  DOC_ID: string;
  LINE_ID: string;
  EXTRACTED_WORKER: string;
  WORKER_KEY: string;
  MASTER_DISPLAY_NAME: string | null;
  EDIT_DIST: number;
}

// Combined type for approval page
export interface ApprovalLineRow extends ExtractedLine {
  DECISION: "APPROVED" | "REJECTED" | "CORRECTED" | null;
  CORRECTED_HOURS: number | null;
  CORRECTED_DATE: string | null;
  CORRECTED_PROJECT: string | null;
  ANALYST_NOTE: string | null;
  GT_HOURS: number | null;
}
