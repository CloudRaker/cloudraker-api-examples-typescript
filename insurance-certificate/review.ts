/**
 * Two summaries for the page: what `fill` wrote into the form, and where the
 * envelope stands once it has been sent.
 *
 * The envelope half comes from GET /v1/runs/{id}/envelope, the sender's view, so
 * it never carries a signing link — those go only to the signer's own inbox.
 */

import type { CloudRaker } from "@cloudraker/api";
import type { Job } from "./scaffold.ts";

export type Review = {
  /** One line saying where things stand. */
  headline: string;
  /**
   * Whether cancelling is still possible. `void` answers 409 once an envelope
   * is finalizing or done, so the page must not offer a button that cannot
   * work — a signed document cannot be un-signed.
   */
  cancellable: boolean;
  facts: Array<{ label: string; value: string }>;
  signers: Array<{
    id: string;
    name: string;
    email: string;
    /** 1 signs first, 2 second, and so on. */
    position: number;
    signed: boolean;
    detail: string;
  }>;
  /** The audit trail, oldest first. */
  trail: Array<{ when: string; what: string; who: string; where: string }>;
};

const when = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString() : "—";

const bytes = (n: number): string =>
  n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

function headline(envelope: CloudRaker.RunSignEnvelopeView): string {
  const { signers } = envelope;
  const signed = signers.filter((s) => s.status === "signed").length;
  switch (envelope.envelope.status) {
    case "completed":
      return `Signed by everyone (${signed} of ${signers.length}).`;
    case "voided":
      return "Cancelled before everyone had signed.";
    case "failed":
      return `Something went wrong: ${envelope.envelope.error ?? "no reason given"}.`;
    case "finalizing":
      return "Everyone has signed — sealing the document.";
    default: {
      const next = signers.find((s) => s.status !== "signed");
      return next
        ? `${signed} of ${signers.length} signed. Waiting on ${next.name}.`
        : `${signed} of ${signers.length} signed.`;
    }
  }
}

/** What one signer is up to, in words. */
function detail(signer: CloudRaker.RunSignEnvelopeView["signers"][number]): string {
  if (signer.status === "signed") {
    const typed = signer.typedName ? `typed "${signer.typedName}"` : "signed";
    return `${typed} on ${when(signer.signedAt)}`;
  }
  if (signer.emailVerifiedAt) return `opened the email on ${when(signer.emailVerifiedAt)}, not signed yet`;
  return `invited on ${when(signer.lastInvitedAt)}, hasn't opened it yet`;
}


/**
 * What `fill` wrote, ready to read beside the PDF. A fill run reports
 * `output.fields` — every field it filled and the value it put there — so the
 * result can be checked as data rather than by eye.
 *
 * Grouped and titled from the template's own field list where there is one —
 * the labels approved in step 2. That matters most for a detected form, whose
 * every field is named `textbox_0_7`: grouping those on the name would put all
 * of them under one heading called "Textbox", and label each row with a number
 * that says nothing about what it holds.
 *
 * Without a field list, the name is all there is, so fall back to the part
 * before the first underscore — how a hand-made form tends to name its boxes
 * (`row1_policy_number`, `remark_7`). Order within a group follows any trailing
 * number, so line 2 comes after line 1 rather than after line 19.
 */
export type FillReview = {
  /** How many values were written. */
  count: number;
  groups: Array<{ title: string; rows: Array<{ field: string; label: string; value: string }> }>;
};

const NUMBERED = /^(.*?)(\d+)$/;

/** "row1_policy_number" → "row1"; "insured" → "insured". */
const prefixOf = (field: string): string => field.split("_")[0] ?? field;

/** "row1" → "Row 1"; "schedule" → "Schedule". */
const titleOf = (prefix: string): string => {
  const spaced = prefix.replace(/(\d+)$/, " $1");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** Sort so number 2 lands after number 1, not after number 19. */
function byName(a: string, b: string): number {
  const [, aStem = a, aNum] = NUMBERED.exec(a) ?? [];
  const [, bStem = b, bNum] = NUMBERED.exec(b) ?? [];
  if (aStem === bStem && aNum && bNum) return Number(aNum) - Number(bNum);
  return a.localeCompare(b);
}

export function summariseFill(job: Job): FillReview | null {
  const filled = job.filled;
  if (!filled) return null;
  const names = Object.keys(filled).sort(byName);

  // What step 2 approved: name → what the box is, and which part of the form it
  // belongs to. A section is the better heading when the template offers one.
  const known = new Map((job.template?.fields ?? []).map((f) => [f.name, f]));
  const headingFor = (field: string): string => {
    const entry = known.get(field);
    if (entry?.section) return entry.section;
    if (entry?.label) return entry.label;
    return "";
  };
  const labelFor = (field: string): string => known.get(field)?.label ?? field;

  const titled = names.every((field) => headingFor(field) !== "");
  if (titled) {
    const groups = new Map<string, Array<{ field: string; label: string; value: string }>>();
    for (const field of names) {
      const rows = groups.get(headingFor(field)) ?? [];
      rows.push({ field, label: labelFor(field), value: filled[field] ?? "" });
      groups.set(headingFor(field), rows);
    }
    return { count: names.length, groups: [...groups].map(([title, rows]) => ({ title, rows })) };
  }

  // A prefix earns a group of its own once more than one field shares it.
  // Everything else is a box on its own, and reads better collected together.
  const shared = new Set<string>();
  const counts = new Map<string, number>();
  for (const field of names) {
    const prefix = prefixOf(field);
    const seen = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, seen);
    if (seen > 1) shared.add(prefix);
  }

  const groups = new Map<string, Array<{ field: string; label: string; value: string }>>();
  for (const field of names) {
    const key = shared.has(prefixOf(field)) ? titleOf(prefixOf(field)) : "Single boxes";
    const rows = groups.get(key) ?? [];
    rows.push({ field, label: labelFor(field), value: filled[field] ?? "" });
    groups.set(key, rows);
  }

  return {
    count: names.length,
    groups: [...groups].map(([title, rows]) => ({ title, rows })),
  };
}

export function summarise(job: Job): Review | null {
  const view = job.envelope;
  if (!view) return null;
  const { envelope, signers, events } = view;

  return {
    headline: headline(view),
    cancellable: envelope.status === "pending",
    facts: [
      { label: "Envelope", value: envelope.status },
      { label: "Document", value: `${envelope.docName} (${bytes(envelope.docSize)})` },
      // The checksum of the exact bytes everyone signed — the thing to keep if
      // you ever need to show the document hasn't changed since.
      { label: "SHA-256", value: envelope.docSha256 },
      { label: "Opened", value: when(envelope.createdAt) },
      { label: "Completed", value: when(envelope.completedAt) },
      { label: "Expires", value: when(envelope.expiresAt) },
    ],
    signers: signers.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      position: s.position,
      signed: s.status === "signed",
      detail: detail(s),
    })),
    trail: events.map((e) => ({
      when: when(e.occurredAt),
      what: e.type,
      who: e.actor,
      where: e.ip ?? "—",
    })),
  };
}
