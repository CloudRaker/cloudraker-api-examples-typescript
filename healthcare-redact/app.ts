/**
 * Redact — strip personal information out of a document or a recording with one
 * `sdk.redact()`, then show what went. Server and page are in scaffold.ts.
 *
 *     bun app.ts                                       # http://localhost:8789
 *     cloudflared tunnel --url http://localhost:8789   # optional
 *
 * The removal is destructive: text is cut out of the PDF content stream rather
 * than covered, and audio is beeped or silenced with its transcript rewritten.
 * Routing is by media type — documents take `mode`, audio takes `style`, and
 * sending the other medium's parameter is a 400.
 *
 * The settings can come from the page or from an action already installed in the
 * organization, named as `action` in place of them.
 *
 * How the result arrives follows from the hostname, not a setting: localhost
 * holds the call open and polls, a tunnel gets a signed webhook.
 */

import { CloudRakerClient, type CloudRaker } from "@cloudraker/api";
import { kindOf, review, type Preview, type Review } from "./review.ts";
import { serve, type Options, type WebhookEvent } from "./scaffold.ts";

const API_BASE = "https://api.cloudraker.com";
// Bun loads .env automatically — put RAKERONE_API_KEY=sk_... next to app.ts.
const API_KEY = process.env.RAKERONE_API_KEY ?? (() => { throw new Error("RAKERONE_API_KEY not set — put RAKERONE_API_KEY=sk_... in .env next to app.ts"); })();
const PORT = Number(process.env.PORT ?? 8789);
/** Seconds to hold the call open. Maximum 120; 0 always returns a 202. */
const WAIT = Number(process.env.RAKERONE_WAIT ?? 120);

const sdk = new CloudRakerClient({ token: API_KEY, baseUrl: API_BASE, timeoutInSeconds: WAIT + 30 });

type Job = {
  log: string[];
  result: unknown | null;
  error: string | null;
  review: Review | null;
  /** Kept so a webhook arriving later can still show the before/after pair. */
  source: Preview | null;
};
const JOBS = new Map<string, Job>();
const blank = (): Job => ({ log: [], result: null, error: null, review: null, source: null });

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
 * `status` walks `uploading` → `processing` → `ready`, or lands on `failed`. Log each
 * step rather than going quiet, and give up rather than hang.
 */
async function settleFile(fileId: string, id?: string, name?: string) {
  let seen = "";
  for (let i = 0; i < 150; i++) {
    const file = await sdk.files.getFile({ id: fileId });
    if (file.status !== seen) {
      seen = file.status;
      if (id) log(id, `${name ?? "file"}: ${seen}`);
    }
    if (file.status === "ready" || file.status === "failed") return file;
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`${name ?? "the file"} was still ${seen || "processing"} after 10 minutes`);
}

const previewOf = (f: { name?: string; mimeType?: string; urls?: { content?: string } }): Preview => ({
  name: f.name ?? "file",
  url: f.urls?.content ?? "",
  kind: kindOf(f.mimeType ?? f.name ?? ""),
});

/** Register the file, PUT the bytes, wait for it to be readable. */
async function upload(id: string, name: string, mimeType: string, data: Uint8Array<ArrayBuffer>) {
  const created = await sdk.files.createFile({ name, mimeType });
  log(id, `file created (${created.id})`);
  const put = await fetch(created.uploadUrl!, { method: "PUT", body: data, headers: { "content-type": mimeType } });
  if (!put.ok) throw new Error(`upload failed: ${put.status} ${await put.text()}`);
  log(id, `uploaded ${name} (${(data.byteLength / 1024).toFixed(0)} KB)`);
  const file = await settleFile(created.id, id, name);
  if (file.status !== "ready") throw new Error(`file ended as ${file.status}`);
  return file;
}

/**
 * `mode` and `style` are mutually exclusive; the caller picked by media type. An
 * action stands in for whichever applies, and what the page filled in goes alongside.
 *
 * `choice` arrives as a query string, so it is narrowed here rather than asserted
 * blind: scaffold rejects anything outside the medium's own list (`targeted` |
 * `lines` for documents, `beep` | `silence` for audio) before the run starts.
 */
