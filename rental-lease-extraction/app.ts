/**
 * Lease extraction — structured lease terms out of an abstract, fact sheet or
 * overview, four ways, selectable in the UI. Server and webhook verification are in
 * scaffold.ts.
 *
 * Each is one `sdk.extract()`. Three differ only in where the shape comes from —
 * `schema` sent inline, inferred from `hints`, or carried by an installed `action`
 * — and one folds a set of documents into a single record.
 *
 *     bun app.ts                                       # http://localhost:8788
 *     cloudflared tunnel --url http://localhost:8788   # optional
 *
 * How the result arrives follows from the hostname, not a mode: localhost holds
 * the call open and polls; a tunnel gets a signed webhook, which is what
 * production looks like once a run can outlast `wait`.
 */

import { CloudRakerClient } from "@cloudraker/api";
import SCHEMA from "./schema.json";
import { review, type Review } from "./review.ts";
import { serve, type Upload, type WebhookEvent } from "./scaffold.ts";

const API_BASE = "https://api.cloudraker.com";
// Bun loads .env automatically — put RAKERONE_API_KEY=sk_... next to app.ts.
const API_KEY = process.env.RAKERONE_API_KEY ?? (() => { throw new Error("RAKERONE_API_KEY not set — put RAKERONE_API_KEY=sk_... in .env next to app.ts"); })();
const PORT = Number(process.env.PORT ?? 8788);
/** Seconds to hold the call open. Maximum 120; 0 always returns a 202. */
const WAIT = Number(process.env.RAKERONE_WAIT ?? 120);

/** Used when the hints box is left blank. */
const HINTS = process.env.RAKERONE_HINTS ??
  "Commercial property lease abstracts and fact sheets. I care about the parties, " +
  "the premises and its area, the term dates, base rent and the rent schedule, " +
  "operating costs, the security deposit, renewal and termination rights, and the " +
  "notice periods.";

/**
 * Slug of the installed action one mode runs. No sensible default: the action has to
 * exist in your organization, and its name is yours. Set RAKERONE_ACTION or name it
 * on the page — `sdk.actions.listActions()` lists them.
 */
const ACTION_SLUG = process.env.RAKERONE_ACTION ?? "";

// The SDK default timeout is shorter than a call held open with wait=120.
const sdk = new CloudRakerClient({ token: API_KEY, baseUrl: API_BASE, timeoutInSeconds: WAIT + 30 });

/** `reviews` is what the page renders — see review.ts. */
type Job = {
  log: string[];
  result: unknown | null;
  error: string | null;
  reviews: Review[] | null;
};
const JOBS = new Map<string, Job>();

const blank = (): Job => ({ log: [], result: null, error: null, reviews: null });

/** Get-or-create: a webhook can arrive before the call that started the run returns. */
function job(id: string): Job {
  let j = JOBS.get(id);
  if (!j) JOBS.set(id, (j = blank()));
  return j;
}

const log = (id: string, line: string) => {
  job(id).log.push(line);
  console.log(`[${id}] ${line}`);
};

async function upload(id: string, uploads: Upload[]): Promise<{ id: string }[]> {
  const refs: { id: string }[] = [];
  for (const u of uploads) {
    const file = await sdk.files.createFile({ name: u.name, mimeType: u.mimeType });
    const put = await fetch(file.uploadUrl!, {
      method: "PUT",
      body: u.data,
      headers: { "content-type": u.mimeType },
    });
    if (!put.ok) throw new Error(`upload of ${u.name} failed: ${put.status} ${await put.text()}`);
    log(id, `uploaded ${u.name} (${file.id})`);
    refs.push({ id: file.id });
  }
  return refs;
}

/** The per-mode differences, all of them. */
function config(mode: string, hints: string, instructions: string, citations: boolean, action: string) {
  // `instructions` coexists with `schema` and `action`; `hints` does not.
  const extra = instructions ? { instructions } : {};
  // Grounding is off unless asked for; with it on the result carries `citations`.
  if (mode === "hints") return { hints: hints || HINTS, citations };
  // `action` stands in for `schema` — at most one of the two. What we send with it
  // applies to this run only; `unit` is left to the action.
  if (mode === "action") return { action: action || ACTION_SLUG, citations, ...extra };
  const unit = mode === "multi-doc" ? ("across_documents" as const) : ("per_document" as const);
  return { schema: SCHEMA, citations, unit, ...extra };
}

