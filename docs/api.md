# API reference

All endpoints are under `/api`, take and return JSON, and use the types in `src/shared/types.ts`.
Sessions are an httpOnly cookie set at login. Errors return `{ error: { code, message, details? } }`
with status 400 (validation), 401 (not signed in), 403 (role or scope), 404, 409 or 422.

Scope: an **officer** sees only loans assigned to them. A **manager** sees their branch. **Head** sees all branches.

| Method | Path | Roles | Body | Response |
|---|---|---|---|---|
| POST | /auth/login | anyone | `LoginRequest` | `MeResponse` |
| POST | /auth/logout | signed in | - | `{ ok: true }` |
| GET | /auth/me | signed in | - | `MeResponse` |
| PATCH | /auth/me | signed in | `{ lang: 'en' \| 'hi' }` | `MeResponse` |
| GET | /clock | anyone | - | `ClockResponse` |
| POST | /clock | signed in, demo mode only | `ClockRequest` | `ClockResponse` |
| GET | /officer/today | officer | - | `TodayResponse` |
| GET | /team/:officerId/list | manager, head | - | `TodayResponse` |
| GET | /loans/:id | scoped | - | `LoanDetailResponse` |
| POST | /loans/:id/pin | manager, head | `PinRequest` | `{ ok: true }` |
| POST | /loans/:id/reassign | manager, head | `ReassignRequest` | `{ ok: true }` |
| POST | /sync/attempts | officer | `SyncRequest` | `SyncResponse` (always 200, per-item status) |
| GET | /promises?status=all\|upcoming\|due_today\|broken\|kept | scoped | - | `PromisesResponse` |
| GET | /templates | signed in | - | `{ templates: TemplateRow[] }` |
| POST | /loans/:id/messages/draft | scoped | `DraftRequest` | `DraftResponse` |
| POST | /loans/:id/messages | scoped | `SendMessageRequest` | `MessageRow` |
| POST | /imports/preview | manager, head | `ImportRequest` | `ImportPreview` |
| POST | /imports/commit | manager, head | `ImportRequest` | `ImportResult` |
| GET | /imports | manager, head | - | `{ imports: ImportSummary[] }` |
| GET | /imports/sample.csv | manager, head | - | CSV file (template with sample rows) |
| GET | /dashboard/roll-rates | manager, head | - | `RollRatesResponse` |
| GET | /dashboard/backtest | manager, head | - | `BacktestResponse` |
| GET | /team | manager, head | - | `TeamResponse` |
| GET | /activity?officerId=&date=YYYY-MM-DD | scoped | - | `ActivityResponse` |

## CSV import format

One row per overdue loan, exported by the loan system each morning. Header row required:

```
loan_id,borrower_name,business_type,phone,address,pincode,outstanding,emi,dpd,last_payment_date,paid_last_3m
LN-10293,Company B (packaging unit),Packaging,+91 90000 10293,"Plot 14, Sector F, Sanwer Road",452015,640000,28000,12,2026-10-04,56000
```

Validation: `loan_id` matches `LN-` followed by digits; `pincode` is 6 digits and must be covered by an officer in your scope;
`outstanding`, `emi` and `paid_last_3m` are non-negative whole rupees; `dpd` is 1 to 30 (this is the 1-30 bucket list);
`last_payment_date` is YYYY-MM-DD or empty. Bad rows are reported with their row number and skipped. Good rows still import.

## Sync semantics

`POST /sync/attempts` is idempotent on the client-generated `id`. Sending the same item twice returns `duplicate`
and changes nothing. Attempts whose `occurredAt` falls outside 08:00-19:00 IST are stored with status `blocked`
(for audit) and no outcome is applied. `occurredAt` more than 5 minutes in the future or more than 7 days in the past is rejected.