const config = (o: Options): Omit<CloudRaker.V1RedactBody, "file"> => ({
  ...(o.action
    ? { action: o.action }
    : o.audio
      ? { style: o.choice as CloudRaker.V1RedactBody.Style }
      : { mode: o.choice as CloudRaker.V1RedactBody.Mode }),
  ...(o.categories.length ? { categories: o.categories } : {}),
  ...(o.instructions ? { instructions: o.instructions } : {}),
});

/** The signed url appears only once the output has finished writing to storage. */
async function finish(id: string, run: { id: string; status: string; output?: { file?: { id?: string } } }) {
  const j = job(id);
  let settled = run;
  const outputId = run.output?.file?.id;
  if (run.status === "processed" && outputId) {
    log(id, "waiting for the redacted file");
    await settleFile(outputId);
    settled = (await sdk.runs.getRun({ id: run.id })) as typeof run;
  }
  log(id, `run ${run.id}: ${run.status}`);
  j.result = settled;
  j.review = review(settled, j.source);
  if (run.status !== "processed") {
    const { code, message } = (settled as { error?: { code?: string; message?: string } }).error ?? {};
    j.error = message ? (code ? `${message} (${code})` : message) : `run finished as ${run.status}`;
  }
}

/** Held open, polled if the run outlives `wait`. */
async function runSync(id: string, fileId: string, opts: Options) {
  const how = opts.action ? `action: ${opts.action}` : `${opts.audio ? "style" : "mode"}: ${opts.choice}`;
  log(id, `redact (${how}) — holding up to ${WAIT}s`);
  let run = await sdk.redact({ wait: WAIT, body: { file: { id: fileId }, ...config(opts) } });
  while (run.status === "queued" || run.status === "processing") {
    log(id, `run ${run.id} is ${run.status} — polling`);
    run = (await sdk.runs.getRun({ id: run.id, wait: WAIT })) as typeof run;
  }
  await finish(id, run);
}

/** The run id is the job id, so a delivery finds its job without a lookup table. */
async function startWebhookRun(staging: string, fileId: string, opts: Options): Promise<string> {
  const run = await sdk.redact({
    wait: 0,
    body: {
      file: { id: fileId },
      ...config(opts),
      webhook: { url: opts.callbackUrl },
    },
  });
  const prior = job(staging);
  JOBS.set(run.id, { ...blank(), log: prior.log, source: prior.source });
  JOBS.delete(staging);
  log(run.id, `run accepted (${run.status}) — waiting for a webhook at ${opts.callbackUrl}`);
  return run.id;
}

async function onRun(name: string, mimeType: string, data: Uint8Array<ArrayBuffer>, opts: Options): Promise<string> {
  const id = crypto.randomUUID();
  JOBS.set(id, blank());
  if (opts.webhook) {
    const file = await upload(id, name, mimeType, data);
    job(id).source = previewOf(file as never);
    return startWebhookRun(id, file.id, opts);
  }
  // Unawaited: the redact call blocks, and the browser needs the id to poll with.
  void (async () => {
    try {
      const file = await upload(id, name, mimeType, data);
      job(id).source = previewOf(file as never);
      await runSync(id, file.id, opts);
    } catch (e) {
      job(id).error = String(e);
    }
  })();
  return id;
}

function onEvent(event: WebhookEvent) {
  log(event.processingId, `webhook: ${event.type}`);
  if (event.type === "run.completed" || event.type === "run.failed") {
    void (async () => {
      try {
        await finish(event.processingId, (await sdk.runs.getRun({ id: event.processingId })) as never);
      } catch (e) {
        job(event.processingId).error = String(e);
      }
    })();
  }
}

serve(PORT, API_BASE, {
  onRun,
  onEvent,
  getState: (id) => JOBS.get(id),
  getPreview: (id, side) => {
    const p = JOBS.get(id)?.review?.[side];
    return p?.url ? { url: p.url, name: p.name } : undefined;
  },
});
