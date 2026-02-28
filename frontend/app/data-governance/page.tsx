"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, CheckCircle, AlertTriangle, Circle, GitMerge, Trash2, Info, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useMasterProjects,
  useMasterWorkers,
  useConfirmProject,
  useConfirmWorker,
  useSyncMaster,
  useProjectMerges,
  useCreateMerge,
  useDeleteMerge,
  useApplyMerges,
  useMergeProvenance,
} from "@/hooks/queries";
import { CuratedProject, CuratedWorker, ProjectCodeSuspect } from "@/lib/types";

type Tab = "projects" | "workers" | "merges" | "provenance";

function SourceBadge({ source }: { source: string }) {
  if (source === "fuzzy_match")
    return (
      <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50 text-[10px]">
        fuzzy match
      </Badge>
    );
  if (source === "manual")
    return (
      <Badge variant="outline" className="border-blue-400 text-blue-700 bg-blue-50 text-[10px]">
        manual
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-slate-500 text-[10px]">
      auto
    </Badge>
  );
}

function ConfirmedIcon({ confirmed }: { confirmed: boolean }) {
  return confirmed ? (
    <CheckCircle className="h-4 w-4 text-green-600" />
  ) : (
    <Circle className="h-4 w-4 text-slate-300" />
  );
}

function NicknameCell({
  value,
  placeholder,
  onSave,
}: {
  value: string | null;
  placeholder: string;
  onSave: (nickname: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next !== value) onSave(next);
  }

  if (editing) {
    return (
      <Input
        autoFocus
        className="h-6 text-xs px-2 w-36"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); }
        }}
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(value ?? ""); setEditing(true); }}
      className={`text-xs px-2 py-0.5 rounded border border-dashed transition-colors text-left w-36 truncate ${
        value
          ? "border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100"
          : "border-slate-200 text-slate-400 hover:border-slate-400 hover:text-slate-600"
      }`}
      title={value ? `Nickname: ${value} — click to edit` : "Click to set nickname"}
    >
      {value ?? "Set nickname…"}
    </button>
  );
}

