"use client";

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Save, Plus, Trash2, CheckSquare, Square } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  useGroundTruth,
  useSaveGroundTruth,
  useMasterProjects,
} from "@/hooks/queries";
import { RawDocument, ExtractedLine, GroundTruthLine } from "@/lib/types";

const EMPTY_LINES: ExtractedLine[] = [];
const EMPTY_GT: GroundTruthLine[] = [];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${WEEKDAYS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

function weekDatesFromDocId(docId: string): string[] {
  const parts = docId.split("-");
  if (parts.length !== 3) return [];
  const [m, d, y] = parts;
  const sat = new Date(
    `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00`
  );
  if (isNaN(sat.getTime())) return [];
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(sat);
    dt.setDate(dt.getDate() + i);
    return dt.toISOString().split("T")[0];
  });
}

function parseHours(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) || n < 0 ? 0 : n;
}

let _rowCounter = 0;
function newRowId() {
  return `row-${++_rowCounter}`;
}

interface GTRow {
  id: string;
  projectCode: string;
  projectName: string;
  worker: string;
  hours: Record<string, string>; // date → string
}

// ── Doc thumbnail card ────────────────────────────────────────────────────────

function DocCard({
  doc,
  lineCount,
  gtCount,
  selected,
  onClick,
}: {
  doc: RawDocument;
  lineCount: number;
  gtCount: number;
  selected: boolean;
  onClick: () => void;
}) {
  const hasGT = gtCount > 0;
  const hasLines = lineCount > 0;
  return (
    <div
      onClick={onClick}
      className={`rounded-lg border cursor-pointer transition-all overflow-hidden ${
        selected
          ? "border-blue-500 ring-2 ring-blue-200"
          : "border-slate-200 hover:border-slate-300 hover:shadow-sm"
      }`}
    >
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
        <div
          className={`absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
            hasGT
              ? "bg-green-100 text-green-700"
              : hasLines
              ? "bg-amber-100 text-amber-700"
              : "bg-slate-200 text-slate-500"
          }`}
        >
          {hasGT ? (
            <CheckSquare className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
          {hasGT
            ? `${gtCount} GT rows`
            : hasLines
            ? `${lineCount} extracted`
            : "Not extracted"}
        </div>
      </div>
      <div className="px-3 py-2 bg-white">
        <p className="text-sm font-semibold text-slate-800 truncate">
          {doc.DOC_ID}
        </p>
        <p className="text-[10px] text-slate-400">
          {doc.DOC_TYPE.replace(/_/g, " ").toLowerCase()}
        </p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GroundTruthPage() {
  const { data: docs = [] } = useDocuments();
  const { data: allLines = EMPTY_LINES } = useExtractedLines();
  const { data: masterData } = useMasterProjects();

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const { data: existing = EMPTY_GT } = useGroundTruth(selectedDocId);
  const save = useSaveGroundTruth();

  const [rows, setRows] = useState<GTRow[]>([]);

  // Canonical active projects for the Select dropdown
  const canonicalProjects = useMemo(
    () => (masterData?.projects ?? []).filter((p) => p.IS_ACTIVE),
    [masterData]
  );

  // Group all extracted lines by doc
  const linesByDoc = useMemo(
    () =>
      allLines.reduce<Record<string, ExtractedLine[]>>((acc, l) => {
        if (!acc[l.DOC_ID]) acc[l.DOC_ID] = [];
        acc[l.DOC_ID].push(l);
        return acc;
      }, {}),
    [allLines]
  );

  // GT row counts per doc (from existing data for selected doc only — we
  // approximate others by using a map built below if available)
  const gtCountByDoc = useMemo(() => {
    const map: Record<string, number> = {};
    if (selectedDocId && existing.length > 0) {
      map[selectedDocId] = existing.length;
    }
    return map;
  }, [selectedDocId, existing]);

  const docLines: ExtractedLine[] = selectedDocId
    ? (linesByDoc[selectedDocId] ?? [])
    : [];

  // 7 dates for the selected doc week, falling back to dates from extraction
  const dates = useMemo(() => {
    if (selectedDocId) {
      const fromDoc = weekDatesFromDocId(selectedDocId);
      if (fromDoc.length === 7) return fromDoc;
    }
    return [
      ...new Set(
        docLines.map((l) => l.WORK_DATE).filter(Boolean) as string[]
      ),
    ].sort();
  }, [selectedDocId, docLines]);

  // Derive the worker name from extracted lines (most frequent)
  const docWorker = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of docLines) {
      if (l.WORKER)
        counts.set(l.WORKER, (counts.get(l.WORKER) ?? 0) + 1);
    }
    let best = "";
    let bestCount = 0;
    for (const [w, c] of counts) {
      if (c > bestCount) {
        best = w;
        bestCount = c;
      }
    }
    return best;
  }, [docLines]);

  // Initialize rows when doc changes or data arrives
  useEffect(() => {
    if (!selectedDocId) {
      setRows([]);
      return;
    }

    const rowMap = new Map<string, GTRow>();

    // 1. Pre-fill from extracted lines
    for (const line of docLines) {
      const code = line.PROJECT_CODE ?? line.PROJECT ?? "";
      if (!code) continue;
      const canonical = canonicalProjects.find(
        (p) => p.PROJECT_CODE === code
      );
      if (!rowMap.has(code)) {
        rowMap.set(code, {
          id: newRowId(),
          projectCode: code,
          projectName: canonical?.PROJECT_NAME ?? line.PROJECT ?? "",
          worker: line.WORKER ?? docWorker,
          hours: {},
        });
      }
      if (line.WORK_DATE && line.HOURS != null) {
        rowMap.get(code)!.hours[line.WORK_DATE] = String(line.HOURS);
      }
    }

    // 2. Override / augment with saved GT (highest priority)
    for (const gt of existing) {
      const code = gt.PROJECT_CODE ?? gt.PROJECT ?? "";
      if (!code) continue;
      const canonical = canonicalProjects.find(
        (p) => p.PROJECT_CODE === code
      );
      if (!rowMap.has(code)) {
        rowMap.set(code, {
          id: newRowId(),
          projectCode: code,
          projectName: canonical?.PROJECT_NAME ?? gt.PROJECT ?? "",
          worker: gt.WORKER ?? docWorker,
          hours: {},
        });
      }
      // GT hours always win over extracted
      rowMap.get(code)!.hours[gt.WORK_DATE] = String(gt.HOURS);
    }

    setRows([...rowMap.values()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDocId, existing]);

  // ── Row mutations ──

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        id: newRowId(),
        projectCode: "",
        projectName: "",
        worker: docWorker,
        hours: {},
      },
    ]);
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function setRowProject(id: string, code: string) {
    const canonical = canonicalProjects.find((p) => p.PROJECT_CODE === code);
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              projectCode: code,
              projectName: canonical?.PROJECT_NAME ?? code,
            }
          : r
      )
    );
  }

  function setCell(id: string, date: string, value: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, hours: { ...r.hours, [date]: value } } : r
      )
    );
  }

  // ── Totals ──

  function rowTotal(row: GTRow) {
    return dates.reduce((s, d) => s + parseHours(row.hours[d] ?? ""), 0);
  }

  function colTotal(date: string) {
    return rows.reduce((s, r) => s + parseHours(r.hours[date] ?? ""), 0);
  }

  const grandTotal = rows.reduce((s, r) => s + rowTotal(r), 0);

  // ── Save ──

  async function handleSave() {
    if (!selectedDocId) return;
    const lines: Omit<GroundTruthLine, "GT_ID" | "ENTERED_AT">[] = [];

    for (const row of rows) {
      if (!row.projectCode) continue;
      for (const date of dates) {
        const h = parseHours(row.hours[date] ?? "");
        if (h > 0) {
          lines.push({
            DOC_ID: selectedDocId,
            WORKER: row.worker || "analyst",
            WORK_DATE: date,
            PROJECT: row.projectName || null,
            PROJECT_CODE: row.projectCode || null,
            HOURS: h,
            ENTERED_BY: "analyst",
          });
        }
      }
    }

    toast.promise(save.mutateAsync({ docId: selectedDocId, lines }), {
      loading: "Saving ground truth…",
      success: `Saved ${lines.length} rows`,
      error: (err) => `Save failed: ${err}`,
    });
  }

  return (
    <div>
      <PageHeader
        title="Ground Truth"
        description="Select a timesheet to enter the analyst-verified hours against canonical projects."
        actions={
          selectedDocId ? (
            <Button onClick={handleSave} disabled={save.isPending}>
              <Save className="h-4 w-4 mr-2" />
              Save Ground Truth
            </Button>
          ) : undefined
        }
      />

      {/* ── Thumbnail grid ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-6">
        {docs.map((doc) => (
          <DocCard
            key={doc.DOC_ID}
            doc={doc}
            lineCount={linesByDoc[String(doc.DOC_ID)]?.length ?? 0}
            gtCount={gtCountByDoc[String(doc.DOC_ID)] ?? 0}
            selected={selectedDocId === String(doc.DOC_ID)}
            onClick={() =>
              setSelectedDocId((prev) =>
                prev === String(doc.DOC_ID) ? null : String(doc.DOC_ID)
              )
            }
          />
        ))}
      </div>

      {/* ── Detail panel ── */}
      {selectedDocId && (
        <div className="rounded-lg border border-blue-200 bg-white overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center justify-between px-4 py-2 bg-blue-50 border-b border-blue-200">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-blue-800">{selectedDocId}</span>
              {docWorker && (
                <span className="text-xs bg-white border border-slate-200 px-2 py-0.5 rounded-full text-slate-600">
                  {docWorker}
                </span>
              )}
              {existing.length > 0 && (
                <span className="text-xs text-green-700 font-medium">
                  {existing.length} GT rows saved
                </span>
              )}
            </div>
            <button
              onClick={() => setSelectedDocId(null)}
              className="text-slate-400 hover:text-slate-600 text-sm"
            >
              ✕
            </button>
          </div>

          {/* Image — full width above the grid */}
          <div className="bg-slate-50 border-b border-slate-200 flex justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/documents/${selectedDocId}/image`}
              alt={selectedDocId}
              className="max-h-[480px] w-auto object-contain rounded shadow-sm"
            />
          </div>

          {/* Hours grid */}
          <div className="overflow-auto p-4">
              {dates.length === 0 && rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-400">
                  <p className="text-sm">No extracted lines for this document yet.</p>
                  <p className="text-xs">Add a project row below to enter hours manually.</p>
                </div>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="px-3 py-2 text-left font-semibold border border-slate-300 min-w-[260px]">
                        Project
                      </th>
                      {dates.map((d) => (
                        <th
                          key={d}
                          className="px-2 py-2 text-center font-semibold border border-slate-300 min-w-[72px] whitespace-nowrap"
                        >
                          {fmtDate(d)}
                        </th>
                      ))}
                      <th className="px-2 py-2 text-center font-semibold border border-slate-300 bg-blue-50 min-w-[52px]">
                        Total
                      </th>
                      <th className="w-8 border border-slate-300" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const total = rowTotal(row);
                      const isNonCanonical =
                        row.projectCode &&
                        !canonicalProjects.find(
                          (p) => p.PROJECT_CODE === row.projectCode
                        );
                      return (
                        <tr
                          key={row.id}
                          className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}
                        >
                          {/* Project selector */}
                          <td className="border border-slate-200 p-1 min-w-[260px]">
                            <Select
                              value={row.projectCode}
                              onValueChange={(code) =>
                                setRowProject(row.id, code)
                              }
                            >
                              <SelectTrigger className="h-auto min-h-[36px] text-xs border-slate-200">
                                <SelectValue placeholder="Select canonical project…">
                                  {row.projectCode ? (
                                    <div className="text-left py-0.5">
                                      <div
                                        className={`font-mono text-[10px] ${
                                          isNonCanonical
                                            ? "text-amber-600"
                                            : "text-blue-700"
                                        }`}
                                      >
                                        {row.projectCode}
                                        {isNonCanonical && (
                                          <span className="ml-1 text-amber-500">
                                            ·non-canonical
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[11px] text-slate-600 leading-tight">
                                        {row.projectName || "—"}
                                      </div>
                                    </div>
                                  ) : undefined}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent className="max-h-72">
                                {canonicalProjects.map((p) => (
                                  <SelectItem
                                    key={p.PROJECT_CODE}
                                    value={p.PROJECT_CODE}
                                  >
                                    <div className="py-0.5">
                                      <div className="font-mono text-[10px] text-blue-700">
                                        {p.PROJECT_CODE}
                                      </div>
                                      <div className="text-xs text-slate-600">
                                        {p.PROJECT_NAME ?? "—"}
                                      </div>
                                    </div>
                                  </SelectItem>
                                ))}
                                {/* Show non-canonical option if pre-filled from extraction */}
                                {isNonCanonical && (
                                  <SelectItem
                                    value={row.projectCode}
                                    className="text-amber-700"
                                  >
                                    <div className="py-0.5">
                                      <div className="font-mono text-[10px]">
                                        {row.projectCode}
                                      </div>
                                      <div className="text-xs text-amber-600">
                                        Not in canonical list
                                      </div>
                                    </div>
                                  </SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                          </td>

                          {/* Day inputs */}
                          {dates.map((d) => {
                            const val = row.hours[d] ?? "";
                            const n = parseHours(val);
                            return (
                              <td
                                key={d}
                                className={`border border-slate-200 p-1 ${
                                  n > 0 ? "bg-green-50" : ""
                                }`}
                              >
                                <Input
                                  type="number"
                                  min="0"
                                  max="24"
                                  step="0.5"
                                  value={val}
                                  onChange={(e) =>
                                    setCell(row.id, d, e.target.value)
                                  }
                                  className={`h-7 w-[58px] text-center text-xs px-1 ${
                                    n > 0
                                      ? "border-green-300 bg-green-50"
                                      : "border-slate-200"
                                  }`}
                                />
                              </td>
                            );
                          })}

                          {/* Row total */}
                          <td className="border border-slate-200 px-2 py-2 text-center font-semibold bg-blue-50 text-blue-800">
                            {total > 0 ? total.toFixed(1) : "—"}
                          </td>

                          {/* Delete row */}
                          <td className="border border-slate-200 text-center">
                            <button
                              onClick={() => removeRow(row.id)}
                              className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                              title="Remove row"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 font-semibold">
                      <td className="px-3 py-2 border border-slate-300 text-slate-700">
                        Daily Total
                      </td>
                      {dates.map((d) => {
                        const t = colTotal(d);
                        return (
                          <td
                            key={d}
                            className="border border-slate-300 px-2 py-2 text-center text-slate-800"
                          >
                            {t > 0 ? t.toFixed(1) : "—"}
                          </td>
                        );
                      })}
                      <td className="border border-slate-300 px-2 py-2 text-center bg-blue-100 text-blue-900 font-bold">
                        {grandTotal > 0 ? grandTotal.toFixed(1) : "—"}
                      </td>
                      <td className="border border-slate-300" />
                    </tr>
                  </tfoot>
                </table>
              )}

              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={addRow}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add project row
              </Button>
          </div>
        </div>
      )}
    </div>
  );
}
