/**
 * A certificate of insurance out of an insurance policy, then signed. Every API
 * call is here; the server and webhook endpoint are in scaffold.ts.
 *
 *     bun app.ts                                       # http://localhost:8791
 *     cloudflared tunnel --url http://localhost:8791   # for webhook delivery
 *
 *   1. `inspectTemplate()` — what boxes the blank certificate has.
 *   2. `createFillConfig()` — save that list, for a form with no fields of its own.
 *   3. `fill()` — write the policy's values into the boxes.
 *   4. `sign()` — email it to the people who have to sign.
 *
 * https://docs.cloudraker.com/capabilities/fill
 * https://docs.cloudraker.com/capabilities/sign
 */

import { CloudRakerClient, type CloudRaker } from "@cloudraker/api";
import { summarise } from "./review.ts";
import {
  serve,
  type FillOptions,
  type Job,
  type Signer,
  type TemplateField,
  type Upload,
} from "./scaffold.ts";

const API_BASE = "https://api.cloudraker.com";
// Bun loads .env automatically — put RAKERONE_API_KEY=sk_... next to app.ts.
const API_KEY = process.env.RAKERONE_API_KEY ?? (() => { throw new Error("RAKERONE_API_KEY not set — put RAKERONE_API_KEY=sk_... in .env next to app.ts"); })();
const PORT = Number(process.env.PORT ?? 8791);

/** Seconds to hold the fill call open. Maximum 120; 0 always returns a 202. */
const WAIT = 120;

/**
 * The one fill config this example owns. Fixed, so every run reuses it instead
 * of leaving another behind — and so it can only ever update its own. The name
 * is the slug because the server mints the slug from the name and rejects a
 * `slug` key outright.
 */
const CONFIG_SLUG = "sdk-example-insurance-certificate";

/** The note each signer sees in their invitation email. */
const MESSAGE = "Please review and sign this certificate of insurance.";

// The SDK default timeout is shorter than a call held open with wait=120.
const sdk = new CloudRakerClient({ token: API_KEY, baseUrl: API_BASE, timeoutInSeconds: WAIT + 30 });

/** One entry per submission, keyed by the id the page polls. */
const JOBS = new Map<string, Job>();

const blank = (): Job => ({ stage: "inspecting", log: [], events: [] });

/** Get-or-create: a webhook can arrive before the call that started the run returns. */
function job(id: string): Job {
  let j = JOBS.get(id);
  if (!j) JOBS.set(id, (j = blank()));
  return j;
}

