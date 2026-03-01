"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/metric-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMonthlyWorkerSummary } from "@/hooks/queries";
import { MonthlyWorkerRow } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

function gapColor(gap: number): string {
  const abs = Math.abs(gap);
  if (abs <= 2) return "text-green-600";
  if (abs <= 10) return "text-amber-600";
  return "text-red-600 font-semibold";
}

export default function ReconciliationPage() {
  const { data: monthly = [] } = useMonthlyWorkerSummary();
  const [rate, setRate] = useState("150");
  const rateNum = parseFloat(rate) || 0;

  const totalTimesheet = monthly.reduce((s, r) => s + r.EXT_TIMESHEET_HOURS, 0);
  const totalInvoice   = monthly.reduce((s, r) => s + r.EXT_INVOICE_HOURS,   0);
  const totalGap       = totalInvoice - totalTimesheet;
  const totalImpact    = totalGap * rateNum;

  return (
    <div>
      <PageHeader
        title="Reconciliation"
        description="Monthly timesheet vs invoice gap and financial impact."
        actions={
          <div className="flex items-center gap-2">
            <Label className="text-sm text-slate-600">Rate $/hr</Label>
            <Input
              type="number"
              className="w-24 h-8"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              min="0"
              step="0.01"
            />
          </div>
        }
      />

      {/* Summary metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <MetricCard
          title="Timesheet Hours"
          value={totalTimesheet.toFixed(1)}
          description="extracted from timesheets"
        />
        <MetricCard
          title="Invoice Hours"
          value={totalInvoice.toFixed(1)}
          description="extracted from invoices"
        />
        <MetricCard
          title="Gap"
          value={`${totalGap >= 0 ? "+" : ""}${totalGap.toFixed(1)} hrs`}
          description="invoice minus timesheet"
          deltaPositive={Math.abs(totalGap) <= 2}
        />
        <MetricCard
          title="$ Impact"
          value={rateNum > 0 ? formatCurrency(Math.abs(totalImpact)) : "—"}
          description={totalImpact > 0 ? "overbilled" : totalImpact < 0 ? "underbilled" : "no variance"}
          deltaPositive={Math.abs(totalImpact) === 0}
        />
      </div>

      {/* Gap by month */}
      {monthly.length > 0 && (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-slate-50">
              <tr>
                {["Month", "Timesheet Hrs", "Invoice Hrs", "Gap Hrs", `$ Impact @ $${rate}/hr`].map((h) => (
                  <th key={h} className="px-4 py-2 text-left font-semibold text-slate-600 border-b border-slate-200">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthly.map((row: MonthlyWorkerRow, i: number) => {
                const gap    = row.EXT_INVOICE_HOURS - row.EXT_TIMESHEET_HOURS;
                const impact = gap * rateNum;
                return (
                  <tr key={row.PERIOD_MONTH} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    <td className="px-4 py-3 border-b border-slate-100 font-mono text-xs">{row.PERIOD_MONTH}</td>
                    <td className="px-4 py-3 border-b border-slate-100 font-mono text-right">{row.EXT_TIMESHEET_HOURS.toFixed(1)}</td>
                    <td className="px-4 py-3 border-b border-slate-100 font-mono text-right">
                      {row.EXT_INVOICE_HOURS > 0 ? row.EXT_INVOICE_HOURS.toFixed(1) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={`px-4 py-3 border-b border-slate-100 font-mono text-right ${gapColor(gap)}`}>
                      {row.EXT_INVOICE_HOURS > 0
                        ? `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}`
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={`px-4 py-3 border-b border-slate-100 font-mono text-right ${gapColor(gap)}`}>
                      {row.EXT_INVOICE_HOURS > 0 && rateNum > 0
                        ? `${impact >= 0 ? "+" : "-"}${formatCurrency(Math.abs(impact))}`
                        : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {monthly.length > 1 && (
              <tfoot className="bg-slate-100 font-semibold">
                <tr>
                  <td className="px-4 py-2 text-slate-600">Total</td>
                  <td className="px-4 py-2 font-mono text-right">{totalTimesheet.toFixed(1)}</td>
                  <td className="px-4 py-2 font-mono text-right">{totalInvoice.toFixed(1)}</td>
                  <td className={`px-4 py-2 font-mono text-right ${gapColor(totalGap)}`}>
                    {`${totalGap >= 0 ? "+" : ""}${totalGap.toFixed(1)}`}
                  </td>
                  <td className={`px-4 py-2 font-mono text-right ${gapColor(totalGap)}`}>
                    {rateNum > 0 ? `${totalImpact >= 0 ? "+" : "-"}${formatCurrency(Math.abs(totalImpact))}` : "—"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
