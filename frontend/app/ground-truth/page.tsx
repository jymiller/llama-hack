"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { toast } from "sonner";
import { Save, Plus, Trash2, CheckSquare, Square, ZoomIn, ZoomOut, Maximize2, RotateCcw } from "lucide-react";
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
  useGroundTruthCounts,
  useSaveGroundTruth,
  useMasterProjects,
  useProjectMerges,
  useNicknameMaps,
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

// ── Zoomable image viewer ─────────────────────────────────────────────────────

const DEFAULT_ZOOM = 1.8;
// Pan offset to show the bottom third: shift image up by ~40% of its height at default zoom
const DEFAULT_PAN = { x: 0, y: -0.28 }; // fraction of container height

function ImageViewer({ src, alt, isPDF }: { src: string; alt: string; isPDF?: boolean }) {
  if (isPDF) {
    return (
      <div className="relative bg-slate-900 border-b border-slate-200" style={{ height: 340 }}>
        <iframe src={src} title={alt} className="w-full h-full border-0" />
      </div>
    );
  }
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState(DEFAULT_PAN);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const resetView = useCallback(() => {
    setZoom(DEFAULT_ZOOM);
    setPan(DEFAULT_PAN);
  }, []);

  const clampPan = useCallback(
    (x: number, y: number, z: number) => {
      const limit = (z - 1) / 2;
      return {
        x: Math.max(-limit, Math.min(limit, x)),
        y: Math.max(-limit, Math.min(limit, y)),
      };
    },
    []
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      setZoom((prev) => {
        const next = Math.max(0.5, Math.min(5, prev - e.deltaY * 0.001));
        setPan((p) => clampPan(p.x, p.y, next));
        return next;
      });
    },
    [clampPan]
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const container = containerRef.current;
      if (!container) return;
      const { width, height } = container.getBoundingClientRect();
      const dx = (e.clientX - lastPos.current.x) / width;
      const dy = (e.clientY - lastPos.current.y) / height;
      lastPos.current = { x: e.clientX, y: e.clientY };
      setPan((prev) => {
        const next = clampPan(prev.x + dx, prev.y + dy, zoom);
        return next;
      });
    },
    [zoom, clampPan]
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const transform = `scale(${zoom}) translate(${(pan.x * 100) / zoom}%, ${(pan.y * 100) / zoom}%)`;

  return (
    <div className="relative bg-slate-900 border-b border-slate-200 select-none" style={{ height: 340 }}>
      {/* Controls */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        <button
          onClick={() => setZoom((z) => { const n = Math.min(5, +(z + 0.25).toFixed(2)); setPan((p) => clampPan(p.x, p.y, n)); return n; })}
          className="p-1.5 rounded bg-black/50 text-white hover:bg-black/70 transition-colors"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          onClick={() => setZoom((z) => { const n = Math.max(0.5, +(z - 0.25).toFixed(2)); setPan((p) => clampPan(p.x, p.y, n)); return n; })}
          className="p-1.5 rounded bg-black/50 text-white hover:bg-black/70 transition-colors"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          onClick={resetView}
          className="p-1.5 rounded bg-black/50 text-white hover:bg-black/70 transition-colors"
          title="Reset view"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <span className="text-[10px] text-white/60 ml-1 font-mono">{Math.round(zoom * 100)}%</span>
      </div>

      {/* Viewport */}
      <div
        ref={containerRef}
        className="w-full h-full overflow-hidden cursor-grab active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="w-full h-full object-contain transition-transform duration-75"
          style={{ transform, transformOrigin: "center center" }}
        />
      </div>
    </div>
  );
}

// ── Doc thumbnail card ────────────────────────────────────────────────────────

