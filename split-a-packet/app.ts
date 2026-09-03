/**
 * Split a packet — one scanned PDF holding several documents becomes one file
 * per document, each labelled and extracted. Three calls, no server:
 *
 *     bun app.ts ./packet.pdf
 *
 * 1. `sdk.classify()` in page mode labels every page and marks where each
 *    document starts. This is the only call that runs a model.
 * 2. `sdk.split()` takes that run id and cuts the PDF along the derived
 *    segments. No model: each child is a real file with its own id.
 * 3. `sdk.extract()` runs once per child, with prose hints picked by class.
 */

import { CloudRakerClient } from "@cloudraker/api";
import { basename } from "node:path";

const API_BASE = "https://api.cloudraker.com";
// Bun loads .env automatically — put RAKERONE_API_KEY=sk_... next to app.ts.
const API_KEY = process.env.RAKERONE_API_KEY ?? (() => { throw new Error("RAKERONE_API_KEY not set — put RAKERONE_API_KEY=sk_... in .env next to app.ts"); })();
/** Seconds to hold each call open. Maximum 120. */
const WAIT = 120;

/**
 * Descriptions are the accuracy lever: there is no training data. The `id` is
 * your branch key and comes back untouched. `other` is the required catch-all;
 * leave it out and the platform injects one.
 */
const CLASSES = [
  { id: "invoice", description: "A bill from a supplier listing line items, quantities and a total amount due." },
  { id: "contract", description: "A signed agreement with numbered clauses and signature blocks." },
  { id: "id_document", description: "A passport, driver licence or national identity card." },
  { id: "other", description: "Anything that does not match another class." },
];

/** What to pull out of each child, by the class it was given. */
const HINTS: Record<string, string> = {
  invoice: "Supplier name, invoice number, invoice date, currency and total amount due.",
  contract: "The parties, effective date, term, governing law and who signed.",
  id_document: "Document type, full name, date of birth, document number and expiry date.",
};

const path = process.argv[2];
if (!path) throw new Error("usage: bun app.ts <packet.pdf>");

const sdk = new CloudRakerClient({ token: API_KEY, baseUrl: API_BASE, timeoutInSeconds: WAIT + 30 });

// Upload: reserve the record, PUT the bytes with the exact mimeType you declared.
const bytes = await Bun.file(path).arrayBuffer();
const file = await sdk.files.createFile({ name: basename(path), mimeType: "application/pdf" });
const put = await fetch(file.uploadUrl!, { method: "PUT", body: bytes, headers: { "content-type": "application/pdf" } });
if (!put.ok) throw new Error(`upload failed: ${put.status} ${await put.text()}`);
console.log(`uploaded ${file.id}`);

// 1. Classify every page. `segments[]` is derived in code from `documentStart`.
const classified = await sdk.classify({ wait: WAIT, body: { file: { id: file.id }, classes: CLASSES, granularity: "page" } });
if (classified.status !== "processed") throw new Error(`classify ${classified.status}: ${classified.error?.message ?? "still running — poll " + classified.statusUrl}`);
for (const s of classified.output?.segments ?? []) {
  console.log(`pages ${s.startPage}-${s.endPage}: ${s.classId} (confidence ${s.confidence ?? "?"}/5)`);
}

// 2. Cut along those segments. Children inherit the parent's space and TTL.
const split = await sdk.split({ wait: WAIT, body: { file: { id: file.id }, classifyRunId: classified.id } });
if (split.status !== "processed") throw new Error(`split ${split.status}: ${split.error?.message ?? "still running — poll " + split.statusUrl}`);

// 3. Extract per child. Skip the catch-all: nothing to pull from "other".
for (const child of split.output?.splits ?? []) {
  const hints = child.classId && HINTS[child.classId];
  if (!hints || !child.fileId) continue;
  const run = await sdk.extract({ wait: WAIT, body: { file: { id: child.fileId }, hints, citations: true } });
  console.log(`\n${child.fileName ?? child.fileId} [${child.classId}] → ${run.status}`);
  if (run.status === "processed") console.log(JSON.stringify(run.output?.value, null, 2));
}
