# Import Audit + SharePoint Sync Plan

## Goals
- Ensure every import is traceable without storing PDFs long-term.
- Keep machine identity consistent per PC.
- Enable future SharePoint sync of audit logs without PHI/PII.

## Current Baseline
- Import log entries include: date, importedAt, fileName, sourceMachine, fileType, recordCount, fileHash.
- Machine identity is stable per PC via localStorage (preferring Electron hostname).

## Phase 1: Finalize Audit Log Schema
- Confirm fields are required vs optional for your office workflow.
- Decide whether to add any of the following:
  - user/operator name
  - import source (folder path or SharePoint library name)
  - error/exception notes

## Phase 2: Expose Audit Log in the UI
- Add a read-only “Import Log” view:
  - Filters by date range, file type, machine
  - Exports to CSV for compliance
- Include a record detail view for quick troubleshooting.

## Phase 3: SharePoint Sync (Log Only)
- Sync only the JSON audit log to SharePoint (no PDFs or images).
- Use Microsoft Graph API to read/write a single JSON file or list items.
- Decide merge strategy:
  - last-write-wins for the full log file, or
  - append-only list items with client-side filtering.

## Phase 4: Optional Redacted File Storage
- Only if needed later:
  - Upload redacted images/PDFs to SharePoint.
  - Store file link references in the audit log.

## Security & Compliance
- Never upload raw PDFs unless explicitly approved.
- Store audit logs without PHI/PII.
- Encrypt transport (Graph API) and keep credentials out of repo.

## Open Decisions
- Where should the audit log UI live (Settings vs Import screens)?
- Do you want user/operator attribution in the log?
- Do you prefer a SharePoint list or a single JSON file for logs?
