/**
 * The upload page, kept out of scaffold.ts so the parts worth reading — the API
 * calls in app.ts and the server in scaffold.ts — stay short.
 *
 * Nothing here knows about leases. The page renders whatever `reviews` the app
 * puts on the polled state: an ordered list of fields and a list of checks. Swap
 * app.ts for another document type and this page still works.
 */

/**
 * `exts` is the accepted extension list, so the picker and its copy agree.
 * `local` and `host` are how the browser reached the server, which decides
 * whether the result is polled or delivered.
 */
export const renderPage = (exts: string[], local: boolean, host: string, hasAction: boolean): string => `<!doctype html>
<title>Lease extraction</title>
<style>
:root{--fg:#1a1a1a;--muted:#666;--line:#e2e2e2;--bg:#fff;--soft:#f6f6f6;--accent:#1a56db;--ok:#137333;--bad:#b3261e}
*{box-sizing:border-box}
body{font:15px/1.5 system-ui,sans-serif;color:var(--fg);background:var(--bg);max-width:56rem;margin:0 auto;padding:2rem 1rem 4rem}
h1{font-size:1.5rem;margin:0 0 .25rem}
h2{font-size:1rem;margin:0 0 .75rem}
.sub{color:var(--muted);margin:0 0 2rem}
small{color:var(--muted)}
code{background:var(--soft);padding:.05rem .3rem;border-radius:3px;font-size:.85em}

/* stepper */
ol.steps{display:flex;gap:.5rem;list-style:none;padding:0;margin:0 0 1.5rem;font-size:.85rem;flex-wrap:wrap}
ol.steps li{color:var(--muted);display:flex;align-items:center;gap:.4rem}
ol.steps li+li:before{content:"→";margin-right:.35rem}
ol.steps li.on{color:var(--fg);font-weight:600}
ol.steps b{display:inline-grid;place-items:center;width:1.4rem;height:1.4rem;border-radius:50%;background:var(--soft);font-size:.75rem}
ol.steps li.on b{background:var(--accent);color:#fff}

section{border:1px solid var(--line);border-radius:8px;padding:1.25rem;margin-bottom:1rem}
section[hidden]{display:none}

/* step 1 — files */
#drop{border:1.5px dashed var(--line);border-radius:8px;padding:1.75rem 1rem;text-align:center;cursor:pointer;transition:.15s}
#drop:hover,#drop.over{border-color:var(--accent);background:var(--soft)}
#drop p{margin:.25rem 0}
ul.files{list-style:none;padding:0;margin:1rem 0 0}
ul.files li{display:flex;align-items:center;gap:.6rem;padding:.5rem .6rem;border:1px solid var(--line);border-radius:6px;margin-bottom:.4rem}
ul.files .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
ul.files button{border:0;background:0;color:var(--muted);cursor:pointer;font-size:1.1rem;line-height:1;padding:0 .2rem}
ul.files button:hover{color:var(--bad)}

/* step 2 — options */
.modes{display:grid;gap:.5rem;margin:0 0 1rem}
.mode{display:flex;gap:.65rem;align-items:flex-start;border:1px solid var(--line);border-radius:6px;padding:.7rem .8rem;cursor:pointer}
.mode:hover{background:var(--soft)}
.mode:has(input:checked){border-color:var(--accent);background:#f5f8ff}
.mode input{margin:.25rem 0 0}
.mode .t{font-weight:600}
.mode .d{display:block;color:var(--muted);font-size:.9rem}
label.opt{display:flex;gap:.6rem;align-items:flex-start;margin:.75rem 0}
textarea{width:100%;font:inherit;font-size:.9rem;padding:.5rem;border:1px solid var(--line);border-radius:6px;resize:vertical}
.field{margin:.75rem 0}
.field label{display:block;font-weight:600;font-size:.9rem;margin-bottom:.25rem}

button.primary{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:.6rem 1.1rem;font:inherit;font-weight:600;cursor:pointer}
button.primary:disabled{opacity:.5;cursor:default}
button.ghost{background:0;border:1px solid var(--line);border-radius:6px;padding:.6rem 1.1rem;font:inherit;cursor:pointer}
button.small{padding:.3rem .7rem;font-size:.85rem}
.row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}

/* status + errors */
.err{border-left:3px solid var(--bad);background:#fdf3f2;padding:.7rem .9rem;border-radius:0 6px 6px 0;white-space:pre-wrap;font-size:.9rem;margin:1rem 0 0}
.warn{border-left:3px solid #b06000;background:#fff8e6;padding:.7rem .9rem;border-radius:0 6px 6px 0;font-size:.9rem;margin:.75rem 0 0}
.banner{border-left:3px solid var(--accent);background:#f5f8ff;padding:.7rem .9rem;border-radius:0 6px 6px 0;font-size:.9rem;margin:0 0 1rem}

/* step 3 — review */
.tally{display:flex;gap:1.25rem;flex-wrap:wrap;margin:0 0 1rem;font-size:.9rem}
.tally b{font-size:1.35rem;font-weight:600;display:block;line-height:1.2}
ul.checks{list-style:none;padding:0;margin:0 0 1.25rem}
ul.checks li{padding:.35rem 0;font-size:.9rem;display:flex;gap:.5rem}
ul.checks .detail{color:var(--muted);font-weight:400}
ul.checks .ok{color:var(--ok)}ul.checks .bad{color:var(--bad)}ul.checks .skip{color:var(--muted)}
table.fields{width:100%;border-collapse:collapse;font-size:.9rem}
table.fields th{text-align:left;font-weight:600;color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.03em;padding:.4rem .5rem;border-bottom:1px solid var(--line)}
table.fields td{padding:.45rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}
table.fields td.k{width:34%;color:var(--muted)}
table.fields td.v{white-space:pre-wrap;word-break:break-word}
.none{color:var(--muted);font-style:italic}
/* nested values: a list of records renders as its own small table */
.scroll{overflow-x:auto;max-width:100%}
table.sub{border-collapse:collapse;font-size:.85rem;margin:.1rem 0}
table.sub th{text-align:left;font-weight:600;color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.03em;padding:.2rem .5rem .2rem 0;border-bottom:1px solid var(--line);white-space:nowrap}
table.sub td{padding:.2rem .5rem .2rem 0;border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:top}
table.sub tr:last-child td{border-bottom:0}
ul.vals{list-style:none;margin:0;padding:0}
ul.vals li{padding:.1rem 0}
.src{color:var(--muted);font-size:.8rem;white-space:nowrap}
.src.low{color:#b06000;font-weight:600}
.hide-empty tr.empty{display:none}
details.diff{border-left:3px solid #b06000;background:#fff8e6;padding:.6rem .9rem;border-radius:0 6px 6px 0;margin:0 0 1.25rem;font-size:.9rem}
details.diff summary{cursor:pointer;font-weight:600}
details.diff p{margin:.5rem 0}
.alt{color:var(--muted);margin-top:.2rem}
details.raw{margin-top:1.25rem}
details.raw summary{cursor:pointer;font-weight:600;font-size:.9rem}
pre{background:var(--soft);padding:.9rem;border-radius:6px;overflow:auto;white-space:pre-wrap;font-size:12px;margin:.6rem 0 0}
#status{margin:0 0 .5rem;font-weight:600;font-size:.9rem;color:var(--fg)}
ol.log{color:var(--muted);font-size:.85rem;margin:0;padding-left:1.4rem}
ol.log li{padding:.1rem 0}
ol.log li:last-child{color:var(--fg)}
</style>

<h1>Lease extraction</h1>
<p class=sub>Turn a lease document into structured fields you can check against the source.</p>

<ol class=steps>
  <li id=s1 class=on><b>1</b> Documents</li>
  <li id=s2><b>2</b> Options</li>
  <li id=s3><b>3</b> Review</li>
</ol>

<section id=step1>
  <h2>1 &middot; Choose documents</h2>
  <div id=drop>
    <p><b>Drop files here</b> or click to browse</p>
    <p><small>${exts.join(", ")}</small></p>
  </div>
  <input type=file id=f hidden multiple accept="${exts.map((e) => "." + e).join(",")}">
  <ul class=files id=list></ul>
  <div id=pickmsg></div>
</section>

<section id=step2>
  <h2>2 &middot; Choose how to run it</h2>
  <div class=modes>
    <label class=mode><input type=radio name=mode value=schema checked>
      <span><span class=t>One record per document</span>
      <span class=d>The fields in <code>schema.json</code>, sent with the call. Each document produces
      its own record. Start here. Sent as <code>unit: per_document</code>.</span></span></label>
    <label class=mode><input type=radio name=mode value=multi-doc>
      <span><span class=t>One record from several documents</span>
      <span class=d>The same <code>schema.json</code> over a lease plus its amendments and schedules.
      Where two documents fill the same field one answer is kept, not both combined &mdash; a cited
      value beats an uncited one, and on a tie the file listed first wins. You get that record, what
      each document said on its own, and a list of anything they disagreed on. Sent as
      <code>unit: across_documents</code>.</span></span></label>
    <label class=mode><input type=radio name=mode value=action>
      <span><span class=t>Use an installed action</span>
      <span class=d>An action already configured in your organization carries the shape, so
      <code>action</code> goes in place of <code>schema</code>. Options you send with the call
      apply to that run only.</span></span></label>
    <label class=mode><input type=radio name=mode value=hints>
      <span><span class=t>Describe it in a sentence</span>
      <span class=d>No <code>schema.json</code> &mdash; say what matters and the shape is inferred, then
      shown with the result so you can save it. Sent as <code>hints</code> in place of
      <code>schema</code>.</span></span></label>
  </div>

  <div class=banner>${
    local
      ? `<b>The result will be polled.</b> The call is held open while the run finishes, and
         polled if it takes longer than the call can wait. Open this page through a tunnel
         and the finished run is delivered to a signed callback instead &mdash; no polling,
         and no ceiling on how long the run may take.`
      : `<b>The result will be delivered.</b> This page is open at <code>${host}</code>, so
         the call returns straight away and the finished run arrives as a signed webhook at
         <code>${host}/webhook</code>, checked before it is trusted.`
  }</div>

  <label class=opt><input type=checkbox id=cite checked>
    <span><b>Show where each value came from</b>
    <span class=d><small>Each value gets the page and the text it was read from, so you can check it against the document. A field the documents do not answer is reported as not found. Turn this off and you get values only. Sent as <code>citations</code>.</small></span></span></label>

  <div class=field id=action-box hidden>
    <label for=action>Installed action <small>(sent as <code>action</code>)</small></label>
    <input type=text id=action placeholder="contract-key-terms">
    <small>The slug or id of an action installed in your organization &mdash;
    <code>sdk.actions.listActions()</code> lists them. Required unless
    <code>RAKERONE_ACTION</code> is set.</small>
  </div>

  <div class=field id=hints-box hidden>
    <label for=hints>What are these documents, and what matters in them?
      <small>sent as <code>hints</code></small></label>
    <textarea id=hints rows=3 placeholder="Leave blank to use the default in app.ts. Name any formats you want, e.g. &quot;give every date as YYYY-MM-DD&quot;."></textarea>
  </div>

  <div class=field>
    <label for=instructions>House rules <small>(optional, sent as <code>instructions</code>)</small></label>
    <textarea id=instructions rows=2 placeholder="e.g. &quot;this lease is bilingual — take prose from the French text, since the French version governs&quot;."></textarea>
    <small id=instr-note>Layered on top of the field list.</small>
  </div>

  <div id=modemsg></div>
  <div class=row style="margin-top:1rem">
    <button class=primary id=go>Extract</button>
  </div>
  <div id=err></div>
</section>

<!-- Kept separate so it stays visible once the review appears. -->
<section id=progress hidden>
  <h2>Progress</h2>
  <p id=status></p>
  <ol class=log id=log></ol>
</section>

<section id=step3 hidden>
  <h2>3 &middot; Review</h2>
  <p><label class=opt><input type=checkbox id=showall>
    <span>Show fields the document didn't state</span></label></p>
  <div id=reviews class=hide-empty></div>
  <details class=raw id=shape hidden><summary>Inferred shape</summary>
    <p><small>The platform worked this out from your sentence and reports it as
    <code>config.schema</code>. Save it as <code>schema.json</code> to run the same shape again
    without inferring it.</small></p>
    <p><button class="ghost small" id=copyshape>Copy schema</button></p>
    <pre id=shapejson></pre>
  </details>
  <details class=raw><summary>Raw response</summary>
    <p><button class="ghost small" id=copy>Copy JSON</button></p>
    <pre id=raw></pre>
  </details>
  <div class=row style="margin-top:1.25rem"><button class=ghost id=again>Run another</button></div>
</section>

<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
/** One definition of "the document didn't say", used by the tally and the table. */
const empty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
const modeOf = () => document.querySelector('input[name=mode]:checked').value;
let picked = [], timer, startedAt, modeUsed;

/* ---- step 1: the picker ---- */
$('drop').onclick = () => $('f').click();
$('drop').ondragover = (e) => { e.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = (e) => {
  e.preventDefault(); $('drop').classList.remove('over');
  add(e.dataTransfer.files);
};
$('f').onchange = () => add($('f').files);

const KB = (n) => n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const OK_EXT = ${JSON.stringify(exts)};

function add(files) {
  for (const file of files) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    // The accept attribute is only a picker filter — a dropped file bypasses it.
    if (!OK_EXT.includes(ext)) { note('pickmsg', 'warn', esc(file.name) + " isn't a supported file type."); continue; }
    if (!picked.some((p) => p.name === file.name && p.size === file.size)) picked.push(file);
  }
  $('f').value = '';
  render();
}

function render() {
  $('list').innerHTML = picked.map((p, i) =>
    '<li><span class=name>' + esc(p.name) + '</span><small>' + KB(p.size) + '</small>' +
    '<button data-i=' + i + ' title=Remove>&times;</button></li>').join('');
  for (const b of $('list').querySelectorAll('button'))
    b.onclick = () => { picked.splice(+b.dataset.i, 1); render(); };
  $('s1').classList.toggle('on', picked.length === 0);
  $('s2').classList.toggle('on', picked.length > 0);
  guard();
}

const note = (id, cls, html) => { $(id).innerHTML = html ? '<div class=' + cls + '>' + html + '</div>' : ''; };

/* ---- step 2: options ---- */
for (const r of document.querySelectorAll('input[name=mode]')) r.onchange = guard;

/** Say up front what won't work, instead of failing after the upload. */
function guard() {
  const mode = modeOf();
  $('hints-box').hidden = mode !== 'hints';
  $('action-box').hidden = mode !== 'action';
  $('instr-note').textContent = mode === 'hints'
    ? 'Ignored in this mode — the sentence above does the same job.'
    : mode === 'action'
      ? 'Applied on top of the action, for this run only.'
      : 'Layered on top of the field list.';
  // The API accepts one file here; with only one there is just nothing to choose
  // between, so this example asks for a second rather than showing a pointless run.
  const msg = mode === 'multi-doc' && picked.length === 1
    ? 'With one file there is nothing to choose between — add another, or switch to one record per document.'
    // The action has to already exist, so there is nothing to guess.
    : mode === 'action' && !$('action').value.trim() && !${hasAction}
      ? 'Name the installed action to run, or set RAKERONE_ACTION and restart.'
      : '';
  note('modemsg', 'warn', msg);
  $('go').disabled = picked.length === 0 || !!msg;
}

/* The action gates the run, so re-check it as it is typed, not only on mode change. */
$('action').oninput = guard;

$('go').onclick = async () => {
  $('go').disabled = true; note('err', 'err', '');
  $('progress').hidden = false; $('log').innerHTML = '';
  startedAt = Date.now();
  $('status').textContent = 'Uploading…';
  const body = new FormData();
  modeUsed = modeOf();
  body.set('mode', modeUsed);
  body.set('hints', $('hints').value.trim());
  body.set('instructions', $('instructions').value.trim());
  body.set('action', $('action').value.trim());
  body.set('citations', $('cite').checked);
  for (const file of picked) body.append('files', file, file.name);
  const r = await fetch('/upload', { method: 'POST', body });
  if (!r.ok) { fail(await r.text()); return; }
  const { jobId } = await r.json();
  $('status').textContent = ${local ? "'Reading the document…'" : "'Accepted — waiting for the callback…'"};
  timer = setInterval(() => poll(jobId), 1500);
};

function fail(text) {
  clearInterval(timer);
  $('status').textContent = '';
  note('err', 'err', esc(text));
  $('go').disabled = false;
}

async function poll(jobId) {
  const s = await (await fetch('/result/' + jobId)).json();
  $('log').innerHTML = (s.log || []).map((l) => '<li>' + esc(l) + '</li>').join('');
  // One long request has no finer progress to report, so show elapsed time.
  if (s.log && s.log.length) {
    const secs = Math.round((Date.now() - startedAt) / 1000);
    $('status').textContent = s.log[s.log.length - 1] + ' · ' + secs + 's';
  }
  if (s.error) return fail(s.error);
  if (!s.result) return;
  clearInterval(timer);
  $('status').textContent = 'Done in ' + Math.round((Date.now() - startedAt) / 1000) + 's.';
  $('raw').textContent = JSON.stringify(s.result, null, 2);
  // Only worth showing when we didn't send one: in the other modes it just echoes back.
  const inferred = modeUsed === 'hints' ? s.result && s.result.config && s.result.config.schema : null;
  $('shape').hidden = !inferred;
  if (inferred) $('shapejson').textContent = JSON.stringify(inferred, null, 2);
  $('reviews').innerHTML = (s.reviews || []).map(review).join('') ||
    '<p class=none>No fields came back — see the raw response.</p>';
  $('step2').hidden = true; $('step3').hidden = false;
  $('s2').classList.remove('on'); $('s3').classList.add('on');
  $('go').disabled = false;
}

// The clipboard API needs a secure context; localhost and the tunnel both are.
$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('raw').textContent);
    $('copy').textContent = 'Copied';
  } catch {
    $('copy').textContent = 'Press ⌘C';
    getSelection().selectAllChildren($('raw'));
  }
  setTimeout(() => { $('copy').textContent = 'Copy JSON'; }, 1500);
};

$('showall').onchange = () =>
  $('reviews').classList.toggle('hide-empty', !$('showall').checked);

$('copyshape').onclick = async () => {
  try { await navigator.clipboard.writeText($('shapejson').textContent); $('copyshape').textContent = 'Copied'; }
  catch { $('copyshape').textContent = 'Press ⌘C'; getSelection().selectAllChildren($('shapejson')); }
  setTimeout(() => { $('copyshape').textContent = 'Copy schema'; }, 1500);
};

$('again').onclick = () => {
  $('step2').hidden = false; $('step3').hidden = true; $('progress').hidden = true;
  $('s3').classList.remove('on'); render();
  scrollTo({ top: 0, behavior: 'smooth' });
};

/* ---- step 3: render whatever the app handed us ---- */
function review(rv) {
  const filled = rv.fields.filter((f) => !empty(f.value));
  const cited = rv.fields.filter((f) => f.cites.length);
  const flagged = (rv.checks || []).filter((c) => c.ok === false);
  return (rv.title ? '<h3>' + esc(rv.title) + '</h3>' : '') +
    '<div class=tally>' +
      tile(filled.length + ' / ' + rv.fields.length, 'fields found') +
      (cited.length ? tile(cited.length, 'traced to the source') : '') +
      tile(flagged.length, flagged.length === 1 ? 'check to look at' : 'checks to look at') +
    '</div>' +
    conflicts(rv.conflicts) +
    ((rv.checks || []).length
      ? '<ul class=checks>' + rv.checks.map((c) =>
          '<li class=' + (c.ok === null ? 'skip' : c.ok ? 'ok' : 'bad') + '><span>' +
          (c.ok === null ? '–' : c.ok ? '✓' : '✗') + '</span><span>' + esc(c.label) +
      (c.detail ? ' <span class=detail>(' + esc(c.detail) + ')</span>' : '') +
      '</span></li>').join('') + '</ul>'
      : '') +
    '<table class=fields><tr><th>Field</th><th>Value</th></tr>' +
    rv.fields.map((f) => '<tr' + (empty(f.value) ? ' class=empty' : '') + '><td class=k>' +
      esc(f.label) + '</td><td class=v>' + value(f) + '</td></tr>').join('') +
    '</table>';
}

const tile = (n, label) => '<div><b>' + esc(n) + '</b><small>' + esc(label) + '</small></div>';

/** Fields the documents answered differently. One answer was kept; show the rest. */
function conflicts(list) {
  if (!list || !list.length) return '';
  const rows = list.map((c) =>
    '<tr><td class=k>' + esc(c.label) + '</td>' +
    '<td class=v><b>' + cell(c.kept) + '</b>' +
    c.others.map((o) => '<div class=alt>' + cell(o.value) +
      ' <small>&mdash; ' + esc(o.name) + '</small></div>').join('') +
    '</td></tr>').join('');
  return '<details class=diff><summary>' + list.length +
    (list.length === 1 ? ' field differs' : ' fields differ') +
    ' between these documents</summary>' +
    '<p><small>The value in bold was kept. Where the documents tie, the one listed ' +
    'first wins, so some of these are a matter of upload order rather than support.</small></p>' +
    '<table class=fields>' + rows + '</table></details>';
}

/** Column heading for a nested key: "rate_per_sf" -> "Rate per sq ft". */
const head = (k) => {
  const s = k.split('_').map((w) => (w === 'sf' ? 'sq ft' : w)).join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const scalar = (x) => esc(x && typeof x === 'object' ? JSON.stringify(x) : x);

/** A list of records is a table, not a blob of JSON. Columns are their keys. */
function subtable(rows) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return '<div class=scroll><table class=sub><tr>' +
    cols.map((c) => '<th>' + esc(head(c)) + '</th>').join('') + '</tr>' +
    rows.map((r) => '<tr>' +
      cols.map((c) => '<td>' + (empty(r[c]) ? '' : scalar(r[c])) + '</td>').join('') +
      '</tr>').join('') +
    '</table></div>';
}

const record = (x) => x && typeof x === 'object' && !Array.isArray(x);

function cell(v) {
  if (Array.isArray(v)) {
    if (v.every(record)) return subtable(v);
    return '<ul class=vals>' + v.map((x) => '<li>' + scalar(x) + '</li>').join('') + '</ul>';
  }
  if (record(v)) return subtable([v]);
  return esc(v);
}

function value(f) {
  const shown = empty(f.value) ? '<span class=none>not stated</span>' : cell(f.value);
  const cites = f.cites;
  if (!cites.length) return shown;
  // One marker for the field, not one per citation. A schedule is cited row by
  // row, and a dozen copies of "Page 2 · Confidence 5/5" say nothing the first
  // one did not. What differs between them is worth showing: which pages, how
  // sure the weakest is, and how many there are.
  const pages = [];
  for (const c of cites) if (c.page != null && pages.indexOf(c.page) < 0) pages.push(c.page);
  pages.sort((a, b) => a - b);
  const scores = cites.map((c) => c.confidence).filter((n) => n != null);
  const low = scores.length ? Math.min.apply(null, scores) : null;
  const high = scores.length ? Math.max.apply(null, scores) : null;
  const bits = [
    pages.length === 0 ? '' : pages.length === 1
      ? 'Page ' + (pages[0] + 1)
      : 'Pages ' + pages.map((n) => n + 1).join(', '),
    low == null ? '' : low === high
      ? 'Confidence ' + low + '/5'
      : 'Confidence ' + low + '-' + high + '/5',
    cites.length > 1 ? cites.length + ' cited' : '',
  ].filter(Boolean).join(' &middot; ');
  if (!bits) return shown;
  const quotes = cites.map((c) => c.text).filter(Boolean).join(' | ');
  return shown + ' <span class="src' + (low != null && low < 4 ? ' low' : '') +
    '" title="' + esc(quotes) + '">' + bits + '</span>';
}

render();
</script>`;
