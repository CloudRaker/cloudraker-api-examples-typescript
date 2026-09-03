# rental-lease-extraction

Upload a commercial lease — an abstract, fact sheet or overview, as PDF, Word, Excel
or a scan — and get the key terms back as structured JSON, every field cited back to
where it came from. Four ways, selectable in the UI, all one
[`sdk.extract()`](https://docs.cloudraker.com/capabilities/extract) on the
[`@cloudraker/api` TypeScript SDK](https://docs.cloudraker.com/developers/sdks):

1. **`schema`** — the JSON Schema in [`schema.json`](schema.json) sent inline.
   Several files give one record each.
2. **`multi-doc`** — the same call with `unit: across_documents`: several documents
   about the same property reduced to one record. Where two of them fill the same
   field, one answer is kept rather than the values being combined: a cited value
   beats an uncited one, anything beats an empty one, and **on a tie the file listed
   first wins**. Two documents that each state a figure plainly are a tie, so upload
   order decides — measured, not inferred: reversing the order flips the result, and
   no wording in `instructions` changes it, since that shapes extraction and the fold
   happens afterwards. The review lists every field the documents disagreed on for
   this reason. The result carries the folded record as a `documents[]` entry with
   `fileId: "merged"`, alongside what each document said on its own. The API accepts a
   single file here; this example asks for two, since one leaves nothing to choose
   between.
3. **`action`** — an action already **installed in your organization** carries the
   shape, so `action` goes in place of `schema`. Anything else you send applies to
   that run only, so you can ask for citations even if the action was saved without
   them. `sdk.actions.listActions()` lists what you have.
4. **`hints`** — no schema at all: a one-sentence prose `hints` and the platform
   [infers the schema](https://docs.cloudraker.com/capabilities/extract#schema-inference),
   reporting it back as `config.schema` on the run.

A saved action may be configured for repeated records (`unit: rows_per_document`),
in which case it returns a list rather than one record — the review step shows each
row separately, and citations for a row are keyed by its index.

The page walks three steps: **choose documents**, **choose how to run it**, then
**review**. The review step lays the fields out in schema order rather than as raw JSON,
tags each grounded value with the page it came from and how sure the match was, and runs
a few checks on whether the document's own numbers and dates agree — an expiry after its
start, a stated term matching the dates, a rent that multiplies out. Each check shows the
figures it compared, so `9 stated, 5.0 from the dates` tells you whether a ✗ is a misread
digit or a genuinely odd lease. Fields the document didn't state are hidden behind a
checkbox, since on most documents they are the majority.

```sh
bun install
bun app.ts                                       # http://localhost:8788
cloudflared tunnel --url http://localhost:8788   # optional, see below
```

### How the result comes back

This is not a mode — it follows from the hostname you open the page at, because only
one of the two works in each case. The page says which is in effect.

| Opened at | What happens |
| --- | --- |
| **localhost** | The call is held open for up to `wait` seconds, then polled if the run outlives it. The platform cannot call localhost back. |
| **a tunnel hostname** | `wait: 0`, so the call returns a `202` at once and the finished run arrives as a [signed webhook](https://docs.cloudraker.com/developers/webhooks). No polling. |

The second is what production looks like. `wait` caps at 120 seconds, and a long
document or a busy queue can take longer than that — holding the call is a bet that
stops paying off under load. All three modes work either way.

## Config

Put your organization API key in `.env` next to `app.ts` (gitignored) — see
[Authentication](https://docs.cloudraker.com/developers/authentication) for creating
one:

```
RAKERONE_API_KEY=sk_...
```

Optional env: `PORT` (default 8788), `RAKERONE_WAIT` (default 120, max 120 — seconds
to hold the call open; `0` always returns the 202), `RAKERONE_HINTS` (default prose
for the `hints` mode), `RAKERONE_ACTION` (the installed action the `action` mode runs
— no default, since the name is yours; set it here or name it on the page).

The page also has an optional **instructions** box — free-form house rules layered on
top of the shape, e.g. which language to take prose from in a bilingual lease — and a
**citations** checkbox, on by default, which applies to every mode. In `action` mode
both apply to that run only, over whatever the action has saved.

## Quickstart

The shortest version of what this example does, against a lease you can reach by URL.
Shown as a raw request so it runs anywhere; the example itself uses `sdk.extract()`:

```sh
curl -X POST https://api.cloudraker.com/v1/extract \
  -H "Authorization: Bearer $RAKERONE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "file": { "url": "https://example.com/lease.pdf" },
    "citations": true,
    "schema": {
      "type": "object",
      "properties": {
        "address":          { "type": ["string", "null"] },
        "start_date":       { "type": ["string", "null"], "format": "date" },
        "expiry_date":      { "type": ["string", "null"], "format": "date" },
        "base_rent_annual": { "type": ["number", "null"], "x-cr-kind": "currency" }
      }
    }
  }'
```

Same thing on the SDK:

```ts
import { CloudRakerClient } from "@cloudraker/api";

const client = new CloudRakerClient({ token: process.env.RAKERONE_API_KEY! });

const run = await client.extract({
  body: {
    file: { url: "https://example.com/lease.pdf" },
    citations: true,
    schema: {
      type: "object",
      properties: {
        address: { type: ["string", "null"] },
        start_date: { type: ["string", "null"], format: "date" },
        expiry_date: { type: ["string", "null"], format: "date" },
        base_rent_annual: { type: ["number", "null"], "x-cr-kind": "currency" },
      },
    },
  },
});

console.log(run.output?.value, run.output?.citations);
```

## What you get back

The finished [extract run](https://docs.cloudraker.com/api/cloud-raker-api/runs/get-run).

Grounding is off unless you ask for it. With the **citations** checkbox ticked the run
sends `citations: true` and each value gets the page and text it was read from, which the
review shows as `Page 1 · Confidence 5/5` beside the value. Untick it and there is no
`citations` key at all.

A field can carry **several** citations, so `citations[field]` is always an array. A term
stated in two places — a rent in the schedule and again in the summary — is cited at each,
and a rent schedule is cited row by row. The review folds them into one marker per field
reporting the pages, the confidence range and how many there are, since a dozen copies of
`Page 2 · Confidence 5/5` say nothing the first one did not. Read the whole array rather
than its first entry.

```jsonc
{
  "id": "exr_...",
  "status": "processed",
  "expiresAt": "2026-08-12T18:22:04.118Z",   // run and files auto-purge after the TTL
  "output": {
    "value": {
      "address": "740 Cormier Avenue, Suite 310, Winnipeg, MB R3C 2M1",
      "base_rent_annual": 103757.5,
      "governing_law": null
    },
    "citations": {
      "address": [
        { "fileId": "...", "page": 0, "bbox": { "x": 0.294, "y": 0.184, "width": 0.377, "height": 0.015 },
          "text": "740 Cormier Avenue, Suite 310, Winnipeg (MB) R3C 2M1", "confidence": 5 }
      ],
      "governing_law": [{ "fileId": "...", "notFound": true }]
    },
    "documents": [{ "fileId": "...", "name": "lease.docx", "status": "processed", "value": {}, "citations": {} }]
  }
}
```

(Example trimmed; a real response carries the full field set and a citation per
grounded field.)

Two things that are easy to trip over: `output.value` is only lifted to the top for a
**single-document** run — send several files and it is `null`, so read
`output.documents[]` instead, where an `across_documents` run also puts the folded
record as an entry with `fileId: "merged"`. And `page` is **0-indexed**.

## Sample documents

[`sample-documents/`](sample-documents/) has six invented leases to try it with — no real
tenants, landlords or addresses. A PDF, a spreadsheet and a scan, plus three Word
documents describing the same property:

| File | Try it with |
| --- | --- |
| `Lease_Fact_Sheet_-_Crestline_Manufacturing…pdf` | One record per document — a good first run |
| `Lease_Overview_-_Meridian_Legal_Partners.xlsx` | A spreadsheet rather than prose |
| `Lease_Overview_-_Lakeside_Dental_Group.png` | A scan, so it goes through OCR |
| `Lease_Abstract_-_Pinehollow…docx` | The commercial terms — premises, dates, rent |
| `Tenant_Contact_Sheet_-_Pinehollow…docx` | Who to contact, the currency, the governing law |
| `Tenant_Rules_-_Pinehollow…docx` | Permitted use, insurance, subletting, upkeep, holdover |

The three Pinehollow documents are the set to try **one record from several documents**
with. They deliberately cover different parts of the schema, which is the case the mode
exists for: the abstract has the money and the dates, the contact sheet has the email and
phone number, and the rules document has the obligations. The combined record ends up
with more than any of them holds alone, and anything they answered differently is listed
under **fields differ between these documents**.

## Files

| | |
| --- | --- |
| [`app.ts`](app.ts) | The API calls — upload, extract, poll, webhook. Start here. |
| [`schema.json`](schema.json) | The fields to pull out, and the order the review shows them in. |
| [`review.ts`](review.ts) | Turns a finished run into fields plus checks. The only lease-specific logic. |
| [`page.ts`](page.ts) | The page. Renders whatever `review.ts` produces; knows nothing about leases. |
| [`scaffold.ts`](scaffold.ts) | HTTP server, uploads, webhook signature verification. |
| [`sample-documents/`](sample-documents/) | Invented leases to try it with. |

### Pointing it at your own documents

1. **Replace `schema.json`** with the fields you want. Root must be an object, keep
   primitives nullable so a missing value reads as `null`, and put the fields in the
   order you want to read them — the review follows that order.
2. **Rewrite `checks()` in `review.ts`.** Each check returns `{ ok, label, detail? }`,
   where `ok: null` means the document didn't state enough to judge and `detail` carries
   the figures compared. Drop the lease ones and write whatever your documents can
   contradict — a total against its parts, a date against another date. This is the only
   function that knows what your documents are.
3. **Change `HINTS` in `app.ts`** — one sentence describing the documents, used when no
   schema is sent.

`page.ts` needs no changes: it renders whatever fields and checks `review.ts` returns.
