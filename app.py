"""
Timesheet Reconciliation System - Streamlit Demo App

Multi-page app:
1. Document Upload & OCR
2. Extraction & Validation
3. Ground Truth Entry (side-by-side with timesheet image)
4. Accuracy Comparison
5. Approval Workflow
6. Reconciliation & Reporting
"""

import streamlit as st
import snowflake.connector
import os
import json
import pandas as pd
from datetime import datetime, date
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib

st.set_page_config(
    page_title="Timesheet Reconciliation",
    page_icon="📊",
    layout="wide",
)


# --- Snowflake Connection ---

def _load_snowflake_config():
    """Load the 'hack' connection from ~/.snowflake/connections.toml."""
    config_path = Path.home() / ".snowflake" / "connections.toml"
    with open(config_path, "rb") as f:
        config = tomllib.load(f)
    return config.get("hack", {})


@st.cache_resource
def get_connection():
    cfg = _load_snowflake_config()
    return snowflake.connector.connect(
        account=cfg["account"],
        user=cfg["user"],
        password=cfg["password"],
        database="RECONCILIATION",
        schema="PUBLIC",
        warehouse=cfg.get("warehouse", "DEFAULT_WH"),
    )


def run_query(sql, params=None):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(sql, params or [])
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        rows = cursor.fetchall()
        return pd.DataFrame(rows, columns=columns) if columns else pd.DataFrame()
    finally:
        cursor.close()


def run_execute(sql, params=None):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(sql, params or [])
        conn.commit()
    finally:
        cursor.close()


# --- Sidebar Navigation ---

st.sidebar.title("Timesheet Reconciliation")
page = st.sidebar.radio(
    "Navigate",
    [
        "1. Documents & OCR",
        "2. Extraction & Validation",
        "3. Ground Truth Entry",
        "4. Accuracy Comparison",
        "5. Approval Workflow",
        "6. Reconciliation",
    ],
)


# ============================================================
# Page 1: Document Upload & OCR
# ============================================================
if page == "1. Documents & OCR":
    st.header("Document Upload & OCR")

    st.subheader("Upload Documents")
    uploaded_files = st.file_uploader(
        "Upload timesheet screenshots or invoice images",
        type=["png", "jpg", "jpeg", "pdf"],
        accept_multiple_files=True,
    )

    if uploaded_files:
        doc_type = st.selectbox("Document Type", ["TIMESHEET", "SUBSUB_INVOICE", "MY_INVOICE"])
        if st.button("Upload to Snowflake Stage"):
            conn = get_connection()
            for f in uploaded_files:
                temp_path = f"/tmp/{f.name}"
                with open(temp_path, "wb") as tmp:
                    tmp.write(f.getbuffer())
                cursor = conn.cursor()
                try:
                    cursor.execute(f"PUT 'file://{temp_path}' @DOCUMENTS_STAGE AUTO_COMPRESS=FALSE OVERWRITE=TRUE")
                    doc_id = os.path.splitext(f.name)[0]
                    cursor.execute("""
                        INSERT INTO RAW_DOCUMENTS (doc_id, doc_type, file_path, ocr_status)
                        SELECT %s, %s, %s, 'PENDING'
                        WHERE NOT EXISTS (SELECT 1 FROM RAW_DOCUMENTS WHERE doc_id = %s)
                    """, (doc_id, doc_type, f"@DOCUMENTS_STAGE/{f.name}", doc_id))
                    conn.commit()
                    st.success(f"Uploaded {f.name}")
                except Exception as e:
                    st.error(f"Error uploading {f.name}: {e}")
                finally:
                    cursor.close()

    st.divider()

    st.subheader("Staged Documents")
    docs_df = run_query("SELECT doc_id, doc_type, file_path, ocr_status, ingested_ts FROM RAW_DOCUMENTS ORDER BY ingested_ts DESC")
    if not docs_df.empty:
        st.dataframe(docs_df, use_container_width=True)

        pending = docs_df[docs_df["OCR_STATUS"] == "PENDING"]["DOC_ID"].tolist()
        if pending and st.button("Run OCR on Pending Documents"):
            conn = get_connection()
            cursor = conn.cursor()
            for doc_id in pending:
                try:
                    row = docs_df[docs_df["DOC_ID"] == doc_id].iloc[0]
                    cursor.execute("CALL PROCESS_DOCUMENT_OCR(%s, %s, %s)", (doc_id, row["DOC_TYPE"], row["FILE_PATH"]))
                    result = cursor.fetchone()
                    st.info(f"{doc_id}: {result[0]}")
                except Exception as e:
                    st.error(f"{doc_id}: {e}")
            cursor.close()
            st.rerun()

        st.subheader("OCR Output Preview")
        selected_doc = st.selectbox("Select document", docs_df["DOC_ID"].tolist(), key="ocr_preview")
        ocr_df = run_query("SELECT ocr_text FROM RAW_DOCUMENTS WHERE doc_id = %s", [selected_doc])
        if not ocr_df.empty and ocr_df.iloc[0]["OCR_TEXT"]:
            st.text_area("OCR Text", ocr_df.iloc[0]["OCR_TEXT"], height=300)
        else:
            st.info("No OCR text available. Run OCR first.")
    else:
        st.info("No documents uploaded yet.")


