"use client";

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
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
} from "@/hooks/queries";
import { ExtractedLine, GroundTruthLine } from "@/lib/types";

// Stable empty arrays — prevents useEffect infinite loop from new [] refs each render
const EMPTY_LINES: ExtractedLine[] = [];
const EMPTY_GT: GroundTruthLine[] = [];

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${DAY[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

function parseHours(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export default function GroundTruthPage() {
  const { data: docs = [] } = useDocuments();
  const { data: allLines = EMPTY_LINES } = useExtractedLines();
  const [selectedDoc, setSelectedDoc] = useState<string>("");
  const docId = selectedDoc || null;

  const { data: existing = EMPTY_GT } = useGroundTruth(docId);
  const save = useSaveGroundTruth();

  // hours[projectKey][date] = string value for the input
  const [hours, setHours] = useState<Record<string, Record<string, string>>>({});

  // Extracted lines for the selected document
  const docLines = useMemo(
    () => allLines.filter((l) => l.DOC_ID === docId),
    [allLines, docId]
  );

  // Unique sorted dates across all extracted lines for this doc
  const dates = useMemo(
    () =>
      [
        ...new Set(
          docLines.map((l) => l.WORK_DATE).filter(Boolean) as string[]
        ),
      ].sort(),
    [docLines]
  );

  // Unique projects (preserve insertion order by first appearance)
  const projects = useMemo(() => {
    const seen = new Map<
      string,
      { key: string; project: string; project_code: string; worker: string }
    >();
    for (const l of docLines) {
      const key = l.PROJECT_CODE || l.PROJECT || "";
      if (!seen.has(key)) {
        seen.set(key, {
          key,
          project: l.PROJECT ?? "",
          project_code: l.PROJECT_CODE ?? "",
          worker: l.WORKER ?? "",
        });
      }
    }
    return [...seen.values()];
  }, [docLines]);

  // Initialise the hours grid from extracted lines (pre-populated) + existing GT (overrides)
  useEffect(() => {
    if (!docId || docLines.length === 0) {
      setHours({});
      return;
    }

    const init: Record<string, Record<string, string>> = {};

    for (const l of docLines) {
      const key = l.PROJECT_CODE || l.PROJECT || "";
      const date = l.WORK_DATE ?? "";
      if (!date) continue;
      if (!init[key]) init[key] = {};

      // Prefer analyst-entered GT over extracted value
      const gt = existing.find(
        (g) => g.WORK_DATE === date && g.PROJECT === l.PROJECT
      );
      init[key][date] = String(gt?.HOURS ?? l.HOURS ?? "");
    }

    setHours(init);
  }, [docId, docLines, existing]);

  function setCell(projectKey: string, date: string, value: string) {
    setHours((prev) => ({
      ...prev,
      [projectKey]: { ...(prev[projectKey] ?? {}), [date]: value },
    }));
  }

  function rowTotal(key: string) {
    return dates.reduce((s, d) => s + parseHours(hours[key]?.[d] ?? ""), 0);
  }

  function colTotal(date: string) {
    return projects.reduce(
      (s, p) => s + parseHours(hours[p.key]?.[date] ?? ""),
      0
    );
  }

  const grandTotal = projects.reduce((s, p) => s + rowTotal(p.key), 0);

  async function handleSave() {
    if (!docId) return;
    const lines: Omit<GroundTruthLine, "GT_ID" | "ENTERED_AT">[] = [];

    for (const p of projects) {
      for (const date of dates) {
        const h = parseHours(hours[p.key]?.[date] ?? "");
        if (h > 0) {
          lines.push({
            DOC_ID: docId,
            WORKER: p.worker,
            WORK_DATE: date,
            PROJECT: p.project || null,
            PROJECT_CODE: p.project_code || null,
            HOURS: h,
            ENTERED_BY: "analyst",
          });
        }
      }
    }

    toast.promise(save.mutateAsync({ docId, lines }), {
      loading: "Saving ground truth…",
      success: `Saved ${lines.length} rows`,
      error: (err) => `Save failed: ${err}`,
    });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <PageHeader
        title="Ground Truth Entry"
        description="View the timesheet image and confirm hours in the matching grid."
        actions={
          <Button onClick={handleSave} disabled={!docId || save.isPending}>
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
        }
      />

      <div className="mb-4">
        <Select value={selectedDoc} onValueChange={setSelectedDoc}>
          <SelectTrigger className="w-60">
            <SelectValue placeholder="Select document…" />
          </SelectTrigger>
          <SelectContent>
            {docs.map((d) => (
              <SelectItem key={d.DOC_ID} value={d.DOC_ID}>
                {d.DOC_ID}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {docId && (
        <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">

          {/* ── Left: Timesheet image ── */}
          <div className="w-1/2 overflow-auto rounded-lg border bg-muted/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/documents/${docId}/image`}
              alt={`Timesheet ${docId}`}
              className="w-full h-auto"
            />
          </div>

          {/* ── Right: Project × Date grid ── */}
          <div className="w-1/2 overflow-auto">
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No extracted lines for this document yet.
              </p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="px-3 py-2 text-left font-semibold border border-slate-300 sticky left-0 bg-slate-100 min-w-[220px]">
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
                    <th className="px-2 py-2 text-center font-semibold border border-slate-300 bg-blue-50 min-w-[60px]">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p, i) => (
                    <tr
                      key={p.key}
                      className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}
                    >
                      <td className="px-3 py-2 border border-slate-200 sticky left-0 bg-inherit">
                        <div className="font-mono text-[10px] text-blue-700 mb-0.5">
                          {p.project_code}
                        </div>
                        <div
                          className="text-xs leading-tight max-w-[200px] truncate text-slate-700"
                          title={p.project}
                        >
                          {p.project}
                        </div>
                      </td>
                      {dates.map((d) => {
                        const val = hours[p.key]?.[d] ?? "";
                        const n = parseHours(val);
                        const hasValue = n > 0;
                        return (
                          <td
                            key={d}
                            className={`border border-slate-200 p-1 text-center ${
                              hasValue ? "bg-green-50" : ""
                            }`}
                          >
                            <Input
                              type="number"
                              min="0"
                              max="24"
                              step="0.5"
                              value={val}
                              onChange={(e) =>
                                setCell(p.key, d, e.target.value)
                              }
                              className={`h-7 w-16 text-center text-xs px-1 ${
                                hasValue
                                  ? "border-green-300 bg-green-50"
                                  : "border-slate-200"
                              }`}
                            />
                          </td>
                        );
                      })}
                      <td className="border border-slate-200 px-2 py-2 text-center font-semibold bg-blue-50 text-blue-800">
                        {rowTotal(p.key) > 0 ? rowTotal(p.key) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 font-semibold">
                    <td className="px-3 py-2 border border-slate-300 sticky left-0 bg-slate-100 text-slate-700">
                      Daily Total
                    </td>
                    {dates.map((d) => {
                      const t = colTotal(d);
                      return (
                        <td
                          key={d}
                          className="border border-slate-300 px-2 py-2 text-center text-slate-800"
                        >
                          {t > 0 ? t : "—"}
                        </td>
                      );
                    })}
                    <td className="border border-slate-300 px-2 py-2 text-center bg-blue-100 text-blue-900 font-bold">
                      {grandTotal > 0 ? grandTotal : "—"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
