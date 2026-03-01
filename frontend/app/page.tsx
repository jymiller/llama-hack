"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle, Circle } from "lucide-react";
import {
  useRunExtractionAll,
  useRunReconciliation,
  useMonthlyWorkerSummary,
} from "@/hooks/queries";
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const YEARS = [2024, 2025, 2026];

type StepStatus = "pending" | "running" | "done" | "error";

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
      {showResults && filteredMonthly.length > 0 && (() => {
        const RATE = 150;
        const totalTS  = filteredMonthly.reduce((s, r) => s + r.EXT_TIMESHEET_HOURS, 0);
        const totalInv = filteredMonthly.reduce((s, r) => s + r.EXT_INVOICE_HOURS,   0);
        const totalGap = totalInv - totalTS;
        const totalImpact = totalGap * RATE;
        return (
          <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-2xl mt-6">
            <h3 className="text-base font-semibold text-slate-800 mb-6">
              {MONTHS[month]} {year} — Financial Impact
            </h3>

            {/* Big numbers */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Timesheet Hrs</p>
                <p className="text-3xl font-bold text-slate-800">{totalTS.toFixed(1)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Invoice Hrs</p>
                <p className="text-3xl font-bold text-slate-800">{totalInv > 0 ? totalInv.toFixed(1) : "—"}</p>
              </div>
              <div className="text-center">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">$ Impact</p>
                <p className={`text-3xl font-bold ${Math.abs(totalGap) <= 2 ? "text-green-600" : "text-red-600"}`}>
                  {totalInv > 0 ? `${totalImpact >= 0 ? "+" : "-"}$${Math.abs(totalImpact).toLocaleString()}` : "—"}
                </p>
              </div>
            </div>

            {/* Gap detail */}
            {totalInv > 0 && (
              <div className={`rounded-lg px-4 py-3 text-sm text-center ${Math.abs(totalGap) <= 2 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                Invoice is <strong>{Math.abs(totalGap).toFixed(1)} hrs {totalGap > 0 ? "over" : "under"}</strong> timesheet
                {" "}= <strong>{totalImpact >= 0 ? "+" : "-"}${Math.abs(totalImpact).toLocaleString()}</strong> at $150/hr
              </div>
            )}

            <div className="mt-4 text-right">
              <Link href="/reconciliation" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                → View Full Reconciliation
              </Link>
            </div>
          </div>
        );
      })()}

      {showResults && filteredMonthly.length === 0 && (
        <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-3xl mt-6 text-center text-slate-500 text-sm">
          No data found for {MONTHS[month]} {year}. Check that documents have been uploaded.
        </div>
      )}
    </div>
  );
}
