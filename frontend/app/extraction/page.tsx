"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Cpu, Play } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { Button } from "@/components/ui/button";
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
  useRunExtraction,
} from "@/hooks/queries";
import { ExtractedLine } from "@/lib/types";

export default function ExtractionPage() {
  const { data: docs = [] } = useDocuments();
  const { data: lines = [], isLoading } = useExtractedLines();
  const runExtraction = useRunExtraction();
  const [selectedDoc, setSelectedDoc] = useState<string>("");

  const totalLines = lines.length;
  const avgConfidence =
    lines.length > 0
      ? lines.reduce((s, l) => s + (l.EXTRACTION_CONFIDENCE ?? 0), 0) /
        lines.length
      : 0;
  const workers = new Set(lines.map((l) => l.WORKER)).size;

  async function handleExtract() {
    if (!selectedDoc) return;
    toast.promise(runExtraction.mutateAsync(Number(selectedDoc)), {
      loading: "Running multimodal extraction…",
      success: "Extraction complete",
      error: (err) => `Extraction failed: ${err}`,
    });
  }

  const columns: ColumnDef<ExtractedLine>[] = [
    { accessorKey: "LINE_ID", header: "ID", size: 60 },
    { accessorKey: "DOC_ID", header: "Doc", size: 60 },
    { accessorKey: "WORKER", header: "Worker" },
    { accessorKey: "WORK_DATE", header: "Date" },
    { accessorKey: "PROJECT", header: "Project" },
    { accessorKey: "PROJECT_CODE", header: "Code" },
    {
      accessorKey: "HOURS",
      header: "Hours",
      cell: ({ getValue }) => getValue<number>()?.toFixed(2) ?? "—",
    },
    {
      accessorKey: "EXTRACTION_CONFIDENCE",
      header: "Confidence",
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return "—";
        const pct = (v * 100).toFixed(0);
        const color =
          v >= 0.8
            ? "text-green-600"
            : v >= 0.6
            ? "text-yellow-600"
            : "text-red-600";
        return <span className={`font-mono text-sm ${color}`}>{pct}%</span>;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Extraction"
        description="Run Claude multimodal extraction on uploaded documents."
        actions={
          <div className="flex items-center gap-2">
            <Select value={selectedDoc} onValueChange={setSelectedDoc}>
              <SelectTrigger className="w-56">
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
            <Button
              onClick={handleExtract}
              disabled={!selectedDoc || runExtraction.isPending}
            >
              <Play className="h-4 w-4 mr-2" />
              Extract
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-4 mb-8">
        <MetricCard title="Extracted Lines" value={totalLines} />
        <MetricCard
          title="Avg Confidence"
          value={`${(avgConfidence * 100).toFixed(1)}%`}
          description={avgConfidence >= 0.7 ? "Within threshold" : "Below threshold"}
          deltaPositive={avgConfidence >= 0.7}
        />
        <MetricCard title="Unique Workers" value={workers} />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <DataTable
          columns={columns}
          data={lines}
          searchColumn="WORKER"
          searchPlaceholder="Search by worker…"
        />
      )}
    </div>
  );
}
