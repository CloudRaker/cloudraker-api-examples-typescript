/**
 * A finished run turned into fields, sources and checks. The only lease-specific
 * file: page.ts renders whatever this returns.
 */

import SCHEMA from "./schema.json";

export type Cite = { page: number | null; text: string; confidence: number | null };
export type Field = { key: string; label: string; value: unknown; cites: Cite[] };
export type Check = { ok: boolean | null; label: string; detail?: string };
export type Conflict = {
  key: string;
  label: string;
  kept: unknown;
  others: { name: string; value: unknown }[];
};
export type Review = {
  title: string | null;
  fields: Field[];
  checks: Check[];
  conflicts?: Conflict[];
};

/** "base_rent_rate_per_sf" -> "Base rent rate per sq ft" */
function label(key: string): string {
  const words = key.split("_").map((w) => (w === "sf" ? "sq ft" : w === "no" ? "number" : w));
  const s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const num = (v: unknown): number | null => (typeof v === "number" && !Number.isNaN(v) ? v : null);
const day = (v: unknown): number | null => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : t;
};
const near = (a: number, b: number, tolerance = 0.01) => Math.abs(a - b) <= Math.abs(b) * tolerance;

/**
 * Does the document agree with itself? `ok: null` means it didn't say enough to
 * tell. `complete` is false for a supporting document, which is not expected to
 * carry the whole lease.
 */
/** 103757.5 -> "103,757.5" — readable without pretending to a currency. */
const amount = (n: number) => n.toLocaleString("en-CA", { maximumFractionDigits: 2 });

/** A label, and optionally the figures the check compared. */
type Said = [string, string?];

function checks(v: Record<string, unknown>, complete = true): Check[] {
  const from = day(v.start_date);
  const to = day(v.expiry_date);
  const years = num(v.term_years);
  const rate = num(v.base_rent_rate_per_sf);
  const area = num(v.size);
  const annual = num(v.base_rent_annual);
  const missing = (SCHEMA.required ?? []).filter((k) => v[k] === null || v[k] === undefined);
  const priced = annual !== null || num(v.security_deposit) !== null;

  const order = from === null || to === null ? null : to > from;
  const span = from !== null && to !== null ? (to - from) / 31_557_600_000 : null;
  const length = years === null || span === null ? null : Math.abs(span - years) <= 0.5;
  const rent = rate === null || area === null || annual === null ? null : near(rate * area, annual);
  const currency = priced ? !!v.currency : null;

  const dates = `${String(v.start_date)} to ${String(v.expiry_date)}`;
  const stated = `${years} stated, ${span?.toFixed(1)} from the dates`;
  const product =
    rate !== null && area !== null ? `${amount(rate)} × ${amount(area)} = ${amount(rate * area)}` : "";

  // The wording follows the outcome, so a ✗ never reads as a claim that held.
  const say = (ok: boolean | null, pass: Said, fail: Said, absent: string): Check => {
    if (ok === null) return { ok, label: absent };
    const [text, detail] = ok ? pass : fail;
    return detail ? { ok, label: text, detail } : { ok, label: text };
  };

  return [
    complete &&
      say(
        missing.length === 0,
        ["every required field came back"],
        [`no value for ${missing.map(label).join(", ").toLowerCase()}`],
        "",
      ),
    say(
      order,
      ["the term expires after it starts", dates],
      ["the term expires before it starts", dates],
      "term dates incomplete — not compared",
    ),
    say(
      length,
      [`the stated ${years}-year term matches the dates`, stated],
      [`the stated ${years}-year term does not match the dates`, stated],
      "no stated term length to reconcile with the dates",
    ),
    say(
      rent,
      ["annual rent equals the rate times the area", product],
      [
        "annual rent does not equal the rate times the area",
        `${product}, stated ${annual !== null ? amount(annual) : "—"}`,
      ],
      "rate, area or annual rent absent — rent not recomputed",
    ),
    say(
      currency,
      ["the currency is identified", String(v.currency)],
      ["amounts are stated but the currency is not"],
      "no amounts — currency not needed",
    ),
  ].filter((c): c is Check => c !== false);
}