export default function DataGovernancePage() {
  const [tab, setTab] = useState<Tab>("projects");
  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeReason, setMergeReason] = useState("");

  const { data: projectData, isLoading: projLoading } = useMasterProjects();
  const { data: workerData, isLoading: wrkLoading } = useMasterWorkers();
  const { data: merges = [] } = useProjectMerges();
  const { data: provenance = [] } = useMergeProvenance();
  const confirmProject = useConfirmProject();
  const confirmWorker = useConfirmWorker();
  const sync = useSyncMaster();
  const createMerge = useCreateMerge();
  const deleteMerge = useDeleteMerge();
  const applyMerges = useApplyMerges();

  function handleSync() {
    toast.promise(sync.mutateAsync(), {
      loading: "Syncing master data from extracted lines…",
      success: (d) => d.message ?? "Sync complete",
      error: (e) => `Sync failed: ${e}`,
    });
  }

  function handleCreateMergeFromSuspect(suspect: ProjectCodeSuspect) {
    const reason = `OCR misread — edit distance ${suspect.EDIT_DIST} from confirmed code '${suspect.MASTER_CODE}'`;
    toast.promise(
      createMerge.mutateAsync({
        source_code: suspect.EXTRACTED_CODE,
        target_code: suspect.MASTER_CODE,
        merge_reason: reason,
      }),
      {
        loading: "Creating merge…",
        success: `${suspect.EXTRACTED_CODE} → ${suspect.MASTER_CODE} merge created`,
        error: (e) => `Error: ${e}`,
      }
    );
  }

  function handleCreateMerge() {
    if (!mergeSource || !mergeTarget) return;
    toast.promise(
      createMerge.mutateAsync({
        source_code: mergeSource,
        target_code: mergeTarget,
        merge_reason: mergeReason || undefined,
      }),
      {
        loading: "Creating merge…",
        success: `${mergeSource} → ${mergeTarget} merge created`,
        error: (e) => `Error: ${e}`,
      }
    );
    setMergeSource("");
    setMergeTarget("");
    setMergeReason("");
  }

  function handleDeleteMerge(mergeId: string, sourceCode: string) {
    toast.promise(deleteMerge.mutateAsync(mergeId), {
      loading: "Removing merge…",
      success: `Merge for ${sourceCode} removed`,
      error: (e) => `Error: ${e}`,
    });
  }

  function handleApplyMerges() {
    toast.promise(applyMerges.mutateAsync(), {
      loading: "Applying merges to extracted lines…",
      success: (d) => d.message ?? "Merges applied",
      error: (e) => `Error: ${e}`,
    });
  }

  function handleConfirmProject(p: CuratedProject) {
    toast.promise(
      confirmProject.mutateAsync({ project_code: p.PROJECT_CODE, confirmed: true }),
      {
        loading: "Confirming…",
        success: `${p.PROJECT_CODE} confirmed`,
        error: (e) => `Error: ${e}`,
      }
    );
  }

  function handleConfirmWorker(w: CuratedWorker) {
    toast.promise(
      confirmWorker.mutateAsync({ worker_key: w.WORKER_KEY, confirmed: true }),
      {
        loading: "Confirming…",
        success: `${w.DISPLAY_NAME ?? w.WORKER_KEY} confirmed`,
        error: (e) => `Error: ${e}`,
      }
    );
  }

  function handleSaveWorkerNickname(workerKey: string, nickname: string | null) {
    toast.promise(
      confirmWorker.mutateAsync({ worker_key: workerKey, nickname }),
      {
        loading: "Saving nickname…",
        success: nickname ? `Nickname set to "${nickname}"` : "Nickname cleared",
        error: (e) => `Error: ${e}`,
      }
    );
  }

  function handleSaveProjectNickname(projectCode: string, nickname: string | null) {
    toast.promise(
      confirmProject.mutateAsync({ project_code: projectCode, nickname }),
      {
        loading: "Saving nickname…",
        success: nickname ? `Nickname set to "${nickname}"` : "Nickname cleared",
        error: (e) => `Error: ${e}`,
      }
    );
  }

  const projects = projectData?.projects ?? [];
  const projectSuspects = projectData?.suspects ?? [];
  const workers = workerData?.workers ?? [];
  const workerSuspects = workerData?.suspects ?? [];

  const unconfirmedProjects = projects.filter((p) => !p.CONFIRMED);
  const confirmedProjects = projects.filter((p) => p.CONFIRMED && p.IS_ACTIVE);
  const unconfirmedWorkers = workers.filter((w) => !w.CONFIRMED);
  const confirmedWorkers = workers.filter((w) => w.CONFIRMED && w.IS_ACTIVE);

  const pendingSuspects = projectSuspects.filter(
    (s) => !merges.some((m) => m.SOURCE_CODE === s.EXTRACTED_CODE)
  );
  const isClean =
    unconfirmedProjects.length === 0 &&
    unconfirmedWorkers.length === 0 &&
    pendingSuspects.length === 0;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Data Governance"
        description="Canonical project codes and worker identities. Set nicknames to replace real names in all output views."
        actions={
          <div className="flex gap-2">
            {merges.length > 0 && (
              <Button onClick={handleApplyMerges} disabled={applyMerges.isPending}>
                <GitMerge className="h-4 w-4 mr-2" />
                Apply Merges to Data
              </Button>
            )}
            <Button variant="outline" onClick={handleSync} disabled={sync.isPending}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Sync from Extraction
            </Button>
          </div>
        }
      />

      {/* ── Privacy notice ── */}
      <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 mb-4 flex items-start gap-2">
        <ShieldCheck className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" />
        <p className="text-xs text-violet-800">
          <strong>Privacy control:</strong> Set a <em>Nickname</em> for any confirmed worker or project to replace the real name in all output views (Trusted Ledger, Reconciliation, exports). The original name is retained here for reference only. Click any nickname cell to edit — press Enter or click away to save.
        </p>
      </div>

      {/* ── Workflow guide ── */}
      <div className={`rounded-lg border p-4 mb-6 ${isClean ? "border-green-200 bg-green-50" : "border-blue-200 bg-blue-50"}`}>
        {isClean ? (
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-800">Data is clean — no action required.</p>
              <p className="text-xs text-green-700 mt-0.5">
                All project codes are confirmed, no OCR suspects detected. Check the <strong>Provenance</strong> tab to review the final canonical list.
              </p>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Info className="h-5 w-5 text-blue-600 shrink-0" />
              <p className="text-sm font-semibold text-blue-800">How to clean up master data after a new extraction:</p>
            </div>
            <ol className="space-y-1.5 text-xs text-blue-900 ml-6 list-decimal">
              <li>
                <strong>Sync from Extraction</strong> — pulls any new project codes or worker names from the extracted data into this master list as unconfirmed entries.
                {unconfirmedProjects.length > 0 || unconfirmedWorkers.length > 0 ? (
                  <span className="ml-2 text-amber-700 font-semibold">
                    ↳ {unconfirmedProjects.length} project(s) and {unconfirmedWorkers.length} worker(s) need review on the tabs below.
                  </span>
                ) : (
                  <span className="ml-2 text-green-700">✓ done</span>
                )}
              </li>
              <li>
                <strong>Review the Merges tab</strong> — the system automatically detects codes that look like OCR misreads (e.g. "Q" mistaken for "G"). Click <em>Create merge</em> on any that look correct, then click <strong>Apply Merges to Data</strong>.
                {pendingSuspects.length > 0 ? (
                  <span className="ml-2 text-amber-700 font-semibold">
                    ↳ {pendingSuspects.length} suggested merge(s) waiting.
                  </span>
                ) : (
                  <span className="ml-2 text-green-700">✓ done</span>
                )}
              </li>
              <li>
                <strong>Confirm remaining project codes and workers</strong> — any new codes not caught by the merge detector need a human to say "yes, this is a real project". Hit <em>Confirm</em> on the Projects and Workers tabs.
              </li>
              <li>
                <strong>Check the Provenance tab</strong> — if the canonical list looks right, <strong>you&apos;re done</strong>. There is no separate approval step for merges.
              </li>
            </ol>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {(["projects", "workers", "merges", "provenance"] as Tab[]).map((t) => {
          const alertCount =
            t === "projects" ? unconfirmedProjects.length
            : t === "workers" ? unconfirmedWorkers.length
            : t === "merges" ? pendingSuspects.length
            : 0;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors flex items-center gap-1.5 ${
                tab === t
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t === "projects" ? `Projects (${confirmedProjects.length} confirmed)`
                : t === "workers" ? `Workers (${confirmedWorkers.length} confirmed)`
                : t === "merges" ? `Merges (${merges.length})`
                : `Provenance`}
              {alertCount > 0 && (
                <span className="bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                  {alertCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Projects tab ── */}
      {tab === "projects" && (
        <div className="space-y-6">
          <p className="text-sm text-slate-500">
            These are the authoritative project codes. Codes are added automatically when extraction runs.
            <strong> Confirming</strong> a code means you&apos;ve verified it&apos;s a real project.
            Use the <strong className="text-violet-700">Nickname</strong> column to substitute a privacy alias that replaces the client&apos;s real project name in all output views.
          </p>

          {/* Fuzzy-match suspects banner */}
          {projectSuspects.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-800">
                  {projectSuspects.length} possible OCR misread(s) detected — go to the <button className="underline" onClick={() => setTab("merges")}>Merges tab</button> to fix them.
                </span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-amber-700 font-semibold">
                    <th className="text-left py-1 pr-4">Extracted code</th>
                    <th className="text-left py-1 pr-4">Closest master code</th>
                    <th className="text-left py-1 pr-4">Master name</th>
                    <th className="text-left py-1 pr-4">Edit dist</th>
                    <th className="text-left py-1 pr-4">Doc</th>
                  </tr>
                </thead>
                <tbody>
                  {projectSuspects.map((s) => (
                    <tr key={`${s.LINE_ID}`} className="border-t border-amber-200">
                      <td className="py-1 pr-4 font-mono text-red-700">{s.EXTRACTED_CODE}</td>
                      <td className="py-1 pr-4 font-mono text-green-700">{s.MASTER_CODE}</td>
                      <td className="py-1 pr-4 text-slate-700 max-w-[220px] truncate" title={s.MASTER_NAME ?? ""}>
                        {s.MASTER_NAME}
                      </td>
                      <td className="py-1 pr-4 text-center">{s.EDIT_DIST}</td>
                      <td className="py-1 pr-4 text-slate-500">{s.DOC_ID}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Unconfirmed queue */}
          {unconfirmedProjects.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-700 mb-1">
                Pending review ({unconfirmedProjects.length})
              </h3>
              <p className="text-xs text-slate-400 mb-2">
                These codes appeared in extracted data but haven&apos;t been verified yet. Hit <em>Confirm</em> if it&apos;s a real project. If it&apos;s a misread of another code, go to the Merges tab instead.
              </p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-left">
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Code</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Project name</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Source</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">First seen</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {unconfirmedProjects.map((p) => (
                    <tr key={p.PROJECT_CODE} className={p.CURATION_SOURCE === "fuzzy_match" ? "bg-amber-50" : "bg-white"}>
                      <td className="px-3 py-2 border border-slate-200 font-mono text-[11px]">
                        {p.PROJECT_CODE}
                        {p.MATCHED_FROM_CODE && (
                          <div className="text-[9px] text-amber-600">
                            extracted as: {p.MATCHED_FROM_CODE}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 border border-slate-200 max-w-[260px]">
                        <div className="truncate" title={p.PROJECT_NAME ?? ""}>{p.PROJECT_NAME}</div>
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
                        <SourceBadge source={p.CURATION_SOURCE} />
                      </td>
                      <td className="px-3 py-2 border border-slate-200 text-slate-500">
                        {p.FIRST_SEEN ?? "—"}
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px] px-2"
                          onClick={() => handleConfirmProject(p)}
                          disabled={confirmProject.isPending}
                        >
                          Confirm
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Confirmed master list */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 mb-1">
              Confirmed master list ({confirmedProjects.length})
            </h3>
            <p className="text-xs text-slate-400 mb-2">
              Click any <span className="text-violet-600 font-medium">Nickname</span> cell to set a privacy alias — it will replace the real project name everywhere in output views.
            </p>
            {projLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : confirmedProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No confirmed projects yet. Click Confirm on entries above.</p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-left">
                    <th className="px-3 py-2 border border-slate-200 font-semibold w-6"></th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Code</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Project name</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">
                      <span className="text-violet-700 flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" /> Nickname
                      </span>
                    </th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Source</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">First seen</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedProjects.map((p, i) => (
                    <tr key={p.PROJECT_CODE} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-3 py-2 border border-slate-200">
                        <ConfirmedIcon confirmed={p.CONFIRMED} />
                      </td>
                      <td className="px-3 py-2 border border-slate-200 font-mono text-[11px] text-blue-800">
                        {p.PROJECT_CODE}
                      </td>
                      <td className="px-3 py-2 border border-slate-200 max-w-[260px]">
                        <div className="truncate text-slate-500" title={p.PROJECT_NAME ?? ""}>{p.PROJECT_NAME}</div>
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
                        <NicknameCell
                          value={p.NICKNAME}
                          placeholder="e.g. Project Alpha"
                          onSave={(nickname) => handleSaveProjectNickname(p.PROJECT_CODE, nickname)}
                        />
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
                        <SourceBadge source={p.CURATION_SOURCE} />
                      </td>
                      <td className="px-3 py-2 border border-slate-200 text-slate-500">
                        {p.FIRST_SEEN ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {/* ── Workers tab ── */}
      {tab === "workers" && (
        <div className="space-y-6">
          <p className="text-sm text-slate-500">
            The canonical list of workers. Confirming a worker means you&apos;ve verified the name is correctly identified — confirmed workers are used to detect future name variations.
            Use the <strong className="text-violet-700">Nickname</strong> column to substitute a privacy alias that replaces the real worker name in all output views.
          </p>

          {/* Fuzzy-match suspects banner */}
          {workerSuspects.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-800">
                  {workerSuspects.length} possible worker name variant(s) detected
                </span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-amber-700 font-semibold">
                    <th className="text-left py-1 pr-4">Extracted name</th>
                    <th className="text-left py-1 pr-4">Closest master</th>
                    <th className="text-left py-1 pr-4">Edit dist</th>
                    <th className="text-left py-1 pr-4">Doc</th>
                  </tr>
                </thead>
                <tbody>
                  {workerSuspects.map((s) => (
                    <tr key={s.LINE_ID} className="border-t border-amber-200">
                      <td className="py-1 pr-4 text-red-700">{s.EXTRACTED_WORKER}</td>
                      <td className="py-1 pr-4 text-green-700">{s.MASTER_DISPLAY_NAME}</td>
                      <td className="py-1 pr-4 text-center">{s.EDIT_DIST}</td>
                      <td className="py-1 pr-4 text-slate-500">{s.DOC_ID}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Unconfirmed queue */}
          {unconfirmedWorkers.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-700 mb-1">
                Pending review ({unconfirmedWorkers.length})
              </h3>
              <p className="text-xs text-slate-400 mb-2">
                These worker names appeared in extracted data but haven&apos;t been verified yet.
              </p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-left">
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Worker key</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Display name</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Source</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">First seen</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {unconfirmedWorkers.map((w) => (
                    <tr key={w.WORKER_KEY} className="bg-white">
                      <td className="px-3 py-2 border border-slate-200 font-mono text-[11px]">
                        {w.WORKER_KEY}
                      </td>
                      <td className="px-3 py-2 border border-slate-200">{w.DISPLAY_NAME}</td>
                      <td className="px-3 py-2 border border-slate-200">
                        <SourceBadge source={w.CURATION_SOURCE} />
                      </td>
                      <td className="px-3 py-2 border border-slate-200 text-slate-500">
                        {w.FIRST_SEEN ?? "—"}
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px] px-2"
                          onClick={() => handleConfirmWorker(w)}
                          disabled={confirmWorker.isPending}
                        >
                          Confirm
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Confirmed master list */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 mb-1">
              Confirmed master list ({confirmedWorkers.length})
            </h3>
            <p className="text-xs text-slate-400 mb-2">
              Click any <span className="text-violet-600 font-medium">Nickname</span> cell to set a privacy alias — it replaces the real name everywhere in the app.
            </p>
            {wrkLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : confirmedWorkers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No confirmed workers yet.</p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-left">
                    <th className="px-3 py-2 border border-slate-200 font-semibold w-6"></th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Display name</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">
                      <span className="text-violet-700 flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" /> Nickname
                      </span>
                    </th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Source</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">First seen</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedWorkers.map((w, i) => (
                    <tr key={w.WORKER_KEY} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-3 py-2 border border-slate-200">
                        <ConfirmedIcon confirmed={w.CONFIRMED} />
                      </td>
                      <td className="px-3 py-2 border border-slate-200 font-medium">
                        {w.DISPLAY_NAME}
                        <div className="text-[10px] text-slate-400 font-mono font-normal">{w.WORKER_KEY}</div>
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
                        <NicknameCell
                          value={w.NICKNAME}
                          placeholder="e.g. Consultant A"
                          onSave={(nickname) => handleSaveWorkerNickname(w.WORKER_KEY, nickname)}
                        />
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
                        <SourceBadge source={w.CURATION_SOURCE} />
                      </td>
                      <td className="px-3 py-2 border border-slate-200 text-slate-500">
                        {w.FIRST_SEEN ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {/* ── Merges tab ── */}
      {tab === "merges" && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 space-y-1">
            <p>
              <strong>What is a merge?</strong> When OCR misreads a project code (e.g. reads <code className="bg-slate-200 px-1 rounded text-xs">006QI...</code> instead of <code className="bg-slate-200 px-1 rounded text-xs">006GI...</code>), a merge maps the misread code to the correct canonical one.
            </p>
            <p>
              <strong>Creating a merge is the approval.</strong> There is no separate sign-off step — once you click <em>Create merge</em> and then <em>Apply Merges to Data</em>, the extracted data is corrected immediately. The full audit trail is on the <button className="underline text-blue-600" onClick={() => setTab("provenance")}>Provenance tab</button>.
            </p>
            <p>
              <strong>Apply Merges to Data</strong> (top right) rewrites the extracted lines with the correct codes. Run it after adding new merges. It is safe to run more than once.
            </p>
          </div>

          {/* Suggested merges from suspect view */}
          {projectSuspects.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Suggested merges — possible OCR misreads ({pendingSuspects.length} pending)
              </h3>
              <p className="text-xs text-slate-400 mb-2">
                Automatically detected by comparing extracted codes to the confirmed master list using edit-distance. Review each one and click <em>Create merge</em> if it looks correct.
              </p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-amber-50 text-left">
                    <th className="px-3 py-2 border border-amber-200 font-semibold">Extracted (misread)</th>
                    <th className="px-3 py-2 border border-amber-200 font-semibold">→ Canonical code</th>
                    <th className="px-3 py-2 border border-amber-200 font-semibold">Canonical name</th>
                    <th className="px-3 py-2 border border-amber-200 font-semibold">Edit dist</th>
                    <th className="px-3 py-2 border border-amber-200 font-semibold">Doc</th>
                    <th className="px-3 py-2 border border-amber-200 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {projectSuspects.map((s) => {
                    const alreadyMerged = merges.some((m) => m.SOURCE_CODE === s.EXTRACTED_CODE);
                    return (
                      <tr key={s.LINE_ID} className={alreadyMerged ? "bg-green-50 opacity-60" : "bg-white"}>
                        <td className="px-3 py-2 border border-slate-200 font-mono text-[11px] text-red-700">
                          {s.EXTRACTED_CODE}
                        </td>
                        <td className="px-3 py-2 border border-slate-200 font-mono text-[11px] text-green-700">
                          {s.MASTER_CODE}
                        </td>
                        <td className="px-3 py-2 border border-slate-200 max-w-[220px]">
                          <div className="truncate text-[10px]" title={s.MASTER_NAME ?? ""}>{s.MASTER_NAME}</div>
                        </td>
                        <td className="px-3 py-2 border border-slate-200 text-center">{s.EDIT_DIST}</td>
                        <td className="px-3 py-2 border border-slate-200 text-slate-500">{s.DOC_ID}</td>
                        <td className="px-3 py-2 border border-slate-200">
                          {alreadyMerged ? (
                            <span className="text-[10px] text-green-600">✓ merged</span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[11px] px-2"
                              onClick={() => handleCreateMergeFromSuspect(s)}
                              disabled={createMerge.isPending}
                            >
                              Create merge
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {/* Active merges */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 mb-1">
              Active merges ({merges.length})
            </h3>
            <p className="text-xs text-slate-400 mb-2">
              All merges on record. Delete a merge only if it was created in error — deleting does not undo the correction already applied to extracted data (re-run extraction to start fresh).
            </p>
            {merges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No merges defined yet.</p>
            ) : (() => {
              const groups: Record<string, typeof merges> = {};
              for (const m of merges) {
                if (!groups[m.TARGET_CODE]) groups[m.TARGET_CODE] = [];
                groups[m.TARGET_CODE].push(m);
              }
              return (
                <div className="space-y-3">
                  {Object.entries(groups).map(([target, group]) => (
                    <div key={target} className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="bg-slate-100 px-4 py-2 flex items-center gap-3">
                        <span className="font-mono text-sm font-semibold text-green-800">{target}</span>
                        <span className="text-xs text-slate-500 flex-1 truncate" title={group[0].TARGET_NAME ?? ""}>
                          {group[0].TARGET_NAME}
                        </span>
                        <span className="text-xs text-slate-400">{group.length} source{group.length !== 1 ? "s" : ""} merged in</span>
                      </div>
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-white border-b border-slate-200 text-slate-500">
                            <th className="px-4 py-1.5 text-left font-medium pl-8">OCR variant (source)</th>
                            <th className="px-4 py-1.5 text-left font-medium">Reason</th>
                            <th className="px-4 py-1.5 text-left font-medium">Merged at</th>
                            <th className="px-4 py-1.5 text-left font-medium"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.map((m, i) => (
                            <tr key={m.MERGE_ID} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                              <td className="px-4 py-2 pl-8 font-mono text-[11px] text-red-700">
                                {m.SOURCE_CODE}
                              </td>
                              <td className="px-4 py-2 text-slate-500 text-[10px] max-w-[300px]">
                                <div className="truncate" title={m.MERGE_REASON ?? ""}>{m.MERGE_REASON ?? "—"}</div>
                              </td>
                              <td className="px-4 py-2 text-slate-400 text-[10px] whitespace-nowrap">
                                {m.MERGED_AT ? new Date(m.MERGED_AT).toLocaleDateString() : "—"}
                              </td>
                              <td className="px-4 py-2">
                                <button
                                  onClick={() => handleDeleteMerge(m.MERGE_ID, m.SOURCE_CODE)}
                                  disabled={deleteMerge.isPending}
                                  className="text-slate-400 hover:text-red-600 transition-colors"
                                  title="Remove merge"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              );
            })()}
          </section>

          {/* Manual merge form */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 mb-1">Manual merge</h3>
            <p className="text-xs text-slate-400 mb-3">
              For cases the automatic detector missed — e.g. two confirmed codes that turn out to be the same project.
            </p>
            <div className="flex gap-3 items-end flex-wrap">
              <div>
                <p className="text-[11px] text-slate-500 mb-1">Source (code to retire)</p>
                <Select value={mergeSource} onValueChange={setMergeSource}>
                  <SelectTrigger className="w-52 h-8 text-xs">
                    <SelectValue placeholder="Select source…" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.PROJECT_CODE} value={p.PROJECT_CODE}>
                        <span className="font-mono text-[11px]">{p.PROJECT_CODE}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="text-slate-400 pb-2 text-sm">→</div>
              <div>
                <p className="text-[11px] text-slate-500 mb-1">Target (canonical code to keep)</p>
                <Select value={mergeTarget} onValueChange={setMergeTarget}>
                  <SelectTrigger className="w-52 h-8 text-xs">
                    <SelectValue placeholder="Select target…" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects
                      .filter((p) => p.PROJECT_CODE !== mergeSource)
                      .map((p) => (
                        <SelectItem key={p.PROJECT_CODE} value={p.PROJECT_CODE}>
                          <span className="font-mono text-[11px]">{p.PROJECT_CODE}</span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <p className="text-[11px] text-slate-500 mb-1">Reason (optional)</p>
                <Input
                  className="h-8 text-xs"
                  placeholder="e.g. same project, different spelling"
                  value={mergeReason}
                  onChange={(e) => setMergeReason(e.target.value)}
                />
              </div>
              <Button
                className="h-8 text-xs"
                onClick={handleCreateMerge}
                disabled={!mergeSource || !mergeTarget || createMerge.isPending}
              >
                <GitMerge className="h-3.5 w-3.5 mr-1.5" />
                Create merge
              </Button>
            </div>
          </section>
        </div>
      )}

      {/* ── Provenance tab ── */}
      {tab === "provenance" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 space-y-1">
            <p>
              <strong>This is the final canonical picture.</strong> Each section below is one authoritative project code, showing every OCR variant that has been merged into it.
            </p>
            <p>
              If the canonical codes listed look correct and the data health banner above says <em>&ldquo;Data is clean&rdquo;</em>, <strong>you are done — no further action is required.</strong>
            </p>
          </div>
          {provenance.length === 0 ? (
            <p className="text-sm text-muted-foreground">No merges recorded yet.</p>
          ) : (() => {
            const groups: Record<string, typeof provenance> = {};
            for (const row of provenance) {
              if (!groups[row.CANONICAL_CODE]) groups[row.CANONICAL_CODE] = [];
              groups[row.CANONICAL_CODE].push(row);
            }
            return Object.entries(groups).map(([canonical, rows]) => (
              <section key={canonical} className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="bg-slate-100 px-4 py-2 flex items-center gap-3">
                  <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                  <span className="font-mono text-sm font-semibold text-blue-800">{canonical}</span>
                  <span className="text-xs text-slate-500 flex-1 truncate">{rows[0].CANONICAL_NAME}</span>
                  <span className="text-xs text-slate-400">{rows[0].LINES_AFFECTED} extracted lines</span>
                  {!rows[0].CANONICAL_ACTIVE && (
                    <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">inactive</span>
                  )}
                </div>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-white border-b border-slate-200 text-slate-500">
                      <th className="px-4 py-1.5 text-left font-medium">OCR variant merged in</th>
                      <th className="px-4 py-1.5 text-left font-medium">Reason</th>
                      <th className="px-4 py-1.5 text-left font-medium">Merged by</th>
                      <th className="px-4 py-1.5 text-left font-medium">Merged at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={row.SOURCE_CODE} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                        <td className="px-4 py-2 font-mono text-[11px] text-red-700">{row.SOURCE_CODE}</td>
                        <td className="px-4 py-2 text-slate-600 max-w-[320px]">
                          <div className="truncate" title={row.MERGE_REASON ?? ""}>{row.MERGE_REASON ?? "—"}</div>
                        </td>
                        <td className="px-4 py-2 text-slate-400">{row.MERGED_BY ?? "—"}</td>
                        <td className="px-4 py-2 text-slate-400 whitespace-nowrap">
                          {row.MERGED_AT ? new Date(row.MERGED_AT).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ));
          })()}
        </div>
      )}
    </div>
  );
}
