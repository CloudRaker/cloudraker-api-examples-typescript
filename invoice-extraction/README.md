# invoice-extraction

Upload an invoice — PDF, Word, Excel or a scan — and get the fields back as
structured JSON with every value traced to where it came from, on one
[`sdk.extract()`](https://docs.cloudraker.com/capabilities/extract) via the
[`@cloudraker/api` TypeScript SDK](https://docs.cloudraker.com/developers/sdks).
Three ways, selectable in the UI, differing only in where the shape comes from:

1. **`schema`** — the shape in [`schema.json`](schema.json) sent inline. Each
   invoice produces its own record (`unit: per_document`).
2. **`action`** — an action already **installed in your organization** carries the
   shape, so `action` goes in place of `schema`. Anything else you send applies to
   that run only. `sdk.actions.listActions()` lists what you have.
3. **`hints`** — no schema at all: a sentence of prose, and the platform
   [infers the shape](https://docs.cloudraker.com/capabilities/extract#schema-inference),
   reporting it back as `config.schema` on the run.

A saved action may be configured for line items (`unit: rows_per_document`), in
which case it returns a list of records rather than one — the review step shows
each row separately.

```sh
bun install
bun app.ts                                       # http://localhost:8790
cloudflared tunnel --url http://localhost:8790   # optional, see below
```

The page walks three steps: **choose invoices**, **choose how to run it**, then
**review**. The review step lays the fields out in schema order rather than as raw
JSON, tags each grounded value with the page it came from and how sure the match
was, and runs five checks of the invoice against itself: every required field came
back, the lines add up to the subtotal, subtotal plus taxes and charges makes the
total, the due date is not before the invoice date, and amounts name a currency.
Each check shows the figures it compared, so
`14,609.00 vs 14,509.00` tells you at a glance whether a ✗ is a misread digit or a
genuinely odd invoice. Fields the invoice didn't state are hidden behind a
checkbox, since on most documents they are the majority.

## The call

One request, whichever mode the page is set to — only the shape source changes:

```ts
const run = await sdk.extract({
  wait: 120,
  body: {
    file: { id: fileId },        // or `files: [...]` for several invoices
    schema: SCHEMA,              // or `action: "..."`, or `hints: "..."`
    citations: true,
    unit: "per_document",
  },
});

console.log(run.output?.value, run.output?.citations);
```

`wait` sits beside `body`, not inside it: the body is the run to create, and `wait`
is how long to hold the connection open for it.

## How the result comes back

Not a mode — it follows from the hostname you open the page at, because only one
of the two works in each case. The page says which is in effect.

| Opened at | What happens |
| --- | --- |
| **localhost** | The call is held open for up to `wait` seconds, then polled if the run outlives it. The platform cannot call localhost back. |
| **a tunnel hostname** | `wait: 0`, so the call returns a `202` at once and the finished run arrives as a [signed webhook](https://docs.cloudraker.com/developers/webhooks). No polling. |

For webhook delivery, open the page **at the tunnel hostname**, not localhost: the
callback URL is taken from the browser's Host header.

## Config

Put your organization API key in `.env` next to `app.ts` (gitignored) — see
[Authentication](https://docs.cloudraker.com/developers/authentication):

```
RAKERONE_API_KEY=sk_...
```

Optional env: `PORT` (default `8790`), `RAKERONE_WAIT` (default `120`, max `120` —
seconds to hold the call open; `0` always returns the `202`), `RAKERONE_HINTS`
(default prose for the `hints` mode), `RAKERONE_ACTION` (the installed action the
`action` mode runs — no default, since the name is yours; set it here or name it on
the page).

The page also has an optional **house rules** box — free-form guidance layered on
top of the shape, e.g. "shipping is an additional charge, not a line item" — and a
**citations** checkbox, on by default. In `action` mode both apply to that run only,
over whatever the action has saved.

## What you get back

The finished [extract run](https://docs.cloudraker.com/api/cloud-raker-api/runs/get-run).

Grounding is off unless you ask for it. With the **citations** checkbox ticked the
run sends `citations: true` and each value gets the page and text it was read from,
which the review shows as `Page 1 · Confidence 5/5` beside the value. Untick it and
there is no `citations` key at all.

A field can carry **several** citations, so `citations[field]` is always an array and
the review shows a marker for each. A value read from one place has one; a value put
together from two — an invoice's terms, printed on separate lines — is cited at both,
and a list is cited per element. Reading only the first entry accounts for part of a
value and quietly stands for the rest.

```jsonc
{
  "id": "exr_...",
  "status": "processed",
  "expiresAt": "2026-08-19T18:22:04.118Z",   // run and files auto-purge after the TTL
  "output": {
    "value": {
      "invoice_number": "INV-4021",
      "subtotal": 14609,
      "total": 16796.7,
      "taxes": [{ "name": "GST", "percentage": 0.05, "amount": 730.45 }],
      "line_items": [{ "code": "MB-1200", "description": "…", "quantity": 40, "unit_price": 84.5, "amount": 3380 }],
      "amount_due": null
    },
    "citations": {
      "total": [
        { "fileId": "...", "page": 0, "bbox": { "x": 0.71, "y": 0.62, "width": 0.11, "height": 0.02 },
          "text": "16,796.70", "confidence": 5 }
      ]
    },
    "documents": [{ "fileId": "...", "name": "invoice.pdf", "status": "processed", "value": {}, "citations": {} }]
  }
}
```

Two things that are easy to trip over: `output.value` is only lifted to the top for
a **single-document** run — send several invoices and it is `null`, so read
`output.documents[]` instead. And `page` is **0-indexed**.

`line_items[]` and `taxes[]` are cited under their own key rather than per element
path, so `citations.line_items` holds the evidence for the whole table — a code, a
description and a quantity are separate entries in that one array. The top-level
totals are cited too, which is what the arithmetic checks reconcile against.

## Sample documents

[`sample-documents/`](sample-documents/) has one invented supplier invoice — no real
vendors or amounts. It itemises cleanly and its totals agree, so all five checks
pass; edit a figure in the schema-mode result to see one fail.

## Files

| | |
| --- | --- |
| [`app.ts`](app.ts) | The API calls — upload, extract, poll, webhook. Start here. |
| [`schema.json`](schema.json) | The fields to pull out, and the order the review shows them in. |
| [`review.ts`](review.ts) | Turns a finished run into fields plus checks. The only invoice-specific logic. |
| [`page.ts`](page.ts) | The page. Renders whatever `review.ts` produces. |
| [`scaffold.ts`](scaffold.ts) | HTTP server, uploads, webhook signature verification. |

### Pointing it at your own documents

1. **Replace `schema.json`** with the fields you want. Root must be an object, keep
   primitives nullable so a missing value reads as `null`, and put the fields in the
   order you want to read them — the review follows that order.
2. **Rewrite `checks()` in `review.ts`.** Each check returns `{ ok, label, detail? }`,
   where `ok: null` means the document didn't state enough to judge and `detail`
   carries the figures compared. Drop the invoice arithmetic and write whatever your
   documents can contradict.
3. **Change `HINTS` in `app.ts`** — one sentence describing the documents, used when
   no schema is sent.

`page.ts` needs no changes: it renders whatever fields and checks `review.ts` returns.
