import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = await r.json();
  if (!r.ok) throw new Error(body?.error ?? r.statusText);
  return body as T;
}

import type {
  RawDocument,
  ExtractedLine,
  ValidationResult,
  PipelineStatus,
  AccuracyRow,
  GroundTruthLine,
  ApprovalLineRow,
  TrustedLedgerRow,
  ReconSummary,
} from "@/lib/types";

// ── Documents ────────────────────────────────────────────────────────────────

export function useDocuments() {
  return useQuery<RawDocument[]>({
    queryKey: ["documents"],
    queryFn: () => fetchJson<RawDocument[]>("/api/documents"),
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) =>
      fetch("/api/documents", { method: "POST", body: formData }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error));
        return r.json();
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });
}

export function useRunOcr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) =>
      fetch(`/api/documents/${docId}/ocr`, { method: "POST" }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error));
        return r.json();
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });
}

// ── Extraction ───────────────────────────────────────────────────────────────

export function useExtractedLines() {
  return useQuery<ExtractedLine[]>({
    queryKey: ["extraction"],
    queryFn: () => fetchJson<ExtractedLine[]>("/api/extraction"),
  });
}

export function useRunExtraction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) =>
      fetch(`/api/extraction/${docId}`, { method: "POST" }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error));
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["extraction"] });
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

// ── Validation ───────────────────────────────────────────────────────────────

export function useValidation() {
  return useQuery<{ results: ValidationResult[]; pipeline: PipelineStatus[] }>({
    queryKey: ["validation"],
    queryFn: () =>
      fetchJson<{ results: ValidationResult[]; pipeline: PipelineStatus[] }>(
        "/api/validation"
      ),
  });
}

export function useRunValidation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetch("/api/validation", { method: "POST" }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error));
        return r.json();
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["validation"] }),
  });
}

// ── Accuracy ─────────────────────────────────────────────────────────────────

export function useAccuracy() {
  return useQuery<AccuracyRow[]>({
    queryKey: ["accuracy"],
    queryFn: () => fetchJson<AccuracyRow[]>("/api/accuracy"),
  });
}

// ── Ground Truth ─────────────────────────────────────────────────────────────

export function useGroundTruth(docId: string | null) {
  return useQuery<GroundTruthLine[]>({
    queryKey: ["ground-truth", docId],
    queryFn: () => fetchJson<GroundTruthLine[]>(`/api/ground-truth/${docId}`),
    enabled: docId !== null,
  });
}

export function useSaveGroundTruth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      docId,
      lines,
    }: {
      docId: string;
      lines: Omit<GroundTruthLine, "GT_ID" | "ENTERED_AT">[];
    }) =>
      fetch(`/api/ground-truth/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lines),
      }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error));
        return r.json();
      }),
    onSuccess: (_d, { docId }) => {
      qc.invalidateQueries({ queryKey: ["ground-truth", docId] });
      qc.invalidateQueries({ queryKey: ["accuracy"] });
    },
  });
}

// ── Approvals ────────────────────────────────────────────────────────────────

export function useApprovalLines(docId: string | null) {
  return useQuery<ApprovalLineRow[]>({
    queryKey: ["approvals", docId],
    queryFn: () => fetchJson<ApprovalLineRow[]>(`/api/approvals/${docId}`),
    enabled: docId !== null,
  });
}

export function useDecideLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      docId: string;
      line_id: string;
      decision: "APPROVED" | "REJECTED" | "CORRECTED";
      corrected_hours?: number | null;
      corrected_date?: string | null;
      corrected_project?: string | null;
      analyst_note?: string | null;
    }) =>
      fetch(`/api/approvals/${payload.docId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error));
        return r.json();
      }),
    onSuccess: (_d, { docId }) => {
      qc.invalidateQueries({ queryKey: ["approvals", docId] });
      qc.invalidateQueries({ queryKey: ["trusted-ledger"] });
    },
  });
}

export function useApproveAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) =>
      fetch(`/api/approvals/${docId}/bulk`, { method: "POST" }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error));
        return r.json();
      }),
    onSuccess: (_d, docId) => {
      qc.invalidateQueries({ queryKey: ["approvals", docId] });
      qc.invalidateQueries({ queryKey: ["trusted-ledger"] });
    },
  });
}

export function useClearApprovals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) =>
      fetch(`/api/approvals/${docId}/bulk`, { method: "DELETE" }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error));
        return r.json();
      }),
    onSuccess: (_d, docId) => {
      qc.invalidateQueries({ queryKey: ["approvals", docId] });
      qc.invalidateQueries({ queryKey: ["trusted-ledger"] });
    },
  });
}

// ── Trusted Ledger ───────────────────────────────────────────────────────────

export function useTrustedLedger() {
  return useQuery<TrustedLedgerRow[]>({
    queryKey: ["trusted-ledger"],
    queryFn: () => fetchJson<TrustedLedgerRow[]>("/api/trusted-ledger"),
  });
}

// ── Reconciliation ────────────────────────────────────────────────────────────

export function useReconciliation() {
  return useQuery<{
    summary: ReconSummary[];
    ledger: TrustedLedgerRow[];
    extracted: ExtractedLine[];
  }>({
    queryKey: ["reconciliation"],
    queryFn: () =>
      fetchJson<{
        summary: ReconSummary[];
        ledger: TrustedLedgerRow[];
        extracted: ExtractedLine[];
      }>("/api/reconciliation"),
  });
}

export function useRunReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rate: number) =>
      fetch("/api/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rate }),
      }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error));
        return r.json();
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reconciliation"] }),
  });
}
