/**
 * Demo UI (single static page, no external assets).
 *
 * SECURITY: the page contains no agent names or endpoints — it fetches the
 * discovered agents and routing results live from the router API. The CLI/API
 * remains the source of truth; this page is a convenience for demos.
 */
export const DEMO_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ENS AI Agent Router</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; background: #0b0e14; color: #e6e6e6;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    display: flex; flex-direction: column; align-items: center; padding: 32px 16px;
  }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
  .sub { color: #8b93a7; font-size: 12px; margin-bottom: 24px; }
  .card {
    width: 100%; max-width: 760px; background: #11151f; border: 1px solid #1e2433;
    border-radius: 12px; padding: 20px; margin-bottom: 16px;
  }
  .row { display: flex; gap: 8px; }
  input[type=text] {
    flex: 1; background: #0b0e14; border: 1px solid #2a3245; color: #e6e6e6;
    border-radius: 8px; padding: 10px 12px; font: inherit; font-size: 14px;
  }
  button {
    background: #2563eb; border: none; color: white; border-radius: 8px;
    padding: 10px 18px; font: inherit; font-size: 14px; cursor: pointer;
  }
  button:disabled { opacity: .5; cursor: wait; }
  .examples { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .examples button { background: #1a2130; color: #9db4ff; padding: 6px 10px; font-size: 12px; }
  .pipeline { display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
  .step { display: flex; gap: 10px; align-items: baseline; }
  .step .label { color: #8b93a7; min-width: 150px; }
  .badge {
    display: inline-block; background: #1a2130; border: 1px solid #2a3245;
    border-radius: 999px; padding: 2px 10px; font-size: 12px; color: #c7d2fe;
  }
  .badge.ok { border-color: #14532d; background: #052e16; color: #86efac; }
  .badge.warn { border-color: #713f12; background: #422006; color: #fcd34d; }
  .badge.err { border-color: #7f1d1d; background: #450a0a; color: #fca5a5; }
  .agents { display: flex; flex-wrap: wrap; gap: 6px; }
  .answer { white-space: pre-wrap; line-height: 1.5; font-size: 13px; }
  .muted { color: #8b93a7; }
  a { color: #9db4ff; }
  .error { color: #fca5a5; font-size: 13px; white-space: pre-wrap; }
</style>
</head>
<body>
  <h1>ENS AI Agent Router</h1>
  <div class="sub">specialist agents discovered at runtime from live ENS records on Sepolia</div>

  <div class="card">
    <div class="row">
      <input id="message" type="text" placeholder="Ask something&hellip; e.g. Which invoice is overdue?" />
      <button id="route">Route</button>
    </div>
    <div class="examples">
      <button data-q="Which invoice is overdue?">invoice</button>
      <button data-q="Can you explain the termination clause in this contract?">contract</button>
      <button data-q="Write a concise premium tagline for our design studio.">brand</button>
      <button data-q="What's the weather in Mumbai tomorrow?">no match</button>
    </div>
  </div>

  <div class="card">
    <div class="pipeline">
      <div class="step"><span class="label">Discovered agents</span><span id="discovered" class="agents muted">loading from ENS&hellip;</span></div>
      <div class="step"><span class="label">Routing</span><span id="routing" class="badge warn">idle</span></div>
      <div class="step"><span class="label">Selected agent</span><span id="selected" class="muted">&mdash;</span></div>
      <div class="step"><span class="label">ENS attribution</span><span id="attribution" class="muted">&mdash;</span></div>
      <div class="step"><span class="label">Answer</span></div>
    </div>
    <div id="answer" class="answer muted">Ask a question to see the full routing pipeline.</div>
  </div>

  <div class="card muted" style="font-size: 12px;">
    Pipeline: ENS directory &rarr; validated agents &rarr; LLM decision (membership-checked in code) &rarr; ENS-derived endpoint (explicit timeout) &rarr; answer + attribution.
    Endpoints: <a href="/agents">/agents</a> &middot; <a href="/routing-log">/routing-log</a> &middot; <a href="/health">/health</a>
  </div>

<script>
  const $ = (id) => document.getElementById(id);

  async function refreshAgents() {
    try {
      const res = await fetch('/agents');
      const data = await res.json();
      const el = $('discovered');
      el.classList.remove('muted');
      el.innerHTML = '';
      if (!data.agents || data.agents.length === 0) {
        el.innerHTML = '<span class="badge err">no valid agents discovered from ENS</span>';
        return;
      }
      for (const agent of data.agents) {
        const badge = document.createElement('span');
        badge.className = 'badge ok';
        badge.textContent = agent.id + ' (' + agent.ensName + ')';
        badge.title = agent.description;
        el.appendChild(badge);
      }
      if (data.skipped && data.skipped.length > 0) {
        const warn = document.createElement('span');
        warn.className = 'badge warn';
        warn.textContent = data.skipped.length + ' skipped';
        warn.title = data.skipped.map(s => s.ensName + ': ' + s.reason).join('\\n');
        el.appendChild(warn);
      }
    } catch {
      $('discovered').innerHTML = '<span class="badge err">router unreachable</span>';
    }
  }

  async function route(message) {
    $('route').disabled = true;
    $('routing').textContent = 'asking the routing model&hellip;';
    $('routing').className = 'badge warn';
    $('selected').textContent = '—';
    $('selected').className = 'muted';
    $('attribution').textContent = '—';
    $('attribution').className = 'muted';
    $('answer').textContent = '…';
    try {
      const res = await fetch('/route', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (data.status === 'answered') {
        $('routing').textContent = 'answered';
        $('routing').className = 'badge ok';
        $('selected').textContent = data.attribution.displayName + ' [' + data.attribution.agentId + ']';
        $('selected').className = '';
        $('attribution').textContent = data.attribution.ensName + ' → ' + data.attribution.endpoint;
        $('attribution').className = '';
        $('answer').textContent = data.answer;
      } else {
        $('routing').textContent = data.status;
        $('routing').className = 'badge ' + (data.status === 'no_suitable_agent' ? 'warn' : 'err');
        $('answer').textContent = (data.message || data.status) + (data.detail ? '\\n\\nDetail: ' + data.detail : '');
      }
    } catch (err) {
      $('routing').textContent = 'request failed';
      $('routing').className = 'badge err';
      $('answer').textContent = String(err);
    } finally {
      $('route').disabled = false;
    }
  }

  $('route').addEventListener('click', () => {
    const message = $('message').value.trim();
    if (message) route(message);
  });
  $('message').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('route').click();
  });
  document.querySelectorAll('.examples button').forEach((b) => {
    b.addEventListener('click', () => {
      $('message').value = b.dataset.q;
      route(b.dataset.q);
    });
  });

  refreshAgents();
</script>
</body>
</html>
`;
