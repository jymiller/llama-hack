"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Upload, Play, Cpu, CheckCircle, Circle, Trash2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/metric-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDocuments,
  useExtractedLines,
  useUploadDocument,
  useDeleteDocument,
  useRunExtraction,
  useRunExtractionAll,
} from "@/hooks/queries";
import { RawDocument, ExtractedLine } from "@/lib/types";

const DOC_TYPES = ["TIMESHEET", "SUBSUB_INVOICE", "MY_INVOICE"] as const;
const DOC_TYPE_LABELS: Record<string, string> = {
  TIMESHEET: "Timesheet",
  SUBSUB_INVOICE: "Subcontract Invoice",
  MY_INVOICE: "My Invoice",
};

function DocCard({
  doc,
  lines,
  selected,
  onClick,
  onExtract,
  onDelete,
  extracting,
}: {
  doc: RawDocument;
  lines: ExtractedLine[];
  selected: boolean;
  onClick: () => void;
  onExtract: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  extracting: boolean;
}) {
  const extracted = lines.length > 0;
  const totalHours = extracted ? lines.reduce((s, l) => s + (l.HOURS ?? 0), 0) : null;

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border cursor-pointer transition-all overflow-hidden ${
        selected
          ? "border-yellow-400 ring-2 ring-yellow-200"
          : extracted
          ? "border-green-400 ring-1 ring-green-100"
          : "border-slate-200 hover:border-slate-300 hover:shadow-sm"
      }`}
    >
      {/* Thumbnail */}
      <div className="relative bg-slate-100 h-40 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/documents/${doc.DOC_ID}/image`}
          alt={doc.DOC_ID}
          className="w-full h-full object-cover object-top"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div className={`absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
          extracted ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"
        }`}>
          {extracted ? <CheckCircle className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
          {extracted ? `${totalHours!.toFixed(1)}h` : "Not extracted"}
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 bg-white">
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{doc.DOC_ID}</p>
            <p className="text-[10px] text-slate-400 truncate">
              {doc.INGESTED_TS ? new Date(doc.INGESTED_TS).toLocaleDateString() : ""}
              {" · "}
              <span>{DOC_TYPE_LABELS[doc.DOC_TYPE] ?? doc.DOC_TYPE.replace(/_/g, " ")}</span>
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onExtract}
              disabled={extracting}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors text-[10px] font-medium"
              title={extracted ? "Re-extract" : "Extract"}
            >
              {extracting
                ? <RefreshCw className="h-3 w-3 animate-spin" />
                : <Play className="h-3 w-3" />}
              Extract
            </button>
            <button
              onClick={onDelete}
              className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              title="Delete document"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  const { data: docs = [] } = useDocuments();
  const { data: lines = [] } = useExtractedLines();
  const upload = useUploadDocument();
  const deleteDoc = useDeleteDocument();
  const runExtraction = useRunExtraction();
  const runAll = useRunExtractionAll();

  const [docType, setDocType] = useState<string>("TIMESHEET");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [confirmDoc, setConfirmDoc] = useState<RawDocument | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const linesByDoc = lines.reduce<Record<string, ExtractedLine[]>>((acc, l) => {
    if (!acc[l.DOC_ID]) acc[l.DOC_ID] = [];
    acc[l.DOC_ID].push(l);
    return acc;
  }, {});

  const selectedLines = selectedDocId ? (linesByDoc[selectedDocId] ?? []) : [];
  const selectedDoc = docs.find((d) => String(d.DOC_ID) === selectedDocId);
  const extractedDocs = docs.filter((d) => (linesByDoc[String(d.DOC_ID)]?.length ?? 0) > 0);

  function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("doc_type", docType);
    toast.promise(upload.mutateAsync(fd), {
      loading: "Uploading…",
      success: "Document uploaded",
      error: (err) => `Upload failed: ${err}`,
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleExtract(docId: string) {
    setExtractingId(docId);
    toast.promise(
      runExtraction.mutateAsync(docId).finally(() => setExtractingId(null)),
      {
        loading: `Extracting ${docId}…`,
        success: "Extraction complete",
        error: (e) => `Extraction failed: ${e}`,
      }
    );
  }

  function handleExtractAll() {
    toast.promise(runAll.mutateAsync(), {
      loading: "Extracting all documents…",
      success: (d) => d.message ?? "All extractions complete",
      error: (e) => `Extraction failed: ${e}`,
    });
  }

  function handleDelete(doc: RawDocument) {
    if (selectedDocId === String(doc.DOC_ID)) setSelectedDocId(null);
    toast.promise(deleteDoc.mutateAsync(doc.DOC_ID), {
      loading: `Deleting ${doc.DOC_ID}…`,
      success: `${doc.DOC_ID} deleted`,
      error: (err) => `Delete failed: ${err}`,
    });
  }

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Upload timesheet and invoice files, then extract structured data using Claude."
        actions={
          <Button onClick={handleExtractAll} disabled={runAll.isPending || docs.length === 0}>
            <Cpu className="h-4 w-4 mr-2" />
            {runAll.isPending ? "Extracting…" : "Extract All"}
          </Button>
        }
      />

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <MetricCard
          title="Documents"
          value={`${extractedDocs.length} / ${docs.length}`}
          description={extractedDocs.length === docs.length && docs.length > 0 ? "All extracted" : `${docs.length - extractedDocs.length} pending`}
          deltaPositive={extractedDocs.length === docs.length && docs.length > 0}
        />
        <MetricCard title="Extracted Lines" value={lines.length} />
      </div>

      {/* Upload form */}
      <form
        onSubmit={handleUpload}
        className="flex items-end gap-3 mb-6 p-4 border rounded-lg bg-muted/30"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">File</label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            required
            className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:cursor-pointer"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Document Type</label>
          <Select value={docType} onValueChange={setDocType}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOC_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t] ?? t.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={upload.isPending}>
          <Upload className="h-4 w-4 mr-2" />
          Upload
        </Button>
      </form>

      {/* Document grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-6">
        {docs.map((doc) => (
          <DocCard
            key={doc.DOC_ID}
            doc={doc}
            lines={linesByDoc[String(doc.DOC_ID)] ?? []}
            selected={selectedDocId === String(doc.DOC_ID)}
            onClick={() => setSelectedDocId((prev) => prev === String(doc.DOC_ID) ? null : String(doc.DOC_ID))}
            onExtract={(e) => { e.stopPropagation(); handleExtract(String(doc.DOC_ID)); }}
            onDelete={(e) => { e.stopPropagation(); setConfirmDoc(doc); }}
            extracting={extractingId === String(doc.DOC_ID)}
          />
        ))}
      </div>

      {/* Detail panel */}
      {selectedDocId && selectedDoc && (
        <div className="rounded-lg border border-blue-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-blue-50 border-b border-blue-200">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-blue-800">{selectedDocId}</span>
              <Badge className={
                selectedDoc.DOC_TYPE === "TIMESHEET" ? "bg-blue-100 text-blue-800"
                : selectedDoc.DOC_TYPE === "MY_INVOICE" ? "bg-purple-100 text-purple-800"
                : "bg-orange-100 text-orange-800"
              }>{selectedDoc.DOC_TYPE.replace(/_/g, " ")}</Badge>
              {selectedLines.length > 0 && (
                <span className="text-xs text-green-700 font-medium">{selectedLines.length} lines extracted</span>
              )}
            </div>
            <button onClick={() => setSelectedDocId(null)} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
          </div>

          <div className="flex min-h-[320px]">
            {/* Image */}
            <div className="w-72 shrink-0 border-r border-slate-200 bg-slate-50 flex items-start justify-center p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/documents/${selectedDocId}/image`}
                alt={selectedDocId}
                className="max-w-full max-h-[480px] object-contain rounded shadow-sm"
              />
            </div>

            {/* Extracted lines */}
            <div className="flex-1 overflow-auto">
              {selectedLines.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                  <p className="text-sm">No extracted lines yet.</p>
                  <Button size="sm" onClick={() => handleExtract(selectedDocId)} disabled={extractingId === selectedDocId}>
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                    Extract now
                  </Button>
                </div>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-100">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600 border-b border-slate-200">Worker</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600 border-b border-slate-200">Date</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600 border-b border-slate-200">Project code</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600 border-b border-slate-200 max-w-[200px]">Project</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600 border-b border-slate-200">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedLines.map((line, i) => {
                      const lowConf = (line.EXTRACTION_CONFIDENCE ?? 1) <= 0.75;
                      return (
                        <tr key={line.LINE_ID} className={lowConf ? "bg-amber-50" : i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                          <td className={`px-3 py-2 border-b border-slate-100 ${lowConf ? "border-l-2 border-l-amber-400" : ""}`}>{line.WORKER ?? "—"}</td>
                          <td className="px-3 py-2 border-b border-slate-100 whitespace-nowrap">{line.WORK_DATE ?? "—"}</td>
                          <td className="px-3 py-2 border-b border-slate-100 font-mono text-[10px] text-blue-700">{line.PROJECT_CODE ?? "—"}</td>
                          <td className="px-3 py-2 border-b border-slate-100 max-w-[200px]">
                            <div className="truncate text-[10px] text-slate-500" title={line.PROJECT ?? ""}>{line.PROJECT ?? "—"}</div>
                          </td>
                          <td className="px-3 py-2 border-b border-slate-100 text-right font-mono">{line.HOURS?.toFixed(1) ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 font-semibold">
                      <td colSpan={4} className="px-3 py-2 text-right text-slate-600">Total</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {selectedLines.reduce((s, l) => s + (l.HOURS ?? 0), 0).toFixed(1)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={confirmDoc !== null}
        onOpenChange={(open) => { if (!open) setConfirmDoc(null); }}
        title="Delete document?"
        description={`This will permanently remove "${confirmDoc?.DOC_ID}" from the stage and delete all extracted lines, approvals, and ground truth data associated with it. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => { if (confirmDoc) handleDelete(confirmDoc); setConfirmDoc(null); }}
      />
    </div>
  );
}
