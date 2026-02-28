"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReconciliation, useRunReconciliation, useMonthlyWorkerSummary, useNicknameMaps } from "@/hooks/queries";
import { ReconSummary, MonthlyWorkerRow } from "@/lib/types";
import { formatCurrency, formatPct } from "@/lib/utils";

export default function ReconciliationPage() {
  const { data, isLoading } = useReconciliation();
  const runRecon = useRunReconciliation();
  const { data: monthly = [] } = useMonthlyWorkerSummary();
  const { nickW } = useNicknameMaps();
  const [rate, setRate] = useState("150");

  const summary = data?.summary ?? [];
  const ledger = data?.ledger ?? [];

  const totalApprovedHours = ledger.reduce(
    (s, r) => s + (r.CORRECTED_HOURS ?? r.HOURS),
    0
  );
  const totalComputed = summary.reduce((s, r) => s + r.COMPUTED_AMOUNT, 0);
  const totalInvoice = summary.reduce(
    (s, r) => s + (r.INVOICE_AMOUNT ?? 0),
    0
  );
  const matchCount = summary.filter((r) => r.STATUS === "MATCH").length;
  const varianceCount = summary.filter((r) => r.STATUS === "VARIANCE").length;

  async function handleRun() {
    const r = parseFloat(rate);
    if (isNaN(r) || r <= 0) {
      toast.error("Enter a valid hourly rate");
      return;
    }
    toast.promise(runRecon.mutateAsync(r), {
      loading: `Running reconciliation at ${formatCurrency(r)}/hr…`,
      success: "Reconciliation complete",
      error: (err) => `Error: ${err}`,
    });
  }

  const columns: ColumnDef<ReconSummary>[] = [
    { accessorKey: "PERIOD_MONTH", header: "Period" },
    { accessorKey: "WORKER", header: "Worker" },
    {
      accessorKey: "APPROVED_HOURS",
      header: "Approved h",
      cell: ({ getValue }) => getValue<number>().toFixed(2),
    },
    {
      accessorKey: "HOURLY_RATE",
      header: "Rate",
      cell: ({ getValue }) => formatCurrency(getValue<number>()),
    },
    {
      accessorKey: "COMPUTED_AMOUNT",
      header: "Computed",
      cell: ({ getValue }) => formatCurrency(getValue<number>()),
    },
    {
      accessorKey: "INVOICE_AMOUNT",
      header: "Invoice",
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        return v != null ? formatCurrency(v) : "—";
      },
    },
    {
      accessorKey: "VARIANCE",
      header: "Variance",
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return "—";
        return (
          <span className={v === 0 ? "text-green-600" : "text-red-600"}>
            {formatCurrency(v)}
          </span>
        );
      },
    },
    {
      accessorKey: "VARIANCE_PCT",
      header: "Var %",
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v == null) return "—";
        return (
          <span className={Math.abs(v) < 1 ? "text-green-600" : "text-red-600"}>
            {formatPct(v)}
          </span>
        );
      },
    },
    {
      accessorKey: "STATUS",
      header: "Status",
      cell: ({ getValue }) => <StatusBadge status={getValue<string>()} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Reconciliation"
        description="Monthly approved hours vs invoice amounts with variance analysis."
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Rate $/hr</Label>
              <Input
                type="number"
                className="w-24 h-8"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                min="0"
                step="0.01"
              />
            </div>
            <Button onClick={handleRun} disabled={runRecon.isPending}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Run Reconciliation
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <MetricCard
          title="Approved Hours"
          value={totalApprovedHours.toFixed(1)}
          description="from trusted ledger"
        />
        <MetricCard
          title="Computed Amount"
          value={formatCurrency(totalComputed)}
          description={`at $${rate}/hr`}
        />
        <MetricCard
          title="Invoice Total"
          value={totalInvoice > 0 ? formatCurrency(totalInvoice) : "—"}
          description="from invoices"
        />
        <MetricCard
          title="Match / Variance"
          value={`${matchCount} / ${varianceCount}`}
          description="periods"
          deltaPositive={varianceCount === 0}
        />
      </div>

      {/* Monthly worker comparison */}
      {monthly.length > 0 && (
        <div className="mb-8">
          <h2 className="text-base font-semibold mb-3 text-slate-800">Monthly Worker Summary</h2>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  {["Worker", "Month", "Timesheet (extracted)", "GT Hours", "Δ vs GT", "Subcontract Invoice", "Δ vs Timesheet"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-slate-600 border-b border-slate-200">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthly.map((row: MonthlyWorkerRow, i: number) => {
                  const hasGT = row.GT_HOURS != null;
                  const hasInvoice = row.EXT_INVOICE_HOURS > 0;
                  const gtDelta = hasGT ? row.EXT_TIMESHEET_HOURS - row.GT_HOURS! : null;
                  const invDelta = hasInvoice ? row.EXT_INVOICE_HOURS - row.EXT_TIMESHEET_HOURS : null;
                  const gtMatched = gtDelta != null && Math.abs(gtDelta) < 0.01;
                  const invMatched = invDelta != null && Math.abs(invDelta) < 0.01;
                  return (
                    <tr key={`${row.WORKER}-${row.PERIOD_MONTH}`} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-3 py-2 border-b border-slate-100 font-medium">{nickW(row.WORKER)}</td>
                      <td className="px-3 py-2 border-b border-slate-100 font-mono text-xs">{row.PERIOD_MONTH}</td>
                      <td className="px-3 py-2 border-b border-slate-100 font-mono text-right">{row.EXT_TIMESHEET_HOURS.toFixed(1)}</td>
                      <td className="px-3 py-2 border-b border-slate-100 font-mono text-right">
                        {hasGT ? row.GT_HOURS!.toFixed(1) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 border-b border-slate-100 font-mono text-right">
                        {gtDelta == null ? <span className="text-slate-300">—</span> : (
                          <span className={gtMatched ? "text-green-600" : "text-red-600 font-semibold"}>
                            {gtDelta >= 0 ? "+" : ""}{gtDelta.toFixed(1)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 border-b border-slate-100 font-mono text-right">
                        {hasInvoice ? row.EXT_INVOICE_HOURS.toFixed(1) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 border-b border-slate-100 font-mono text-right">
                        {invDelta == null ? <span className="text-slate-300">—</span> : (
                          <span className={invMatched ? "text-green-600" : "text-red-600 font-semibold"}>
                            {invDelta >= 0 ? "+" : ""}{invDelta.toFixed(1)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <DataTable
          columns={columns}
          data={summary}
          searchColumn="WORKER"
          searchPlaceholder="Search by worker…"
        />
      )}

      {ledger.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-4">Trusted Ledger Summary</h2>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["Doc", "Worker", "Date", "Project", "Hours", "Decision"].map(
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
                {ledger.slice(0, 50).map((row) => (
                  <tr key={row.LINE_ID} className="border-t">
                    <td className="px-3 py-2">{row.DOC_ID}</td>
                    <td className="px-3 py-2">{row.WORKER ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.WORK_DATE ?? "—"}
                    </td>
                    <td className="px-3 py-2">{row.PROJECT ?? "—"}</td>
                    <td className="px-3 py-2 font-mono">
                      {(row.CORRECTED_HOURS ?? row.HOURS).toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.DECISION} />
                    </td>
                  </tr>
                ))}
                {ledger.length > 50 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-2 text-center text-xs text-muted-foreground"
                    >
                      … and {ledger.length - 50} more rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
