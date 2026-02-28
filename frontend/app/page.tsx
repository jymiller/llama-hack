"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle, Circle } from "lucide-react";
import {
  useRunExtractionAll,
  useRunReconciliation,
  useMonthlyWorkerSummary,
} from "@/hooks/queries";
import type { MonthlyWorkerRow } from "@/lib/types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const YEARS = [2024, 2025, 2026];

type StepStatus = "pending" | "running" | "done" | "error";

function deltaColor(delta: number | null): string {
  if (delta == null) return "";
  const abs = Math.abs(delta);
  if (abs <= 2) return "text-green-600";
  if (abs <= 10) return "text-amber-600";
  return "text-red-600 font-semibold";
}

function StepRow({ label, status }: { label: string; status: StepStatus }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {status === "done" && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
      {status === "running" && <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />}
      {status === "pending" && <Circle className="h-4 w-4 text-slate-300 shrink-0" />}
      {status === "error" && <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
      <span
        className={
          status === "running"
            ? "text-blue-600 font-medium"
            : status === "done"
            ? "text-slate-700"
            : status === "error"
            ? "text-red-600"
            : "text-slate-400"
        }
      >
        {label}
      </span>
    </div>
  );
}

export default function Home() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [steps, setSteps] = useState<[StepStatus, StepStatus, StepStatus]>(
    ["pending", "pending", "pending"]
  );
  const [running, setRunning] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const extractAll = useRunExtractionAll();
  const runRecon = useRunReconciliation();
  const { data: monthly = [], refetch: refetchMonthly } = useMonthlyWorkerSummary();

  const selectedMonthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
  const filteredMonthly = monthly.filter((r) =>
    r.PERIOD_MONTH?.startsWith(selectedMonthStr)
  );

  async function handleRun() {
    setRunning(true);
    setShowResults(false);
    setSteps(["running", "pending", "pending"]);

    try {
      await extractAll.mutateAsync(undefined);
      setSteps(["done", "running", "pending"]);

      await new Promise((r) => setTimeout(r, 800));
      setSteps(["done", "done", "running"]);

      await runRecon.mutateAsync(150);
      await refetchMonthly();
      setSteps(["done", "done", "done"]);
      setShowResults(true);
    } catch {
      setSteps((prev) => {
        const next = [...prev] as [StepStatus, StepStatus, StepStatus];
        const idx = next.findIndex((s) => s === "running");
        if (idx >= 0) next[idx] = "error";
        return next;
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="-m-8 min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col items-center justify-start pt-16 px-8 pb-16">
      {/* Hero */}
      <div className="flex flex-col items-center mb-12">
        <img
          src="/agenticmeshbanner.png"
          alt="The Agentic Mesh Company"
          className="h-24 w-auto object-contain mb-4"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <h1 className="text-3xl font-bold text-white tracking-tight">
          Timesheet Reconciliation
        </h1>
        <p className="text-slate-400 mt-1 text-sm">The Agentic Mesh Company</p>
      </div>

      {/* Run card */}
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <h2 className="text-lg font-semibold text-slate-800 mb-6">Run Pipeline</h2>

        <div className="flex gap-3 mb-6">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-500 mb-1">Month</label>
            <select
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              disabled={running}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i}>{m}</option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <label className="block text-xs font-medium text-slate-500 mb-1">Year</label>
            <select
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              disabled={running}
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleRun}
          disabled={running}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg py-3 text-base transition-colors flex items-center justify-center gap-2"
        >
          {running && <Loader2 className="h-4 w-4 animate-spin" />}
          {running ? "Running…" : "Run Pipeline"}
        </button>

        {steps[0] !== "pending" && (
          <div className="mt-6 space-y-2 border-t border-slate-100 pt-4">
            <StepRow label="Extracting documents…" status={steps[0]} />
            <StepRow label="Comparing ground truth…" status={steps[1]} />
            <StepRow label="Reconciling invoice hours…" status={steps[2]} />
          </div>
        )}
      </div>

      {/* Results */}
      {showResults && filteredMonthly.length > 0 && (
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-3xl mt-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4">
            Results — {MONTHS[month]} {year}
          </h3>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  {["Worker", "Timesheet Hours", "GT Hours", "Δ GT", "Invoice Hours", "Δ Invoice"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-slate-600 border-b border-slate-200">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMonthly.map((row: MonthlyWorkerRow, i: number) => {
                  const hasGT = row.GT_HOURS != null;
                  const hasInvoice = row.EXT_INVOICE_HOURS > 0;
                  const gtDelta = hasGT ? row.EXT_TIMESHEET_HOURS - row.GT_HOURS! : null;
                  const invDelta = hasInvoice ? row.EXT_INVOICE_HOURS - row.EXT_TIMESHEET_HOURS : null;
                  return (
                    <tr
                      key={`${row.WORKER}-${row.PERIOD_MONTH}`}
                      className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}
                    >
                      <td className="px-3 py-2 border-b border-slate-100 font-medium">{row.WORKER}</td>
                      <td className="px-3 py-2 border-b border-slate-100 font-mono text-right">
                        {row.EXT_TIMESHEET_HOURS.toFixed(1)}
                      </td>
                      <td className="px-3 py-2 border-b border-slate-100 font-mono text-right">
                        {hasGT ? row.GT_HOURS!.toFixed(1) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className={`px-3 py-2 border-b border-slate-100 font-mono text-right ${deltaColor(gtDelta)}`}>
                        {gtDelta == null
                          ? <span className="text-slate-300">—</span>
                          : `${gtDelta >= 0 ? "+" : ""}${gtDelta.toFixed(1)}`}
                      </td>
                      <td className="px-3 py-2 border-b border-slate-100 font-mono text-right">
                        {hasInvoice ? row.EXT_INVOICE_HOURS.toFixed(1) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className={`px-3 py-2 border-b border-slate-100 font-mono text-right ${deltaColor(invDelta)}`}>
                        {invDelta == null
                          ? <span className="text-slate-300">—</span>
                          : `${invDelta >= 0 ? "+" : ""}${invDelta.toFixed(1)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-right">
            <Link href="/reconciliation" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
              → View Full Reconciliation
            </Link>
          </div>
        </div>
      )}

      {showResults && filteredMonthly.length === 0 && (
        <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-3xl mt-6 text-center text-slate-500 text-sm">
          No data found for {MONTHS[month]} {year}. Check that documents have been uploaded.
        </div>
      )}
    </div>
  );
}