# ============================================================
# Page 2: Extraction & Validation
# ============================================================
elif page == "2. Extraction & Validation":
    st.header("Extraction & Validation Results")

    docs_df = run_query("SELECT doc_id, file_path FROM RAW_DOCUMENTS ORDER BY doc_id")
    if docs_df.empty:
        st.info("No documents found. Upload documents first.")
    else:
        # Re-extract with multimodal
        st.subheader("Re-extract (Multimodal)")
        re_col1, re_col2 = st.columns([3, 1])
        with re_col1:
            reextract_doc = st.selectbox(
                "Select document to re-extract",
                docs_df["DOC_ID"].tolist(),
                key="reextract_doc",
            )
        with re_col2:
            st.markdown("<br>", unsafe_allow_html=True)
            if st.button("Re-extract with Claude Vision", type="primary"):
                file_path = docs_df[docs_df["DOC_ID"] == reextract_doc].iloc[0]["FILE_PATH"]
                with st.spinner(f"Extracting {reextract_doc} via multimodal..."):
                    result_df = run_query(
                        "CALL EXTRACT_DOCUMENT_MULTIMODAL(%s, %s)",
                        [reextract_doc, file_path],
                    )
                    status = result_df.iloc[0][0] if not result_df.empty else "No result"
                if "SUCCESS" in str(status):
                    st.success(status)
                else:
                    st.error(status)
                st.rerun()

        st.divider()

        # Extraction results
        st.subheader("Extracted Lines")
        ext_df = run_query("""
            SELECT e.doc_id, e.line_id, e.worker, e.work_date, e.project, 
                   e.hours, e.extraction_confidence
            FROM EXTRACTED_LINES e
            ORDER BY e.doc_id, e.work_date
        """)
        if not ext_df.empty:
            doc_filter = st.selectbox("Filter by document", ["All"] + ext_df["DOC_ID"].unique().tolist(), key="ext_filter")
            display_df = ext_df if doc_filter == "All" else ext_df[ext_df["DOC_ID"] == doc_filter]
            st.dataframe(display_df, use_container_width=True)

            total_hours = display_df["HOURS"].sum()
            avg_conf = display_df["EXTRACTION_CONFIDENCE"].mean()
            col1, col2, col3 = st.columns(3)
            col1.metric("Total Lines", len(display_df))
            col2.metric("Total Hours", f"{total_hours:.1f}")
            col3.metric("Avg Confidence", f"{avg_conf:.2f}")
        else:
            st.info("No extracted lines yet. Run extraction first.")

        st.divider()

        # Validation results
        st.subheader("Validation Results")
        val_df = run_query("""
            SELECT doc_id, rule_name, status, details, computed_value
            FROM VALIDATION_RESULTS
            ORDER BY doc_id, rule_name
        """)
        if not val_df.empty:
            # Summary metrics
            pass_count = len(val_df[val_df["STATUS"] == "PASS"])
            fail_count = len(val_df[val_df["STATUS"] == "FAIL"])
            warn_count = len(val_df[val_df["STATUS"] == "WARN"])

            col1, col2, col3, col4 = st.columns(4)
            col1.metric("Total Checks", len(val_df))
            col2.metric("PASS", pass_count)
            col3.metric("FAIL", fail_count)
            col4.metric("WARN", warn_count)

            st.dataframe(val_df, use_container_width=True)
        else:
            st.info("No validation results yet.")

        # Pipeline status view
        st.divider()
        st.subheader("Pipeline Status")
        status_df = run_query("SELECT * FROM PIPELINE_STATUS")
        if not status_df.empty:
            st.dataframe(status_df, use_container_width=True)


