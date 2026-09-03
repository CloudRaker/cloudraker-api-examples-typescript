/**
 * HTTP scaffolding: serves the upload page, receives uploads, verifies signed
 * webhooks, and exposes per-job state as JSON for the polling UI. The extraction
 * logic lives in app.ts and is injected here as three callbacks.
 */

import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { renderPage } from "./page.ts";

/** A webhook delivery body. `processingId` is the run id. */
export type WebhookEvent = {
  eventId: string;
  processingId: string;
  type: string;
  occurredAt: string;
  data?: Record<string, unknown>;
};

export type Upload = { name: string; mimeType: string; data: Uint8Array<ArrayBuffer> };

export interface Callbacks {
  /** `webhook` is true when the page was opened at a hostname the platform can reach. */
  onRun: (uploads: Upload[], mode: string, callbackUrl: string, hints: string, instructions: string, citations: boolean, webhook: boolean, action: string) => Promise<string>;
  /** Signature verified, duplicates already dropped. */
  onEvent: (event: WebhookEvent) => void;
  getState: (jobId: string) => unknown | undefined;
}

const EXT_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp4: "video/mp4",
};

const ACCEPTED = new Set(Object.values(EXT_MIME));

/** What was sent, kept in memory so the review step can play it back. */
const SOURCES = new Map<string, Upload[]>();

