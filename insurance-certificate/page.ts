/**
 * The page, kept out of scaffold.ts so the parts worth reading — the API calls
 * in app.ts and the server in scaffold.ts — stay short.
 *
 * Four steps: fill a certificate from the policy, look at what came back, say
 * who signs it, then watch the envelope. Nothing here knows about insurance; it
 * renders whatever the polled state carries.
 *
 * `local` and `host` are how the browser reached the server, which decides
 * whether the envelope is polled or delivered by webhook.
 *
 * The whole page is one template literal, so the browser script below cannot
 * contain a backtick — including in its comments — and a backslash escape in a
 * quoted string is resolved before the browser ever sees it: write \"the request\"
 * rather than an escaped apostrophe, or the emitted string ends early.
 */

export const renderPage = (local: boolean, host: string): string => `<!doctype html>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Certificate of insurance</title>
<style>
:root{--fg:#1a1a1a;--muted:#666;--line:#e2e2e2;--bg:#fff;--soft:#f6f6f6;--accent:#1a56db;--ok:#137333;--bad:#b3261e;--wait:#b06000}
*{box-sizing:border-box}
body{font:15px/1.5 system-ui,sans-serif;color:var(--fg);background:var(--bg);max-width:56rem;margin:0 auto;padding:2rem 1rem 4rem}
h1{font-size:1.5rem;margin:0 0 .25rem}
h2{font-size:1rem;margin:0 0 .75rem}
.sub{color:var(--muted);margin:0 0 2rem}
small{color:var(--muted)}
code{background:var(--soft);padding:.05rem .3rem;border-radius:3px;font-size:.85em}

ol.steps{display:flex;gap:.5rem;list-style:none;padding:0;margin:0 0 1.5rem;font-size:.85rem;flex-wrap:wrap}
ol.steps li{color:var(--muted);display:flex;align-items:center;gap:.4rem}
ol.steps li+li:before{content:"→";margin-right:.35rem}
ol.steps li.on{color:var(--fg);font-weight:600}
ol.steps b{display:inline-grid;place-items:center;width:1.4rem;height:1.4rem;border-radius:50%;background:var(--soft);font-size:.75rem}
ol.steps li.on b{background:var(--accent);color:#fff}

section{border:1px solid var(--line);border-radius:8px;padding:1.25rem;margin-bottom:1rem}
section[hidden]{display:none}

.modes{display:grid;gap:.5rem;margin:0 0 1rem}
.mode{display:flex;gap:.65rem;align-items:flex-start;border:1px solid var(--line);border-radius:6px;padding:.7rem .8rem;cursor:pointer}
.mode:hover{background:var(--soft)}
.mode:has(input:checked){border-color:var(--accent);background:#f5f8ff}
.mode input{margin:.25rem 0 0}
.mode .t{font-weight:600}
.mode .d{display:block;color:var(--muted);font-size:.9rem}
label.opt{display:flex;gap:.6rem;align-items:flex-start;margin:.75rem 0}
label.opt .d{display:block;color:var(--muted);font-size:.9rem}
.field{margin:.75rem 0}
.field label{display:block;font-weight:600;font-size:.9rem;margin-bottom:.25rem}
input[type=text],input[type=email],textarea{width:100%;font:inherit;font-size:.9rem;padding:.5rem;border:1px solid var(--line);border-radius:6px}
textarea{resize:vertical;min-height:7rem;font-size:.85rem}

button.primary{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:.6rem 1.1rem;font:inherit;font-weight:600;cursor:pointer}
button.primary:disabled{opacity:.5;cursor:default}
button.ghost{background:0;border:1px solid var(--line);border-radius:6px;padding:.6rem 1.1rem;font:inherit;cursor:pointer}
button.small{padding:.3rem .7rem;font-size:.85rem}
.row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}

.err{border-left:3px solid var(--bad);background:#fdf3f2;padding:.7rem .9rem;border-radius:0 6px 6px 0;white-space:pre-wrap;font-size:.9rem;margin:1rem 0 0}
.warn{border-left:3px solid var(--wait);background:#fff8e6;padding:.7rem .9rem;border-radius:0 6px 6px 0;font-size:.9rem;margin:.75rem 0 0}
.banner{border-left:3px solid var(--accent);background:#f5f8ff;padding:.7rem .9rem;border-radius:0 6px 6px 0;font-size:.9rem;margin:0 0 1rem}

.drop{border:1.5px dashed var(--line);border-radius:8px;padding:1.5rem 1rem;text-align:center;cursor:pointer;transition:.15s}
.drop:hover,.drop.over{border-color:var(--accent);background:var(--soft)}
.drop p{margin:.25rem 0}
ul.files{list-style:none;padding:0;margin:.6rem 0 0}
ul.files li{display:flex;align-items:center;gap:.6rem;padding:.5rem .6rem;border:1px solid var(--line);border-radius:6px}
ul.files .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
ul.files button{border:0;background:0;color:var(--muted);cursor:pointer;font-size:1.1rem;line-height:1;padding:0 .2rem}
ul.files button:hover{color:var(--bad)}

iframe.preview{width:100%;height:40rem;border:1px solid var(--line);border-radius:6px;background:var(--soft)}
.tally{display:flex;gap:1.25rem;flex-wrap:wrap;margin:0 0 1rem;font-size:.9rem}
.tally b{font-size:1.35rem;font-weight:600;display:block;line-height:1.2}
details.written{margin:0 0 1rem}
details.written summary{cursor:pointer;font-weight:600;font-size:.9rem}
/* Step 2 lays the blank form beside its field list, the way a form is read. */
.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:.9rem;align-items:start}
@media (max-width:900px){.split{grid-template-columns:1fr}}
.pane{margin:0;border:1px solid var(--line);border-radius:8px;background:var(--soft);overflow:hidden}
.pane figcaption{padding:.5rem .7rem;font-size:.78rem;font-weight:600;text-transform:uppercase;letter-spacing:.03em;
  color:#555;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:.5rem;align-items:baseline}
.pane figcaption small{font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)}
.pane object{display:block;width:100%;height:34rem;border:0;background:#fff}
.rows{max-height:34rem;overflow:auto;padding:.5rem;display:flex;flex-direction:column;gap:.4rem;background:#fff}
/* One row per box: what it is on the left, what to write in it on the right. */
.box{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr) auto;gap:.5rem;align-items:center;
  padding:.45rem;border:1.5px solid transparent;border-radius:8px;background:var(--soft)}
.box:hover{border-color:var(--line)}
.box.picked{border-color:var(--accent);background:#fff}
.box .name{font-size:.72rem;color:var(--muted);font-family:ui-monospace,monospace;word-break:break-all}
.box input[type=text]{width:100%;font:inherit;font-size:.85rem;padding:.35rem .45rem;border:1px solid var(--line);
  border-radius:6px;background:#fff;color:inherit}
.box input[type=text]:focus{outline:none;border-color:var(--accent)}
.box.off{opacity:.5}
/* A checkbox drawn as a switch: native input, no library. */
.sw{position:relative;width:2.2rem;height:1.25rem;flex:none}
.sw input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer;width:100%;height:100%}
.sw span{position:absolute;inset:0;border-radius:999px;background:#cbd2da;transition:.15s;pointer-events:none}
.sw span::after{content:"";position:absolute;top:.15rem;left:.15rem;width:.95rem;height:.95rem;border-radius:50%;
  background:#fff;transition:.15s}
.sw input:checked + span{background:var(--accent)}
.sw input:checked + span::after{transform:translateX(.95rem)}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600}
button.primary:hover:not(:disabled){filter:brightness(1.08)}
table.written{width:100%;border-collapse:collapse;font-size:.85rem;margin:.6rem 0 0}
table.written th{text-align:left;font-weight:600;color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.03em;padding:.5rem .5rem .25rem;border-bottom:1px solid var(--line)}
table.written td{padding:.3rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}
table.written td.v{padding:.15rem .25rem}
/* Always bordered: a value you are meant to correct should look editable
   before you hover it, not after. */
table.written input{width:100%;font:inherit;font-size:.85rem;color:inherit;background:#fff;
  border:1px solid var(--line);border-radius:6px;padding:.35rem .45rem}
table.written input:hover{border-color:#aab3bd}
table.written input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(37,99,235,.12)}
table.written input.changed{background:#fffbeb;border-color:#f0c36d}
table.written tr:hover td{background:var(--soft)}
.withhelp{display:flex;gap:.35rem;align-items:center}
.withhelp input{flex:1}
table.written td.f small{color:var(--muted);font-weight:400}
.addfield{display:flex;gap:.4rem;margin:.6rem 0 0}
.addfield input{flex:1;font:inherit;padding:.35rem .5rem;border:1px solid var(--line);border-radius:4px}
table.written td.f{width:38%;font-size:.85rem;word-break:break-word}
table.written td.f small{display:block;color:var(--muted);font-family:ui-monospace,monospace;font-size:.72rem;
  font-weight:400;margin-top:.1rem}
table.written td.v{white-space:pre-wrap;word-break:break-word}

.signers .row{margin-bottom:.4rem}
.signers input{flex:1;min-width:8rem}
.signers button{border:0;background:0;color:var(--muted);cursor:pointer;font-size:1.1rem;line-height:1;padding:0 .2rem}
.signers button:hover{color:var(--bad)}

#headline{font-weight:600;margin:0 0 1rem}
table.facts{width:100%;border-collapse:collapse;font-size:.9rem;margin:0 0 1.25rem}
table.facts td{padding:.35rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}
table.facts td.k{width:9rem;color:var(--muted);white-space:nowrap}
table.facts td.v{word-break:break-all}
table.people{width:100%;border-collapse:collapse;font-size:.9rem;margin:0 0 1rem}
table.people th{text-align:left;font-weight:600;color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.03em;padding:.4rem .5rem;border-bottom:1px solid var(--line)}
table.people td{padding:.45rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}
.signed{color:var(--ok)}
.waiting{color:var(--wait)}
details.raw{margin-top:1.25rem}
details.raw summary{cursor:pointer;font-weight:600;font-size:.9rem}
details.trail{margin:0 0 1.25rem;font-size:.85rem}
details.trail summary{cursor:pointer;color:var(--muted)}
details.trail table{width:100%;border-collapse:collapse;margin-top:.6rem}
details.trail td{padding:.2rem .5rem .2rem 0;border-bottom:1px solid var(--line);color:var(--muted);white-space:nowrap}
pre{background:var(--soft);padding:.9rem;border-radius:6px;overflow:auto;white-space:pre-wrap;font-size:12px;margin:.6rem 0 0}
#status{margin:0 0 .5rem;font-weight:600;font-size:.9rem}
ol.log{color:var(--muted);font-size:.85rem;margin:0;padding-left:1.4rem}
ol.log li{padding:.1rem 0}
ol.log li:last-child{color:var(--fg)}
ul.events{list-style:none;padding:0;margin:.5rem 0 0;font-size:.85rem;color:var(--muted)}
a.file{text-decoration:none;padding:.35rem .7rem;border:1px solid var(--line);border-radius:6px;font-size:.85rem}
.docs{display:grid;grid-template-columns:repeat(auto-fit,minmax(19rem,1fr));gap:.9rem;margin-top:.9rem}
.doc{border:1px solid var(--line);border-radius:6px;overflow:hidden;background:var(--soft)}
.doc h3{margin:0;padding:.5rem .7rem;font-size:.8rem;letter-spacing:.02em;text-transform:uppercase;
  color:#555;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:baseline;gap:.5rem}
.doc h3 a{font-size:.78rem;text-transform:none;letter-spacing:0}
.doc object{display:block;width:100%;height:26rem;border:0}
.doc .fallback{padding:1rem;font-size:.85rem}
</style>

<h1>Certificate of insurance</h1>
<p class=sub>Read a policy, write a certificate from it, check it, then send it for signature.</p>

<ol class=steps>
  <li id=s1 class=on><b>1</b> Documents</li>
  <li id=s2><b>2</b> Template</li>
  <li id=s3><b>3</b> Certificate</li>
  <li id=s4><b>4</b> Signers</li>
  <li id=s5><b>5</b> Envelope</li>
</ol>

<section id=step1>
  <h2>1 &middot; Choose the documents</h2>

  <p><small>Both documents are yours to choose. The specimens in
    <code>sample-documents/</code> are a place to start &mdash; one policy to
    read, and blank certificates with and without form fields, in one-signature,
    two-signature and no-signature variants.</small></p>

  <div class=field>
    <label>Policy to read <small>(sent as <code>files</code>)</small></label>
    <div class=drop data-for=policy>
      <p><b>Drop the policy here</b> or click to browse</p>
      <p><small>pdf</small></p>
    </div>
    <input type=file id=policy hidden accept=application/pdf>
    <ul class=files id=policyList></ul>
    <div id=policyMsg></div>
  </div>

  <div class=field>
    <label>Blank form to fill <small>(sent as <code>template</code>)</small></label>
    <div class=drop data-for=template>
      <p><b>Drop the blank form here</b> or click to browse</p>
      <p><small>pdf</small></p>
    </div>
    <input type=file id=template hidden accept=application/pdf>
    <ul class=files id=templateList></ul>
    <div id=templateMsg></div>
    <small>Fields named after the boxes on the page, each with a note saying what belongs in it,
      land values most accurately. A form with no fields works too: the platform finds the places
      to write and names them itself. Where the signatures go is decided later, so a form with
      signature lines and one without both work here.</small>
  </div>

  <label class=opt><input type=checkbox id=editable>
    <span><b>Leave the certificate editable</b>
    <span class=d>Off bakes the values in so nothing can be changed afterwards; on leaves the
    form fillable. Sent as <code>output</code>.</span></span></label>

  <div class=row style="margin-top:1rem">
    <button class=primary id=fill>Fill the certificate</button>
  </div>
  <div id=err1></div>
</section>

<section id=step2 hidden>
  <h2>2 &middot; Configure the template</h2>
  <p><small>What <code>inspect</code> found in the blank form, one row per box.
    Nothing has been drafted yet: this list is saved as a <b>fill config</b>, and
    the labels on it are what the drafting pass reads to decide what belongs
    where. Configure a template once, fill it as often as you like.</small></p>

  <p><small>The second input on each row is <b>guidance</b> for that one box, sent
    as its <code>description</code>. It is where to settle what a printed caption
    leaves open: a form that heads three lines with a single &ldquo;NAME AND
    ADDRESS&rdquo; never says whose, so a run can put the insurer where the broker
    belongs. Writing &ldquo;the broker of record that issues this certificate, not
    the insurer&rdquo; on that box settles it, and it stays with the box rather
    than in a prompt about the form as a whole.</small></p>

  <div id=templateNote class=note></div>

  <div class=split>
    <figure class=pane>
      <figcaption>The blank certificate <small id=paneHint></small></figcaption>
      <object id=templateView type=application/pdf></object>
    </figure>

    <div class=pane>
      <figcaption>What it will be filled from <small>one row per box</small></figcaption>
      <div id=boxRows class=rows></div>
    </div>
  </div>

  <div id=err2></div>
  <div class=row>
    <button class=primary id=configure>Save the configuration and draft</button>
    <button class=ghost id=back1 type=button>Back</button>
  </div>
</section>

<section id=step3 hidden>
  <h2>3 &middot; Check the certificate</h2>
  <p><small>This is what <code>fill</code> produced from the policy. Nothing has gone to anyone
    yet.</small></p>

  <div class=tally id=tally></div>
  <!-- open: reviewing these values IS step 2, so nothing about it should be behind a click. -->
  <details class=written id=written open>
    <summary>What was written into each box</summary>
    <p><small>Straight from the run's <code>output.fields</code>: every field the drafting pass
      filled and the value it put there. Fields the policy didn't answer are simply absent,
      which is why the count is lower than the number of boxes on the form.</small></p>
    <p><small><b>These are editable.</b> Correct anything that came out wrong and apply it: the
      values are written into a fresh copy of the blank form with
      <code>fill</code>'s <code>values</code> mode &mdash; no drafting pass, so the result is
      exactly what you approved. Add a box the policy didn't answer by naming it below.</small></p>
    <p><small><b>Read the amounts against the policy before you send this.</b> A figure standing
      beside its label in a ruled table is read reliably; one in a table drawn without rules is
      not, because the labels and the figures arrive separately and get paired by position. Every
      number still comes from the policy &mdash; it is the pairing that slips, so a limit can land
      on the row above or below its own, and read perfectly plausibly.</small></p>
    <div id=writtenGroups></div>
    <div class=addfield>
      <input id=newField placeholder="field name, e.g. remark_7" spellcheck=false>
      <input id=newValue placeholder="value">
      <button class=ghost id=addField type=button>Add</button>
    </div>
    <div class=row style="margin-top:.6rem">
      <button class=ghost id=applyEdits disabled>Apply edits and re-fill</button>
      <small id=editCount class=d></small>
    </div>
  </details>

  <div id=err3></div>
  <iframe class=preview id=preview title="Filled certificate"></iframe>
  <div class=row style="margin-top:.75rem">
    <button class=primary id=approve>Looks right &mdash; choose signers</button>
    <a class=file id=download href="#" download>Download</a>
    <button class=ghost id=restart>Start again</button>
  </div>
</section>

<section id=step4 hidden>
  <h2>4 &middot; Choose who signs</h2>

  <div class=field>
    <label>Signers <small>(sent as <code>signers</code>, in signing order)</small></label>
    <div class=signers id=signers></div>
    <button class="ghost small" type=button id=addSigner>Add another signer</button>
    <small>They sign in the order listed. Each one gets an email, confirms it with a one-time
      code, then signs by typing their name.</small>
  </div>

  <div class=field>
    <label>Where the signatures go</label>
    <div class=modes>
      <label class=mode><input type=radio name=placement value=tags checked>
        <span><span class=t>On the certificate's own lines</span>
        <span class=d>Each signature lands over the <code>[Signature N]</code> marker waiting for
        it &mdash; signer 1 on <code>[Signature 1]</code>, signer 2 on <code>[Signature 2]</code>,
        matched by position. Sent as <code>placement: "tags"</code>.</span></span></label>
      <label class=mode><input type=radio name=placement value=page>
        <span><span class=t>On a page added at the end</span>
        <span class=d>The lines are left alone and a page listing every signature is appended
        instead, so any number of people can sign &mdash; up to 50. Sent as
        <code>placement: "page"</code>.</span></span></label>
    </div>
    <small id=placementNote></small>
  </div>
  <div id=tagmsg></div>

  <div class=field>
    <label for=message>Note in the invitation email <small>(sent as <code>message</code>)</small></label>
    <input type=text id=message placeholder="Leave blank to use the default in app.ts.">
  </div>

  <div class=banner>${
    local
      ? `<b>The envelope will be polled.</b> Signing waits on people, so the sign call returns
         as soon as the envelope exists and this page asks for its state every few seconds.
         Open this page through a tunnel and each run's events are delivered to a signed
         callback as well.`
      : `<b>Events will be delivered too.</b> This page is open at <code>${host}</code>, so each
         run also posts its events to <code>${host}/webhook/&lt;id&gt;</code> as they happen,
         alongside the polling.`
  }</div>

  <div class=row style="margin-top:1rem">
    <button class=primary id=send>Send for signature</button>
    <button class=ghost id=back>Back to the certificate</button>
  </div>
  <div id=err4></div>
</section>

<!-- Kept separate so it stays visible once the envelope appears. -->
<section id=progress hidden>
  <h2 id=stageHead>Progress</h2>
  <p id=status></p>
  <div id=files class=docs></div>
  <!-- Both lists are detail, not headline: open while the run moves, folded
       away once it has finished so the result is what you see. -->
  <details id=logWrap class=trail><summary id=logSummary>Steps</summary>
    <ol class=log id=log></ol>
  </details>
  <details id=events class=trail hidden><summary id=eventSummary>Webhook deliveries</summary>
    <ul class=events id=eventList></ul>
  </details>
</section>

<section id=step5 hidden>
  <h2>5 &middot; Envelope</h2>
  <div id=err5></div>
  <p id=headline></p>
  <table class=facts><tbody id=facts></tbody></table>
  <table class=people>
    <thead><tr><th>Order<th>Signer<th>Status<th></tr></thead>
    <tbody id=people></tbody>
  </table>
  <details class=trail><summary>Audit trail</summary>
    <table><tbody id=trail></tbody></table>
  </details>
  <div class=row id=voidRow hidden>
    <button class="ghost small" id=voidBtn>Cancel this envelope</button>
  </div>
  <details class=raw><summary>Raw envelope</summary>
    <pre id=raw></pre>
  </details>
  <div class=row style="margin-top:1.25rem"><button class=ghost id=again>Start another</button></div>
</section>

<script>
/** A signer array is capped at 50 by the API. */
const MAX_SIGNERS = 50;

/** Where the signatures go, chosen in step 3. */
const placement = () => document.querySelector('input[name=placement]:checked').value;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const note = (id, cls, html) => { $(id).innerHTML = html ? '<div class=' + cls + '>' + html + '</div>' : ''; };

function step(n) {
  for (const i of [1, 2, 3, 4, 5]) {
    $('step' + i).hidden = i !== n;
    $('s' + i).classList.toggle('on', i === n);
  }
}

let id, timer;
/** The inspected field list, and whether its rows have been drawn yet. */
let templateFields = [], boxesShown = false, pickedRow = -1;

/** Mark a row as the one being edited, and show the page it belongs to. */
function pick(i) {
  if (i === pickedRow) return;
  pickedRow = i;
  for (const row of $('boxRows').querySelectorAll('.box')) {
    row.classList.toggle('picked', Number(row.dataset.row) === i);
  }
  const page = templateFields[i] && templateFields[i].page;
  const view = $('templateView');
  // #page is the one navigation an embedded PDF viewer honours natively.
  if (view.data && typeof page === 'number') {
    const base = view.data.split('#')[0];
    view.data = base + '#page=' + (page + 1);
  }
}
/** The documents currently embedded, so a poll that changes nothing leaves them alone. */
let shownDocs = null;
/** What fill last reported, so an edit can be compared against it. */
let drafted = {};
/**
 * Helpers for the boxes a policy cannot answer, because they belong to the
 * certificate being issued rather than to the cover. The drafting pass is told
 * to leave them empty; they are offered in the review instead, and written by
 * the values mode of fill, so no model guesses at a date.
 *
 * Matched on what the box IS rather than what it is called. A form that declares
 * its fields names this one "date_issued"; a detected one calls it
 * "textbox_0_7". The label from step 2 is the only thing common to both.
 */
const REQUEST_HELPERS = [
  { match: /date\\s*issued/i, help: 'Today', value: () => new Date().toISOString().slice(0, 10) },
];

/**
 * The signature LINES, which signing fills: a name written into one would sit
 * under the stamp. The name-and-title boxes beside them stay fillable — the
 * sender knows who they are sending it to.
 *
 * Written out rather than as a regular expression on purpose. This whole script
 * is emitted from a template literal, and an escape in one — a backslash-b word
 * boundary included — is resolved before the browser ever sees it.
 */
const signedLater = (label) => {
  const l = String(label || '').toLowerCase();
  return l.startsWith('signature') || l.startsWith('[signature') ||
    l.includes('authorized representative') || l.includes('countersign');
};

/** Fields added by hand that the drafting pass left empty. */
let extras = {};

/* ── step 1: fill ────────────────────────────────────────────────────────── */

const KB = (n) => n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

/** One drop area and its hidden input. Both documents are required. */
function picker(name) {
  const drop = document.querySelector('.drop[data-for=' + name + ']');
  const input = $(name);
  const list = $(name + 'List');
  let chosen = null;

  const render = () => {
    list.innerHTML = chosen
      ? '<li><span class=name>' + esc(chosen.name) + '</span><small>' + KB(chosen.size) +
        '</small><button type=button title=Remove>&times;</button></li>'
      : '';
    const remove = list.querySelector('button');
    if (remove) remove.onclick = () => { chosen = null; render(); };
  };

  const take = (files) => {
    const file = files && files[0];
    if (!file) return;
    // The accept attribute is only a picker filter — a dropped file bypasses it.
    if (!/\\.pdf$/i.test(file.name)) {
      note(name + 'Msg', 'warn', esc(file.name) + ' is not a PDF.');
      return;
    }
    note(name + 'Msg', 'warn', '');
    chosen = file;
    input.value = '';       // so picking the same file again still fires change
    render();
  };

  drop.onclick = () => input.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files); };
  input.onchange = () => take(input.files);

  return () => chosen;
}
const policyFile = picker('policy');
const templateFile = picker('template');

$('fill').onclick = async () => {
  if (!policyFile() || !templateFile()) {
    note('err1', 'err', 'Choose both a policy to read and a blank form to fill.');
    return;
  }
  const body = new FormData();
  body.set('policy', policyFile());
  body.set('template', templateFile());
  body.set('output', $('editable').checked ? 'editable' : 'flattened');

  $('fill').disabled = true;
  $('progress').hidden = false;
  $('status').textContent = 'filling…';
  note('err1', 'err', '');

  const res = await fetch('/inspect', { method: 'POST', body });
  if (!res.ok) {
    note('err1', 'err', esc(await res.text()));
    $('fill').disabled = false;
    return;
  }
  id = (await res.json()).id;
  timer = setInterval(poll, 3000);
  poll();
};

/* ── step 3: look at what came back ─────────────────────────────────────── */

$('approve').onclick = () => { step(4); describePlacement(); };
$('restart').onclick = () => location.reload();
$('back').onclick = () => step(3);

/* ── step 4: signers ────────────────────────────────────────────────────── */

function signerRow() {
  const row = document.createElement('div');
  row.className = 'row signer';
  row.innerHTML = '<input type=text class=n placeholder="Full name">' +
    '<input type=email class=e placeholder="name@example.com">' +
    '<button type=button title="Remove">&times;</button>';
  row.querySelector('button').onclick = () => { row.remove(); describePlacement(); };
  $('signers').append(row);
  for (const i of row.querySelectorAll('input')) i.oninput = describePlacement;
  describePlacement();
}
$('addSigner').onclick = signerRow;

const signerList = () => [...document.querySelectorAll('.signer')]
  .map((r) => ({ name: r.querySelector('.n').value.trim(), email: r.querySelector('.e').value.trim() }))
  .filter((s) => s.name && s.email);

/**
 * Nothing here counts the markers in the document — the person who chose the
 * form knows what is in it. This just says what signing on the lines needs.
 */
function describePlacement() {
  const n = Math.max(1, document.querySelectorAll('.signer').length);
  $('placementNote').innerHTML = placement() === 'tags'
    ? 'Check the form you filled carries <code>[Signature 1]</code>' +
      (n > 1 ? ' through <code>[Signature ' + n + ']</code>' : '') +
      ' — one marker per signer, numbered in the order listed. A signer with no marker fails ' +
      'the run. Each stamp grows upwards from its marker into the space the page leaves free, ' +
      'so leave room above the lines.'
    : 'Nothing needs to be prepared in the document: the signatures go on a page appended at ' +
      'the end, up to ' + MAX_SIGNERS + ' of them.';
  tagWarning();
}

/** The only ceiling that is ours to enforce is the one the API sets. */
function tagWarning() {
  const n = document.querySelectorAll('.signer').length;
  note('tagmsg', 'warn', n > MAX_SIGNERS
    ? n + ' signers — the most an envelope takes is ' + MAX_SIGNERS + '.'
    : '');
}
for (const r of document.querySelectorAll('input[name=placement]')) r.onchange = describePlacement;

// One row to start with, now that everything it touches exists.
signerRow();

$('send').onclick = async () => {
  const signers = signerList();
  if (!signers.length) {
    note('err3', 'err', 'Add at least one signer with a name and an email.');
    return;
  }
  note('err3', 'err', '');
  const body = new FormData();
  body.set('signers', JSON.stringify(signers));
  body.set('placement', placement());
  body.set('message', $('message').value.trim());

  $('send').disabled = true;
  const res = await fetch('/job/' + id + '/sign', { method: 'POST', body });
  if (!res.ok) {
    note('err3', 'err', esc(await res.text()));
    $('send').disabled = false;
    return;
  }
  timer = setInterval(poll, 3000);
  poll();
};

/* ── polling ────────────────────────────────────────────────────────────── */

/**
 * A produced document, shown rather than linked. The heading names the ROLE:
 * the API's own filenames end "(filled).pdf" and "(filled) (signed).pdf", which
 * are near-identical at a glance. An object element renders the PDF inline and
 * keeps the link as its fallback, so a browser with no PDF viewer still gets
 * the file.
 */
const fileCard = (f, title) => f && f.url
  ? '<div class=doc><h3>' + esc(title) +
    '<a href="' + esc(f.url) + '" download>Download</a></h3>' +
    '<object type=application/pdf data="' + esc(f.url) + '" title="' + esc(title) + '">' +
    '<p class=fallback>' + esc(f.name) + ' &mdash; ' +
    '<a href="' + esc(f.url) + '" download>download it</a> to view.</p>' +
    '</object></div>'
  : '';

const STATUS = {
  inspecting: 'reading the template…',
  inspected: 'template read — configure it',
  filling: 'filling…',
  filled: 'certificate ready',
  signing: 'waiting on the signers…',
  done: 'finished',
};

/**
 * Wire the value inputs after a rebuild. A change is measured against what fill
 * reported, so reverting a cell by hand un-marks it and the apply button goes
 * back to disabled — nothing is "edited" just because it was clicked into.
 */
function wireEdits() {
  const inputs = () => document.querySelectorAll('#writtenGroups input[data-field]');
  const refresh = () => {
    let changed = 0;
    for (const el of inputs()) {
      const dirty = el.value !== (drafted[el.dataset.field] ?? '');
      el.classList.toggle('changed', dirty);
      if (dirty) changed++;
    }
    const added = Object.keys(extras).length;
    $('applyEdits').disabled = changed + added === 0;
    $('editCount').textContent = changed + added
      ? changed + ' changed' + (added ? ', ' + added + ' added' : '')
      : '';
  };
  for (const el of inputs()) el.oninput = refresh;
  for (const b of document.querySelectorAll('#writtenGroups button[data-suggest]')) {
    b.onclick = () => {
      const el = document.querySelector('#writtenGroups input[data-field="' + b.dataset.suggest + '"]');
      if (!el) return;
      const row = el.closest('tr');
      const label = row ? row.querySelector('.f').textContent : '';
      const helper = REQUEST_HELPERS.find((h) => h.match.test(label));
      if (helper) el.value = helper.value();
      refresh();
    };
  }
  refresh();
}

/** Everything the re-fill should write: what is in the boxes now, plus additions. */
function editedValues() {
  const out = { ...drafted, ...extras };
  for (const el of document.querySelectorAll('#writtenGroups input[data-field]')) {
    out[el.dataset.field] = el.value;
  }
  return out;
}

$('addField').onclick = () => {
  const field = $('newField').value.trim();
  const value = $('newValue').value;
  if (!field) return;
  extras[field] = value;
  $('newField').value = '';
  $('newValue').value = '';
  // Shown as a group of its own so an addition is visibly not from the policy.
  let box = document.getElementById('addedGroup');
  if (!box) {
    box = document.createElement('table');
    box.id = 'addedGroup';
    box.className = 'written';
    box.innerHTML = '<thead><tr><th colspan=2>Added by hand</th></tr></thead><tbody></tbody>';
    $('writtenGroups').append(box);
  }
  const row = box.querySelector('tbody').insertRow();
  row.innerHTML = '<td class=f>' + esc(field) +
    '<td class=v><input class=changed data-field="' + esc(field) + '" value="' + esc(value) + '" spellcheck=false>';
  wireEdits();
};

$('applyEdits').onclick = async () => {
  $('applyEdits').disabled = true;
  const res = await fetch('/job/' + id + '/values', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ values: editedValues() }),
  });
  if (!res.ok) { note('err2', 'err', esc(await res.text())); $('applyEdits').disabled = false; return; }
  note('err2', 'err', '');
  // Re-filling puts the job back to 'filling', so pick the polling back up.
  clearInterval(timer);
  timer = setInterval(poll, 3000);
  poll();
};

async function poll() {
  const job = await (await fetch('/job/' + id)).json();

  const steps = job.log || [];
  const running = job.stage !== 'done' && !job.error;
  $('log').innerHTML = steps.map((l) => '<li>' + esc(l) + '</li>').join('');
  $('logSummary').textContent = steps.length ? 'Steps (' + steps.length + ')' : 'Steps';
  // Open while the run is moving, folded once it is not: the outcome is the
  // headline, the step list is only interesting when you are waiting on it.
  $('logWrap').open = running;
  $('status').textContent = job.error ? 'stopped' : (STATUS[job.stage] ?? job.stage ?? '');

  const target = job.stage === 'inspecting' ? 'err1'
    : job.stage === 'inspected' || job.stage === 'filling' ? 'err2'
    : job.envelope ? 'err5' : 'err4';
  for (const box of ['err1', 'err2', 'err3', 'err4', 'err5']) note(box, 'err', '');
  if (job.error) note(target, 'err', esc(job.error));

  // Once it has gone for signature the signed copy is the answer, and the
  // unsigned one is step 2's business — showing both invites reading the wrong
  // one. Rebuilt only when the set actually changes: assigning innerHTML on
  // every 3s tick tears down the embedded viewers and they visibly reload.
  const docs = [
    job.signRunId ? '' : fileCard(job.certificate, 'Certificate'),
    fileCard(job.signed, 'Signed certificate'),
  ].filter(Boolean).join('');
  if (docs !== shownDocs) {
    shownDocs = docs;
    $('files').innerHTML = docs;
  }
  const events = job.events || [];
  $('events').hidden = !events.length;
  $('eventSummary').textContent = 'Webhook deliveries (' + events.length + ')';
  $('eventList').innerHTML = events.map((e) => '<li>' + esc(e) + '</li>').join('');

  // What fill wrote, beside the PDF, so the result can be read as data.
  const f = job.fill;
  if (f) {
    // The group count is one per part of the form, not per box — calling it
    // "boxes touched" read as though only four boxes had been filled.
    const empty = (job.template?.fields || []).length - f.count;
    $('tally').innerHTML =
      '<span><b>' + f.count + '</b>values written</span>' +
      '<span><b>' + f.groups.length + '</b>' + (f.groups.length === 1 ? 'part of the form' : 'parts of the form') + '</span>' +
      (job.template ? '<span><b>' + empty + '</b>' + (empty === 1 ? 'box left empty' : 'boxes left empty') + '</span>' : '');
    // Rebuilt only when fill reports a different set: assigning innerHTML on a
    // poll tick would discard whatever the reviewer is halfway through typing.
    const signature = JSON.stringify(job.filled || {});
    if (signature !== JSON.stringify(drafted)) {
      drafted = JSON.parse(signature);
      extras = {};
      // A box the template has but the draft left empty: the issuer's own
      // references, which no policy can supply. Offered here rather than guessed
      // at during drafting.
      const empties = (job.template?.fields ?? []).filter(
        (f) => !f.ignore && !(f.name in (job.filled || {})) && !signedLater(f.label || f.name),
      );
      const requestRows = empties.map((f) => {
        const label = f.label || f.name;
        const helper = REQUEST_HELPERS.find((h) => h.match.test(label));
        return '<tr><td class=f>' + esc(label) + '<br><small>' + esc(f.name) + '</small>' +
          '<td class=v><span class=withhelp>' +
          '<input data-field="' + esc(f.name) + '" value="' + esc(drafted[f.name] ?? '') + '" spellcheck=false>' +
          (helper ? '<button class="ghost small" type=button data-suggest="' + esc(f.name) + '">' + esc(helper.help) + '</button>' : '') +
          '</span></tr>';
      }).join('');
      $('writtenGroups').innerHTML =
        (requestRows
          ? '<table class=written><thead><tr><th colspan=2>' +
            'Boxes the policy did not answer &mdash; yours to fill' +
            '</th></tr></thead><tbody>' + requestRows + '</tbody></table>'
          : '') +
        f.groups.map((g) =>
        '<table class=written><thead><tr><th colspan=2>' + esc(g.title) + '</th></tr></thead><tbody>' +
        g.rows.map((r) =>
          '<tr><td class=f>' + esc(r.label) +
          (r.label === r.field ? '' : '<br><small>' + esc(r.field) + '</small>') +
          '<td class=v><input data-field="' + esc(r.field) + '" value="' + esc(r.value) + '" spellcheck=false>' +
          '</tr>').join('') +
        '</tbody></table>').join('');
      wireEdits();
    }
  }

  // The filled certificate comes with a link served inline, so it can be read
  // here before anyone is invited to sign it.
  const cert = job.certificate;
  if (cert && cert.url) {
    if ($('preview').src !== cert.url) {
      $('preview').src = cert.url;
      $('download').href = cert.url;
      $('download').textContent = 'Download ' + cert.name;
    }
    // Move on as soon as there is something to look at. Only from the configure
    // step, so clicking ahead to the signers isn't undone by the next poll.
    if (!job.signRunId && !$('step2').hidden) step(3);
  }

  const r = job.review;
  if (r) {
    step(5);
    $('headline').textContent = r.headline;
    $('facts').innerHTML = r.facts
      .map((x) => '<tr><td class=k>' + esc(x.label) + '<td class=v>' + esc(x.value) + '</tr>').join('');
    $('people').innerHTML = r.signers.map((s) =>
      '<tr><td>' + s.position +
      '<td>' + esc(s.name) + '<br><small>' + esc(s.email) + '</small>' +
      '<td class=' + (s.signed ? 'signed' : 'waiting') + '>' + esc(s.detail) +
      '<td>' + (s.signed ? '' : '<button class="ghost small" type=button data-signer="' + esc(s.id) + '">Send again</button>') +
      '</tr>').join('');
    for (const b of $('people').querySelectorAll('button[data-signer]')) b.onclick = () => resend(b.dataset.signer);
    $('trail').innerHTML = r.trail.map((t) =>
      '<tr><td>' + esc(t.when) + '<td>' + esc(t.what) + '<td>' + esc(t.who) + '<td>' + esc(t.where) + '</tr>').join('');
    $('raw').textContent = JSON.stringify(job.envelope, null, 2);
    // POST /void answers 409 once the envelope is finalizing or done, so only
    // offer the button while it can still succeed.
    $('voidRow').hidden = !r.cancellable;
  }

  // What the template offers, once inspect has answered. Rendered once: the rows
  // are inputs, and rebuilding them under a cursor would discard an edit.
  if (job.template && !boxesShown) {
    boxesShown = true;
    templateFields = job.template.fields;
    const kind = job.template.detected
      ? 'This form declares no fields, so the boxes below were <b>found by the detector</b> and labelled from the text printed beside them. That label is the only thing saying what belongs in a box, so it is worth reading.'
      : 'This form <b>declares its own fields</b>, so the labels below come from the form itself and are already accurate.';
    note('templateNote', 'note', kind + ' ' + templateFields.length + ' box(es) in all.');
    if (job.templateUrl) $('templateView').data = job.templateUrl;
    $('paneHint').textContent = job.template.pageCount ? job.template.pageCount + ' page(s)' : '';

    // One row per box. The switch decides whether the box gets filled at all;
    // the two inputs are what the drafting pass reads.
    for (const f of templateFields) {
      if (signedLater(f.label || f.name)) f.ignore = true;
    }
    $('boxRows').innerHTML = templateFields.map((f, i) =>
      '<div class=box data-row=' + i + (f.ignore ? ' off' : '') + '>' +
        '<div><div>' + esc(f.label || f.name) + '</div>' +
        '<div class=name>' + esc(f.name) + (f.section ? ' &middot; ' + esc(f.section) : '') + '</div></div>' +
        '<div><input type=text data-label=' + i + ' value="' + esc(f.label ?? '') + '" placeholder="What this box is" spellcheck=false>' +
        '<input type=text data-desc=' + i + ' value="' + esc(f.description ?? '') + '" placeholder="Guidance for filling this field" spellcheck=false style="margin-top:.3rem"></div>' +
        '<label class=sw><input type=checkbox data-keep=' + i + (f.ignore ? '' : ' checked') + '><span></span></label>' +
      '</div>'
    ).join('');

    for (const row of $('boxRows').querySelectorAll('.box')) {
      // Selecting a row marks it, and moves the viewer to the page it sits on.
      // A precise box outline would need the PDF rendered by hand; the page jump
      // is what a plain <object> viewer can be asked for.
      row.onclick = (e) => {
        if (e.target.matches('input')) return;
        pick(Number(row.dataset.row));
      };
      const keep = row.querySelector('[data-keep]');
      keep.onchange = () => row.classList.toggle('off', !keep.checked);
      for (const input of row.querySelectorAll('input[type=text]')) {
        input.onfocus = () => pick(Number(row.dataset.row));
      }
    }
    step(2);
  }

  // Stop polling whenever nothing is moving — mid-flow the next step is a click.
  // A send that failed leaves the job at 'filled', so Send is live again.
  if (job.stage === 'inspected') clearInterval(timer);
  if (job.stage === 'filled' || job.stage === 'done') {
    clearInterval(timer);
    if (job.error) { $('fill').disabled = false; $('send').disabled = false; }
  }
}

async function resend(signerId) {
  const res = await fetch('/job/' + id + '/resend?signer=' + encodeURIComponent(signerId), { method: 'POST' });
  if (!res.ok) note('err4', 'err', esc(await res.text()));
  poll();
}

$('voidBtn').onclick = async () => {
  if (!confirm('Cancel this envelope? Nobody else will be able to sign it.')) return;
  const res = await fetch('/job/' + id + '/void', { method: 'POST' });
  if (!res.ok) note('err4', 'err', esc(await res.text()));
  poll();
};

$('configure').onclick = async () => {
  $('configure').disabled = true;
  // Read the rows back: a label the platform got wrong is worth more corrected
  // than a value fixed later, since the label is what decides the box.
  const fields = templateFields.map((f, i) => ({
    ...f,
    label: $('boxRows').querySelector('[data-label="' + i + '"]').value.trim() || undefined,
    description: $('boxRows').querySelector('[data-desc="' + i + '"]').value.trim() || undefined,
    ignore: !$('boxRows').querySelector('[data-keep="' + i + '"]').checked,
  }));
  const res = await fetch('/job/' + id + '/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    note('err2', 'err', esc(await res.text()));
    $('configure').disabled = false;
    return;
  }
  timer = setInterval(poll, 3000);
  poll();
};

$('back1').onclick = () => step(1);

$('again').onclick = () => location.reload();
</script>
`;
