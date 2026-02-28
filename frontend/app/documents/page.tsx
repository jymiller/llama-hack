"use client";

import { useState, useRef } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Upload, RefreshCw, FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDocuments, useUploadDocument, useRunOcr } from "@/hooks/queries";
import { RawDocument } from "@/lib/types";

const DOC_TYPES = ["TIMESHEET", "SUBSUB_INVOICE", "MY_INVOICE"] as const;

export default function DocumentsPage() {
  const { data: docs = [], isLoading } = useDocuments();
  const upload = useUploadDocument();
  const runOcr = useRunOcr();

  const [docType, setDocType] = useState<string>("TIMESHEET");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    const fd = new FormData();
    fd.append("file", file);
    fd.append("doc_type", docType);

    toast.promise(upload.mutateAsync(fd), {
      loading: "Uploading…",
      success: "Document uploaded",
      error: (err) => `Upload failed: ${err}`,
    });

    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleOcr(docId: number) {
    toast.promise(runOcr.mutateAsync(docId), {
      loading: "Running OCR…",
      success: "OCR complete",
      error: (err) => `OCR failed: ${err}`,
    });
  }

  const columns: ColumnDef<RawDocument>[] = [
    {
      accessorKey: "DOC_ID",
      header: "ID",
      size: 60,
    },
    {
      accessorKey: "FILE_NAME",
      header: "File",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-mono text-sm">{row.original.FILE_NAME}</span>
        </div>
      ),
    },
    {
      accessorKey: "DOC_TYPE",
      header: "Type",
      cell: ({ getValue }) => {
        const v = getValue<string>();
        const color =
          v === "TIMESHEET"
            ? "bg-blue-100 text-blue-800"
            : v === "MY_INVOICE"
            ? "bg-purple-100 text-purple-800"
            : "bg-orange-100 text-orange-800";
        return <Badge className={color}>{v.replace(/_/g, " ")}</Badge>;
      },
    },
    {
      accessorKey: "PROCESSED",
      header: "OCR",
      cell: ({ getValue }) => (
        <StatusBadge status={getValue<boolean>() ? "PASS" : "PENDING"} />
      ),
    },
    {
      accessorKey: "INGESTED_TS",
      header: "Ingested",
      cell: ({ getValue }) => {
        const v = getValue<string>();
        return v ? new Date(v).toLocaleString() : "—";
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleOcr(row.original.DOC_ID)}
          disabled={runOcr.isPending}
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Run OCR
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Upload timesheet and invoice files, then run OCR to extract text."
      />

      {/* Upload form */}
      <form
        onSubmit={handleUpload}
        className="flex items-end gap-3 mb-8 p-4 border rounded-lg bg-muted/30"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">File</label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            required
            className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:cursor-pointer"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            Document Type
          </label>
          <Select value={docType} onValueChange={setDocType}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOC_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={upload.isPending}>
          <Upload className="h-4 w-4 mr-2" />
          Upload
        </Button>
      </form>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <DataTable
          columns={columns}
          data={docs}
          searchColumn="FILE_NAME"
          searchPlaceholder="Search files…"
        />
      )}
    </div>
  );
}
