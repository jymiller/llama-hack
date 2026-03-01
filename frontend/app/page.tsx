"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle, Circle } from "lucide-react";
import {
  useRunExtractionAll,
  useMonthlyWorkerSummary,
} from "@/hooks/queries";

type HealthData = {
  status: "ok" | "degraded" | "down";
  snowflake: { connected: boolean; latency_ms: number | null };
  pipeline: {
    total_docs: number;
    docs_extracted: number;
    docs_pending: number;
    total_lines: number;
    avg_confidence: number | null;
  } | null;
  checked_at: string;
};

function SystemStatus() {
  const [health, setHealth] = useState<HealthData | null>(null);

  async function refresh() {
    try {
      const r = await fetch("/api/health");
      setHealth(await r.json());
    } catch {
      setHealth(null);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!health) return null;

  const { status, snowflake, pipeline } = health;

  const dotColor =
    status === "ok" ? "bg-green-400" :
    status === "degraded" ? "bg-yellow-400" : "bg-red-500";

  const statusLabel =
    status === "ok" ? "Snowflake connected" :
    status === "degraded" ? "Snowflake connected — extractions pending" :
    "Snowflake offline";

  return (
    <div className="bg-white/10 backdrop-blur rounded-xl px-5 py-4 w-full max-w-md mt-4 text-white text-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${dotColor}`} />
          <span className="font-medium">{statusLabel}</span>
        </div>
        {snowflake.latency_ms !== null && (
          <span className="text-white/50 text-xs">{snowflake.latency_ms}ms</span>
        )}
      </div>
      {pipeline && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-white/50 text-xs uppercase tracking-wide">Docs</p>
            <p className="text-lg font-semibold">{pipeline.total_docs}</p>
            <p className="text-white/40 text-xs">{pipeline.docs_extracted} extracted</p>
          </div>
          <div>
            <p className="text-white/50 text-xs uppercase tracking-wide">Lines</p>
            <p className="text-lg font-semibold">{pipeline.total_lines}</p>
            <p className="text-white/40 text-xs">from Claude</p>
          </div>
          <div>
            <p className="text-white/50 text-xs uppercase tracking-wide">Confidence</p>
            <p className="text-lg font-semibold">
              {pipeline.avg_confidence !== null
                ? `${(pipeline.avg_confidence * 100).toFixed(0)}%`
                : "—"}
            </p>
            <p className="text-white/40 text-xs">avg</p>
          </div>
        </div>
      )}
    </div>
  );
}
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
  const [steps, setSteps] = useState<[StepStatus, StepStatus]>(
    ["pending", "pending"]
  );
  const [running, setRunning] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const extractAll = useRunExtractionAll();
  const { data: monthly = [], refetch: refetchMonthly } = useMonthlyWorkerSummary();

  const selectedMonthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
  const filteredMonthly = monthly.filter((r) =>
    r.PERIOD_MONTH?.startsWith(selectedMonthStr)
  );

  async function handleRun() {
    setRunning(true);
    setShowResults(false);
    setSteps(["running", "pending"]);

    try {
      await extractAll.mutateAsync(undefined);
      setSteps(["done", "running"]);

      await refetchMonthly();
      setSteps(["done", "done"]);
      setShowResults(true);
    } catch {
      setSteps((prev) => {
        const next = [...prev] as [StepStatus, StepStatus];
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
            <StepRow label="Computing gap…" status={steps[1]} />
          </div>
        )}
      </div>

      <SystemStatus />

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
