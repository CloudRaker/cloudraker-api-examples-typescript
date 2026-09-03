/**
 * HTTP scaffolding: serves the page, receives the documents, verifies signed
 * webhooks, and exposes per-job state as JSON for the polling page. The API
 * calls live in app.ts and are injected here as callbacks.
 */

import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { CloudRaker } from "@cloudraker/api";

import { renderPage } from "./page.ts";
import { summarise, summariseFill } from "./review.ts";

export type Signer = { name: string; email: string };

export type Upload = { name: string; bytes: Uint8Array<ArrayBuffer> };

export type FillOptions = {
  output: "flattened" | "editable";
  /** Where the platform should post this job's events, when it can reach us. */
  webhookUrl?: string;
};


/**
 * One box the template offers, as `inspect` reports it and a fill config stores
 * it. Passed back whole: `box` and `page` are what place a value, and a config
 * without them is a 400.
 */
export type TemplateField = {
  name: string;
  type?: string;
  label?: string;
  description?: string;
  section?: string;
  required?: boolean;
  options?: string[];
  page?: number;
  box?: { x: number; y: number; width: number; height: number };
  ignore?: boolean;
};

export type Job = {
  /**
   * inspecting → inspected (waiting for the field list to be approved) →
   * filling → filled (waiting for a nod) → signing → done.
   */
  stage: "inspecting" | "inspected" | "filling" | "filled" | "signing" | "done";
  log: string[];
  /** Webhook deliveries, oldest first. Empty when the page is polling only. */
  events: string[];
  /** Kept from the fill request so the sign request needs no repeat. */
  webhookUrl?: string;
  /**
   * The BLANK template, kept so edited values can be written into a fresh copy.
   * `values` mode fills a template, not an already-filled document.
   */
  templateFileId?: string;
  /** The `output` the caller chose, so a re-fill after editing keeps it. */
  output?: "flattened" | "editable";
  /** What the page typed, kept from step 1 so the config carries it. */
  /** The policy, kept so the fill can start once the field list is approved. */
  policyFileId?: string;
  /** What the template offers, from `inspect`, before anything is filled. */
  template?: {
    fields: TemplateField[];
    /** True when the boxes were found by the detector rather than declared. */
    detected: boolean;
    /** sha256 of the prepared bytes: what tells a saved config it is stale. */
    hash?: string;
    pageCount?: number;
  };
  /** The blank template's own link, so step 2 can show it beside the fields. */
  templateUrl?: string;
  /** The saved fill config the run went through, once there is one. */
  configId?: string;
  error?: string;
  fillRunId?: string;
  signRunId?: string;
  certificate?: { name: string; url?: string };
  /** What `fill` wrote, field name to value, straight off the run. */
  filled?: Record<string, string>;
  signed?: { name: string; url?: string };
  envelope?: CloudRaker.RunSignEnvelopeView;
};

/** A signer array is capped at 50 by the API. */
export const MAX_SIGNERS = 50;

export interface Callbacks {
  /**
   * Step 1: register both documents and ask the template what boxes it has.
   * Nothing is drafted yet — the field list is what the next step approves.
   */
  onInspect: (id: string, policy: Upload, template: Upload, options: FillOptions) => void;
  /**
   * Step 2: save the approved field list as a fill config, then draft through it.
   * The labels are what the drafting pass reads, so this is the step that decides
   * whether values land in the right boxes.
   */
  onConfigure: (id: string, fields: TemplateField[]) => void;
  onSign: (id: string, signers: Signer[], placement: "page" | "tags", message: string) => void;
  /** Re-fill the blank template from corrected values — deterministic, no drafting. */
  onEdit: (id: string, values: Record<string, string>) => void;
  getJob: (id: string) => Job | undefined;
  resend: (id: string, signerId: string) => Promise<void>;
  void: (id: string) => Promise<void>;
  /** Signature verified, duplicates already dropped. */
  onEvent: (id: string, event: string) => void;
}

/** Both documents are the caller's to choose, so both have to be there. */
async function required(form: FormData, field: "policy" | "template"): Promise<Upload | null> {
  const chosen = form.get(field);
  if (!(chosen instanceof File) || chosen.size === 0) return null;
  return { name: chosen.name, bytes: new Uint8Array(await chosen.arrayBuffer()) };
}

/** The platform can call a public hostname back but not localhost. */
function origin(req: Request, port: number) {
  const host = req.headers.get("host") ?? `localhost:${port}`;
  const local = host.startsWith("localhost") || host.startsWith("127.");
  return { host, local, proto: local ? "http" : "https" };
}

const fail = (message: string, status = 400) => new Response(message, { status });

/** A POST with no multipart body throws rather than yielding an empty form. */
const formOf = async (req: Request): Promise<FormData | null> =>
  req.formData().catch(() => null);

/**
 * `x-rk1-signature` is a compact ES256 JWT. Verify it against the published
 * JWKS, then check its `bodySha256` claim against the bytes received, so the
 * signature is bound to this exact body.
 */
async function verifyWebhook(
  jwks: ReturnType<typeof createRemoteJWKSet>,
  signature: string,
  body: Uint8Array,
): Promise<{ eventId?: string }> {
  const { payload } = await jwtVerify(signature, jwks, { algorithms: ["ES256"] });
  const digest = createHash("sha256").update(body).digest("base64url");
  if (payload.bodySha256 !== digest) throw new Error("bodySha256 does not match the body");
  return payload as { eventId?: string };
}

