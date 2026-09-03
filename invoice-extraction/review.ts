/**
 * A finished run turned into fields, sources and checks. The only invoice-specific
 * file: page.ts renders whatever this returns.
 */

import SCHEMA from "./schema.json";

export type Cite = { page: number | null; text: string; confidence: number | null };
export type Field = { key: string; label: string; value: unknown; cites: Cite[] };
export type Check = { ok: boolean | null; label: string; detail?: string };
export type Review = { title: string | null; fields: Field[]; checks: Check[] };

/** "po_number" -> "PO number" */
function label(key: string): string {
  const words = key.split("_").map((w) => (w === "po" ? "PO" : w));
  const s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const num = (v: unknown): number | null => (typeof v === "number" && !Number.isNaN(v) ? v : null);
const day = (v: unknown): number | null => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : t;
};
const money = (n: number) => n.toFixed(2);

type Row = { amount?: number | null } | null;
const sum = (rows: unknown): number =>
  (Array.isArray(rows) ? (rows as Row[]) : []).reduce((n, r) => n + (r?.amount ?? 0), 0);

/**
 * Does the invoice agree with itself? Its own totals have to match its parts, so
 * a misread digit usually shows up here rather than in production. A cent of
 * tolerance covers float noise and rounding printed on the document.
 */
function checks(v: Record<string, unknown>): Check[] {
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;
  const lines = sum(v.line_items);
  const taxes = sum(v.taxes);
  const charges = sum(v.additional_charges);
  const subtotal = num(v.subtotal);
  const total = num(v.total);
  const issued = day(v.invoice_date);
  const due = day(v.due_date);

  const base = subtotal ?? lines;
  const computed = base + taxes + charges;
  const missing = (SCHEMA.required ?? []).filter((k) => v[k] === null || v[k] === undefined);
  const itemised = Array.isArray(v.line_items) && v.line_items.length > 0;

  // The wording follows the outcome, so a ✗ never reads as a claim that held.
  const say = (
    ok: boolean | null,
    pass: [string, string?],
    fail: [string, string?],
    absent: string,
  ): Check => {
    if (ok === null) return { ok, label: absent };
    const [text, detail] = ok ? pass : fail;
    return detail ? { ok, label: text, detail } : { ok, label: text };
  };

  const linesVsSubtotal = subtotal === null || !itemised ? null : near(lines, subtotal);
  const partsVsTotal = total === null ? null : near(computed, total);
  const dueAfterIssue = issued === null || due === null ? null : due >= issued;

  return [
    say(
      missing.length === 0,
      ["every required field came back"],
      [`no value for ${missing.map(label).join(", ").toLowerCase()}`],
      "",
    ),
    say(
      linesVsSubtotal,
      ["the line items add up to the subtotal", `${money(lines)} = ${money(subtotal ?? 0)}`],
      [
        "the line items do not add up to the subtotal",
        `${money(lines)} vs ${money(subtotal ?? 0)}`,
      ],
      itemised ? "no subtotal stated — line items not checked" : "no line items to add up",
    ),
    say(
      partsVsTotal,
      [
        "subtotal, taxes and charges make the total",
        `${money(base)} + ${money(taxes)} + ${money(charges)} = ${money(computed)}`,
      ],
      [
        "subtotal, taxes and charges do not make the total",
        `${money(base)} + ${money(taxes)} + ${money(charges)} = ${money(computed)}, stated ${money(total ?? 0)}`,
      ],
      "no total stated — nothing to reconcile",
    ),
    say(
      dueAfterIssue,
      ["the due date is not before the invoice date", `${String(v.invoice_date)} to ${String(v.due_date)}`],
      ["the due date falls before the invoice date", `${String(v.invoice_date)} to ${String(v.due_date)}`],
      "invoice or due date absent — not compared",
    ),
    say(
      total === null ? null : !!v.currency,
      ["the currency is identified", String(v.currency)],
      ["amounts are stated but the currency is not"],
      "no amounts — currency not needed",
    ),
  ];
}