function DocCard({
  doc,
  lineCount,
  gtCount,
  gtTotalHours,
  extTotalHours,
  selected,
  unsaved,
  onClick,
}: {
  doc: RawDocument;
  lineCount: number;
  gtCount: number;
  gtTotalHours: number | null;
  extTotalHours: number;
  selected: boolean;
  unsaved: boolean;
  onClick: () => void;
}) {
  const hasGT = gtCount > 0;
  const hasLines = lineCount > 0;
  const delta = hasGT && gtTotalHours != null ? extTotalHours - gtTotalHours : null;
  const hasDelta = delta != null && Math.abs(delta) >= 0.01;

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border cursor-pointer transition-all overflow-hidden ${
        selected || unsaved
          ? "border-yellow-400 ring-2 ring-yellow-200"
          : hasDelta
          ? "border-red-400 ring-1 ring-red-100"
          : hasGT
          ? "border-green-400 ring-1 ring-green-100"
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
        {unsaved && (
          <div className="absolute inset-0 bg-yellow-400/10 pointer-events-none" />
        )}
        <div
          className={`absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
            unsaved
              ? "bg-yellow-100 text-yellow-700"
              : hasDelta
              ? "bg-red-100 text-red-700"
              : hasGT
              ? "bg-green-100 text-green-700"
              : hasLines
              ? "bg-amber-100 text-amber-700"
              : "bg-slate-200 text-slate-500"
          }`}
        >
          {unsaved ? (
            <RotateCcw className="h-3 w-3" />
          ) : hasDelta ? (
            <CheckSquare className="h-3 w-3" />
          ) : hasGT ? (
            <CheckSquare className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
          {unsaved
            ? "Unsaved"
            : hasDelta
            ? `Δ ${delta! >= 0 ? "+" : ""}${delta!.toFixed(1)}h`
            : hasGT
            ? `${gtTotalHours!.toFixed(1)}h`
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
  const { data: allDocs = [] } = useDocuments();
  const docs = allDocs.filter((d) => d.DOC_TYPE === "TIMESHEET");
  const { data: allLines = EMPTY_LINES } = useExtractedLines();
  const { data: masterData } = useMasterProjects();
  const { data: gtCounts = [] } = useGroundTruthCounts();
  const { data: merges = [] } = useProjectMerges();
  const { nickP, nickW } = useNicknameMaps();

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const { data: existing = EMPTY_GT } = useGroundTruth(selectedDocId);
  const save = useSaveGroundTruth();

  const [rows, setRows] = useState<GTRow[]>([]);
  const [needsSave, setNeedsSave] = useState(false);

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

  // GT row counts and total hours for every doc (from summary endpoint)
  const gtCountByDoc = useMemo(
    () =>
      gtCounts.reduce<Record<string, number>>((acc, r) => {
        acc[r.DOC_ID] = r.ROW_COUNT;
        return acc;
      }, {}),
    [gtCounts]
  );

  const gtHoursByDoc = useMemo(
    () =>
      gtCounts.reduce<Record<string, number>>((acc, r) => {
        acc[r.DOC_ID] = r.TOTAL_HOURS;
        return acc;
      }, {}),
    [gtCounts]
  );

  const extTotalByDoc = useMemo(
    () =>
      allLines.reduce<Record<string, number>>((acc, l) => {
        acc[l.DOC_ID] = (acc[l.DOC_ID] ?? 0) + (l.HOURS ?? 0);
        return acc;
      }, {}),
    [allLines]
  );

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

  // Build rows from extracted lines only (no GT override)
  const buildRowsFromExtraction = useCallback(() => {
    const rowMap = new Map<string, GTRow>();
    for (const line of docLines) {
      const code = line.PROJECT_CODE ?? line.PROJECT ?? "";
      if (!code) continue;
      const canonical = canonicalProjects.find((p) => p.PROJECT_CODE === code);
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
    return [...rowMap.values()];
  }, [docLines, canonicalProjects, docWorker]);

  // Initialize rows when doc changes or saved GT arrives.
  // If GT exists, use it exclusively — extraction is only a first-time hint.
  // This ensures cleared cells (deleted by the analyst) stay deleted after save.
  useEffect(() => {
    if (!selectedDocId) {
      setRows([]);
      return;
    }

    const rowMap = new Map<string, GTRow>();

    if (existing.length > 0) {
      // GT has been saved: load from GT only — do NOT blend with extraction
      for (const gt of existing) {
        const code = gt.PROJECT_CODE ?? gt.PROJECT ?? "";
        if (!code) continue;
        const canonical = canonicalProjects.find((p) => p.PROJECT_CODE === code);
        if (!rowMap.has(code)) {
          rowMap.set(code, {
            id: newRowId(),
            projectCode: code,
            projectName: canonical?.PROJECT_NAME ?? gt.PROJECT ?? "",
            worker: gt.WORKER ?? docWorker,
            hours: {},
          });
        }
        rowMap.get(code)!.hours[gt.WORK_DATE] = String(gt.HOURS);
      }
    } else {
      // No GT yet — pre-fill from extracted lines as a starting point
      for (const line of docLines) {
        const code = line.PROJECT_CODE ?? line.PROJECT ?? "";
        if (!code) continue;
        const canonical = canonicalProjects.find((p) => p.PROJECT_CODE === code);
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

  // Merge resolution: source_code → target_code
  const mergeMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of merges) map[m.SOURCE_CODE] = m.TARGET_CODE;
    return map;
  }, [merges]);

  // ── Extracted rows grouped by project (for comparison) ──

  const extractedRowsByCode = useMemo(() => {
    const map = new Map<string, { projectCode: string; projectName: string; hours: Record<string, number> }>();
    for (const line of docLines) {
      const rawCode = line.PROJECT_CODE ?? line.PROJECT ?? "";
      if (!rawCode) continue;
      // Resolve through merge map so merged codes compare against GT correctly
      const code = mergeMap[rawCode] ?? rawCode;
      if (!map.has(code)) {
        const canonical = canonicalProjects.find((p) => p.PROJECT_CODE === code);
        map.set(code, {
          projectCode: code,
          projectName: canonical?.PROJECT_NAME ?? line.PROJECT ?? "",
          hours: {},
        });
      }
      if (line.WORK_DATE && line.HOURS != null) {
        map.get(code)!.hours[line.WORK_DATE] = line.HOURS;
      }
    }
    return map;
  }, [docLines, canonicalProjects, mergeMap]);

  // GT lookup: projectCode → date → hours (for comparison against extraction)
  const gtLookup = useMemo(() => {
    const lookup: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      if (!row.projectCode) continue;
      lookup[row.projectCode] = {};
      for (const date of dates) {
        const h = parseHours(row.hours[date] ?? "");
        if (h > 0) lookup[row.projectCode][date] = h;
      }
    }
    return lookup;
  }, [rows, dates]);

  // Union of project codes from both GT and extraction, for full comparison view
  const allComparisonCodes = useMemo(() => {
    const codes = new Set<string>();
    rows.forEach((r) => { if (r.projectCode) codes.add(r.projectCode); });
    extractedRowsByCode.forEach((_, code) => codes.add(code));
    return [...codes].sort();
  }, [rows, extractedRowsByCode]);

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

    toast.promise(
      save.mutateAsync({ docId: selectedDocId, lines }).then((r) => {
        setNeedsSave(false);
        return r;
      }),
      {
        loading: "Saving ground truth…",
        success: `Saved ${lines.length} rows`,
        error: (err) => `Save failed: ${err}`,
      }
    );
  }

  return (
    <div>
      <PageHeader
        title="Ground Truth"
        description="Select a timesheet to enter the analyst-verified hours against canonical projects."
      />

      {/* ── Thumbnail grid ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-6">
        {docs.map((doc) => (
          <DocCard
            key={doc.DOC_ID}
            doc={doc}
            lineCount={linesByDoc[String(doc.DOC_ID)]?.length ?? 0}
            gtCount={gtCountByDoc[String(doc.DOC_ID)] ?? 0}
            gtTotalHours={gtHoursByDoc[String(doc.DOC_ID)] ?? null}
            extTotalHours={extTotalByDoc[String(doc.DOC_ID)] ?? 0}
            selected={selectedDocId === String(doc.DOC_ID)}
            unsaved={needsSave && selectedDocId === String(doc.DOC_ID)}
            onClick={() => {
              setNeedsSave(false);
              setSelectedDocId((prev) =>
                prev === String(doc.DOC_ID) ? null : String(doc.DOC_ID)
              );
            }}
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
                  {nickW(docWorker)}
                </span>
              )}
              {existing.length > 0 && (
                <span className="text-xs text-green-700 font-medium">
                  {existing.length} GT rows saved
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setRows(buildRowsFromExtraction()); setNeedsSave(true); }}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-amber-600 transition-colors px-2 py-1 rounded hover:bg-amber-50"
                title="Discard saved GT and reset grid to AI-extracted values"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset to extraction
              </button>
              <button
                onClick={() => setSelectedDocId(null)}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Zoomable image — full width above the grid */}
          <ImageViewer
            src={`/api/documents/${selectedDocId}/image`}
            alt={selectedDocId}
            isPDF={docs.find((d) => String(d.DOC_ID) === selectedDocId)?.STAGE_PATH?.toLowerCase().endsWith(".pdf")}
          />

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
                                        {nickP(row.projectCode) || "—"}
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
                                        {nickP(p.PROJECT_CODE) || "—"}
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

              <div className="mt-3 flex items-center justify-between">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addRow}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add project row
                </Button>
                <Button onClick={handleSave} disabled={save.isPending}>
                  <Save className="h-4 w-4 mr-2" />
                  {save.isPending ? "Saving…" : "Save Ground Truth"}
                </Button>
              </div>

              {/* ── AI Extraction comparison ── */}
              {allComparisonCodes.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">AI Extraction</span>
                    <div className="flex-1 h-px bg-slate-200" />
                    <div className="flex items-center gap-3 text-[10px] text-slate-400">
                      <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-200 border border-green-300" />Match</span>
                      <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-200 border border-red-300" />Difference</span>
                    </div>
                  </div>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-3 py-2 text-left font-semibold border border-slate-200 min-w-[260px] text-slate-500">Project</th>
                        {dates.map((d) => (
                          <th key={d} className="px-2 py-2 text-center font-semibold border border-slate-200 min-w-[72px] whitespace-nowrap text-slate-500">
                            {fmtDate(d)}
                          </th>
                        ))}
                        <th className="px-2 py-2 text-center font-semibold border border-slate-200 bg-slate-100 min-w-[52px] text-slate-500">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allComparisonCodes.map((code, i) => {
                        const extRow = extractedRowsByCode.get(code);
                        const gtRow = gtLookup[code];
                        const isMissing = !extRow; // in GT but not extracted
                        const isExtra = !gtRow;    // extracted but not in GT
                        const extTotal = dates.reduce((s, d) => s + (extRow?.hours[d] ?? 0), 0);

                        return (
                          <tr
                            key={code}
                            className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}
                          >
                            <td className={`border border-slate-200 px-3 py-2 ${isMissing || isExtra ? "border-l-2 border-l-red-400" : ""}`}>
                              <div className="font-mono text-[10px] text-blue-700">{code}</div>
                              <div className="text-[11px] text-slate-500">
                                {nickP(code) || extRow?.projectName || rows.find((r) => r.projectCode === code)?.projectName || "—"}
                              </div>
                              {isExtra && <div className="text-[10px] text-red-500 font-semibold">EXTRA</div>}
                              {isMissing && <div className="text-[10px] text-red-500 font-semibold">MISSING</div>}
                            </td>
                            {dates.map((d) => {
                              const extH = extRow?.hours[d] ?? 0;
                              const gtH = gtRow?.[d] ?? 0;
                              const hasAny = extH > 0 || gtH > 0;
                              const isMatch = hasAny && Math.abs(extH - gtH) < 0.01;
                              const cellClass = !hasAny ? "" : isMatch ? "bg-green-100 text-green-800 font-semibold" : "bg-red-100 text-red-800 font-semibold";
                              const label = extH > 0 ? extH.toFixed(1) : hasAny ? "—" : "";

                              return (
                                <td key={d} className={`border border-slate-200 px-2 py-2 text-center font-mono ${cellClass}`}>
                                  {label}
                                </td>
                              );
                            })}
                            <td className="border border-slate-200 px-2 py-2 text-center font-mono text-slate-500 bg-slate-50">
                              {extTotal > 0 ? extTotal.toFixed(1) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-100 font-semibold">
                        <td className="px-3 py-2 border border-slate-300 text-slate-500">Daily Total</td>
                        {dates.map((d) => {
                          const t = [...extractedRowsByCode.values()].reduce((s, r) => s + (r.hours[d] ?? 0), 0);
                          return (
                            <td key={d} className="border border-slate-300 px-2 py-2 text-center text-slate-600 font-mono">
                              {t > 0 ? t.toFixed(1) : "—"}
                            </td>
                          );
                        })}
                        <td className="border border-slate-300 px-2 py-2 text-center bg-slate-200 text-slate-700 font-mono font-bold">
                          {[...extractedRowsByCode.values()].reduce((s, r) => s + dates.reduce((s2, d) => s2 + (r.hours[d] ?? 0), 0), 0).toFixed(1)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