const log = (id: string, line: string): void => {
  job(id).log.push(line);
  console.log(`[${id}] ${line}`);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type File = Awaited<ReturnType<typeof sdk.files.getFile>>;
type FillRun = Awaited<ReturnType<typeof sdk.fill>>;
type SignRun = Awaited<ReturnType<typeof sdk.sign>>;

/** A run stops moving at one of these. */
const FINISHED = ["processed", "failed", "cancelled", "expired"];

/** Register the file, PUT the bytes to the URL that comes back, wait for it to be read. */
async function upload(id: string, file: Upload, label: string): Promise<File> {
  const created = await sdk.files.createFile({ name: file.name, mimeType: "application/pdf" });
  const put = await fetch(created.uploadUrl!, {
    method: "PUT",
    headers: { "content-type": "application/pdf" },
    body: file.bytes,
  });
  if (!put.ok) throw new Error(`could not upload ${file.name}: ${put.status} ${await put.text()}`);
  return settleFile(id, created.id, label);
}

/** `status` walks `uploading` → `processing` → `ready`, or lands on `failed`. */
async function settleFile(id: string, fileId: string, label: string): Promise<File> {
  let seen = "";
  for (let i = 0; i < 120; i++) {
    const file = await sdk.files.getFile({ id: fileId });
    if (file.status !== seen) log(id, `${label}: ${(seen = file.status)}`);
    if (file.status === "ready") return file;
    if (file.status === "failed") throw new Error(`${label} failed: ${file.error ?? "no reason given"}`);
    await sleep(3_000);
  }
  throw new Error(`${label} was still ${seen} after six minutes`);
}

/** The sender's view of an envelope: who was invited, who has signed, what happened when. */
const envelope = (runId: string): Promise<CloudRaker.RunSignEnvelopeView> =>
  sdk.runs.getRunEnvelope({ id: runId });

/** Record a failure, and say which stage it leaves the job at. */
const failed = (id: string, e: unknown, stage: Job["stage"]): void => {
  const why = e instanceof Error ? e.message : String(e);
  job(id).error = why;
  job(id).stage = stage;
  log(id, `stopped: ${why}`);
};

/**
 * Step 1: register both documents, then ask the template what boxes it has.
 * `inspect` labels each box from the field's own `/TU`, or from the text printed
 * beside it where the form declares no fields.
 */
function startInspect(id: string, policy: Upload, template: Upload, options: FillOptions): void {
  const j = job(id);
  j.webhookUrl = options.webhookUrl;
  j.output = options.output;

  void (async () => {
    try {
      log(id, "registering both documents");
      const policyFile = await upload(id, policy, "policy");
      const templateFile = await upload(id, template, "certificate template");
      j.policyFileId = policyFile.id;
      j.templateFileId = templateFile.id;
      j.templateUrl = templateFile.urls?.content;

      log(id, "asking the template what boxes it has");
      const seen = await sdk.templates.inspectTemplate({ id: templateFile.id });
      const fields = (seen.fields ?? []) as TemplateField[];
      j.template = {
        fields,
        detected: seen.detected === true,
        hash: seen.templateHash ?? undefined,
        pageCount: seen.pageCount ?? undefined,
      };
      j.stage = "inspected";
      log(
        id,
        `${fields.length} box(es) ${j.template.detected ? "found by the detector" : "declared by the form"}`,
      );
    } catch (e) {
      failed(id, e, "done");
    }
  })();
}

/** Step 2: save the approved field list as a fill config, then draft through it. */
function startConfigure(id: string, fields: TemplateField[]): void {
  const j = job(id);
  const templateFileId = j.templateFileId;
  const policyFileId = j.policyFileId;
  if (!templateFileId || !policyFileId) {
    failed(id, new Error("no documents on this job to fill"), "done");
    return;
  }
  j.stage = "filling";

  void (async () => {
    try {
      // Only a detected template needs a config: a form that declares its own
      // fields is self-describing, and `inspect` returns no `box` for one, which
      // a config requires.
      if (j.template?.detected) {
        const kept = fields.filter((f) => !f.ignore);
        const hash = j.template.hash;
        // `config.template` is the file id as a string — an object is a 400.
        const body = { template: templateFileId, fields, templateHash: hash };

        // Configure once, fill many times: one config, addressed by a fixed
        // slug, updated in place. Named for a slug rather than searched for —
        // a search by `templateHash` would adopt any config in the
        // organization built from the same bytes, including one somebody made
        // in the app, and replace what it holds.
        const existing = await sdk.configs.getFillConfig({ idOrSlug: CONFIG_SLUG }).catch(() => null);
        const saved = existing
          ? await sdk.configs.updateFillConfig({ idOrSlug: CONFIG_SLUG, config: body } as never)
          : await sdk.configs.createFillConfig({ name: CONFIG_SLUG, config: body } as never);

        j.configId = (saved as { id: string }).id;
        log(
          id,
          `${existing ? "updated" : "saved"} config ${CONFIG_SLUG}: ${kept.length} of ${fields.length} box(es) to fill`,
        );
      } else {
        log(id, `the form declares its own ${fields.length} field(s) — drafting from those`);
      }

      let fill = await sdk.fill({
        wait: WAIT,
        body: {
          ...(j.configId
            ? { action: j.configId }
            : { template: { id: templateFileId } }),
          files: [{ id: policyFileId }],
          output: j.output,
          ...(j.webhookUrl ? { webhook: { url: j.webhookUrl } } : {}),
        } as never,
      });
      j.fillRunId = fill.id;
      log(id, `fill run ${fill.id}: ${fill.status}`);

      let seen = fill.status;
      while (!FINISHED.includes(fill.status)) {
        await sleep(3_000);
        fill = (await sdk.runs.getRun({ id: fill.id, wait: WAIT })) as FillRun;
        if (fill.status !== seen) log(id, `fill run: ${(seen = fill.status)}`);
      }
      if (fill.status !== "processed" || !fill.output?.file) {
        throw new Error(`fill ended as ${fill.status}: ${fill.error?.message ?? "no reason given"}`);
      }
      const source = (fill.output as { fieldsSource?: string }).fieldsSource;
      if (source) log(id, `fields came from the ${source} list`);

      const certificate = await settleFile(id, fill.output.file.id, "certificate");
      if (!certificate.urls?.content) throw new Error("the filled certificate has no download link");
      j.certificate = { name: certificate.name, url: certificate.urls.content };
      j.filled = Object.fromEntries(
        Object.entries(fill.output.fields ?? {}).map(([field, value]) => [field, String(value ?? "")]),
      );
      j.stage = "filled";
      log(id, `certificate ready: ${Object.keys(j.filled).length} values written — check it before sending`);
    } catch (e) {
      failed(id, e, "done");
    }
  })();
}

/**
 * Write corrected values into a fresh copy of the blank template. `values` mode
 * is the same `fill` verb with the sources left out, so no model runs. `values`
 * and `files` are mutually exclusive, hence a second call.
 */
function startEdit(id: string, values: Record<string, string>): void {
  const j = job(id);
  const templateFileId = j.templateFileId;
  if (!templateFileId) {
    failed(id, new Error("no template on this job to re-fill"), "filled");
    return;
  }

  void (async () => {
    try {
      j.stage = "filling";
      log(id, `applying ${Object.keys(values).length} reviewed values`);
      let fill = await sdk.fill({
        wait: WAIT,
        body: {
          template: { id: templateFileId },
          values,
          output: j.output ?? "flattened",
          ...(j.webhookUrl ? { webhook: { url: j.webhookUrl } } : {}),
        },
      });
      j.fillRunId = fill.id;

      let seen = fill.status;
      while (!FINISHED.includes(fill.status)) {
        await sleep(3_000);
        fill = (await sdk.runs.getRun({ id: fill.id, wait: WAIT })) as FillRun;
        if (fill.status !== seen) log(id, `fill run: ${(seen = fill.status)}`);
      }
      if (fill.status !== "processed" || !fill.output?.file) {
        throw new Error(`fill ended as ${fill.status}: ${fill.error?.message ?? "no reason given"}`);
      }

      const certificate = await settleFile(id, fill.output.file.id, "certificate");
      if (!certificate.urls?.content) throw new Error("the filled certificate has no download link");
      j.certificate = { name: certificate.name, url: certificate.urls.content };
      j.filled = Object.fromEntries(
        Object.entries(fill.output.fields ?? {}).map(([field, value]) => [field, String(value ?? "")]),
      );
      j.stage = "filled";
      log(id, "certificate updated from the reviewed values");
    } catch (e) {
      // The previous certificate is untouched, so the job can be edited or sent.
      failed(id, e, "filled");
    }
  })();
}

/**
 * Step 3: send the certificate the page has just approved. `placement: "tags"`
 * puts each signature on the `[Signature N]` line waiting for it; `"page"`
 * appends a page listing them instead.
 */
function startSign(id: string, signers: Signer[], placement: "page" | "tags", message: string): void {
  const j = job(id);
  const certificate = j.certificate;
  const url = certificate?.url;
  if (!certificate || !url) throw new Error("there is no certificate to send yet");

  j.stage = "signing";

  void (async () => {
    try {
      // By link rather than by id: a file the platform produced is not read a
      // second time, so an id gives file_not_parsed.
      let sign = await sdk.sign({
        body: {
          file: { url, name: certificate.name },
          signers,
          message: message || MESSAGE,
          placement,
          ...(j.webhookUrl ? { webhook: { url: j.webhookUrl } } : {}),
        },
      });
      j.signRunId = sign.id;
      log(id, `sign run ${sign.id}: ${sign.status} — signing ${placement === "tags" ? "on the certificate's lines" : "on an appended page"}, ${signers.length === 1 ? "the invitation is" : "invitations are"} on the way`);

      let told = "";
      while (!FINISHED.includes(sign.status)) {
        j.envelope = await envelope(sign.id);
        const where = summarise(j)?.headline;
        if (where && where !== told) log(id, (told = where));
        await sleep(5_000);
        sign = (await sdk.runs.getRun({ id: sign.id })) as SignRun;
      }
      log(id, `sign run: ${sign.status}`);
      j.envelope = await envelope(sign.id);

      if (sign.status === "processed" && sign.output?.file) {
        const signed = await settleFile(id, sign.output.file.id, "signed certificate");
        j.signed = { name: signed.name, url: signed.urls?.content };
      }
      j.stage = "done";
    } catch (e) {
      // The certificate is untouched, so this is sendable again.
      failed(id, e, "filled");
    }
  })();
}

serve(PORT, API_BASE, {
  onInspect: startInspect,
  onConfigure: startConfigure,
  onSign: startSign,
  onEdit: startEdit,
  getJob: (id) => JOBS.get(id),

  /** Send one signer's invitation email again. */
  resend: async (id, signerId) => {
    const runId = JOBS.get(id)?.signRunId;
    if (!runId) throw new Error("there is no envelope yet");
    await sdk.runs.resendRunSigner({ id: runId, signerId });
    log(id, "invitation sent again");
    job(id).envelope = await envelope(runId);
  },

  /** Close the envelope early. Signatures already collected stay on the record. */
  void: async (id) => {
    const runId = JOBS.get(id)?.signRunId;
    if (!runId) throw new Error("there is no envelope yet");
    await sdk.runs.voidRunEnvelope({ id: runId });
    log(id, "envelope cancelled");
    job(id).envelope = await envelope(runId);
  },

  /** A verified webhook delivery, when the run was given a callback URL. */
  onEvent: (id, event) => {
    job(id).events.push(event);
    console.log(`[${id}] webhook: ${event}`);
  },
});
