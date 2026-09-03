/**
 * The upload page. Nothing here knows about healthcare — it renders whatever
 * `review` the app puts on the polled state.
 */

export const renderPage = (exts: string[], local: boolean, host: string): string => `<!doctype html>
<title>Redact</title>
<style>
:root{--fg:#1a1a1a;--muted:#666;--line:#e2e2e2;--bg:#fff;--soft:#f6f6f6;--accent:#1a56db;--ok:#137333;--bad:#b3261e;--warn:#b06000}
*{box-sizing:border-box}
body{font:15px/1.5 system-ui,sans-serif;color:var(--fg);background:var(--bg);max-width:60rem;margin:0 auto;padding:2rem 1rem 4rem}
h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1rem;margin:0 0 .75rem}h3{font-size:.9rem;margin:0 0 .4rem}
.sub{color:var(--muted);margin:0 0 2rem}
small{color:var(--muted)}code{background:var(--soft);padding:.05rem .3rem;border-radius:3px;font-size:.85em}

ol.steps{display:flex;gap:.5rem;list-style:none;padding:0;margin:0 0 1.5rem;font-size:.85rem;flex-wrap:wrap}
ol.steps li{color:var(--muted);display:flex;align-items:center;gap:.4rem}
ol.steps li+li:before{content:"→";margin-right:.35rem}
ol.steps li.on{color:var(--fg);font-weight:600}
ol.steps b{display:inline-grid;place-items:center;width:1.4rem;height:1.4rem;border-radius:50%;background:var(--soft);font-size:.75rem}
ol.steps li.on b{background:var(--accent);color:#fff}

section{border:1px solid var(--line);border-radius:8px;padding:1.25rem;margin-bottom:1rem}
section[hidden]{display:none}

#drop{border:1.5px dashed var(--line);border-radius:8px;padding:1.75rem 1rem;text-align:center;cursor:pointer;transition:.15s}
#drop:hover,#drop.over{border-color:var(--accent);background:var(--soft)}
#drop p{margin:.25rem 0}
ul.files{list-style:none;padding:0;margin:1rem 0 0}
ul.files li{display:flex;align-items:center;gap:.6rem;padding:.5rem .6rem;border:1px solid var(--line);border-radius:6px}
ul.files .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
ul.files button{border:0;background:0;color:var(--muted);cursor:pointer;font-size:1.1rem;padding:0 .2rem}
ul.files button:hover{color:var(--bad)}
.tag{background:var(--soft);border-radius:99px;padding:.1rem .5rem;font-size:.75rem;color:var(--muted)}

.modes{display:grid;gap:.5rem;margin:0 0 1rem}
.mode{display:flex;gap:.65rem;align-items:flex-start;border:1px solid var(--line);border-radius:6px;padding:.7rem .8rem;cursor:pointer}
.mode:hover{background:var(--soft)}
.mode:has(input:checked){border-color:var(--accent);background:#f5f8ff}
.mode input{margin:.25rem 0 0}
.mode .t{font-weight:600}.mode .d{display:block;color:var(--muted);font-size:.9rem}
.field{margin:.75rem 0}
.field label{display:block;font-weight:600;font-size:.9rem;margin-bottom:.25rem}
textarea,input[type=text]{width:100%;font:inherit;font-size:.9rem;padding:.5rem;border:1px solid var(--line);border-radius:6px;resize:vertical}

button.primary{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:.6rem 1.1rem;font:inherit;font-weight:600;cursor:pointer}
button.primary:disabled{opacity:.5;cursor:default}
button.ghost{background:0;border:1px solid var(--line);border-radius:6px;padding:.6rem 1.1rem;font:inherit;cursor:pointer}
button.small{padding:.3rem .7rem;font-size:.85rem}
.row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}

#status{margin:0 0 .5rem;font-weight:600;font-size:.9rem}
ol.log{color:var(--muted);font-size:.85rem;margin:0;padding-left:1.4rem}
ol.log li:last-child{color:var(--fg)}
.err{border-left:3px solid var(--bad);background:#fdf3f2;padding:.7rem .9rem;border-radius:0 6px 6px 0;white-space:pre-wrap;font-size:.9rem;margin:1rem 0 0}
.warn{border-left:3px solid var(--warn);background:#fff8e6;padding:.7rem .9rem;border-radius:0 6px 6px 0;font-size:.9rem;margin:.75rem 0 0}
.banner{border-left:3px solid var(--accent);background:#f5f8ff;padding:.7rem .9rem;border-radius:0 6px 6px 0;font-size:.9rem;margin:0 0 1rem}

.tally{display:flex;gap:1.25rem;flex-wrap:wrap;margin:0 0 1rem;font-size:.9rem}
.tally b{font-size:1.35rem;font-weight:600;display:block;line-height:1.2}
ul.checks{list-style:none;padding:0;margin:0 0 1.25rem}
ul.checks li{padding:.35rem 0;font-size:.9rem;display:flex;gap:.5rem}
ul.checks .detail{color:var(--muted);font-weight:400}
ul.checks .ok{color:var(--ok)}ul.checks .bad{color:var(--bad)}ul.checks .skip{color:var(--muted)}
table.ents{width:100%;border-collapse:collapse;font-size:.9rem;margin:0 0 1.25rem}
table.ents th{text-align:left;font-weight:600;color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.03em;padding:.4rem .5rem;border-bottom:1px solid var(--line)}
table.ents td{padding:.45rem .5rem;border-bottom:1px solid var(--line)}
table.ents td.n{text-align:right;width:5rem;font-variant-numeric:tabular-nums}

/* side-by-side preview — the point of reviewing a redaction */
.compare{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:0 0 1rem}
@media(max-width:46rem){.compare{grid-template-columns:1fr}}
.pane{border:1px solid var(--line);border-radius:6px;padding:.7rem;min-width:0}
.pane h3{margin:0 0 .5rem;display:flex;justify-content:space-between;gap:.5rem;align-items:baseline}
a.open{font-size:.8rem;font-weight:600;color:var(--accent);text-decoration:none}
a.open:hover{text-decoration:underline}
.pane object{display:block;width:100%;height:32rem;border:1px solid var(--line);border-radius:4px;background:var(--soft)}
.pane audio{width:100%;margin-top:.4rem}
.pane .none{color:var(--muted);font-style:italic;font-size:.9rem}
details.raw{margin-top:1.25rem}
details.raw summary{cursor:pointer;font-weight:600;font-size:.9rem}
pre{background:var(--soft);padding:.9rem;border-radius:6px;overflow:auto;white-space:pre-wrap;font-size:12px;margin:.6rem 0 0}
</style>

<h1>Redact</h1>
<p class=sub>Remove personal information from a document or a recording, then check what went.</p>

<ol class=steps>
  <li id=s1 class=on><b>1</b> File</li>
  <li id=s2><b>2</b> Options</li>
  <li id=s3><b>3</b> Review</li>
</ol>

<section id=step1>
  <h2>1 &middot; Choose a file</h2>
  <div id=drop>
    <p><b>Drop a file here</b> or click to browse</p>
    <p><small>${exts.join(", ")}</small></p>
  </div>
  <input type=file id=f hidden accept="${exts.map((e) => "." + e).join(",")}">
  <ul class=files id=list></ul>
  <div id=pickmsg></div>
</section>

<section id=step2>
  <h2>2 &middot; Choose how to redact</h2>
  <div class=banner>${
    local
      ? `<b>The result will be polled.</b> The call is held open while the run finishes, and polled
         if it takes longer than the call can wait. Open this page through a tunnel and the finished
         run is delivered to a signed callback instead.`
      : `<b>The result will be delivered.</b> This page is open at <code>${host}</code>, so the call
         returns straight away and the finished run arrives as a signed webhook at
         <code>${host}/webhook</code>, checked before it is trusted.`
  }</div>
  <div class=modes>
    <label class=mode><input type=radio name=source value=here checked>
      <span><span class=t>Use the settings below</span>
      <span class=d>You choose what counts as sensitive and how it is removed.</span></span></label>
    <label class=mode><input type=radio name=source value=action>
      <span><span class=t>Use an installed action</span>
      <span class=d>An action your organization already configured carries those settings, so
      <code>action</code> goes in place of them. Anything you fill in below still applies, for
      that run only.</span></span></label>
  </div>

  <div class=field id=action-box hidden>
    <label for=action>Installed action <small>(sent as <code>action</code>)</small></label>
    <input type=text id=action placeholder="redact-patient-info">
    <small>The slug or id of an action installed in your organization &mdash;
    <code>sdk.actions.listActions()</code> lists them.</small>
  </div>

  <!-- The two parameters are not interchangeable, and sending the wrong one is a
       400, so the choice follows the file's media type rather than being asked. -->
  <div id=doc-opts hidden>
    <div class=modes>
      <label class=mode><input type=radio name=mode value=targeted checked>
        <span><span class=t>Remove just the matched text</span>
        <span class=d>Each name, number or address is cut out where it sits. Sent as <code>mode: "targeted"</code>.</span></span></label>
      <label class=mode><input type=radio name=mode value=lines>
        <span><span class=t>Remove the whole line</span>
        <span class=d>Safer when a value shares its line with context that would give it away. Sent as <code>mode: "lines"</code>.</span></span></label>
    </div>
  </div>
  <div id=audio-opts hidden>
    <div class=modes>
      <label class=mode><input type=radio name=style value=beep checked>
        <span><span class=t>Beep over it</span>
        <span class=d>Audible that something was removed. Sent as <code>style: "beep"</code>.</span></span></label>
      <label class=mode><input type=radio name=style value=silence>
        <span><span class=t>Silence it</span>
        <span class=d>Leaves a gap instead. Sent as <code>style: "silence"</code>.</span></span></label>
    </div>
  </div>

  <div class=field>
    <label for=categories>What counts as sensitive <small>(optional, sent as <code>categories</code>)</small></label>
    <input type=text id=categories placeholder="Person names, Address — comma separated. Leave blank for the defaults.">
    <small>Named in plain words, the same way they come back in the result. Blank uses the
    defaults: Person names, Social insurance number, Address, Phone number, Email address,
    Date of birth.</small>
  </div>

  <div class=field>
    <label for=instructions>House rules <small>(optional, sent as <code>instructions</code>)</small></label>
    <textarea id=instructions rows=2 placeholder="e.g. &quot;keep the clinic's own address and phone number, remove the patient's&quot;."></textarea>
  </div>

  <div class=row style="margin-top:1rem"><button class=primary id=go>Redact</button></div>
  <div id=err></div>
</section>

<section id=progress hidden>
  <h2>Progress</h2>
  <p id=status></p>
  <ol class=log id=log></ol>
</section>

<section id=step3 hidden>
  <h2>3 &middot; Review</h2>
  <div id=review></div>
  <details class=raw><summary>Raw response</summary>
    <p><button class="ghost small" id=copy>Copy JSON</button></p>
    <pre id=raw></pre>
  </details>
  <div class=row style="margin-top:1.25rem"><button class=ghost id=again>Redact another</button></div>
</section>

<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const OK_EXT = ${JSON.stringify(exts)};
const AUDIO = /\\.(mp3|m4a|wav|aac|ogg|mp4|mov)$/i;
let picked = null, timer, startedAt, jobOnScreen;

$('drop').onclick = () => $('f').click();
$('drop').ondragover = (e) => { e.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = (e) => { e.preventDefault(); $('drop').classList.remove('over'); take(e.dataTransfer.files[0]); };
$('f').onchange = () => take($('f').files[0]);

const KB = (n) => n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const note = (id, cls, html) => { $(id).innerHTML = html ? '<div class=' + cls + '>' + html + '</div>' : ''; };

function take(file) {
  if (!file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  // The accept attribute is only a picker filter — a dropped file bypasses it.
  if (!OK_EXT.includes(ext)) { note('pickmsg', 'warn', esc(file.name) + " isn't a supported file type."); return; }
  note('pickmsg', 'warn', '');
  picked = file; $('f').value = '';
  render();
}

function render() {
  if (!picked) { $('list').innerHTML = ''; $('go').disabled = true; return; }
  const audio = AUDIO.test(picked.name);
  $('list').innerHTML = '<li><span class=name>' + esc(picked.name) + '</span>' +
    '<span class=tag>' + (audio ? 'audio' : 'document') + '</span>' +
    '<small>' + KB(picked.size) + '</small><button title=Remove>&times;</button></li>';
  $('list').querySelector('button').onclick = () => { picked = null; render(); };
  $('doc-opts').hidden = audio;
  $('audio-opts').hidden = !audio;
  $('s1').classList.toggle('on', false); $('s2').classList.add('on');
  options();
}

/** The action replaces the how, so hide that pair while one is named. */
function options() {
  const byAction = sourceOf() === 'action';
  $('action-box').hidden = !byAction;
  const audio = picked && AUDIO.test(picked.name);
  $('doc-opts').hidden = byAction || !!audio;
  $('audio-opts').hidden = byAction || !audio;
  $('go').disabled = !picked || (byAction && !$('action').value.trim());
}

const sourceOf = () => document.querySelector('input[name=source]:checked').value;
for (const r of document.querySelectorAll('input[name=source]')) r.onchange = options;
$('action').oninput = options;

$('go').onclick = async () => {
  $('go').disabled = true; note('err', 'err', '');
  $('progress').hidden = false; $('log').innerHTML = ''; startedAt = Date.now();
  $('status').textContent = 'Uploading…';
  const audio = AUDIO.test(picked.name);
  const q = new URLSearchParams({
    name: picked.name,
    audio: String(audio),
    action: sourceOf() === 'action' ? $('action').value.trim() : '',
    choice: audio ? document.querySelector('input[name=style]:checked').value
                  : document.querySelector('input[name=mode]:checked').value,
    categories: $('categories').value.trim(),
    instructions: $('instructions').value.trim(),
  });
  const r = await fetch('/upload?' + q, { method: 'POST', body: picked });
  if (!r.ok) { fail(await r.text()); return; }
  const { jobId } = await r.json();
  jobOnScreen = jobId;
  $('status').textContent = ${local ? "'Redacting…'" : "'Accepted — waiting for the callback…'"};
  timer = setInterval(() => poll(jobId), 1500);
};

function fail(text) { clearInterval(timer); $('status').textContent = ''; note('err', 'err', esc(text)); $('go').disabled = false; }

async function poll(jobId) {
  const s = await (await fetch('/result/' + jobId)).json();
  $('log').innerHTML = (s.log || []).map((l) => '<li>' + esc(l) + '</li>').join('');
  if (s.log && s.log.length) {
    $('status').textContent = s.log[s.log.length - 1] + ' · ' + Math.round((Date.now() - startedAt) / 1000) + 's';
  }
  if (s.error) return fail(s.error);
  if (!s.result) return;
  clearInterval(timer);
  $('status').textContent = 'Done in ' + Math.round((Date.now() - startedAt) / 1000) + 's.';
  $('raw').textContent = JSON.stringify(s.result, null, 2);
  $('review').innerHTML = s.review ? view(s.review) : '<p>No output — see the raw response.</p>';
  $('step2').hidden = true; $('step3').hidden = false;
  $('s2').classList.remove('on'); $('s3').classList.add('on');
  $('go').disabled = false;
}

$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('raw').textContent); $('copy').textContent = 'Copied'; }
  catch { $('copy').textContent = 'Press ⌘C'; getSelection().selectAllChildren($('raw')); }
  setTimeout(() => { $('copy').textContent = 'Copy JSON'; }, 1500);
};

$('again').onclick = () => {
  $('step2').hidden = false; $('step3').hidden = true; $('progress').hidden = true;
  $('s3').classList.remove('on'); render(); scrollTo({ top: 0, behavior: 'smooth' });
};

const tile = (n, label) => '<div><b>' + esc(n) + '</b><small>' + esc(label) + '</small></div>';

/**
 * The files themselves. Audio plays inline; a PDF is embedded straight from our
 * own /preview route, with the link as the way in if the browser declines.
 */
function pane(title, side, p) {
  if (!p || !p.url) return '<div class=pane><h3>' + esc(title) + '</h3><p class=none>not available</p></div>';
  const src = '/preview/' + encodeURIComponent(jobOnScreen) + '/' + side;
  const body = p.kind === 'audio'
    ? '<audio controls preload=metadata src="' + src + '"></audio>'
    : '<object data="' + src + '" type="application/pdf">' +
        '<p class=none>preview unavailable &mdash; use the link above</p></object>';
  return '<div class=pane><h3>' + esc(title) +
    ' <a class=open href="' + src + '" target=_blank rel="noopener noreferrer">open</a></h3>' +
    body + '</div>';
}

function view(r) {
  const rows = r.entities.map((e) =>
    '<tr><td>' + esc(e.label) + '</td><td class=n>' + esc(e.count) + '</td></tr>').join('');
  return '<div class=tally>' +
      tile(r.total, r.total === 1 ? 'item removed' : 'items removed') +
      tile(r.entities.length, r.entities.length === 1 ? 'category' : 'categories') +
      (r.skipped > 0 ? tile(r.skipped, 'nothing to redact') : '') +
    '</div>' +
    (r.skipped > 0 && r.total === 0
      ? '<div class=warn>Nothing matched, so no redacted copy was produced. Check the categories ' +
        'cover what you expected before treating the file as clean.</div>'
      : '') +
    '<ul class=checks>' + r.checks.map((c) =>
      '<li class=' + (c.ok === null ? 'skip' : c.ok ? 'ok' : 'bad') + '><span>' +
      (c.ok === null ? '–' : c.ok ? '✓' : '✗') + '</span><span>' + esc(c.label) +
      (c.detail ? ' <span class=detail>(' + esc(c.detail) + ')</span>' : '') +
      '</span></li>').join('') + '</ul>' +
    (rows ? '<table class=ents><tr><th>Removed</th><th class=n>Count</th></tr>' + rows + '</table>' : '') +
    '<div class=compare>' + pane('Before', 'before', r.before) + pane('After', 'after', r.after) + '</div>';
}

render();
</script>`;