# ============================================================
# Page 3: Ground Truth Entry
# ============================================================
elif page == "3. Ground Truth Entry":
    st.header("Ground Truth Entry")
    st.markdown("Enter the correct timesheet hours in the weekly grid below, matching the original document layout.")

    docs_df = run_query("SELECT doc_id, doc_type, file_path FROM RAW_DOCUMENTS ORDER BY doc_id")
    if docs_df.empty:
        st.info("No documents found. Upload documents first.")
    else:
        selected_doc = st.selectbox("Select Document", docs_df["DOC_ID"].tolist(), key="gt_doc")
        doc_row = docs_df[docs_df["DOC_ID"] == selected_doc].iloc[0]

        # --- Determine the week dates from extracted data or doc_id ---
        ext_df = run_query("""
            SELECT DISTINCT worker, work_date, project, hours
            FROM EXTRACTED_LINES WHERE doc_id = %s ORDER BY work_date, project
        """, [selected_doc])

        # Normalize date columns to consistent strings for comparison
        if not ext_df.empty:
            ext_df["WORK_DATE"] = pd.to_datetime(ext_df["WORK_DATE"]).dt.strftime("%Y-%m-%d")

        # Figure out the Saturday-Friday week from the doc
        if not ext_df.empty:
            all_dates = pd.to_datetime(ext_df["WORK_DATE"])
            min_date = all_dates.min()
            # Find the Saturday on or before min_date
            week_start = min_date - pd.Timedelta(days=(min_date.weekday() + 2) % 7)
        else:
            # Fallback: parse from doc_id
            try:
                parsed = pd.to_datetime(selected_doc, format="mixed")
                week_start = parsed - pd.Timedelta(days=(parsed.weekday() + 2) % 7)
            except Exception:
                week_start = pd.Timestamp(date.today())

        day_labels = ["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"]
        week_dates = [week_start + pd.Timedelta(days=i) for i in range(7)]
        day_columns = [f"{lbl}\n{d.strftime('%m/%d')}" for lbl, d in zip(day_labels, week_dates)]

        # --- Layout: image on left, spreadsheet on right ---
        col_image, col_sheet = st.columns([2, 3])

        with col_image:
            st.subheader("Original Document")
            try:
                file_path = doc_row["FILE_PATH"]
                # Parse stage and filename from path like @DB.SCHEMA.STAGE/file.jpg
                if "/" in file_path:
                    stage_part, file_name = file_path.rsplit("/", 1)
                else:
                    stage_part, file_name = "@DOCUMENTS_STAGE", file_path
                # Build presigned URL query with the correct stage
                img_url_df = run_query(
                    f"SELECT GET_PRESIGNED_URL({stage_part}, %s) AS url",
                    [file_name]
                )
                if not img_url_df.empty and img_url_df.iloc[0]["URL"]:
                    st.image(img_url_df.iloc[0]["URL"], use_container_width=True)
                else:
                    st.info("Image preview not available.")
            except Exception as e:
                st.info(f"Image preview not available: {e}")

            # OCR text fallback
            ocr_df = run_query("SELECT ocr_text FROM RAW_DOCUMENTS WHERE doc_id = %s", [selected_doc])
            if not ocr_df.empty and ocr_df.iloc[0]["OCR_TEXT"]:
                with st.expander("OCR Text Reference", expanded=False):
                    st.text(ocr_df.iloc[0]["OCR_TEXT"])

            # Show AI extraction for reference
            if not ext_df.empty:
                with st.expander("AI-Extracted Lines (reference)", expanded=False):
                    st.dataframe(ext_df, use_container_width=True)

        with col_sheet:
            st.subheader("Weekly Timesheet Grid")

            # Load existing ground truth
            gt_df = run_query("""
                SELECT worker, work_date, project, hours
                FROM GROUND_TRUTH_LINES WHERE doc_id = %s ORDER BY work_date, project
            """, [selected_doc])

            # Normalize GT dates to match
            if not gt_df.empty:
                gt_df["WORK_DATE"] = pd.to_datetime(gt_df["WORK_DATE"]).dt.strftime("%Y-%m-%d")

            # Build the grid: rows = projects, columns = days
            # Determine projects from GT if available, else from extraction
            if not gt_df.empty:
                projects = gt_df["PROJECT"].unique().tolist()
            elif not ext_df.empty:
                projects = ext_df["PROJECT"].unique().tolist()
            else:
                projects = [""]

            # Worker name
            worker_name = "Mike Agrawal"
            if not gt_df.empty and gt_df.iloc[0]["WORKER"]:
                worker_name = gt_df.iloc[0]["WORKER"]
            elif not ext_df.empty and ext_df.iloc[0]["WORKER"]:
                worker_name = ext_df.iloc[0]["WORKER"]

            worker_input = st.text_input("Worker", value=worker_name, key="gt_worker")

            # Build the spreadsheet dataframe
            grid_data = []
            for proj in projects:
                row = {"Project": proj}
                for i, col_name in enumerate(day_columns):
                    d = week_dates[i]
                    d_str = d.strftime("%Y-%m-%d")
                    # Check GT first, then extraction
                    hours_val = 0.0
                    if not gt_df.empty:
                        match = gt_df[(gt_df["PROJECT"] == proj) & (gt_df["WORK_DATE"] == d_str)]
                        if not match.empty:
                            hours_val = float(match.iloc[0]["HOURS"])
                    elif not ext_df.empty:
                        match = ext_df[(ext_df["PROJECT"] == proj) & (ext_df["WORK_DATE"] == d_str)]
                        if not match.empty:
                            hours_val = float(match.iloc[0]["HOURS"])
                    row[col_name] = hours_val
                grid_data.append(row)

            grid_df = pd.DataFrame(grid_data)

            # Add a TOTAL column
            numeric_cols = [c for c in grid_df.columns if c != "Project"]
            grid_df["TOTAL"] = grid_df[numeric_cols].sum(axis=1)

            # Editable spreadsheet
            edited_df = st.data_editor(
                grid_df,
                use_container_width=True,
                num_rows="dynamic",
                column_config={
                    "Project": st.column_config.TextColumn("Project", width="large"),
                    "TOTAL": st.column_config.NumberColumn("TOTAL", disabled=True, format="%.1f"),
                    **{
                        col: st.column_config.NumberColumn(
                            col, min_value=0.0, max_value=24.0, step=0.5, format="%.1f"
                        )
                        for col in numeric_cols
                    },
                },
                key="gt_grid",
            )

            # Recalculate TOTAL from edited values
            edited_numeric = [c for c in edited_df.columns if c not in ("Project", "TOTAL")]
            edited_df["TOTAL"] = edited_df[edited_numeric].sum(axis=1)
            grand_total = edited_df["TOTAL"].sum()

            st.markdown(f"**Grand Total: {grand_total:.1f} hours**")

            # Save button
            col_save, col_clear = st.columns(2)
            with col_save:
                if st.button("Save Ground Truth", type="primary"):
                    # Clear old GT for this doc
                    run_execute("DELETE FROM GROUND_TRUTH_LINES WHERE doc_id = %s", [selected_doc])
                    # Insert each cell as a row
                    count = 0
                    for _, row in edited_df.iterrows():
                        proj = row["Project"]
                        if not proj or pd.isna(proj):
                            continue
                        for i, col_name in enumerate(day_columns):
                            hours = float(row.get(col_name, 0) or 0)
                            if hours > 0:
                                d_str = week_dates[i].strftime("%Y-%m-%d")
                                run_execute("""
                                    INSERT INTO GROUND_TRUTH_LINES
                                    (doc_id, worker, work_date, project, hours)
                                    VALUES (%s, %s, %s, %s, %s)
                                """, [selected_doc, worker_input, d_str, proj, hours])
                                count += 1
                    st.success(f"Saved {count} ground truth entries.")
                    st.rerun()

            with col_clear:
                if st.button("Clear Ground Truth"):
                    run_execute("DELETE FROM GROUND_TRUTH_LINES WHERE doc_id = %s", [selected_doc])
                    st.success("Ground truth cleared.")
                    st.rerun()

            # Pre-populate shortcut
            if gt_df.empty and not ext_df.empty:
                st.divider()
                st.caption("No ground truth entered yet. The grid above is pre-filled from AI extraction. Review, correct, and click Save.")


