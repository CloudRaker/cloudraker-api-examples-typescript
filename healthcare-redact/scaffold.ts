/**
 * HTTP scaffolding: serves the page, receives one upload, verifies signed
 * webhooks, and exposes per-job state as JSON for the polling UI. The redaction
 * logic lives in app.ts and is injected here as callbacks.
 */

import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { renderPage } from "./page.ts";

export type WebhookEvent = { eventId: string; processingId: string; type: string };

export type Options = {
  /** True for audio, which takes `style` where documents take `mode`. */
  audio: boolean;
  /** `targeted` | `lines` for documents, `beep` | `silence` for audio. */
  choice: string;
  /** Slug or id of an installed action to run instead of the settings below. */
  action: string;
  categories: string[];
  instructions: string;
  /** True when the page was opened at a hostname the platform can reach. */
  webhook: boolean;
  callbackUrl: string;
};

export interface Callbacks {
  onRun: (name: string, mimeType: string, data: Uint8Array<ArrayBuffer>, opts: Options) => Promise<string>;
  /** The signed url for one side of a job's before/after pair, if it has one yet. */
  getPreview: (jobId: string, side: "before" | "after") => { url: string; name: string } | undefined;
  /** Signature verified, duplicates already dropped. */
  onEvent: (event: WebhookEvent) => void;
  getState: (jobId: string) => unknown | undefined;
}

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
};

const isAudio = (mimeType: string) => mimeType.startsWith("audio/");

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
 */
async function verifyWebhook(jwks: ReturnType<typeof createRemoteJWKSet>, sig: string, body: Uint8Array) {
  const { payload } = await jwtVerify(sig, jwks, { algorithms: ["ES256"] });
  const digest = createHash("sha256").update(body).digest("base64url");
  if (payload.bodySha256 !== digest) throw new Error("bodySha256 mismatch");
  return payload as unknown as WebhookEvent;
}

export function serve(port: number, apiBase: string, { onRun, onEvent, getState, getPreview }: Callbacks) {
  const jwks = createRemoteJWKSet(new URL(`${apiBase}/v1/webhooks/jwks.json`));
  const seen = new Set<string>();

  Bun.serve({
    port,
    maxRequestBodySize: 512 * 1024 * 1024,
    routes: {
      // Rendered per request so the page can say how the result will arrive.
      "/": (req) => {
        const { host, local } = origin(req, port);
        return new Response(renderPage(Object.keys(EXT_MIME), local, host), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },

      // Streams a file from our own origin. Browsers are inconsistent about
      // rendering a cross-origin PDF inline, and this keeps the signed url out of
      // the page as well.
      "/preview/:id/:side": async (req) => {
        const side = req.params.side === "after" ? "after" : "before";
        const found = getPreview(req.params.id, side);
        if (!found?.url) return new Response("not found", { status: 404 });
        const upstream = await fetch(found.url);
        if (!upstream.ok) return new Response("upstream error", { status: 502 });
        return new Response(upstream.body, {
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
            "content-disposition": `inline; filename="${found.name.replace(/"/g, "")}"`,
            "cache-control": "private, max-age=300",
          },
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
        return Response.json(state);
      },

      "/upload": {
        POST: async (req) => {
          const q = new URL(req.url).searchParams;
          const name = q.get("name") ?? "upload";
          const ext = name.split(".").pop()?.toLowerCase() ?? "";
          const mimeType = EXT_MIME[ext];
          if (!mimeType) {
            return new Response(
              `unsupported file type: ${name}. Accepted: ${Object.keys(EXT_MIME).join(", ")}`,
              { status: 400 },
            );
          }
          const audio = isAudio(mimeType);
          const action = q.get("action") ?? "";
          const choice = q.get("choice") ?? (audio ? "beep" : "targeted");
          // Guard the pairing here too: the API 400s on the other medium's parameter.
          // An action carries its own, so there is nothing to pair.
          const allowed = audio ? ["beep", "silence"] : ["targeted", "lines"];
          if (!action && !allowed.includes(choice)) {
            return new Response(`${choice} is not valid for this file type`, { status: 400 });
          }
          const data = new Uint8Array(await req.arrayBuffer());
          if (data.byteLength === 0) return new Response("empty file", { status: 400 });
          const { host, local, proto } = origin(req, port);
          try {
            const jobId = await onRun(name, mimeType, data, {
              audio,
              choice,
              action,
              categories: (q.get("categories") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
              instructions: q.get("instructions") ?? "",
              webhook: !local,
              callbackUrl: `${proto}://${host}/webhook`,
            });
            return Response.json({ jobId }, { status: 201 });
          } catch (e) {
            return new Response(String(e), { status: 500 });
          }
        },
      },

      "/webhook": {
        POST: async (req) => {
          const body = new Uint8Array(await req.arrayBuffer());
          let claims: WebhookEvent;
          try {
            claims = await verifyWebhook(jwks, req.headers.get("x-rk1-signature") ?? "", body);
          } catch (e) {
            console.log("webhook rejected:", e);
            return new Response("bad signature", { status: 401 });
          }
          // Delivery is at-least-once, so dedupe on eventId.
          if (!seen.has(claims.eventId)) {
            seen.add(claims.eventId);
            onEvent(claims);
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
