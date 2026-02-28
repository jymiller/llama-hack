"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Play, Cpu, CheckCircle, Circle, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/metric-card";
import { Button } from "@/components/ui/button";
import {
  useDocuments,
  useExtractedLines,
  useRunExtraction,
  useRunExtractionAll,
} from "@/hooks/queries";
import { RawDocument, ExtractedLine } from "@/lib/types";

function DocCard({
  doc,
  lines,
  selected,
  onClick,
  onExtract,
  extracting,
}: {
  doc: RawDocument;
  lines: ExtractedLine[];
  selected: boolean;
  onClick: () => void;
  onExtract: (e: React.MouseEvent) => void;
  extracting: boolean;
}) {
  const extracted = lines.length > 0;
  const avgConf =
    extracted
      ? lines.reduce((s, l) => s + (l.EXTRACTION_CONFIDENCE ?? 0), 0) / lines.length
      : null;
  const confColor =
    avgConf == null ? "" : avgConf >= 0.8 ? "text-green-600" : avgConf >= 0.6 ? "text-yellow-600" : "text-red-600";

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border cursor-pointer transition-all overflow-hidden ${
        selected
          ? "border-blue-500 ring-2 ring-blue-200"
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
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        {/* Extraction status badge */}
        <div className={`absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
          extracted ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"
        }`}>
          {extracted ? <CheckCircle className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
          {extracted ? `${lines.length} lines` : "Not extracted"}
        </div>
      </div>

      {/* Card footer */}
      <div className="px-3 py-2 bg-white">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{doc.DOC_ID}</p>
            <p className="text-[10px] text-slate-400 truncate">{doc.DOC_TYPE}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {avgConf != null && (
              <span className={`text-xs font-mono ${confColor}`}>
                {(avgConf * 100).toFixed(0)}%
              </span>
            )}
            <Button
              size="sm"
              variant={extracted ? "outline" : "default"}
              className="h-6 text-[11px] px-2"
              onClick={onExtract}
              disabled={extracting}
              title={extracted ? "Re-extract this document" : "Extract this document"}
            >
              {extracting ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ExtractionPage() {
  const { data: docs = [] } = useDocuments();
  const { data: lines = [] } = useExtractedLines();
  const runExtraction = useRunExtraction();
  const runAll = useRunExtractionAll();
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [extractingId, setExtractingId] = useState<string | null>(null);

  // Group lines by doc
  const linesByDoc = lines.reduce<Record<string, ExtractedLine[]>>((acc, l) => {
    if (!acc[l.DOC_ID]) acc[l.DOC_ID] = [];
    acc[l.DOC_ID].push(l);
    return acc;
  }, {});

  const selectedLines = selectedDocId ? (linesByDoc[selectedDocId] ?? []) : [];
  const selectedDoc = docs.find((d) => String(d.DOC_ID) === selectedDocId);

  const extractedDocs = docs.filter((d) => (linesByDoc[String(d.DOC_ID)]?.length ?? 0) > 0);
  const totalLines = lines.length;
  const avgConfidence =
    lines.length > 0
      ? lines.reduce((s, l) => s + (l.EXTRACTION_CONFIDENCE ?? 0), 0) / lines.length
      : 0;

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

  function handleCardClick(docId: string) {
    setSelectedDocId((prev) => (prev === docId ? null : docId));
  }

  return (
    <div>
      <PageHeader
        title="Extraction"
        description="Run Claude multimodal extraction on uploaded documents. Click a document to review its extracted rows."
        actions={
          <Button onClick={handleExtractAll} disabled={runAll.isPending || docs.length === 0}>
            <Cpu className="h-4 w-4 mr-2" />
            {runAll.isPending ? "Extracting all…" : "Extract All"}
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-4 mb-8">
        <MetricCard
          title="Documents"
          value={`${extractedDocs.length} / ${docs.length}`}
          description={extractedDocs.length === docs.length ? "All extracted" : `${docs.length - extractedDocs.length} pending`}
          deltaPositive={extractedDocs.length === docs.length}
        />
        <MetricCard title="Extracted Lines" value={totalLines} />
        <MetricCard
          title="Avg Confidence"
          value={`${(avgConfidence * 100).toFixed(1)}%`}
          description={avgConfidence >= 0.7 ? "Within threshold" : "Below threshold"}
          deltaPositive={avgConfidence >= 0.7}
        />
      </div>

      {/* Document thumbnail grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-6">
        {docs.map((doc) => (
          <DocCard
            key={doc.DOC_ID}
            doc={doc}
            lines={linesByDoc[String(doc.DOC_ID)] ?? []}
            selected={selectedDocId === String(doc.DOC_ID)}
            onClick={() => handleCardClick(String(doc.DOC_ID))}
            onExtract={(e) => { e.stopPropagation(); handleExtract(String(doc.DOC_ID)); }}
            extracting={extractingId === String(doc.DOC_ID)}
          />
        ))}
      </div>

      {/* Detail panel — shown when a doc is selected */}
      {selectedDocId && selectedDoc && (
        <div className="rounded-lg border border-blue-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-blue-50 border-b border-blue-200">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-blue-800">{selectedDocId}</span>
              <span className="text-xs text-slate-500">{selectedDoc.DOC_TYPE}</span>
              {selectedLines.length > 0 && (
                <span className="text-xs text-green-700 font-medium">{selectedLines.length} lines extracted</span>
              )}
            </div>
            <button
              onClick={() => setSelectedDocId(null)}
              className="text-slate-400 hover:text-slate-600 text-sm"
            >
              ✕
            </button>
          </div>

          <div className="flex gap-0 min-h-[320px]">
            {/* Image panel */}
            <div className="w-72 shrink-0 border-r border-slate-200 bg-slate-50 flex items-start justify-center p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/documents/${selectedDocId}/image`}
                alt={selectedDocId}
                className="max-w-full max-h-[480px] object-contain rounded shadow-sm"
              />
            </div>

            {/* Extracted lines table */}
            <div className="flex-1 overflow-auto">
              {selectedLines.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                  <p className="text-sm">No extracted lines yet.</p>
                  <Button
                    size="sm"
                    onClick={() => handleExtract(selectedDocId)}
                    disabled={extractingId === selectedDocId}
                  >
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
                      <th className="px-3 py-2 text-right font-semibold text-slate-600 border-b border-slate-200">Conf.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedLines.map((line, i) => {
                      const conf = line.EXTRACTION_CONFIDENCE;
                      const confColor =
                        conf == null ? "text-slate-400"
                        : conf >= 0.8 ? "text-green-600"
                        : conf >= 0.6 ? "text-yellow-600"
                        : "text-red-600";
                      return (
                        <tr key={line.LINE_ID} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                          <td className="px-3 py-2 border-b border-slate-100">{line.WORKER ?? "—"}</td>
                          <td className="px-3 py-2 border-b border-slate-100 whitespace-nowrap">{line.WORK_DATE ?? "—"}</td>
                          <td className="px-3 py-2 border-b border-slate-100 font-mono text-[10px] text-blue-700">{line.PROJECT_CODE ?? "—"}</td>
                          <td className="px-3 py-2 border-b border-slate-100 max-w-[200px]">
                            <div className="truncate text-[10px] text-slate-500" title={line.PROJECT ?? ""}>{line.PROJECT ?? "—"}</div>
                          </td>
                          <td className="px-3 py-2 border-b border-slate-100 text-right font-mono">{line.HOURS?.toFixed(1) ?? "—"}</td>
                          <td className={`px-3 py-2 border-b border-slate-100 text-right font-mono ${confColor}`}>
                            {conf != null ? `${(conf * 100).toFixed(0)}%` : "—"}
                          </td>
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
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