export function serve(port: number, apiBase: string, c: Callbacks) {
  const jwks = createRemoteJWKSet(new URL(`${apiBase}/v1/webhooks/jwks.json`));
  const seen = new Set<string>();

  Bun.serve({
    port,
    idleTimeout: 60,
    maxRequestBodySize: 128 * 1024 * 1024,
    routes: {
      // Rendered per request so the page can say how progress will arrive.
      "/": (req) => {
        const { host, local } = origin(req, port);
        return new Response(renderPage(local, host), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },

      "/inspect": {
        POST: async (req) => {
          const form = await formOf(req);
          if (!form) return fail("send the documents as multipart form data");
          const policy = await required(form, "policy");
          const template = await required(form, "template");
          if (!policy) return fail("choose a policy to read");
          if (!template) return fail("choose a blank form to fill");

          // Each job gets its own callback URL, so a delivery routes by path and
          // needs no lookup — both runs behind one job share it.
          const id = crypto.randomUUID();
          const { host, local, proto } = origin(req, port);

          c.onInspect(id, policy, template, {
            output: form.get("output") === "editable" ? "editable" : "flattened",
            // Only a public hostname can receive a delivery; localhost polls.
            webhookUrl: local ? undefined : `${proto}://${host}/webhook/${id}`,
          });
          return Response.json({ id }, { status: 201 });
        },
      },

      "/job/:id/config": {
        POST: async (req) => {
          const job = c.getJob(req.params.id);
          if (!job) return fail("no such job", 404);
          if (job.stage !== "inspected") return fail(`the template is ${job.stage}, not ready to configure`);
          const body = (await req.json().catch(() => null)) as { fields?: TemplateField[] } | null;
          if (!Array.isArray(body?.fields)) return fail("send { fields: [...] }");
          c.onConfigure(req.params.id, body.fields);
          return Response.json({ ok: true }, { status: 202 });
        },
      },

      "/job/:id/sign": {
        POST: async (req) => {
          const id = req.params.id;
          const job = c.getJob(id);
          if (!job) return fail("unknown job", 404);
          if (job.stage !== "filled") return fail(`the certificate is ${job.stage}, not ready to send`);

          const form = await formOf(req);
          if (!form) return fail("send the signers as multipart form data");
          let signers: Signer[];
          try {
            signers = JSON.parse(String(form.get("signers") ?? "[]"));
          } catch {
            return fail("signers must be JSON");
          }
          if (!Array.isArray(signers) || signers.length === 0 || signers.some((s) => !s?.name || !s?.email)) {
            return fail("every signer needs a name and an email");
          }
          // The certificate's lines are there to be used, but they can also be
          // ignored in favour of a page appended at the end — the same document
          // goes out either way.
          const placement = form.get("placement") === "page" ? "page" : "tags";
          if (signers.length > MAX_SIGNERS) {
            return fail(`${signers.length} signers — the most an envelope takes is ${MAX_SIGNERS}`);
          }
          // Nothing here counts the [Signature N] markers in the document —
          // whoever chose the form knows what is in it, and the run says so
          // plainly if a signer has no marker waiting.

          try {
            c.onSign(id, signers, placement, String(form.get("message") ?? "").trim());
          } catch (e) {
            return fail(e instanceof Error ? e.message : String(e), 500);
          }
          return new Response("sending", { status: 202 });
        },
      },

      "/job/:id": (req) => {
        const job = c.getJob(req.params.id);
        // State lives in this process, so a restart loses the handle to a live
        // envelope. The envelope itself is unaffected and keeps waiting.
        if (!job) {
          return Response.json({
            error:
              `No job ${req.params.id} here. This example keeps state in memory, so restarting ` +
              `it loses jobs in flight — the runs themselves are unaffected. Read an envelope ` +
              `directly with GET /v1/runs/{sign run id}/envelope.`,
          }, { status: 404 });
        }
        return Response.json({ ...job, fill: summariseFill(job), review: summarise(job) });
      },

      "/job/:id/values": {
        POST: async (req) => {
          const body = await req.json().catch(() => null);
          const values = (body as { values?: Record<string, string> } | null)?.values;
          if (!values || typeof values !== "object") return fail("no values");
          c.onEdit(req.params.id, values);
          return new Response("filling");
        },
      },

      "/job/:id/resend": {
        POST: async (req) => {
          const signerId = new URL(req.url).searchParams.get("signer");
          if (!signerId) return fail("which signer?");
          try {
            await c.resend(req.params.id, signerId);
            return new Response("sent");
          } catch (e) {
            return fail(e instanceof Error ? e.message : String(e), 500);
          }
        },
      },

      "/job/:id/void": {
        POST: async (req) => {
          try {
            await c.void(req.params.id);
            return new Response("cancelled");
          } catch (e) {
            return fail(e instanceof Error ? e.message : String(e), 500);
          }
        },
      },

      "/webhook/:id": {
        POST: async (req) => {
          const body = new Uint8Array(await req.arrayBuffer());
          let claims: { eventId?: string };
          try {
            claims = await verifyWebhook(jwks, req.headers.get("x-rk1-signature") ?? "", body);
          } catch (e) {
            console.log("webhook rejected:", e);
            return fail("bad signature", 401);
          }
          // Delivery is at-least-once, so drop an eventId already handled.
          if (claims.eventId) {
            if (seen.has(claims.eventId)) return new Response("ok");
            seen.add(claims.eventId);
          }

          const parsed = JSON.parse(new TextDecoder().decode(body)) as {
            type?: string;
            data?: { status?: string };
          };
          const status = parsed.data?.status ? ` (${parsed.data.status})` : "";
          c.onEvent(req.params.id, `${parsed.type ?? "event"}${status}`);
          return new Response("ok");
        },
      },
    },
    fetch: () => fail("not found", 404),
  });

  console.log(`open http://localhost:${port}`);
}
