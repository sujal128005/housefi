# Deviations from openapi.yaml

The goal is none. Each entry links to the open question that will remove it.

| Where | Deviation | Why | Question |
| --- | --- | --- | --- |
| Every endpoint | Unexpected failures return `{ error: { code: "INTERNAL" } }` with HTTP 500; `INTERNAL` is not in `ErrorBody.code`. | The enum has no code for server errors. | QUESTIONS.md #5 |
| `GET /v1/health`, `GET /v1/health/ready` | Not in `openapi.yaml`. | Operational endpoints required by STARTER-PROMPT step 1; public, no personal data. | (add to the spec) |

## Behaviour the spec does not describe

- Every response carries `X-Request-Id`. A caller may send its own (8-64 chars of `A-Z a-z 0-9 . _ -`); anything
  else is replaced. The same id is in error bodies as `requestId`.
- `RATE_LIMITED` responses also set the `Retry-After` header (same value as `retryAfterSec`).
- A 403 from the framework maps to `NOT_FOUND`, so the API never reveals whether something exists.
- Request bodies are limited to 100 KB (photos and audio go to S3 directly); larger bodies are `VALIDATION`.
