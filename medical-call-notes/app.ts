/**
 * Call notes — a structured note out of a recorded clinician call, four ways,
 * selectable in the UI. Server and webhook verification are in scaffold.ts.
 *
 *     bun app.ts                                       # http://localhost:8787
 *     cloudflared tunnel --url http://localhost:8787   # the last mode needs this
 *
 * Three are one `sdk.extract()` on an uploaded recording, differing only in where
 * the shape comes from: `schema` sent inline, inferred from `hints`, or carried by
 * an installed `action`. Anything sent alongside an action applies to that run only,
 * so citations can be asked for even if the action was saved without them.
 *
 * The fourth is `sdk.process.startProcess()` — the same installed action, but with
 * upload, transcription and the run in one call, reported only by webhook, so it needs
 * a hostname the platform can reach. There the action runs as configured.
 *
 * For the three verb modes, how the result arrives follows from the hostname rather
 * than a setting: localhost holds the call open and polls, a tunnel gets a webhook.
 */

import { CloudRakerClient } from "@cloudraker/api";
import SCHEMA from "./schema.json";
import { review, type Review, type Segment } from "./review.ts";
import { serve, type Upload, type WebhookEvent } from "./scaffold.ts";

const API_BASE = "https://api.cloudraker.com";
// Bun loads .env automatically — put RAKERONE_API_KEY=sk_... next to app.ts.
const API_KEY = process.env.RAKERONE_API_KEY ?? (() => { throw new Error("RAKERONE_API_KEY not set — put RAKERONE_API_KEY=sk_... in .env next to app.ts"); })();
const PORT = Number(process.env.PORT ?? 8787);
/** Seconds to hold the call open. Maximum 120; 0 always returns a 202. */
const WAIT = Number(process.env.RAKERONE_WAIT ?? 120);

/** Used when the hints box is left blank. */
const HINTS = process.env.RAKERONE_HINTS ??
  "A recorded phone call between a clinician and a patient. I care about the chief " +
  "complaint, the symptoms the patient confirms, relevant history, any medications " +
  "discussed, the clinician's assessment, and the agreed plan and follow-up.";

/**
 * Slug of the installed action the last two modes run. There is no sensible default:
 * the action has to exist in your organization, and its name is yours. Set
 * RAKERONE_ACTION or name it on the page — `sdk.actions.listActions()` lists them.
 */
const ACTION_SLUG = process.env.RAKERONE_ACTION ?? "";

// The SDK default timeout is shorter than a call held open with wait=120.
const sdk = new CloudRakerClient({ token: API_KEY, baseUrl: API_BASE, timeoutInSeconds: WAIT + 30 });

/** `reviews` is what the page renders — see review.ts. */
type Job = {
  /** Which surface started it: the capability verb, or the installed-action pipeline. */
  kind: "run" | "process";
  log: string[];
  result: unknown | null;
  error: string | null;
  reviews: Review[] | null;
  /** One per upload, in the same order, so the page can pair it to a player. */
  transcripts: Transcript[] | null;
};

type Transcript = { fileId: string; name: string; segments: Segment[] };
const JOBS = new Map<string, Job>();

const blank = (kind: Job["kind"] = "run"): Job =>
  ({ kind, log: [], result: null, error: null, reviews: null, transcripts: null });

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

/**
 * `status` walks `uploading` → `processing` → `ready`, or lands on `failed`.
 * Transcribing a recording takes minutes, so log each step rather than going quiet.
 */
type File = Awaited<ReturnType<typeof sdk.files.getFile>>;

async function settleFile(id: string, fileId: string, name: string): Promise<File> {
  let seen = "";
  for (let i = 0; i < 120; i++) {
    const file = await sdk.files.getFile({ id: fileId });
    if (file.status !== seen) log(id, `${name}: ${(seen = file.status)}`);
    // The ready response already carries `urls`, so nothing needs fetching twice.
    if (file.status === "ready") return file;
    if (file.status === "failed") throw new Error(`${name} failed: ${file.error ?? "no reason given"}`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`${name} was still ${seen} after 10 minutes`);
}

/** The transcript shape, wherever it arrives from. Word-level timings go unused. */
function segmentsOf(body: unknown): Segment[] {
  const rows = body && typeof body === "object" && Array.isArray((body as { segments?: unknown }).segments)
    ? ((body as { segments: unknown[] }).segments)
    : [];
  return rows
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      start: typeof x.start === "number" ? x.start : 0,
      text: String(x.text ?? ""),
      speaker: typeof x.speaker === "string" ? x.speaker : null,
    }))
    .filter((x) => x.text !== "");
}

/** A ready recording exposes its transcript as `urls.json`: segments with timings. */
async function transcriptOf(file: File, name: string): Promise<Transcript | null> {
  const url = file.urls?.json;
  if (!url) return null;
  try {
    const segments = segmentsOf(await (await fetch(url)).json());
    return segments.length > 0 ? { fileId: file.id, name, segments } : null;
  } catch {
    // The note stands on its own; a transcript we can't read just isn't shown.
    return null;
  }
}

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
    // Extracting before the transcript exists only makes the run wait.
    const ready = await settleFile(id, file.id, u.name);
    const t = await transcriptOf(ready, u.name);
    if (t) (job(id).transcripts ??= []).push(t);
    refs.push({ id: file.id });
  }
  return refs;
}