/** Browsers often report no type for .docx/.xlsx, so fall back to the extension. */
const mimeFor = (name: string, declared: string): string =>
  declared && declared !== "application/octet-stream"
    ? declared
    : (EXT_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream");

/** The platform can call a public hostname back but not localhost. */
function origin(req: Request, port: number) {
  const host = req.headers.get("host") ?? `localhost:${port}`;
  const local = host.startsWith("localhost") || host.startsWith("127.");
  return { host, local, proto: local ? "http" : "https" };
}

/**
 * `x-rk1-signature` is a compact ES256 JWT. Verify it against the public JWKS,
 * then check its `bodySha256` claim against the bytes received so the signature
 * is bound to this exact body. Route on the claims — only those are signed.
 *
 * The two surfaces publish separate key sets — `/v1/webhooks/jwks.json` for the
 * capability verbs, `/process/jwks.json` for the pipeline — so a delivery is
 * tried against both rather than guessing which sent it.
 */
async function verifyWebhook(
  keys: ReturnType<typeof createRemoteJWKSet>[],
  sig: string,
  body: Uint8Array,
) {
  let last: unknown;
  for (const jwks of keys) {
    try {
      const { payload } = await jwtVerify(sig, jwks, { algorithms: ["ES256"] });
      const digest = createHash("sha256").update(body).digest("base64url");
      if (payload.bodySha256 !== digest) throw new Error("bodySha256 mismatch");
      return payload as { processingId: string; eventId: string; type: string };
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new Error("no key set accepted the signature");
}

export function serve(port: number, apiBase: string, hasAction: boolean, { onRun, onEvent, getState }: Callbacks) {
  const keys = [
    createRemoteJWKSet(new URL(`${apiBase}/v1/webhooks/jwks.json`)),
    createRemoteJWKSet(new URL(`${apiBase}/process/jwks.json`)),
  ];
  const seenEvents = new Set<string>();

  Bun.serve({
    port,
    maxRequestBodySize: 512 * 1024 * 1024,
    routes: {
      // Rendered per request so the page can say how the result will arrive.
      "/": (req) => {
        const { host, local } = origin(req, port);
        return new Response(renderPage(Object.keys(EXT_MIME), local, host, hasAction), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },

      "/result/:id": (req) => {
        const state = getState(req.params.id);
        // State lives in this process, so a restart loses the handle to a live run.
        if (state === undefined) {
          return Response.json(
            {
              error:
                `No job ${req.params.id} here. This example keeps state in memory, so restarting ` +
                `it loses in-flight jobs — the run itself is unaffected. In webhook delivery the ` +
                `job id IS the run id, so fetch it with ` +
                `sdk.runs.getRun({ id: "${req.params.id}" }).`,
            },
            { status: 404 },
          );
        }
        const sources = (SOURCES.get(req.params.id) ?? []).map((u, i) => ({
          name: u.name,
          mimeType: u.mimeType,
          url: `/source/${req.params.id}/${i}`,
        }));
        return Response.json(
          state && typeof state === "object" ? { ...state, sources } : state,
        );
      },

      "/source/:id/:index": (req) => {
        const src = SOURCES.get(req.params.id)?.[Number(req.params.index)];
        if (!src) return new Response("not found", { status: 404 });
        const headers: Record<string, string> = {
          "content-type": src.mimeType,
          "accept-ranges": "bytes",
          "content-disposition": `inline; filename="${src.name.replace(/"/g, "")}"`,
        };
        // Browsers will not seek, and Safari will not play, without a 206.
        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
        if (!range) return new Response(src.data, { headers });
        const total = src.data.byteLength;
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
        return new Response(src.data.subarray(start, end + 1), {
          status: 206,
          headers: { ...headers, "content-range": `bytes ${start}-${end}/${total}` },
        });
      },

      "/upload": {
        POST: async (req) => {
          const form = await req.formData();
          const str = (k: string, fallback = "") => {
            const v = form.get(k);
            return typeof v === "string" ? v : fallback;
          };
          const mode = str("mode", "schema") || "schema";
          const hints = str("hints");
          const instructions = str("instructions");
          const citations = str("citations") === "true";
          const action = str("action");
          const uploads: Upload[] = await Promise.all(
            form.getAll("files").filter((v): v is File => v instanceof File).map(async (file) => ({
              name: file.name,
              mimeType: mimeFor(file.name, file.type),
              data: new Uint8Array(await file.arrayBuffer()),
            })),
          );
          if (uploads.length === 0) return new Response("no files", { status: 400 });
          // The accept attribute is only a file-picker filter, so check here too.
          const rejected = uploads.filter((u) => !ACCEPTED.has(u.mimeType));
          if (rejected.length > 0) {
            const names = rejected.map((u) => `${u.name} (${u.mimeType})`).join(", ");
            return new Response(
              `unsupported file type: ${names}. Accepted: ${Object.keys(EXT_MIME).join(", ")}`,
              { status: 400 },
            );
          }
          const { host, local, proto } = origin(req, port);
          // The installed-action pipeline reports only by webhook, so it cannot
          // work against a hostname the platform can't reach.
          if (mode === "process" && local) {
            return new Response(
              `the installed-action mode reports by webhook, and this page was opened at ${host}, ` +
                `which the platform cannot reach. Start a tunnel and open the page there:\n` +
                `  cloudflared tunnel --url http://localhost:${port}`,
              { status: 400 },
            );
          }
          try {
            const jobId = await onRun(
              uploads,
              mode,
              `${proto}://${host}/webhook`,
              hints,
              instructions,
              citations,
              // Only a public hostname can receive a delivery; localhost polls.
              !local,
              action,
            );
            // After onRun: a webhook run is keyed by its run id.
            SOURCES.set(jobId, uploads);
            return Response.json({ jobId }, { status: 201 });
          } catch (e) {
            return new Response(String(e), { status: 500 });
          }
        },
      },

      "/webhook": {
        POST: async (req) => {
          const body = new Uint8Array(await req.arrayBuffer());
          let claims: { processingId: string; eventId: string; type: string };
          try {
            claims = await verifyWebhook(keys, req.headers.get("x-rk1-signature") ?? "", body);
          } catch (e) {
            console.log("webhook rejected:", e);
            return new Response("bad signature", { status: 401 });
          }
          const parsed = JSON.parse(new TextDecoder().decode(body)) as Partial<WebhookEvent>;
          // Delivery is at-least-once, so dedupe on eventId.
          if (!seenEvents.has(claims.eventId)) {
            seenEvents.add(claims.eventId);
            console.log("webhook:", claims.type, claims.processingId);
            onEvent({
              eventId: claims.eventId,
              processingId: claims.processingId,
              type: claims.type,
              occurredAt: parsed.occurredAt ?? new Date().toISOString(),
              data: parsed.data,
            });
          }
          // Always 200, including for duplicates: anything else triggers a retry.
          return new Response("ok");
        },
      },
    },
    fetch: () => new Response("not found", { status: 404 }),
  });

  console.log(`serving on http://localhost:${port}`);
  console.log(`to have results delivered instead of polled, open this page through a tunnel:`);
  console.log(`  cloudflared tunnel --url http://localhost:${port}`);
}