/**
 * Every citation for a field. `confidence` is how sure each match is, 1 to 5.
 *
 * A field can carry more than one: a term drawn from two places in the lease — a
 * rent stated in the schedule and again in the summary — is cited at each, and a
 * list is cited per element. Reading only the first accounts for part of a value
 * and quietly stands for the rest.
 *
 * A row result keys its citations by path — `[0].rent` — so a row is looked up
 * under its own index first, then the bare key.
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

/**
 * Whether this record is really the shape in schema.json. An inferred shape can
 * still borrow a name or two — `address` and `currency` are obvious ones — so a
 * single match proves nothing; most of the keys have to be ours. The checks below
 * read our names, and running them on someone else's shape reports fields as
 * missing that the document states perfectly well under another name.
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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const blank = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

// Text compares as a bag of words, so punctuation and order are not a
// disagreement: "Winnipeg (MB)" and "Winnipeg, MB" are the same answer.
const key = (v: unknown): string =>
  typeof v === "string"
    ? (v.toLowerCase().match(/[a-z0-9]+/g) ?? []).sort().join(" ")
    : JSON.stringify(v);

const same = (a: unknown, b: unknown): boolean => key(a) === key(b);

/**
 * Fields the documents answered differently. The fold keeps one and drops the
 * rest silently, so a self-consistent record can still hold the wrong value.
 */
function conflictsAmong(
  docs: Record<string, unknown>[],
  merged: Record<string, unknown>,
): Conflict[] {
  const out: Conflict[] = [];
  for (const key of Object.keys(SCHEMA.properties)) {
    const answers = docs
      .map((d) => ({
        name: String(d.name ?? d.fileId ?? "document"),
        value: isRecord(d.value) ? d.value[key] : undefined,
      }))
      .filter((a) => !blank(a.value));
    if (answers.length < 2) continue;
    const kept = merged[key];
    const others = answers.filter((a) => !same(a.value, kept));
    if (others.length > 0) out.push({ key, label: label(key), kept, others });
  }
  return out;
}

/**
 * One review per record. An `across_documents` run adds a `fileId: "merged"`
 * entry — that is the answer, so it leads and the sources follow it.
 */
export function review(run: unknown): Review[] {
  const output = (run as { output?: unknown }).output;
  if (!isRecord(output)) return [];
  const one = (
    value: Record<string, unknown>,
    citations: unknown,
    title: string | null,
    complete: boolean,
    prefix: string,
  ): Review => ({
    title,
    fields: fieldsOf(value, citations, prefix),
    checks: usesOurFields(value) ? checks(value, complete) : [NOT_OUR_SCHEMA],
  });

  /**
   * A saved action may be configured for repeated records (`rows_per_document`),
   * which returns a list rather than one record. Each row is reviewed on its own.
   */
  const build = (
    value: unknown,
    citations: unknown,
    title: string | null,
    complete = true,
  ): Review[] => {
    if (Array.isArray(value)) {
      const rows = value.filter(isRecord);
      return rows.map((row, i) =>
        one(row, citations, rows.length > 1 ? `${title ?? "Record"} ${i + 1}` : title, complete, `[${i}].`),
      );
    }
    return isRecord(value) ? [one(value, citations, title, complete, "")] : [];
  };

  const docs = (Array.isArray(output.documents) ? output.documents : []).filter(isRecord);
  const merged = docs.find((d) => d.fileId === "merged");
  const single = docs.filter((d) => d.fileId !== "merged");
  const named = (d: Record<string, unknown>) => String(d.name ?? d.fileId ?? "document");

  if (merged) {
    const from = `${single.length} document${single.length === 1 ? "" : "s"}`;
    const combined = build(merged.value, merged.citations, `Combined record, from ${from}`);
    if (combined[0] && isRecord(merged.value)) {
      combined[0].conflicts = conflictsAmong(single, merged.value);
    }
    return [
      ...combined,
      ...single.flatMap((d) => build(d.value, d.citations, `As read from ${named(d)}`, false)),
    ];
  }
  if (single.length > 1) return single.flatMap((d) => build(d.value, d.citations, named(d)));
  return build(output.value ?? single[0]?.value, output.citations ?? single[0]?.citations, null);
}
