# 06-ingest-pipeline

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`06-ingest-pipeline\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (6)

- `0039` — pipeline/archive.ts — write the raw source payload to S3 before normalize runs
- `0040` — IngestReceipt idempotency ledger with deterministic activityId
- `0041` — pipeline/persist.ts — write the Activity row inside the ingest transaction
- `0042` — process-activity Lambda, SQS queue and DLQ via the CDK escape hatch
- `0043` — Manual Sync action — listSince, then enqueue
- `0044` — Failure handling and DLQ visibility — a failed job must be visible somewhere a human looks

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