# ============================================================
# Page 4: Accuracy Comparison
# ============================================================
elif page == "4. Accuracy Comparison":
    st.header("Extraction Accuracy vs Ground Truth")

    accuracy_df = run_query("SELECT * FROM EXTRACTION_ACCURACY ORDER BY doc_id, work_date")

    if accuracy_df.empty:
        st.info("No accuracy data available. Enter ground truth data first (Page 3).")
    else:
        # Per-document summary
        docs_with_gt = accuracy_df["DOC_ID"].unique().tolist()
        st.subheader("Per-Document Accuracy")

        for doc_id in docs_with_gt:
            doc_acc = accuracy_df[accuracy_df["DOC_ID"] == doc_id]
            matched = len(doc_acc[doc_acc["MATCH_STATUS"] == "MATCH"])
            discrepancies = len(doc_acc[doc_acc["MATCH_STATUS"] == "DISCREPANCY"])
            missing = len(doc_acc[doc_acc["MATCH_STATUS"] == "MISSING_EXTRACTED"])
            extra = len(doc_acc[doc_acc["MATCH_STATUS"] == "EXTRA_EXTRACTED"])

            # Use the pre-computed accuracy from the view
            accuracy_pct = doc_acc.iloc[0]["HOURS_ACCURACY_PCT"]
            if accuracy_pct is None or pd.isna(accuracy_pct):
                accuracy_pct = 0.0
            total_gt = doc_acc.iloc[0]["TOTAL_GT_HOURS"] or 0
            total_ext = doc_acc.iloc[0]["TOTAL_EXT_HOURS"] or 0

            with st.expander(f"Document: {doc_id}", expanded=True):
                col1, col2, col3, col4, col5 = st.columns(5)
                col1.metric("Matched Days", matched)
                col2.metric("Discrepancy Days", discrepancies)
                col3.metric("Missing (no GT)", extra)
                col4.metric("Extra (no Ext)", missing)
                col5.metric("Hours Accuracy", f"{accuracy_pct:.1f}%")

                st.caption(f"Ground Truth Total: {total_gt:.1f}h | Extracted Total: {total_ext:.1f}h")

                # Color-coded day-level comparison table
                display_cols = ["WORK_DATE", "GT_HOURS", "EXT_HOURS", "HOURS_DELTA", "MATCH_STATUS"]
                display_df = doc_acc[display_cols].copy()

                def highlight_status(row):
                    color_map = {
                        "MATCH": "background-color: #d4edda",
                        "DISCREPANCY": "background-color: #fff3cd",
                        "MISSING_EXTRACTED": "background-color: #f8d7da",
                        "EXTRA_EXTRACTED": "background-color: #cce5ff",
                    }
                    color = color_map.get(row["MATCH_STATUS"], "")
                    return [color] * len(row)

                styled = display_df.style.apply(highlight_status, axis=1)
                st.dataframe(styled, use_container_width=True)

        # Overall summary
        st.divider()
        st.subheader("Overall Accuracy Summary")
        total_matched = len(accuracy_df[accuracy_df["MATCH_STATUS"] == "MATCH"])
        total_disc = len(accuracy_df[accuracy_df["MATCH_STATUS"] == "DISCREPANCY"])
        total_miss = len(accuracy_df[accuracy_df["MATCH_STATUS"] == "MISSING_EXTRACTED"])
        total_extra = len(accuracy_df[accuracy_df["MATCH_STATUS"] == "EXTRA_EXTRACTED"])

        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Total Matched Days", total_matched)
        col2.metric("Total Discrepancies", total_disc)
        col3.metric("Total Missing", total_miss)
        col4.metric("Total Extra", total_extra)

        overall_gt = accuracy_df["GT_HOURS"].sum()
        overall_ext = accuracy_df["EXT_HOURS"].sum()
        st.metric("Overall Hours: Ground Truth vs Extracted", f"{overall_gt:.1f}h GT / {overall_ext:.1f}h Extracted")