/**
 * Every citation for a field. `confidence` is how sure each match is, 1 to 5.
 *
 * A field can carry more than one: a value taken from two places on the page —
 * terms printed on separate lines, a figure and the label beside it — is cited
 * at each, and a list field is cited per element. Showing only the first would
 * point a reader at part of the evidence.
 *
 * A row result keys its citations by path — `[0].Company` — so a row is looked up
 * under its own index first, then the bare key for a single-record run.
 */
function citesFor(citations: unknown, key: string, prefix = ""): Cite[] {
  const map = citations as Record<string, unknown> | undefined;
  const list = (prefix ? map?.[`${prefix}${key}`] : undefined) ?? map?.[key];
  if (!Array.isArray(list)) return [];
  return list.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const c = row as { page?: unknown; text?: unknown; confidence?: unknown; notFound?: unknown };
    if (c.notFound) return [];
    return [{
      page: typeof c.page === "number" ? c.page : null,
      text: String(c.text ?? ""),
      confidence: typeof c.confidence === "number" ? c.confidence : null,
    }];
  });
}

/**
 * Whether this record is really the shape in schema.json. An inferred shape can
 * still borrow a name or two — `invoice_date` is an obvious one — so a single
 * match proves nothing; most of the keys have to be ours. The checks below read
 * our names, and running them on someone else's shape reports fields as missing
 * that the invoice states perfectly well under another name.
 */
function usesOurFields(value: Record<string, unknown>): boolean {
  const known = Object.keys(SCHEMA.properties);
  const keys = Object.keys(value);
  const mine = keys.filter((k) => known.includes(k)).length;
  return mine > 0 && mine >= keys.length / 2;
}

const NOT_OUR_SCHEMA: Check = {
  ok: null,
  label: "no checks — these read the fields in schema.json, and this run used a different shape",
};

/** Fields in schema order, then any the schema doesn't mention. */
function fieldsOf(value: Record<string, unknown>, citations: unknown, prefix = ""): Field[] {
  const known = Object.keys(SCHEMA.properties);
  const extra = Object.keys(value).filter((k) => !known.includes(k));
  // Every schema field is listed even when the response omits it, so an absent one
  // reads as "not stated" instead of vanishing. Another shape is listed as it came
  // back — it may borrow one of our names, and dropping it would hide a field.
  const keys = usesOurFields(value) ? [...known, ...extra] : Object.keys(value);
  return keys.map((key) => ({
    key,
    label: label(key),
    value: value[key] ?? null,
    cites: citesFor(citations, key, prefix),
  }));
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** One review per invoice. Several files come back in `output.documents[]`. */
export function review(run: unknown): Review[] {
  const output = (run as { output?: unknown })?.output;
  if (!isRecord(output)) return [];
  const one = (
    value: Record<string, unknown>,
    citations: unknown,
    title: string | null,
    prefix = "",
  ): Review => ({
    title,
    fields: fieldsOf(value, citations, prefix),
    checks: usesOurFields(value) ? checks(value) : [NOT_OUR_SCHEMA],
  });

  /**
   * `per_document` gives one record per file; `rows_per_document` gives a list of
   * them, which is what a saved action configured for line items returns. Each row
   * is reviewed on its own.
   */
  const build = (value: unknown, citations: unknown, title: string | null): Review[] => {
    if (Array.isArray(value)) {
      const rows = value.filter(isRecord);
      return rows.map((row, i) =>
        one(row, citations, rows.length > 1 ? `${title ?? "Record"} ${i + 1}` : title, `[${i}].`),
      );
    }
    return isRecord(value) ? [one(value, citations, title)] : [];
  };

  const docs = (Array.isArray(output.documents) ? output.documents : []).filter(isRecord);
  if (docs.length > 1) {
    return docs.flatMap((d) =>
      build(d.value, d.citations, String(d.name ?? d.fileId ?? "invoice")),
    );
  }
  return build(output.value ?? docs[0]?.value, output.citations ?? docs[0]?.citations, null);
}