/** The per-mode differences, all of them. */
function config(mode: string, hints: string, instructions: string, citations: boolean, action: string) {
  // `instructions` coexists with `schema` and `action`; `hints` does not, so that mode omits it.
  const extra = instructions ? { instructions } : {};
  // Grounding is off unless asked for; with it on the result carries `citations`.
  if (mode === "hints") return { hints: hints || HINTS, citations };
  // `action` stands in for `schema` — at most one of the two. What we send with it
  // applies to this run only; `unit` is left to the action.
  if (mode === "action") return { action: action || ACTION_SLUG, citations, ...extra };
  return { schema: SCHEMA, citations, unit: "per_document" as const, ...extra };
}

type Finished = { id: string; status: string; error?: { code?: string; message?: string } };

function finish(id: string, run: Finished) {
  const j = job(id);
  log(id, `run ${run.id}: ${run.status}`);
  j.result = run;
  j.reviews = review(run, j.transcripts);
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
    const run = await sdk.extract({ wait: WAIT, body: { ...target, ...config(mode, hints, instructions, citations, action) } });
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
  // Carried across whole: picking fields by hand loses what `upload` gathered.
  JOBS.set(run.id, JOBS.get(staging) ?? blank());
  JOBS.delete(staging);
  log(run.id, `run accepted (${run.status}) — waiting for a webhook at ${callbackUrl}`);
  return run.id;
}

/**
 * One call uploads the audio, transcribes it with speaker labels and runs the
 * installed action, reporting progress by webhook. The events carry no payload, so
 * `processing.completed` triggers a fetch of the full status.
 */
async function startProcess(uploads: Upload[], callbackUrl: string, action: string): Promise<string> {
  const r = await sdk.process.startProcess({
    options: {
      files: uploads.map((u) => ({ field: u.name, processingKind: "audio-transcribe-and-diarize" })),
      actions: [action || ACTION_SLUG],
      callbackUrl,
    },
    files: uploads.map((u) => ({ data: u.data, filename: u.name, contentType: u.mimeType })),
  });
  JOBS.set(r.processingId, blank("process"));
  log(r.processingId, `processing accepted — waiting for webhooks at ${callbackUrl}`);
  void watchProcess(r.processingId); // backstop, in case a delivery never lands
  return r.processingId;
}

/** Pull the finished status with the action result and transcript inlined. */
async function fetchProcess(id: string): Promise<string | undefined> {
  try {
    const status = await sdk.process.getProcess({ id, include: "results,content", format: "json" });
    if (status.status === "done" || status.status === "failed") {
      const j = job(id);
      // The webhook and the polling backstop can both land on a finished processing.
      if (j.result) return status.status;
      j.result = status;
      // `include=content` inlines the transcript, so unlike the verb modes there is
      // nothing extra to fetch.
      const inlined = status.files
        .map((f) => ({ fileId: f.fileId, name: f.fileName, segments: segmentsOf(f.content) }))
        .filter((t) => t.segments.length > 0);
      if (inlined.length > 0) j.transcripts = inlined;
      j.reviews = review(status, j.transcripts);
      log(id, `processing ${status.status}`);
      // `done` means the pipeline ran, not that every action in it succeeded.
      const failed = status.actions.filter((a) => a.status === "failed");
      if (status.status === "failed") j.error = "processing failed — see the raw response";
      else if (failed.length > 0) {
        j.error = failed.map((a) => a.error ?? "the action failed").join("; ");
      }
    }
    return status.status;
  } catch (e) {
    job(id).error = String(e);
    return undefined;
  }
}

/**
 * Webhooks are the intended signal, but a single missed delivery would leave the
 * page waiting forever — the verb modes degrade to polling and this should too.
 * Stops as soon as the processing is terminal, or the job already has a result.
 */
async function watchProcess(id: string) {
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    if (job(id).result) return;
    const status = await fetchProcess(id);
    if (status === "done" || status === "failed" || status === undefined) return;
  }
  log(id, "gave up waiting after 15 minutes — the processing may still finish");
}

/** `webhook` comes from the hostname, not the mode; every verb mode works either way. */
async function onRun(uploads: Upload[], mode: string, callbackUrl: string, hints: string, instructions: string, citations: boolean, webhook: boolean, action: string): Promise<string> {
  // Only the pipeline surface needs a reachable hostname; `action` on a verb does not.
  if (mode === "process") return startProcess(uploads, callbackUrl, action);
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

/**
 * Both surfaces emit `processing.*` events, so the type alone does not say which
 * API to read back — a /v1 run would 404 against /process. The job records which
 * one started it.
 */
function onEvent(event: WebhookEvent) {
  const id = event.processingId;
  log(id, `webhook: ${event.type}`);
  const terminal = /\.(completed|failed)$/.test(event.type);
  if (!terminal) return;
  if (job(id).kind === "process") {
    if (event.type.startsWith("processing.")) void fetchProcess(id);
    return;
  }
  if (event.type.startsWith("run.")) void fetchRun(id);
}

async function fetchRun(runId: string) {
  try {
    finish(runId, await sdk.runs.getRun({ id: runId }));
  } catch (e) {
    job(runId).error = String(e);
  }
}

serve(PORT, API_BASE, !!ACTION_SLUG, { onRun, onEvent, getState: (id) => JOBS.get(id) });
