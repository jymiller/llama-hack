"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, CheckCircle, AlertTriangle, Circle, GitMerge, Trash2 } from "lucide-react";
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

export default function MasterDataPage() {
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

  const projects = projectData?.projects ?? [];
  const projectSuspects = projectData?.suspects ?? [];
  const workers = workerData?.workers ?? [];
  const workerSuspects = workerData?.suspects ?? [];

  const unconfirmedProjects = projects.filter((p) => !p.CONFIRMED);
  const confirmedProjects = projects.filter((p) => p.CONFIRMED);
  const unconfirmedWorkers = workers.filter((w) => !w.CONFIRMED);
  const confirmedWorkers = workers.filter((w) => w.CONFIRMED);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Master Data"
        description="Curated reference lists for project codes and workers. Confirm auto-extracted entries and review fuzzy-match suspects."
        actions={
          <div className="flex gap-2">
            {tab === "merges" && (
              <Button onClick={handleApplyMerges} disabled={applyMerges.isPending || merges.length === 0}>
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

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {(["projects", "workers", "merges", "provenance"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t === "projects" ? `Projects (${projects.length})`
              : t === "workers" ? `Workers (${workers.length})`
              : t === "merges" ? `Merges (${merges.length})`
              : `Provenance (${provenance.length})`}
          </button>
        ))}
      </div>

      {/* ── Projects tab ── */}
      {tab === "projects" && (
        <div className="space-y-6">

          {/* Fuzzy-match suspects banner */}
          {projectSuspects.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-800">
                  {projectSuspects.length} possible OCR misread(s) detected
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
              <h3 className="text-sm font-semibold text-slate-700 mb-2">
                Pending review ({unconfirmedProjects.length})
              </h3>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-left">
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Code</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Project name</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Source</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">First seen</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Curation note</th>
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
                      <td className="px-3 py-2 border border-slate-200 text-slate-500 max-w-[220px]">
                        <div className="truncate text-[10px]" title={p.CURATION_NOTE ?? ""}>
                          {p.CURATION_NOTE ?? "—"}
                        </div>
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
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              Confirmed master list ({confirmedProjects.length})
            </h3>
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
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Source</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">First seen</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Curation note</th>
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
                      <td className="px-3 py-2 border border-slate-200 max-w-[280px]">
                        <div className="truncate" title={p.PROJECT_NAME ?? ""}>{p.PROJECT_NAME}</div>
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
                        <SourceBadge source={p.CURATION_SOURCE} />
                      </td>
                      <td className="px-3 py-2 border border-slate-200 text-slate-500">
                        {p.FIRST_SEEN ?? "—"}
                      </td>
                      <td className="px-3 py-2 border border-slate-200 text-slate-400 text-[10px] max-w-[220px]">
                        <div className="truncate" title={p.CURATION_NOTE ?? ""}>
                          {p.CURATION_NOTE ?? "—"}
                        </div>
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

          {/* Suggested merges from suspect view */}
          {projectSuspects.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Suggested merges from OCR suspects ({projectSuspects.filter(
                  (s) => !merges.some((m) => m.SOURCE_CODE === s.EXTRACTED_CODE)
                ).length} pending)
              </h3>
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
                            <span className="text-[10px] text-green-600">merged</span>
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
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              Active merges ({merges.length})
            </h3>
            {merges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No merges defined yet.</p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-left">
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Source (misread)</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">→ Target (canonical)</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Target name</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Reason</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Merged at</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {merges.map((m, i) => (
                    <tr key={m.MERGE_ID} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-3 py-2 border border-slate-200 font-mono text-[11px] text-red-700">
                        {m.SOURCE_CODE}
                        {m.SOURCE_NAME && (
                          <div className="text-[9px] text-slate-400 font-sans truncate max-w-[160px]" title={m.SOURCE_NAME}>
                            {m.SOURCE_NAME}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 border border-slate-200 font-mono text-[11px] text-green-700">
                        {m.TARGET_CODE}
                      </td>
                      <td className="px-3 py-2 border border-slate-200 max-w-[200px]">
                        <div className="truncate text-[10px]" title={m.TARGET_NAME ?? ""}>{m.TARGET_NAME}</div>
                      </td>
                      <td className="px-3 py-2 border border-slate-200 text-slate-500 text-[10px] max-w-[200px]">
                        <div className="truncate" title={m.MERGE_REASON ?? ""}>{m.MERGE_REASON ?? "—"}</div>
                      </td>
                      <td className="px-3 py-2 border border-slate-200 text-slate-400 text-[10px] whitespace-nowrap">
                        {m.MERGED_AT ? new Date(m.MERGED_AT).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
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
            )}
          </section>

          {/* Manual merge form */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Manual merge</h3>
            <div className="flex gap-3 items-end flex-wrap">
              <div>
                <p className="text-[11px] text-slate-500 mb-1">Source (misread code)</p>
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
                <p className="text-[11px] text-slate-500 mb-1">Target (canonical code)</p>
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
                  placeholder="e.g. OCR misread G→Q"
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
            <p className="text-[10px] text-slate-400 mt-2">
              After creating merges, click <strong>Apply Merges to Data</strong> to rewrite EXTRACTED_LINES with the canonical codes.
            </p>
          </section>
        </div>
      )}

      {/* ── Provenance tab ── */}
      {tab === "provenance" && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Full audit trail of every source code merged into its canonical target.
            Grouped by canonical code — each row is one source→target mapping.
          </p>
          {provenance.length === 0 ? (
            <p className="text-sm text-muted-foreground">No merges recorded yet.</p>
          ) : (() => {
            // Group by canonical code
            const groups: Record<string, typeof provenance> = {};
            for (const row of provenance) {
              if (!groups[row.CANONICAL_CODE]) groups[row.CANONICAL_CODE] = [];
              groups[row.CANONICAL_CODE].push(row);
            }
            return Object.entries(groups).map(([canonical, rows]) => (
              <section key={canonical} className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="bg-slate-100 px-4 py-2 flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-blue-800">{canonical}</span>
                  <span className="text-xs text-slate-500 flex-1 truncate">{rows[0].CANONICAL_NAME}</span>
                  <span className="text-xs text-slate-400">{rows[0].LINES_AFFECTED} lines</span>
                  {!rows[0].CANONICAL_ACTIVE && (
                    <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">inactive</span>
                  )}
                </div>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-white border-b border-slate-200 text-slate-500">
                      <th className="px-4 py-1.5 text-left font-medium">Source (OCR variant)</th>
                      <th className="px-4 py-1.5 text-left font-medium">Merge reason</th>
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

      {/* ── Workers tab ── */}
      {tab === "workers" && (
        <div className="space-y-6">

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
              <h3 className="text-sm font-semibold text-slate-700 mb-2">
                Pending review ({unconfirmedWorkers.length})
              </h3>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-left">
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Worker key</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Display name</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Source</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">First seen</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Curation note</th>
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
                      <td className="px-3 py-2 border border-slate-200 text-slate-500 text-[10px] max-w-[220px]">
                        <div className="truncate" title={w.CURATION_NOTE ?? ""}>
                          {w.CURATION_NOTE ?? "—"}
                        </div>
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
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              Confirmed master list ({confirmedWorkers.length})
            </h3>
            {wrkLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : confirmedWorkers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No confirmed workers yet.</p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-left">
                    <th className="px-3 py-2 border border-slate-200 font-semibold w-6"></th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Worker key</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Display name</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Source</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">First seen</th>
                    <th className="px-3 py-2 border border-slate-200 font-semibold">Curation note</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedWorkers.map((w, i) => (
                    <tr key={w.WORKER_KEY} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-3 py-2 border border-slate-200">
                        <ConfirmedIcon confirmed={w.CONFIRMED} />
                      </td>
                      <td className="px-3 py-2 border border-slate-200 font-mono text-[11px] text-blue-800">
                        {w.WORKER_KEY}
                      </td>
                      <td className="px-3 py-2 border border-slate-200">{w.DISPLAY_NAME}</td>
                      <td className="px-3 py-2 border border-slate-200">
                        <SourceBadge source={w.CURATION_SOURCE} />
                      </td>
                      <td className="px-3 py-2 border border-slate-200 text-slate-500">
                        {w.FIRST_SEEN ?? "—"}
                      </td>
                      <td className="px-3 py-2 border border-slate-200 text-slate-400 text-[10px] max-w-[220px]">
                        <div className="truncate" title={w.CURATION_NOTE ?? ""}>
                          {w.CURATION_NOTE ?? "—"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
