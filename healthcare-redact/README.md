# healthcare-redact

Remove personal information from a document or a recording with one
[`sdk.redact()`](https://docs.cloudraker.com/capabilities/redact), on the
[`@cloudraker/api`](https://www.npmjs.com/package/@cloudraker/api) SDK — upload the
bytes with `sdk.files.createFile()`, then redact.

The settings can come from the page, or from an action already installed in your
organization: name it and `action` goes in place of them, with anything you fill in
alongside applying to that run only.

The removal is destructive, not cosmetic: the text is taken out of the PDF itself
and the area blacked out, so there is nothing left underneath the box, and audio is
beeped or silenced with its transcript rewritten to match.

```sh
bun install
bun app.ts                                       # http://localhost:8789
cloudflared tunnel --url http://localhost:8789   # optional, see below
```

The page walks three steps: **choose a file**, **choose how to redact**, then
**review**. Step 2 is either the settings below or the name of an installed action. The review step puts the original and the redacted file side by side —
recordings play in the page, documents open in a tab — because the only real check
on a redaction is looking at it. Alongside them it reports how many items were
removed in each category, and says so plainly when nothing matched at all.

## How the result comes back

Not a setting — it follows from the hostname you open the page at, because only
one of the two works in each case. The page says which is in effect.

| Opened at | What happens |
| --- | --- |
| **localhost** | The call is held open for up to `wait` seconds, then polled if the run outlives it. The platform cannot call localhost back. |
| **a tunnel hostname** | `wait: 0`, so the call returns a `202` at once and the finished run arrives as a [signed webhook](https://docs.cloudraker.com/developers/webhooks). No polling. |

Deliveries are verified before they are trusted: `x-rk1-signature` is a compact
ES256 JWT checked against the platform's public JWKS, and its `bodySha256` claim
must match the bytes received, so a valid signature cannot be replayed onto a
different body. Delivery is at-least-once, so events are deduplicated on
`eventId`. In webhook delivery the job id **is** the run id, which is how a
delivery finds its job without a lookup table.

## How redaction is chosen

Documents and recordings take different parameters, and sending the other
medium's parameter is a `400`. This example picks from the file's type rather
than asking, so the pairing can't be got wrong:

| Input | Parameter | Choices |
| --- | --- | --- |
| `application/pdf` | `mode` | `targeted` — black out only the sensitive words · `lines` — black out every line containing them |
| anything under `audio/` | `style` | `beep` · `silence` |

Those are the only two inputs redaction accepts. **Word documents, images and
video are not handled** — convert to PDF or extract the audio track first.

Two optional inputs apply to both. **categories** (`categories`) narrows what
counts as sensitive, named in plain words the same way they come back in the
result — the defaults are `Person names`, `Social insurance number`, `Address`,
`Phone number`, `Email address` and `Date of birth`. Whatever you pass replaces
that list rather than adding to it.

Those categories are about the *kind* of information, not whose it is, so on a
clinical form every address and phone number goes — the practice's as well as the
patient's. **house rules** (`instructions`) is how you draw that line. On the
cardiology referral, adding "keep the referring clinic's own name, address, phone and
fax — redact the patient's and the parent's" takes it from 12 items removed to 8: the
clinic's address and both its numbers stay, and so does the referring doctor's name,
which the instruction never mentioned.

## Running an installed action instead

If your organization already has a redaction configured, name it and `action` goes in
place of `mode`/`style` — the action carries those and any saved house rules:

```ts
await sdk.redact({ wait: 120, body: { file: { id }, action: "redact-patient-info" } })
```

`sdk.actions.listActions()` lists what you have installed. It takes a slug or an id,
and anything you send alongside applies to that run only, so you can narrow the
categories for one call without editing the action. The result is an ordinary redact
run, so the review step reads it unchanged.

## What you get back

A redact run whose `output` carries:

| | |
| --- | --- |
| `file` | The redacted file — `{ id, name, url }`. `url` is signed and time-limited, and appears only once the file has finished writing, so the run is re-fetched after the output settles. |
| `files[]` | One entry per input. |
| `entities` | Counts per category, keyed by display name — `{ "Person names": 8, "Phone number": 1 }`. |
| `skipped` | How many inputs had **nothing to redact**. Nothing matched, so no redacted copy was written for them — a clean file, not a leftover. |

Same lifecycle as any run — poll `sdk.runs.getRun({ id })` if a call doesn't finish
inside its `wait` window.

## Sample files

[`sample-files/`](sample-files/) has three, all invented — no real patients, clinics
or numbers:

| File | |
| --- | --- |
| `referral_1_cardiology.pdf` | A cardiology referral. Carries the clinic's details *and* the patient's *and* a parent's, plus a health insurance number, and is part French. |
| `sample_medical_intake_form.pdf` | A plainer intake form — names, address, phone, email, date of birth. |
| `followup_call_labresults_sample.mp3` | A follow-up call about lab results. |

Start with the referral. It is the only one carrying a health insurance number, so it
is the only one that exercises the `Social insurance number` category, and because it
holds the practice's contact details alongside the family's it is the file to try
house rules on.

The recording is worth a run too: its details are spoken rather than printed, so the
redaction has to land on the audio and its transcript together. Counts shift a little
between runs.

## Config

Put your organization API key in `.env` next to `app.ts` (gitignored) — see
[Authentication](https://docs.cloudraker.com/developers/authentication):

```
RAKERONE_API_KEY=sk_...
```

Optional env: `PORT` (default `8789`), `RAKERONE_WAIT` (default `120`, max `120` —
seconds to hold the call open; `0` always returns the `202`).

For webhook delivery, open the page **at the tunnel hostname**, not localhost: the
callback URL is taken from the browser's Host header.

## Files

| | |
| --- | --- |
| [`app.ts`](app.ts) | The API calls — upload, redact, fetch both files. Start here. |
| [`review.ts`](review.ts) | Turns a finished run into counts, checks and the two previews. |
| [`page.ts`](page.ts) | The page. Renders whatever `review.ts` returns. |
| [`scaffold.ts`](scaffold.ts) | HTTP server, uploads, webhook signature verification. |

To point this at your own documents, change the checks in `review.ts` for what
you want asserted about a finished run.
