# CloudRaker API examples, TypeScript

Six runnable apps built on [`@cloudraker/api`](https://www.npmjs.com/package/@cloudraker/api) and [Bun](https://bun.sh). Each one takes a document or a recording, calls the [CloudRaker API](https://docs.cloudraker.com), and shows the result with every value traced back to its source.

Each directory is self-contained: `cd` in, `bun install`, follow its README.

[![SDK: @cloudraker/api](https://img.shields.io/badge/SDK-%40cloudraker%2Fapi-black)](https://www.npmjs.com/package/@cloudraker/api)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-black)](./LICENSE)

## Examples

| Example | Run | Verbs | Description |
|---|---|---|---|
| [`medical-call-notes/`](medical-call-notes/) | `bun app.ts` → http://localhost:8787 | `extract` + `process` | Turns a recorded clinician call into a structured note. Four modes: inline schema, schema inferred from prose, installed action, and `process` with signed webhooks. Each value cites the transcript and seeks the audio. |
| [`split-a-packet/`](split-a-packet/) | `bun app.ts ./packet.pdf` | `classify` → `split` → `extract` | Splits a scanned PDF holding several documents into one file per document. `classify` in page mode finds the boundaries, `split` cuts without a model call, `extract` runs per child with hints chosen by class. |
| [`healthcare-redact/`](healthcare-redact/) | `bun app.ts` → http://localhost:8789 | `redact` | Removes PII from a PDF or an audio recording. Text is removed from the PDF stream; audio is beeped and the transcript rewritten. Polls on localhost, receives a signed webhook through a tunnel. |
| [`invoice-extraction/`](invoice-extraction/) | `bun app.ts` → http://localhost:8790 | `extract` | Extracts invoice fields (PDF, Word, Excel, scan) as structured JSON. Three modes: schema, action, hints. Citations per value, `rows_per_document` for line items, five arithmetic checks. |
| [`rental-lease-extraction/`](rental-lease-extraction/) | `bun app.ts` → http://localhost:8788 | `extract` | Extracts key terms from a commercial lease. Four modes, including `unit: across_documents`, which folds several files into one record and reports which file supplied each field. Citations and arithmetic checks per lease. |
| [`insurance-certificate/`](insurance-certificate/) | `bun app.ts` → http://localhost:8791 | `inspect` → `fill` → `sign` | Reads a policy, fills a certificate of insurance, lets you correct values, then sends it for e-signature. `values` mode re-runs `fill` without a model. Shows signer status, audit trail, and the sealed PDF. |

## Setup

```sh
cd medical-call-notes   # or any directory above
bun install
bun app.ts              # each example has its own port, so several can run at once
```

Put your organization API key in `.env` beside `app.ts` (gitignored). See [Authentication](https://docs.cloudraker.com/developers/authentication).

```
RAKERONE_API_KEY=sk_...
```

Optional env vars, per example: `PORT`, `RAKERONE_WAIT` (seconds to hold the call open, max 120), `RAKERONE_HINTS`, `RAKERONE_ACTION`. Each README lists its defaults.

## Polling and webhooks

Where an example can report by webhook, the hostname you open the page at decides which path it takes.

| Opened at | Behaviour |
|---|---|
| `localhost` | The call is held open for `wait` seconds, then polled if the run outlives it. |
| a tunnel (`cloudflared tunnel --url http://localhost:8787`) | `wait: 0`, so the call returns `202` immediately. The result arrives as a signed webhook, verified against `jwks.json` and deduplicated on `eventId`. |

The tunnel path is the one to use in production. Both work without code changes.

## Docs

- [CloudRaker docs](https://docs.cloudraker.com): verbs, webhooks, citations, actions
- [Authentication](https://docs.cloudraker.com/developers/authentication): API keys for your org
- [`@cloudraker/api` on npm](https://www.npmjs.com/package/@cloudraker/api): the SDK these examples use
- Capabilities: [extract](https://docs.cloudraker.com/capabilities/extract) · [classify](https://docs.cloudraker.com/paperwork/capabilities/classify) · [split](https://docs.cloudraker.com/paperwork/capabilities/split) · [redact](https://docs.cloudraker.com/capabilities/redact) · [fill](https://docs.cloudraker.com/capabilities/fill) · [sign](https://docs.cloudraker.com/capabilities/sign)

## License

MIT. See [LICENSE](./LICENSE).
