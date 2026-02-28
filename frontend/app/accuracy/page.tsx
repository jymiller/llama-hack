"use client";

import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { useAccuracy } from "@/hooks/queries";
import { AccuracyRow } from "@/lib/types";

export default function AccuracyPage() {
  const { data: rows = [], isLoading } = useAccuracy();

  const withGt = rows.filter((r) => r.GT_HOURS != null);
  const exactMatch = withGt.filter((r) => r.HOURS_DELTA === 0).length;
  const avgDelta =
    withGt.length > 0
      ? withGt.reduce((s, r) => s + Math.abs(r.HOURS_DELTA ?? 0), 0) /
        withGt.length
      : 0;
  const accuracy =
    withGt.length > 0 ? ((exactMatch / withGt.length) * 100).toFixed(1) : "—";

  const columns: ColumnDef<AccuracyRow>[] = [
    { accessorKey: "DOC_ID", header: "Doc", size: 60 },
    { accessorKey: "WORKER", header: "Worker" },
    { accessorKey: "WORK_DATE", header: "Date" },
    {
      accessorKey: "EXTRACTED_HOURS",
      header: "Extracted",
      cell: ({ getValue }) => getValue<number>()?.toFixed(2) ?? "—",
    },
    {
      accessorKey: "GT_HOURS",
      header: "Ground Truth",
      cell: ({ getValue }) => getValue<number>()?.toFixed(2) ?? "—",
    },
    {
      accessorKey: "HOURS_DELTA",
      header: "Δ Hours",
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return "—";
        const color =
          v === 0
            ? "text-green-600"
            : Math.abs(v) < 1
            ? "text-yellow-600"
            : "text-red-600";
        return (
          <span className={`font-mono text-sm ${color}`}>
            {v >= 0 ? "+" : ""}
            {v.toFixed(2)}
          </span>
        );
      },
    },
    {
      accessorKey: "EXTRACTION_CONFIDENCE",
      header: "Confidence",
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return "—";
        return <span className="font-mono text-sm">{(v * 100).toFixed(0)}%</span>;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Accuracy Comparison"
        description="Extraction results vs analyst-verified ground truth."
      />

      <div className="grid grid-cols-3 gap-4 mb-8">
        <MetricCard title="Lines with GT" value={withGt.length} />
        <MetricCard
          title="Exact Match Rate"
          value={`${accuracy}%`}
          description={`${exactMatch} of ${withGt.length} lines`}
          deltaPositive={Number(accuracy) >= 90}
        />
        <MetricCard
          title="Avg Hour Delta"
          value={avgDelta.toFixed(2)}
          description="Mean absolute error"
          deltaPositive={avgDelta < 0.5}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          searchColumn="WORKER"
          searchPlaceholder="Search by worker…"
        />
      )}
    </div>
  );
}