# ============================================================
# Page 5: Approval Workflow
# ============================================================
elif page == "5. Approval Workflow":
    st.header("Line Approval Workflow")
    st.markdown("Review extracted lines and approve, reject, or correct them for the trusted ledger.")

    docs_df = run_query("SELECT DISTINCT doc_id FROM EXTRACTED_LINES ORDER BY doc_id")
    if docs_df.empty:
        st.info("No extracted lines to review.")
    else:
        selected_doc = st.selectbox("Select Document", docs_df["DOC_ID"].tolist(), key="approval_doc")

        # Show existing approvals
        existing_df = run_query("""
            SELECT a.line_id, a.decision, a.corrected_hours, a.corrected_date,
                   a.corrected_project, a.reason, a.reviewed_ts
            FROM LEDGER_APPROVALS a
            WHERE a.doc_id = %s
            ORDER BY a.reviewed_ts DESC
        """, [selected_doc])

        if not existing_df.empty:
            approved = len(existing_df[existing_df["DECISION"] == "APPROVED"])
            rejected = len(existing_df[existing_df["DECISION"] == "REJECTED"])
            corrected = len(existing_df[existing_df["DECISION"] == "CORRECTED"])
            col1, col2, col3 = st.columns(3)
            col1.metric("Approved", approved)
            col2.metric("Rejected", rejected)
            col3.metric("Corrected", corrected)

        # Get lines needing review (not yet approved)
        lines_df = run_query("""
            SELECT e.line_id, e.worker, e.work_date, e.project, e.hours,
                   e.extraction_confidence,
                   a.decision AS current_decision
            FROM EXTRACTED_LINES e
            LEFT JOIN LEDGER_APPROVALS a ON e.line_id = a.line_id
            WHERE e.doc_id = %s
            ORDER BY e.work_date
        """, [selected_doc])

        if lines_df.empty:
            st.info("No lines for this document.")
        else:
            # Show ground truth side-by-side if available
            gt_df = run_query("""
                SELECT worker, work_date, project, hours
                FROM GROUND_TRUTH_LINES WHERE doc_id = %s ORDER BY work_date
            """, [selected_doc])

            if not gt_df.empty:
                col_ext, col_gt = st.columns(2)
                with col_ext:
                    st.markdown("**Extracted Lines**")
                    st.dataframe(lines_df[["LINE_ID", "WORKER", "WORK_DATE", "PROJECT", "HOURS", "EXTRACTION_CONFIDENCE"]], use_container_width=True)
                with col_gt:
                    st.markdown("**Ground Truth**")
                    st.dataframe(gt_df, use_container_width=True)
            else:
                st.dataframe(lines_df, use_container_width=True)

            st.divider()

            # Bulk approve all
            col_bulk1, col_bulk2 = st.columns(2)
            with col_bulk1:
                if st.button("Approve All Lines", type="primary"):
                    for _, row in lines_df.iterrows():
                        run_execute("""
                            MERGE INTO LEDGER_APPROVALS t
                            USING (SELECT %s AS line_id) s ON t.line_id = s.line_id
                            WHEN MATCHED THEN UPDATE SET decision = 'APPROVED', reviewed_ts = CURRENT_TIMESTAMP()
                            WHEN NOT MATCHED THEN INSERT (line_id, doc_id, decision) VALUES (%s, %s, 'APPROVED')
                        """, [row["LINE_ID"], row["LINE_ID"], selected_doc])
                    st.success("All lines approved.")
                    st.rerun()
            with col_bulk2:
                if st.button("Clear All Approvals"):
                    run_execute("DELETE FROM LEDGER_APPROVALS WHERE doc_id = %s", [selected_doc])
                    st.success("Approvals cleared.")
                    st.rerun()

            # Per-line review
            st.divider()
            st.subheader("Review Individual Lines")

            for idx, row in lines_df.iterrows():
                current = row.get("CURRENT_DECISION") or "Pending"
                status_icon = {"APPROVED": "✅", "REJECTED": "❌", "CORRECTED": "✏️"}.get(current, "⏳")

                with st.expander(f"{status_icon} {row['LINE_ID']} | {row['WORK_DATE']} | {row['PROJECT']} | {row['HOURS']}h"):
                    decision = st.radio(
                        "Decision",
                        ["APPROVED", "REJECTED", "CORRECTED"],
                        key=f"dec_{row['LINE_ID']}",
                        horizontal=True,
                    )

                    corrected_hours = None
                    corrected_date = None
                    corrected_project = None
                    reason = ""

                    if decision == "CORRECTED":
                        corrected_hours = st.number_input("Corrected Hours", value=float(row["HOURS"]), key=f"ch_{row['LINE_ID']}")
                        corrected_date = st.date_input("Corrected Date", value=row["WORK_DATE"], key=f"cd_{row['LINE_ID']}")
                        corrected_project = st.text_input("Corrected Project", value=row["PROJECT"], key=f"cp_{row['LINE_ID']}")

                    if decision == "REJECTED":
                        reason = st.text_input("Rejection Reason", key=f"rr_{row['LINE_ID']}")

                    if st.button("Submit", key=f"sub_{row['LINE_ID']}"):
                        run_execute("""
                            MERGE INTO LEDGER_APPROVALS t
                            USING (SELECT %s AS line_id) s ON t.line_id = s.line_id
                            WHEN MATCHED THEN UPDATE SET
                                decision = %s, corrected_hours = %s, corrected_date = %s,
                                corrected_project = %s, reason = %s, reviewed_ts = CURRENT_TIMESTAMP()
                            WHEN NOT MATCHED THEN INSERT
                                (line_id, doc_id, decision, corrected_hours, corrected_date, corrected_project, reason)
                                VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """, [
                            row["LINE_ID"],
                            decision, corrected_hours, str(corrected_date) if corrected_date else None,
                            corrected_project, reason or None,
                            row["LINE_ID"], selected_doc, decision, corrected_hours,
                            str(corrected_date) if corrected_date else None,
                            corrected_project, reason or None,
                        ])
                        st.success(f"{row['LINE_ID']}: {decision}")
                        st.rerun()

        # Trusted Ledger preview
        st.divider()
        st.subheader("Trusted Ledger (Approved/Corrected Lines)")
        ledger_df = run_query("SELECT * FROM TRUSTED_LEDGER ORDER BY doc_id, work_date")
        if not ledger_df.empty:
            st.dataframe(ledger_df, use_container_width=True)
            total = ledger_df["HOURS"].sum()
            st.metric("Total Trusted Hours", f"{total:.1f}")
        else:
            st.info("No approved lines yet.")


