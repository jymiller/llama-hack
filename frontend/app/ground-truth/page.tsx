"use client";

import { useState, useEffect } from "react";
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
import { toISODate } from "@/lib/utils";

// Stable empty arrays to avoid triggering useEffect on every render while queries load
const EMPTY_LINES: ExtractedLine[] = [];
const EMPTY_GT: GroundTruthLine[] = [];

interface GridRow {
  WORKER: string;
  WORK_DATE: string;
  PROJECT: string;
  PROJECT_CODE: string;
  HOURS: string;
}

export default function GroundTruthPage() {
  const { data: docs = [] } = useDocuments();
  const { data: allLines = EMPTY_LINES } = useExtractedLines();
  const [selectedDoc, setSelectedDoc] = useState<string>("");
  const docId = selectedDoc || null;

  const { data: existing = EMPTY_GT } = useGroundTruth(docId);
  const save = useSaveGroundTruth();

  const [grid, setGrid] = useState<GridRow[]>([]);

  // Build grid from extracted lines whenever doc or extracted lines change
  useEffect(() => {
    if (!docId) return;

    const docLines = allLines.filter((l) => l.DOC_ID === docId);

    // Collect unique (worker, date) combos from extraction
    const seen = new Set<string>();
    const rows: GridRow[] = [];
    for (const l of docLines) {
      const key = `${l.WORKER}|${l.WORK_DATE}`;
      if (!seen.has(key)) {
        seen.add(key);

        // Prefer existing GT if available
        const gt = existing.find(
          (e) => e.WORKER === l.WORKER && e.WORK_DATE === l.WORK_DATE
        );
        rows.push({
          WORKER: gt?.WORKER ?? l.WORKER ?? "",
          WORK_DATE: gt?.WORK_DATE ?? l.WORK_DATE ?? toISODate(new Date()),
          PROJECT: gt?.PROJECT ?? l.PROJECT ?? "",
          PROJECT_CODE: gt?.PROJECT_CODE ?? l.PROJECT_CODE ?? "",
          HOURS: String(gt?.HOURS ?? l.HOURS ?? ""),
        });
      }
    }

    // If no extracted lines, fall back to existing GT only
    if (rows.length === 0) {
      for (const g of existing) {
        rows.push({
          WORKER: g.WORKER,
          WORK_DATE: g.WORK_DATE,
          PROJECT: g.PROJECT ?? "",
          PROJECT_CODE: g.PROJECT_CODE ?? "",
          HOURS: String(g.HOURS),
        });
      }
    }

    setGrid(rows);
  }, [docId, allLines, existing]);

  function updateCell(idx: number, field: keyof GridRow, value: string) {
    setGrid((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row))
    );
  }

  function addRow() {
    setGrid((prev) => [
      ...prev,
      { WORKER: "", WORK_DATE: toISODate(new Date()), PROJECT: "", PROJECT_CODE: "", HOURS: "" },
    ]);
  }

  function removeRow(idx: number) {
    setGrid((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!docId) return;
    const lines: Omit<GroundTruthLine, "GT_ID" | "ENTERED_AT">[] = grid
      .filter((r) => r.WORKER && r.WORK_DATE && r.HOURS)
      .map((r) => ({
        DOC_ID: docId!,
        WORKER: r.WORKER,
        WORK_DATE: r.WORK_DATE,
        PROJECT: r.PROJECT || null,
        PROJECT_CODE: r.PROJECT_CODE || null,
        HOURS: parseFloat(r.HOURS),
        ENTERED_BY: "analyst",
      }));

    toast.promise(save.mutateAsync({ docId, lines }), {
      loading: "Saving ground truth…",
      success: `Saved ${lines.length} rows`,
      error: (err) => `Save failed: ${err}`,
    });
  }

  return (
    <div>
      <PageHeader
        title="Ground Truth Entry"
        description="Enter correct timesheet data to measure extraction accuracy."
        actions={
          <Button onClick={handleSave} disabled={!docId || save.isPending}>
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
        }
      />

      <div className="mb-6">
        <Select value={selectedDoc} onValueChange={setSelectedDoc}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select document…" />
          </SelectTrigger>
          <SelectContent>
            {docs.map((d) => (
              <SelectItem key={d.DOC_ID} value={String(d.DOC_ID)}>
                [{d.DOC_ID}] {d.FILE_NAME}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {docId && (
        <>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["Worker", "Date", "Project", "Code", "Hours", ""].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left font-medium text-muted-foreground"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {grid.map((row, i) => (
                  <tr key={i} className="border-t">
                    {(
                      [
                        "WORKER",
                        "WORK_DATE",
                        "PROJECT",
                        "PROJECT_CODE",
                        "HOURS",
                      ] as (keyof GridRow)[]
                    ).map((field) => (
                      <td key={field} className="px-2 py-1">
                        <Input
                          value={row[field]}
                          onChange={(e) => updateCell(i, field, e.target.value)}
                          type={
                            field === "WORK_DATE"
                              ? "date"
                              : field === "HOURS"
                              ? "number"
                              : "text"
                          }
                          className="h-8 text-sm"
                          step={field === "HOURS" ? "0.5" : undefined}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => removeRow(i)}
                      >
                        ×
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="outline" size="sm" className="mt-3" onClick={addRow}>
            + Add Row
          </Button>
        </>
      )}
    </div>
  );
}
