"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ThumbsUp, ThumbsDown, CheckCheck, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDocuments,
  useApprovalLines,
  useDecideLine,
  useApproveAll,
  useClearApprovals,
} from "@/hooks/queries";
import { ApprovalLineRow } from "@/lib/types";

export default function ApprovalsPage() {
  const { data: docs = [] } = useDocuments();
  const [selectedDoc, setSelectedDoc] = useState<string>("");
  const docId = selectedDoc || null;

  const { data: lines = [], isLoading } = useApprovalLines(docId);
  const decide = useDecideLine();
  const approveAll = useApproveAll();
  const clearAll = useClearApprovals();

  const [clearOpen, setClearOpen] = useState(false);

  // Inline correction state
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [corrHours, setCorrHours] = useState("");
  const [corrNote, setCorrNote] = useState("");

  async function handleDecide(
    lineId: string,
    decision: "APPROVED" | "REJECTED" | "CORRECTED",
    extra?: { corrected_hours?: number | null; analyst_note?: string | null }
  ) {
    if (!docId) return;
    toast.promise(
      decide.mutateAsync({ docId, line_id: lineId, decision, ...extra }),
      {
        loading: "Saving decision…",
        success: "Decision saved",
        error: (err) => `Error: ${err}`,
      }
    );
    setCorrecting(null);
  }

  async function handleApproveAll() {
    if (!docId) return;
    toast.promise(approveAll.mutateAsync(docId), {
      loading: "Approving all lines…",
      success: (d) => `Approved ${d.approved} lines`,
      error: (err) => `Error: ${err}`,
    });
  }

  const pending = lines.filter((l) => !l.DECISION).length;
  const approved = lines.filter((l) => l.DECISION === "APPROVED").length;
  const rejected = lines.filter((l) => l.DECISION === "REJECTED").length;

  const columns: ColumnDef<ApprovalLineRow>[] = [
    { accessorKey: "LINE_ID", header: "ID", size: 60 },
    { accessorKey: "WORKER", header: "Worker" },
    { accessorKey: "WORK_DATE", header: "Date" },
    { accessorKey: "PROJECT", header: "Project" },
    {
      accessorKey: "HOURS",
      header: "Extracted h",
      cell: ({ getValue }) => getValue<number>()?.toFixed(2) ?? "—",
    },
    {
      accessorKey: "GT_HOURS",
      header: "GT h",
      cell: ({ getValue }) => getValue<number>()?.toFixed(2) ?? "—",
    },
    {
      accessorKey: "EXTRACTION_CONFIDENCE",
      header: "Conf",
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        return v != null ? `${(v * 100).toFixed(0)}%` : "—";
      },
    },
    {
      accessorKey: "DECISION",
      header: "Decision",
      cell: ({ row }) => {
        const d = row.original.DECISION;
        return <StatusBadge status={d ?? "PENDING"} />;
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const lineId = row.original.LINE_ID;
        const isCorr = correcting === lineId;
        return (
          <div className="flex items-center gap-1 flex-wrap">
            {isCorr ? (
              <>
                <Input
                  type="number"
                  className="h-7 w-20 text-xs"
                  placeholder="Hours"
                  value={corrHours}
                  onChange={(e) => setCorrHours(e.target.value)}
                  step="0.5"
                />
                <Input
                  className="h-7 w-32 text-xs"
                  placeholder="Note"
                  value={corrNote}
                  onChange={(e) => setCorrNote(e.target.value)}
                />
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    handleDecide(lineId, "CORRECTED", {
                      corrected_hours: corrHours ? Number(corrHours) : null,
                      analyst_note: corrNote || null,
                    })
                  }
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setCorrecting(null)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-green-700 border-green-200 hover:bg-green-50"
                  onClick={() => handleDecide(lineId, "APPROVED")}
                >
                  <ThumbsUp className="h-3 w-3 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-red-700 border-red-200 hover:bg-red-50"
                  onClick={() => handleDecide(lineId, "REJECTED")}
                >
                  <ThumbsDown className="h-3 w-3 mr-1" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-blue-700 border-blue-200 hover:bg-blue-50"
                  onClick={() => {
                    setCorrecting(lineId);
                    setCorrHours(String(row.original.HOURS ?? ""));
                    setCorrNote("");
                  }}
                >
                  Correct
                </Button>
              </>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Approval Workflow"
        description="Review and approve, reject, or correct extracted timesheet lines."
        actions={
          docId ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 border-red-200"
                onClick={() => setClearOpen(true)}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear All
              </Button>
              <Button size="sm" onClick={handleApproveAll}>
                <CheckCheck className="h-4 w-4 mr-1" />
                Approve All
              </Button>
            </div>
          ) : null
        }
      />

      <div className="mb-6 flex items-center gap-6">
        <Select value={selectedDoc} onValueChange={setSelectedDoc}>
          <SelectTrigger className="w-72">
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
        {docId && (
          <div className="flex gap-4 text-sm text-muted-foreground">
            <span className="text-yellow-600 font-medium">{pending} pending</span>
            <span className="text-green-600 font-medium">{approved} approved</span>
            <span className="text-red-600 font-medium">{rejected} rejected</span>
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <DataTable columns={columns} data={lines} searchColumn="WORKER" />
      )}

      <ConfirmationDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear all approvals?"
        description="This will delete all approval decisions for this document. Lines will return to Pending status."
        confirmLabel="Clear"
        variant="destructive"
        onConfirm={() =>
          docId &&
          toast.promise(clearAll.mutateAsync(docId), {
            loading: "Clearing…",
            success: "Approvals cleared",
            error: (e) => String(e),
          })
        }
      />
    </div>
  );
}