# ============================================================
# Page 6: Reconciliation & Reporting
# ============================================================
elif page == "6. Reconciliation":
    st.header("Reconciliation & Reporting")

    # Check for trusted ledger data
    ledger_df = run_query("SELECT * FROM TRUSTED_LEDGER ORDER BY work_date")
    ext_df = run_query("SELECT doc_id, worker, work_date, project, hours FROM EXTRACTED_LINES ORDER BY work_date")

    source = "trusted ledger" if not ledger_df.empty else "extracted lines"
    data_df = ledger_df if not ledger_df.empty else ext_df

    if data_df.empty:
        st.info("No data available for reconciliation. Run extraction and approval first.")
    else:
        st.info(f"Using **{source}** as data source for reconciliation.")

        # Summary metrics
        st.subheader("Monthly Summary")
        data_df["MONTH"] = pd.to_datetime(data_df["WORK_DATE"]).dt.to_period("M").astype(str)
        monthly = data_df.groupby("MONTH").agg(
            total_hours=("HOURS", "sum"),
            line_count=("HOURS", "count"),
            unique_workers=("WORKER", "nunique"),
        ).reset_index()
        st.dataframe(monthly, use_container_width=True)

        # Per-project breakdown
        st.subheader("By Project")
        by_project = data_df.groupby("PROJECT").agg(
            total_hours=("HOURS", "sum"),
            line_count=("HOURS", "count"),
        ).reset_index().sort_values("total_hours", ascending=False)
        st.dataframe(by_project, use_container_width=True)

        # Recon summary from table
        st.divider()
        st.subheader("Reconciliation Summary")
        recon_df = run_query("SELECT * FROM RECON_SUMMARY ORDER BY period_month")
        if not recon_df.empty:
            st.dataframe(recon_df, use_container_width=True)

            for _, row in recon_df.iterrows():
                var_sub = row.get("VARIANCE_SUBSUB")
                var_my = row.get("VARIANCE_MY")
                if var_sub and abs(var_sub) > 0:
                    st.warning(f"Sub-sub variance for {row['PERIOD_MONTH']}: ${var_sub:,.2f}")
                if var_my and abs(var_my) > 0:
                    st.warning(f"Agency variance for {row['PERIOD_MONTH']}: ${var_my:,.2f}")
        else:
            st.info("No reconciliation summary data yet. Run the reconciliation pipeline to populate.")

        # Overall totals
        st.divider()
        st.subheader("Overall Totals")
        total_hours = data_df["HOURS"].sum()
        total_lines = len(data_df)
        workers = data_df["WORKER"].nunique()

        col1, col2, col3 = st.columns(3)
        col1.metric("Total Hours", f"{total_hours:.1f}")
        col2.metric("Total Line Items", total_lines)
        col3.metric("Unique Workers", workers)
