# insurance-certificate

Read an insurance policy, write a certificate of insurance from it, correct what
came out, then send it for signature — on the
[`@cloudraker/api` TypeScript SDK](https://docs.cloudraker.com/developers/sdks):

1. [`POST /v1/templates/{id}/inspect`](https://docs.cloudraker.com/capabilities/fill)
   asks the blank certificate what boxes it has, and what each one is for.
2. [`POST /v1/fill`](https://docs.cloudraker.com/capabilities/fill) takes that
   certificate as its **template** and the policy as its **source**, and writes
   the policy's values into the boxes.
3. [`POST /v1/sign`](https://docs.cloudraker.com/capabilities/sign) emails the
   finished certificate to whoever has to sign it, and
   [`GET /v1/runs/{id}/envelope`](https://docs.cloudraker.com/api/cloud-raker-api/runs/get-run-envelope)
   reports who has and who hasn't.

Separate requests on purpose. Filling a form from another document is a
judgement call, so the page shows what came out — the PDF, and every value
written — and sends it only once you say it looks right. Anything you correct
goes back through `fill` again in `values` mode, which runs no model.

```sh
bun install
bun app.ts                                       # http://localhost:8791
cloudflared tunnel --url http://localhost:8791   # only needed for webhooks
```

Put your organization API key in `.env` beside `app.ts` — see
[Authentication](https://docs.cloudraker.com/developers/authentication):

```
RAKERONE_API_KEY=sk_...
```

Optional: `PORT` (default 8791). `app.ts` targets `https://api.cloudraker.com`;
a key issued for another environment will 401 against it.

## The flow

| Step | What happens |
| --- | --- |
| 1 · Documents | Choose the policy to read and the blank certificate to fill, and say whether the result stays editable. |
| 2 · Template | What `inspect` found in the blank form: one row per box, with the label the drafting pass will read. Fix a label, describe a box, or leave one out. Nothing has been drafted yet. |
| 3 · Certificate | What `fill` produced: the PDF inline, and every value it wrote, grouped by the box it went into. Every value is editable, and the boxes only the issuer can fill are typed here. Nothing has been sent yet. |
| 4 · Signers | Who signs, in order, and where the signatures land — the form's own signature lines, or a page appended at the end. |
| 5 · Envelope | Who has signed, the audit trail, and the signed PDF once it's sealed. |

## The specimen documents

Seven fictional PDFs ship with the sample. They are offered, never substituted:
what gets filled is always a file you chose, so download one from the page and
send it back up.

One policy gets read:
[`policy-to-read.pdf`](sample-documents/policy-to-read.pdf) — four pages of
insurer, broker, named insured, policy period, five coverages with limits,
endorsements and insured locations.

The rest are blank certificates, in two kinds and three signature variants:

| Blank certificate | 1 signature | 2 signatures | none |
| --- | --- | --- | --- |
| **With form fields** — a named box per line, each carrying a description | `simple-certificate-fields-one-signature-line.pdf` | `…-two-signature-lines.pdf` | `…-no-signature-lines.pdf` |
| **No form fields** — the same page with none | `simple-certificate-detected-one-signature-line.pdf` | `…-two-signature-lines.pdf` | `…-no-signature-lines.pdf` |

Two axes, and each changes a different thing.

**Signature variants** decide how it can be signed. A certificate carrying
`[Signature N]` markers takes `placement: "tags"`, one signature per marker. A
certificate with none takes `placement: "page"` and gets a signature page
appended at the end.

**How much room the block leaves decides what a signature looks like.** The
appearance is a card — name, mark, and the envelope and timestamp ruled off
beneath — and it needs roughly 90pt of clear space above the line. Below that it
becomes the mark alone rather than covering the heading above it. These
certificates leave the room, so a signature on one comes out as the full card.

**Fields or no fields** decides how much step 2 has to do, and it is the more
interesting axis. Both kinds are the same page — the only difference is whether
the boxes are declared — so you can run each and compare what comes out.

## Configuring a template

`inspect` reports one entry per box with a label. Where it comes from depends on
the form:

- **A form that declares its fields** carries the label itself, in each field's
  `/TU` note — `issuer_telephone`, "issuer telephone number". Nothing more is
  needed; `fill` reads those notes and drafts straight from them. The run reports
  `output.fieldsSource: "inventory"`.
- **A form with no fields** has its boxes found by the detector, which names them
  `textbox_0_0`, `textbox_0_1`, … Those names say nothing about what belongs in
  them, so `inspect` infers a label from the text printed beside each box —
  "CONTACT", "TELEPHONE", "DATE ISSUED". The example saves that list as a **fill
  config** and drafts through it, and the run reports
  `output.fieldsSource: "curated"`.

That second path is why step 2 exists. Draft a detected form without labels and
the model fills the boxes in page order: skip one box and every value after it
lands one box early, which reads as a plausible certificate and is wrong
throughout. The labels are what prevent it.

Each entry also carries a `description` — guidance for that one box, editable in
step 2. It settles what a printed caption leaves open: a form heading three lines
with a single "NAME AND ADDRESS" never says whose, so a run can put the insurer
where the broker belongs. Written on the box, the answer travels with it.

```ts
const seen = await sdk.templates.inspectTemplate({ id: templateFileId });
// One config, addressed by a fixed slug: updated in place rather than duplicated,
// and never able to adopt a config someone else made.
const body = { template: templateFileId, fields: seen.fields, templateHash: seen.templateHash };
const existing = await sdk.configs.getFillConfig({ idOrSlug: CONFIG_SLUG }).catch(() => null);
const config = existing
  ? await sdk.configs.updateFillConfig({ idOrSlug: CONFIG_SLUG, config: body })
  : await sdk.configs.createFillConfig({ name: CONFIG_SLUG, config: body });
await sdk.fill({ wait: 120, body: { action: config.id, files: [{ id: policyFileId }] } });
```

A config holds `templateHash` — the fingerprint of the bytes it was made from —
so a template that changes underneath is detectable rather than silently
mismatched. Configure once, fill as often as you like.

No `instructions` are sent anywhere in this example. `fill` has its own default,
and what each box is for is already written on the box — in the field's `/TU`
note, or in the label step 2 saves. Pass `instructions` when you need something
the form itself cannot say.

## What `fill` reports back

A finished run carries `output.fields` — every field filled and the value written
— so the result can be checked as data rather than by eye:

```jsonc
{
  "output": {
    "file": { "id": "…", "name": "certificate (filled).pdf", "url": "…" },
    "fieldsSource": "inventory",              // or "curated", through a config
    "fields": {
      "insured_name_and_address_1": "Boréal Ateliers Verdun inc.",
      "issuer_telephone": "514 555 0193",
      "policy_effective_date": "2026-04-01",
      "row1_description": "Commercial General Liability — Each occurrence",
      "row1_basis": "Occurrence",
      "row1_limit": "2 000 000 $"
    }
  }
}
```

Fields the policy doesn't answer are simply absent, which is why the count is
lower than the number of boxes on the form. `fieldsSource` says which list the
run went by: `curated` for a saved field list, `inventory` for the template's own
field names alone.

On a form with no fields the names are the detector's — `textbox_0_7` rather than
`date_issued` — so read them against the labels from step 2 rather than on their
own.

**Read it before you send.** The amounts are what to read against the policy. A
figure standing beside its label in a ruled table is read reliably; one in a
table drawn without rules is not, because the labels and the figures arrive
separately and are paired by position. Every number still comes from the policy —
it is the pairing that slips, so a limit can land on the row above or below its
own.

On the specimen policy that is real and repeatable: the Section I limits sit in
an unruled table, and across runs `Tenants' legal liability`, `Medical payments`
and `Employers' liability` swap figures among themselves. The certificate reads
perfectly plausibly either way, which is the whole argument for a review step —
nothing leaves the machine until you approve it.

## Correcting it before it goes

Step 2's values are editable, and applying them re-fills a fresh copy of the
blank template through the same `fill` verb with the sources left out:

```ts
await sdk.fill({
  body: { template: { id: templateFileId }, values, output: "flattened" },
});
```

`values` mode runs no drafting pass and no model, so what comes back is exactly
what was approved. A drafting run's `output.fields` round-trips into `values`
unchanged, which is what makes this a review step rather than a rewrite.
`values` and `files` are mutually exclusive, so this is a second call.

A box the policy did not answer — the name of whoever will sign, say —
appears here as an empty input, to type or to leave for the signer.

## Where the signatures go

**`placement: "tags"`** puts each signature over a literal `[Signature N]` in the
document — `signers[0]` on `[Signature 1]`, and so on, matched by position, never
by name. The marker is ordinary page text, not a form field: `fill` never writes
it, so it must already be in the document. After signing it is hidden under the
stamp rather than removed. A signer with no marker fails the run before anyone is
invited.

**`placement: "page"`** leaves those lines alone and appends a page listing every
signature, so nothing has to be prepared and up to 50 people can sign.

Either way the sealed PDF ends with the audit pages.

If you mark up your own form, the marker sets *where* a stamp sits, not how big
it is: each stamp grows upwards into whatever space is free above it, so a marker
in a tight space gets a smaller one rather than a stamp colliding with the text
above. Leave about 90pt clear of other text and form fields for the full card,
and put the marker just above the line the signature belongs on.

## Following the envelope

`POST /v1/sign` returns as soon as the envelope exists — it can't do otherwise,
since it's waiting on people. Each signer gets an email, confirms it with a
one-time code, then signs by typing their name. Everyone is invited at once; the
array order decides which marker each one signs, not who is asked first.

The sample polls the run and reads the envelope for the sender's view:

```jsonc
{
  "envelope": {
    "status": "pending",                  // pending → finalizing → completed
    "docSha256": "9f2b…",                 // the exact bytes everyone signs
    "outputFileId": null,                 // the signed PDF, once it exists
    "expiresAt": "2026-08-28T12:00:00Z"
  },
  "signers": [
    {
      "name": "Élise Tremblay",
      "position": 1,                      // which [Signature N] they land on
      "status": "pending",                // or "signed"
      "signedAt": null,
      "typedName": null                   // what they typed when signing
    }
  ],
  "events": [                             // the audit trail
    { "type": "created", "actor": "system", "occurredAt": "…" }
  ]
}
```

`sdk.runs.getRunEnvelope({ id })` returns that as a `RunSignEnvelopeView`, so the
roster and trail are typed the whole way through — no casting.

Signing links never appear in an API response; they go only to the signer's inbox.
From the sender's side you can resend an invitation
(`POST /v1/runs/{id}/signers/{signerId}/resend`) or cancel while the envelope is
still pending (`POST /v1/runs/{id}/void`). The signed PDF carries the signatures
and a Signature Certificate page with each signer's verified email, signing time,
IP, typed name, the document's fingerprint, and the full event log.

## Handing the certificate to `sign`

One detail worth copying: the filled certificate is passed by **link**, not by id.

```ts
const certificate = await sdk.files.getFile({ id: fillRun.output.file.id });
if (!certificate.urls?.content) throw new Error("the filled certificate has no download link");

await sdk.sign({
  body: {
    file: { url: certificate.urls.content, name: certificate.name },
    signers,
  },
});
```

A file the platform produced is stored as written and isn't read a second time,
so referring to it by id gives `file_not_parsed`. The content link lets the sign
run fetch the bytes and read them for itself.

The link is signed and appears only once the file has finished writing, which is
why it is checked rather than assumed — `app.ts` polls `getFile` until the status
is `ready` before reaching for it.

## Webhooks

How progress arrives follows from the hostname, not a setting. On localhost the
page polls. Opened through a tunnel, each run also gets a `webhook` built from
that address, and its events arrive as they happen alongside the polling.

Deliveries carry an `x-rk1-signature` header: a compact ES256 JWT whose
`bodySha256` claim binds it to the exact body received. `scaffold.ts` verifies it
against
[`GET /v1/webhooks/jwks.json`](https://docs.cloudraker.com/developers/webhooks)
and drops any `eventId` it has already handled, since delivery is at-least-once.

## Housekeeping

Runs and their files are purged after their TTL — 24 hours by default, up to 7
days. E-signature runs are exempt while an envelope is open, since an envelope
waits for its signers however long that takes. To keep a result permanently, call
[`POST /v1/runs/{id}/keep`](https://docs.cloudraker.com/api/cloud-raker-api/runs/keep-run)
before the deadline.

State lives in this process, so restarting the server loses jobs in flight. The
runs are unaffected — read an envelope back with
`GET /v1/runs/{sign run id}/envelope`.

## The files

| File | What's in it |
| --- | --- |
| [`app.ts`](app.ts) | Every API call — inspect, config, fill, the values re-fill, sign — and the job state the page polls. |
| [`scaffold.ts`](scaffold.ts) | The server: routes, the specimens, webhook verification. Talks to no API. |
| [`page.ts`](page.ts) | The page. Plain HTML and a little browser JavaScript, no build step. |
| [`review.ts`](review.ts) | Turns a fill run's fields and a sign run's envelope into what the page renders. |