type Finished = { id: string; status: string; error?: { code?: string; message?: string } };

function finish(id: string, run: Finished) {
  const j = job(id);
  log(id, `run ${run.id}: ${run.status}`);
  j.result = run;
  j.reviews = review(run);
  if (run.status === "needs_input") {
    j.error = "run needs input — see tasks[] on the result";
  } else if (run.status !== "processed") {
    // A failed run explains itself — show that, not our own restatement of it.
    const { code, message } = run.error ?? {};
    j.error = message ? (code ? `${message} (${code})` : message) : `run finished as ${run.status}`;
  }
}

async function settle(id: string, runId: string) {
  let run = await sdk.runs.getRun({ id: runId, wait: WAIT });
  while (run.status === "queued" || run.status === "processing") {
    log(id, `run ${run.id} is ${run.status} — polling`);
    run = await sdk.runs.getRun({ id: runId, wait: WAIT });
  }
  finish(id, run);
}

async function runSync(id: string, refs: { id: string }[], mode: string, hints: string, instructions: string, citations: boolean, action: string) {
  try {
    const target = refs.length === 1 ? { file: refs[0] } : { files: refs };
    log(id, `extract (${mode}) — holding up to ${WAIT}s`);
    const run = await sdk.extract({
      wait: WAIT,
      body: { ...target, ...config(mode, hints, instructions, citations, action) },
    });
    // A run that outlives wait comes back as a 202 stub, so keep polling.
    if (run.status === "queued" || run.status === "processing") await settle(id, run.id);
    else finish(id, run);
  } catch (e) {
    job(id).error = String(e);
  }
}

/** The run id is the job id, so a delivery finds its job without a lookup table. */
async function startWebhookRun(uploads: Upload[], mode: string, callbackUrl: string, hints: string, instructions: string, citations: boolean, action: string): Promise<string> {
  const staging = crypto.randomUUID();
  const refs = await upload(staging, uploads);
  const target = refs.length === 1 ? { file: refs[0] } : { files: refs };
  const run = await sdk.extract({
    wait: 0,
    body: {
      ...target,
      ...config(mode, hints, instructions, citations, action),
      webhook: { url: callbackUrl },
    },
  });
  JOBS.set(run.id, { ...blank(), log: JOBS.get(staging)?.log ?? [] });
  JOBS.delete(staging);
  log(run.id, `run accepted (${run.status}) — waiting for a webhook at ${callbackUrl}`);
  return run.id;
}

/** `webhook` comes from the hostname, not the mode; every mode works either way. */
async function onRun(uploads: Upload[], mode: string, callbackUrl: string, hints: string, instructions: string, citations: boolean, webhook: boolean, action: string): Promise<string> {
  if (webhook) return startWebhookRun(uploads, mode, callbackUrl, hints, instructions, citations, action);
  const id = crypto.randomUUID();
  JOBS.set(id, blank());
  // Unawaited: the extract call blocks, and the browser needs the id to poll with.
  void (async () => {
    try {
      await runSync(id, await upload(id, uploads), mode, hints, instructions, citations, action);
    } catch (e) {
      job(id).error = String(e);
    }
  })();
  return id;
}

function onEvent(event: WebhookEvent) {
  log(event.processingId, `webhook: ${event.type}`);
  if (event.type === "run.completed" || event.type === "run.failed") {
    void fetchRun(event.processingId);
  }
}

async function fetchRun(runId: string) {
  try {
    finish(runId, await sdk.runs.getRun({ id: runId }));
  } catch (e) {
    job(runId).error = String(e);
  }
}

serve(PORT, API_BASE, !!ACTION_SLUG, { onRun, onEvent, getState: (id) => JOBS.get(id) });
