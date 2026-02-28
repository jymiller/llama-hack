"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, CheckCircle, AlertTriangle, Circle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useMasterProjects,
  useMasterWorkers,
  useConfirmProject,
  useConfirmWorker,
  useSyncMaster,
} from "@/hooks/queries";
import { CuratedProject, CuratedWorker } from "@/lib/types";

type Tab = "projects" | "workers";

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

  const { data: projectData, isLoading: projLoading } = useMasterProjects();
  const { data: workerData, isLoading: wrkLoading } = useMasterWorkers();
  const confirmProject = useConfirmProject();
  const confirmWorker = useConfirmWorker();
  const sync = useSyncMaster();

  function handleSync() {
    toast.promise(sync.mutateAsync(), {
      loading: "Syncing master data from extracted lines…",
      success: (d) => d.message ?? "Sync complete",
      error: (e) => `Sync failed: ${e}`,
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
          <Button variant="outline" onClick={handleSync} disabled={sync.isPending}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Sync from Extraction
          </Button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {(["projects", "workers"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t === "projects"
              ? `Projects (${projects.length})`
              : `Workers (${workers.length})`}
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
