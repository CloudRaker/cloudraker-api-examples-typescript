/**
 * A finished run turned into fields, sources and checks. The only medical-specific
 * file: page.ts renders whatever this returns.
 */

import SCHEMA from "./schema.json";

/**
 * Where a value came from: a page for a document, a timecode for a recording —
 * never both, since a source is one or the other.
 */
export type Cite = {
  page: number | null;
  /** The timecode as a clock reading, for the label: `0:03`. */
  at: string | null;
  /** The same timecode in seconds, for seeking the player. */
  seconds: number | null;
  fileId: string | null;
  text: string;
  confidence: number | null;
};

/** One line of a diarized transcript, shown beside the note and seekable. */
export type Segment = { start: number; text: string; speaker: string | null };
export type Transcript = { fileId: string; name: string; segments: Segment[] };
export type Field = { key: string; label: string; value: unknown; cites: Cite[] };
export type Check = { ok: boolean | null; label: string; detail?: string };
export type Review = {
  title: string | null;
  fields: Field[];
  checks: Check[];
  transcript: Transcript | null;
};

/** "chief_complaint" -> "Chief complaint" */
function label(key: string): string {
  const s = key.split("_").join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** An uncovered field should come back null; a run sometimes writes prose saying so. */
const SAYS_NOTHING =
  /\bnot (?:yet |explicitly |clearly |directly |specifically |currently )*(?:stated|discussed|mentioned|provided|specified|given|addressed)\b|\bnone (?:stated|discussed|mentioned)\b/i;

const text = (v: unknown): string =>
  typeof v === "string" && !SAYS_NOTHING.test(v) ? v : "";
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** A label, and optionally the figures behind it. */
type Said = [string, string?];

/**
 * Does the note hang together? A call summary has no arithmetic to reconcile, so
 * these ask the next best thing: whether the parts that imply each other are both
 * there. `ok: null` means the call didn't cover enough to judge.
 */
function checks(v: Record<string, unknown>): Check[] {
  // `required` here means the key comes back, not that a value was found: the types
  // are nullable, and null is how a run says the call never covered it.
  const absent = (SCHEMA.required ?? []).filter((k) => !(k in v));
  const assessment = text(v.assessment);
  const plan = text(v.plan);
  const symptoms = list(v.symptoms);
  const meds = list(v.medications_discussed);
  const followUp = text(v.follow_up);

  // A plan that starts or changes a drug should name it in the medication list.
  const prescribes = /\b(prescrib|start(?:ing|ed)?|increase|taper|refill|dose)\b/i.test(plan);
  // The when lands in `follow_up` or in the plan prose, so ask whether the note
  // states it at all rather than which field holds it.
  const revisits = /\b(follow[- ]?up|recheck|review|reassess|come back|return)\b/i.test(plan);
  // A span needs a preposition, so "twice a day" is not read as a return date.
  const SOON = "(?:a|an|\\d+|one|two|three|four|five|six|seven|eight|nine|ten|a few|a couple(?: of)?)";
  const WHEN = new RegExp(
    "\\b(?:today|tonight|tomorrow|next (?:day|week|month|visit)" +
      `|(?:in|within|after) ${SOON} ?(?:hour|day|week|month)s?` +
      // A condition can be the when: "once the bloodwork is back", "after the scan".
      "|(?:once|after|pending|when) .{0,40}(?:back|available|complete|completed|resulted|results?|done))\\b",
    "i",
  );
  const whenStated = followUp !== "" || WHEN.test(plan);

  // The wording follows the outcome, so a ✗ never reads as a claim that held.
  // `fail` is null where a check has no failing case — only a result or nothing.
  const say = (ok: boolean | null, pass: Said, fail: Said | null, absent: string): Check => {
    if (ok === null) return { ok, label: absent };
    const [t, detail] = ok ? pass : (fail ?? pass);
    return detail ? { ok, label: t, detail } : { ok, label: t };
  };

  return [
    say(
      absent.length === 0,
      ["the response carries every required field"],
      [`the response is missing ${absent.map(label).join(", ").toLowerCase()}`],
      "",
    ),
    say(
      assessment && plan ? true : assessment || plan ? false : null,
      ["the note pairs an assessment with a plan"],
      [assessment ? "an assessment with no plan" : "a plan with no assessment"],
      "no assessment or plan on the call",
    ),
    say(
      symptoms.length > 0 ? true : null,
      ["symptoms were captured", `${symptoms.length} reported`],
      null,
      "no symptoms reported on the call",
    ),
    say(
      !prescribes ? null : meds.length > 0,
      ["the medications the plan changes are listed", `${meds.length} named`],
      ["the plan changes a medication but none are listed"],
      "no medication change to reconcile",
    ),
    say(
      !revisits ? null : whenStated,
      followUp !== ""
        ? ["the follow-up the plan asks for is stated"]
        : ["the plan asks to be revisited and says when", "in the plan, not in follow_up"],
      ["the plan asks to be revisited but never says when"],
      "no revisit asked for",
    ),
  ];
}

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Seconds into the recording, straight from the citation. It marks the transcript
 * segment the quote falls in, which is what the seek buttons need.
 *
 * Declared as a number or a string, so accept either rather than assuming.
 */
function timecodeOf(c: Record<string, unknown>): number | null {
  if (typeof c.timecode === "number" && Number.isFinite(c.timecode)) return c.timecode;
  if (typeof c.timecode === "string") {
    const parsed = Number.parseFloat(c.timecode);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Every citation for a field, each with a document page or a recording timecode.
 *
 * A field can carry more than one: a value composed from two places in the call
 * is cited at each of them, so showing only the first would point a reviewer at
 * half the reasoning. An entry marked `notFound` cites nothing and is dropped.
 */
function citesFor(citations: unknown, key: string): Cite[] {
  const rows = (citations as Record<string, unknown> | undefined)?.[key];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const c = row as Record<string, unknown>;
    if (c.notFound) return [];
    const seconds = timecodeOf(c);
    return [{
      page: typeof c.page === "number" ? c.page : null,
      at: seconds === null ? null : clock(seconds),
      seconds,
      fileId: typeof c.fileId === "string" ? c.fileId : null,
      text: String(c.text ?? ""),
      confidence: typeof c.confidence === "number" ? c.confidence : null,
    }];
  });
}

/**
 * Whether this record is really the shape in schema.json. An inferred shape can
 * borrow a name or two, so a single match proves nothing; most of the keys have to
 * be ours. The checks above read our names, and running them on someone else's
 * shape reports fields as missing that the call covered under another name.
 */
function usesOurFields(value: Record<string, unknown>): boolean {
  const known = Object.keys(SCHEMA.properties);
  const keys = Object.keys(value);
  const mine = keys.filter((k) => known.includes(k)).length;
  return mine > 0 && mine >= keys.length / 2;
}

const blank = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Checks that name no field, so an inferred shape still gets reviewed. They ask about
 * the citations rather than the medicine, which is all you can judge without knowing
 * what the fields mean.
 */
function anyShapeChecks(value: Record<string, unknown>, citations: unknown): Check[] {
  // Citations are opt-in, so an absent citations object is a choice, not a gap.
  const asked = !!citations && typeof citations === "object" && Object.keys(citations).length > 0;
  const answered = Object.keys(value).filter((k) => !blank(value[k]));
  const cites = answered.map((k) => citesFor(citations, k));
  const traced = cites.filter((rows) => rows.length > 0).length;
  const quotes = cites.flat();
  const unsure = quotes.filter((c) => c.confidence !== null && c.confidence < 4).length;

  const say = (ok: boolean | null, pass: string, detail: string, fail: string, absent: string): Check =>
    ok === null ? { ok, label: absent } : ok ? { ok, label: pass, detail } : { ok, label: fail };

  return [
    {
      ok: null,
      label: "field checks read schema.json — this run inferred its own shape, so these check the citations instead",
    },
    say(
      !asked || answered.length === 0 ? null : traced === answered.length,
      "every value is traced to the call",
      `${traced} of ${answered.length}`,
      `${answered.length - traced} of ${answered.length} values carry no quote`,
      asked ? "nothing came back to check" : "citations were not requested, so there is nothing to trace",
    ),
    say(
      traced === 0 ? null : unsure === 0,
      "every quote is a confident match",
      `${quotes.length} at 4/5 or better`,
      `${unsure} of ${quotes.length} quotes below 4/5 — worth reading`,
      "no quotes to weigh",
    ),
  ];
}

/** Fields in schema order, then any the schema doesn't mention. */
function fieldsOf(value: Record<string, unknown>, citations: unknown): Field[] {
  const known = Object.keys(SCHEMA.properties);
  const extra = Object.keys(value).filter((k) => !known.includes(k));
  // Every schema field is listed even when omitted, so an absent one reads as "not
  // stated". An inferred shape is listed as it came back — it may borrow our names.
  const keys = usesOurFields(value) ? [...known, ...extra] : Object.keys(value);
  return keys.map((key) => ({
    key,
    label: label(key),
    value: value[key] ?? null,
    cites: citesFor(citations, key),
  }));
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * One review per call. The two shapes this has to read:
 *
 *   extract   `output.value` for one recording, `output.documents[]` for several
 *   process   `actions[].result.docs[]`, each with `data` and `evidence`
 */
export function review(run: unknown, transcripts: Transcript[] | null = null): Review[] {
  if (!isRecord(run)) return [];
  const all = transcripts ?? [];
  // A single-recording run needn't name the file it came from, so fall back to the
  // only transcript there is.
  const forFile = (fileId: unknown): Transcript | null =>
    all.find((t) => t.fileId === fileId) ?? (all.length === 1 ? all[0]! : null);

  const build = (value: unknown, citations: unknown, title: string | null, fileId?: unknown): Review[] => {
    if (!isRecord(value)) return [];
    const transcript = forFile(fileId);
    return [
      {
        title,
        fields: fieldsOf(value, citations),
        checks: usesOurFields(value) ? checks(value) : anyShapeChecks(value, citations),
        transcript,
      },
    ];
  };

  // An installed action reports its result per document, under its own keys.
  const actions = Array.isArray(run.actions) ? run.actions.filter(isRecord) : [];
  const fromActions = actions.flatMap((a) => {
    const result = isRecord(a.result) ? a.result : undefined;
    const docs = Array.isArray(result?.docs) ? result.docs.filter(isRecord) : [];
    return docs.flatMap((d) =>
      build(d.data, d.evidence, docs.length > 1 ? String(d.name ?? d.id ?? "call") : null, d.fileId ?? d.id),
    );
  });
  if (fromActions.length > 0) return fromActions;

  const output = isRecord(run.output) ? run.output : undefined;
  if (!output) return [];
  const docs = (Array.isArray(output.documents) ? output.documents : []).filter(isRecord);
  if (docs.length > 1) {
    return docs.flatMap((d) =>
      build(d.value, d.citations, String(d.name ?? d.fileId ?? "call"), d.fileId),
    );
  }
  return build(
    output.value ?? docs[0]?.value,
    output.citations ?? docs[0]?.citations,
    null,
    docs[0]?.fileId ?? (isRecord(run.file) ? run.file.id : undefined),
  );
}
