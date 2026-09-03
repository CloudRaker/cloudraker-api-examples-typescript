# medical-call-notes

Upload a recorded clinician–patient call and get a structured note back, with every
value traced to the words that produced it. Four ways, selectable in the UI, on the
[`@cloudraker/api` TypeScript SDK](https://docs.cloudraker.com/developers/sdks).

Three are one [`sdk.extract()`](https://docs.cloudraker.com/capabilities/extract) on an
uploaded recording, differing only in where the shape comes from:

1. **`schema`** — the shape in [`schema.json`](schema.json), sent with the call. Each
   recording gets its own note (`unit: per_document`).
2. **`hints`** — no schema at all: a sentence of prose, and the platform
   [infers the shape](https://docs.cloudraker.com/capabilities/extract#schema-inference),
   reporting it back as `config.schema` so you can save it.
3. **`action`** — an action already **installed in your organization** carries the
   shape, so `action` goes in place of `schema`. Anything else you send applies to that
   run only, so you can ask for citations even if the action was saved without them.

The fourth is different:

4. **`process`** — `sdk.process.startProcess()` uploads, transcribes with speaker
   labels and runs the same installed action in a single call, reporting progress by
   signed webhook. The action runs as configured, so per-run options don't apply. This
   is the only mode that needs a public hostname.

```sh
bun install
bun app.ts                                       # http://localhost:8787
cloudflared tunnel --url http://localhost:8787   # only mode 4 needs this
```

The page walks three steps: **choose recordings**, **choose how to run it**, then
**review**. The review step plays the recording you sent, shows its transcript, and
lays the fields out in schema order rather than as raw JSON. Under each value is the
phrase from the call it came from — for a recording that is genuinely different from
the value, so it is worth reading. Fields the call didn't cover are hidden behind a
checkbox.

Every timecode is a **seek button**: click one in the transcript, or the `At 0:03`
beside a value, and the player jumps there. So a value can be heard rather than taken
on trust. This needs the citations checkbox on — the position comes from the
citation's `timecode` (see [What you get back](#what-you-get-back)).

The checks ask whether the note hangs together, since a call has no arithmetic to
reconcile: whether the response carries every required field, whether an assessment is
paired with a plan, whether a plan that changes a medication names one, and whether a
plan that asks to be revisited says when — in `follow_up` or in the plan itself.

A run that invents its own shape can't be checked by field name, so mode 2 gets checks
that read the citations instead: whether every answered value is traced to the call,
and whether every quote is a confident match.

## How the result comes back

For the three `sdk.extract()` modes this follows from the hostname, not a setting,
because only one of the two works in each case. The page says which is in effect.

| Opened at | What happens |
| --- | --- |
| **localhost** | The call is held open for up to `wait` seconds, then polled if the run outlives it. The platform cannot call localhost back. |
| **a tunnel hostname** | `wait: 0`, so the call returns a `202` at once and the finished run arrives as a [signed webhook](https://docs.cloudraker.com/developers/webhooks). No polling. |

Mode 4 reports **only** by webhook, so it is refused on localhost with a message
telling you to start a tunnel. Its events carry no payload — they notify, and the app
then calls `sdk.process.getProcess({ include: "results,content" })` for the note, which
brings the transcript with it.

The two surfaces publish separate signing keys — `/v1/webhooks/jwks.json` for the
capability verbs, `/process/jwks.json` for the pipeline — so a delivery is verified
against both rather than guessing which sent it. Deliveries are at-least-once, so
events are deduplicated on `eventId`.

## Config

Put your organization API key in `.env` next to `app.ts` (gitignored) — see
[Authentication](https://docs.cloudraker.com/developers/authentication):

```
RAKERONE_API_KEY=sk_...
```

Optional env: `PORT` (default `8787`), `RAKERONE_WAIT` (default `120`, max `120`),
`RAKERONE_HINTS` (default prose for mode 2), `RAKERONE_ACTION` (the installed action
modes 3 and 4 run — no default, since the name is yours; set it here or on the page,
and `sdk.actions.listActions()` lists what you have installed).

The page also has an optional **house rules** box — free-form guidance layered on top
of the shape, e.g. "record only symptoms the patient confirms" — and a **citations**
checkbox, on by default. Mode 4 disables the checkbox and ignores house rules, since
the action runs as configured.

## What you get back

Citations are off unless you ask for them. With the checkbox ticked the run sends
`citations: true` and each value carries the words it came from. In mode 3 that applies
to the run even when the installed action was saved without it.

An audio citation carries the quoted text, a confidence, and a `timecode` — seconds
into the recording — where a document would give a `page`. The timecode marks the
transcript segment the quote falls in, and it is what every seek button uses. With
citations off there is no timecode and no seeking.

A value can carry **several** citations. One put together from two moments in the
call — the drug named at one point, starting it agreed at another — is cited at
each of them, and the review shows every quote with its own seek button, because
either one alone tells half the story.

```jsonc
{
  "output": {
    "value": {
      "chief_complaint": "Chest pain for the past several hours",
      "symptoms": ["Sharp left-sided chest pain, present for approximately 8 hours", "…"],
      "assessment": null
    },
    "citations": {
      "chief_complaint": [
        { "fileId": "...", "timecode": 3.04, "text": "I'm just having a lot of chest pain", "confidence": 5 }
      ]
    }
  }
}
```

`output.value` is only lifted to the top for a **single** recording — send several and
it is `null`, so read `output.documents[]` instead.

## Sample recordings

[`sample-files/`](sample-files/) has three invented calls — no real patients or
clinicians:

| File | | Typically fills |
| --- | --- | --- |
| `CAR0001.mp3` | Chest pain — history taken, but the clinician voices no impression | 3 of 7 |
| `CAR0002.mp3` | Chest pain, with current medications named | 4 of 7 |
| `CAR0003.mp3` | Breathlessness — the only one with an assessment and a plan | 6 of 7 |

`CAR0003` is the one that exercises the checks: it is the only call where the
assessment-and-plan pairing passes and the medication check has anything to reconcile.
On the other two the clinician never voices an impression, so those checks report
"no assessment or plan on the call" — the review telling you something true about the
recording rather than about the extraction.

Field counts drift run to run; the shape of the call doesn't.

## Files

| | |
| --- | --- |
| [`app.ts`](app.ts) | The API calls — upload, extract, process, poll, webhook. Start here. |
| [`schema.json`](schema.json) | The fields to pull out, and the order the review shows them in. |
| [`review.ts`](review.ts) | Turns a finished run into fields, checks, and the citation behind each value. The only medical-specific logic. |
| [`page.ts`](page.ts) | The page: player, transcript, checks, fields. Renders whatever `review.ts` produces. |
| [`scaffold.ts`](scaffold.ts) | HTTP server, uploads, webhook signature verification. |

### Pointing it at your own recordings

1. **Replace `schema.json`** with the fields you want. Root must be an object, keep
   primitives nullable so a field the call didn't cover reads as `null`, and put the
   fields in the order you want to read them — the review follows that order.
2. **Rewrite `checks()` in `review.ts`.** Each check returns `{ ok, label, detail? }`,
   where `ok: null` means the call didn't cover enough to judge.
3. **Change `HINTS` in `app.ts`** — one sentence describing the recordings, used when
   no schema is sent.

Nothing else needs touching. `page.ts` renders whatever fields and checks `review.ts`
returns, and the transcript matching in `review.ts` is field-agnostic.
