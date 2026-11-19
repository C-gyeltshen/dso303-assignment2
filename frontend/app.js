/* Single-page app: Cognito Hosted UI sign-in (auth code + PKCE), hash routing, no build step. */
(() => {
  'use strict';
  const cfg = window.APP_CONFIG;
  const app = document.getElementById('app');
  const redirectUri = location.origin + '/';
  const AUTOSAVE_MS = 30000;
  let autosaveTimer = null;
  let clockTimer = null;

  // ---------------- helpers ----------------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');
  const setStatus = (t, cls = 'muted') => { document.getElementById('status').innerHTML = `<span class="${cls}">${esc(t)}</span>`; };
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // ---------------- auth ----------------
  const tokens = () => JSON.parse(sessionStorage.getItem('tokens') || 'null');
  const claims = () => { const t = tokens(); return t ? JSON.parse(atob(t.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) : null; };
  const groups = () => claims()?.['cognito:groups'] || [];
  const is = (g) => groups().includes(g);

  async function login() {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    sessionStorage.setItem('pkce', JSON.stringify({ verifier, state, returnTo: location.hash }));
    const q = new URLSearchParams({ response_type: 'code', client_id: cfg.userPoolClientId, redirect_uri: redirectUri,
      scope: 'openid email profile', code_challenge_method: 'S256', code_challenge: challenge, state });
    location.assign(`${cfg.cognitoDomain}/oauth2/authorize?${q}`);
  }

  async function tokenRequest(params) {
    const r = await fetch(`${cfg.cognitoDomain}/oauth2/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.userPoolClientId, ...params }),
    });
    if (!r.ok) throw new Error('Sign-in failed');
    const t = await r.json();
    t.expires_at = Date.now() + t.expires_in * 1000;
    if (!t.refresh_token) t.refresh_token = tokens()?.refresh_token;
    sessionStorage.setItem('tokens', JSON.stringify(t));
  }

  async function handleRedirect() {
    const p = new URLSearchParams(location.search);
    if (!p.get('code')) return;
    const saved = JSON.parse(sessionStorage.getItem('pkce') || '{}');
    if (p.get('state') !== saved.state) throw new Error('Invalid sign-in state');
    await tokenRequest({ grant_type: 'authorization_code', code: p.get('code'), redirect_uri: redirectUri, code_verifier: saved.verifier });
    sessionStorage.removeItem('pkce');
    history.replaceState(null, '', '/' + (saved.returnTo || '#/'));
  }

  function logout() {
    sessionStorage.clear();
    location.assign(`${cfg.cognitoDomain}/logout?client_id=${cfg.userPoolClientId}&logout_uri=${encodeURIComponent(redirectUri)}`);
  }

  async function idToken() {
    let t = tokens();
    if (t && Date.now() > t.expires_at - 60000 && t.refresh_token) {
      await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
      t = tokens();
    }
    return t?.id_token;
  }

  async function api(method, path, body) {
    const r = await fetch(`${cfg.apiBase || ''}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${await idToken()}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) { await login(); throw new Error('Session expired'); }
    if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status });
    return data;
  }

  // ---------------- views ----------------
  const views = {};

  views.home = async () => {
    const exams = await api('GET', '/exams');
    const staff = is('tutors') || is('admins');
    app.innerHTML = `<div class="card"><h2>Exams</h2>${staff ? '<p><a class="btn" href="#/exams/new">+ New exam</a></p>' : ''}
      <table><tr><th>Exam</th><th>Window</th><th>Duration</th><th></th></tr>
      ${exams.map((e) => `<tr><td>${esc(e.title)}<br><span class="muted">${esc(e.course || '')}</span></td>
        <td>${fmt(e.opens_at)} →<br>${fmt(e.closes_at)}</td><td>${e.duration_mins} min</td>
        <td>${staff ? `<a href="#/exams/${e.id}/attempts">Attempts</a>${e.results_released ? ' <span class="ok">released</span>' : ''}`
          : e.attempt_status && e.attempt_status !== 'in_progress' ? '<span class="ok">Submitted</span>'
          : `<a class="btn" href="#/exams/${e.id}/take">${e.attempt_id ? 'Resume' : 'Start'}</a>`}</td></tr>`).join('')}
      </table></div>`;
  };

  views.take = async (examId) => {
    const data = await api('POST', `/exams/${examId}/start`);
    const { attempt, questions, exam } = data;
    const skew = new Date(data.serverTime).getTime() - Date.now();
    const key = `attempt-${attempt.id}`;
    const local = JSON.parse(localStorage.getItem(key) || 'null');
    // Prefer whichever copy is newer: local copy survives network loss / server failover.
    let state = local && local.seq > attempt.client_seq ? local : { answers: attempt.answers, seq: attempt.client_seq };
    let dirty = state !== local ? false : true;

    app.innerHTML = `<div class="timer"><strong>${esc(exam.title)}</strong><span id="clock"></span><span id="saved" class="muted"></span></div>
      <form id="exam">${questions.map((q, i) => `<div class="card"><h3>Q${i + 1}. ${esc(q.text)} <span class="muted">(${q.marks} marks)</span></h3>
        ${q.type === 'mcq'
          ? q.options.map((o, j) => `<label class="option"><input type="radio" name="q${q.id}" value="${j}" ${String(state.answers[q.id]) === String(j) ? 'checked' : ''}>${esc(o)}</label>`).join('')
          : `<textarea name="q${q.id}">${esc(state.answers[q.id] || '')}</textarea>`}</div>`).join('')}
        <button type="submit">Submit exam</button></form>`;

    const form = document.getElementById('exam');
    const collect = () => {
      const a = {};
      for (const q of questions) {
        const el = form.elements[`q${q.id}`];
        const v = q.type === 'mcq' ? [...form.querySelectorAll(`[name=q${q.id}]`)].find((x) => x.checked)?.value : el.value;
        if (v !== undefined && v !== '') a[q.id] = q.type === 'mcq' ? Number(v) : v;
      }
      return a;
    };
    form.addEventListener('input', () => {
      state = { answers: collect(), seq: state.seq + 1 };
      localStorage.setItem(key, JSON.stringify(state));
      dirty = true;
      document.getElementById('saved').textContent = 'Unsaved changes';
    });

    const save = async () => {
      if (!dirty) return;
      const snapshot = { ...state };
      try {
        const r = await api('PUT', `/attempts/${attempt.id}/answers`, { answers: snapshot.answers, clientSeq: snapshot.seq });
        if (state.seq === snapshot.seq) dirty = false;
        document.getElementById('saved').innerHTML = `<span class="ok">Saved ${new Date(r.savedAt).toLocaleTimeString()}</span>`;
      } catch (e) {
        document.getElementById('saved').innerHTML = e.status === 409
          ? '<span class="bad">Exam closed</span>'
          : '<span class="warn">Offline – answers kept on this device, retrying…</span>';
      }
    };
    autosaveTimer = setInterval(save, AUTOSAVE_MS);

    const deadline = new Date(attempt.deadline).getTime();
    const tick = () => {
      const left = Math.max(0, deadline - (Date.now() + skew));
      const m = Math.floor(left / 60000); const s = Math.floor((left % 60000) / 1000);
      document.getElementById('clock').textContent = `Time left ${m}:${String(s).padStart(2, '0')}`;
      if (left === 0) { clearInterval(clockTimer); submit(); }
    };
    clockTimer = setInterval(tick, 1000); tick();

    async function submit(ev) {
      ev?.preventDefault();
      if (ev && !confirmSubmit()) return;
      clearInterval(autosaveTimer); clearInterval(clockTimer);
      dirty = true; await save();
      await api('POST', `/attempts/${attempt.id}/submit`);
      localStorage.removeItem(key);
      app.innerHTML = '<div class="card"><h2 class="ok">Exam submitted</h2><p>MCQs are being auto-marked. You will get an email when results are released.</p><a href="#/">Back</a></div>';
    }
    function confirmSubmit() { return window.confirm('Submit your exam now? You cannot change answers afterwards.'); }
    form.addEventListener('submit', submit);
  };

  views.newExam = async () => {
    const now = new Date(); const later = new Date(Date.now() + 7 * 864e5);
    const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    app.innerHTML = `<div class="card"><h2>New exam</h2><form id="f">
      <label>Title <input name="title" required></label><label>Course <input name="course"></label>
      <label>Opens <input type="datetime-local" name="opensAt" value="${local(now)}"></label>
      <label>Closes <input type="datetime-local" name="closesAt" value="${local(later)}"></label>
      <label>Duration (minutes) <input type="number" name="durationMins" value="60" min="1"></label>
      <label>Questions (JSON) <textarea name="questions" rows="10">[
  {"type":"mcq","text":"2 + 2 = ?","options":["3","4","5"],"correctOption":1,"marks":1},
  {"type":"short","text":"Explain RPO in one sentence.","marks":3}
]</textarea></label><button>Create</button></form></div>`;
    document.getElementById('f').onsubmit = async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try {
        await api('POST', '/exams', { title: f.get('title'), course: f.get('course'), durationMins: Number(f.get('durationMins')),
          opensAt: new Date(f.get('opensAt')).toISOString(), closesAt: new Date(f.get('closesAt')).toISOString(), questions: JSON.parse(f.get('questions')) });
        location.hash = '#/';
      } catch (e) { setStatus(e.message, 'bad'); }
    };
  };

  views.attempts = async (examId) => {
    const { questions, attempts } = await api('GET', `/exams/${examId}/attempts`);
    const shortQs = questions.filter((q) => q.type === 'short');
    app.innerHTML = `<div class="card"><h2>Attempts</h2><button id="rel">Release results &amp; email students</button>
      <table><tr><th>Student</th><th>Status</th><th>MCQ</th><th>Total</th><th>Short answers</th></tr>
      ${attempts.map((a) => `<tr><td>${esc(a.student_email)}</td><td>${esc(a.status)}</td><td>${a.mcq_score ?? '—'}</td>
        <td>${a.total_score ?? '—'} / ${a.max_score ?? '—'}</td>
        <td>${shortQs.map((q) => `<div><span class="muted">${esc(q.text)}</span><br>${esc(a.answers[q.id] || '(blank)')}<br>
          <input type="number" min="0" max="${q.marks}" style="width:5rem" data-a="${a.id}" data-q="${q.id}" value="${a.short_marks[q.id] ?? ''}"> / ${q.marks}</div>`).join('')}
        </td></tr>`).join('')}</table></div>`;
    app.querySelectorAll('input[data-a]').forEach((el) => el.addEventListener('change', async () => {
      try { await api('PUT', `/attempts/${el.dataset.a}/marks`, { marks: { [el.dataset.q]: Number(el.value) } }); setStatus('Mark saved', 'ok'); }
      catch (e) { setStatus(e.message, 'bad'); }
    }));
    document.getElementById('rel').onclick = async () => { await api('POST', `/exams/${examId}/release`); setStatus('Results released – emails are being sent', 'ok'); };
  };

  views.results = async () => {
    const rows = await api('GET', '/results');
    app.innerHTML = `<div class="card"><h2>My results</h2><table><tr><th>Exam</th><th>Score</th><th>Released</th></tr>
      ${rows.map((r) => `<tr><td>${esc(r.title)}</td><td>${r.total_score ?? '—'} / ${r.max_score ?? '—'}${r.status !== 'marked' ? ' <span class="warn">(provisional)</span>' : ''}</td><td>${fmt(r.released_at)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No results released yet</td></tr>'}
      </table></div>`;
  };

  views.assignments = async () => {
    const rows = await api('GET', '/assignments');
    const staff = is('tutors') || is('admins');
    app.innerHTML = `<div class="card"><h2>Assignments</h2>
      ${staff ? '<form id="na"><input name="title" placeholder="Title" required> <input type="datetime-local" name="dueAt" required> <button>Create assignment</button></form>' : ''}
      <table><tr><th>Assignment</th><th>Due</th><th></th></tr>${rows.map((a) => `<tr><td>${esc(a.title)}</td><td>${fmt(a.due_at)}</td>
      <td>${staff ? `<a href="#/assignments/${a.id}">${a.submissions} submissions</a>`
        : `<input type="file" accept=".pdf,.zip" data-id="${a.id}"><progress hidden max="100"></progress>
           <span class="muted">${a.my_last_submission ? 'Last submitted ' + fmt(a.my_last_submission) : ''}</span>`}</td></tr>`).join('')}</table></div>`;
    document.getElementById('na')?.addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      await api('POST', '/assignments', { title: f.get('title'), dueAt: new Date(f.get('dueAt')).toISOString() }); route();
    });
    app.querySelectorAll('input[type=file]').forEach((el) => el.addEventListener('change', () => upload(el)));
  };

  async function upload(input) {
    const file = input.files[0]; if (!file) return;
    if (file.size > 50 * 1024 * 1024) return setStatus('File is larger than 50 MB', 'bad');
    const bar = input.nextElementSibling; bar.hidden = false; bar.value = 0;
    try {
      const p = await api('POST', `/assignments/${input.dataset.id}/upload-url`, { fileName: file.name });
      const form = new FormData();
      Object.entries(p.fields).forEach(([k, v]) => form.append(k, v));
      form.append('file', file); // must be last
      await new Promise((resolve, reject) => {           // XHR gives upload progress for a 40 MB file
        const xhr = new XMLHttpRequest();
        xhr.open('POST', p.url);
        xhr.upload.onprogress = (e) => { bar.value = (e.loaded / e.total) * 100; };
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`S3 rejected upload (${xhr.status})`)));
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(form);
      });
      setStatus(`Uploaded ${file.name} – your tutor will be notified`, 'ok');
    } catch (e) { setStatus(e.message, 'bad'); }
  }

  views.submissions = async (id) => {
    const rows = await api('GET', `/assignments/${id}/submissions`);
    app.innerHTML = `<div class="card"><h2>Submissions</h2><table><tr><th>Student</th><th>File</th><th>Size</th><th>Received</th><th>Status</th></tr>
      ${rows.map((s) => `<tr><td>${esc(s.student_email)}</td><td>${s.downloadUrl ? `<a href="${esc(s.downloadUrl)}">${esc(s.file_name)}</a>` : esc(s.file_name)}</td>
      <td>${(s.size_bytes / 1048576).toFixed(1)} MB</td><td>${fmt(s.received_at)}</td>
      <td class="${s.status === 'received' ? 'ok' : 'bad'}">${esc(s.status)} ${esc(s.reason || '')}</td></tr>`).join('')}</table></div>`;
  };

  views.admin = async () => {
    app.innerHTML = `<div class="card"><h2>Add user</h2><form id="u"><label>Email <input name="email" type="email" required></label>
      <label>Role <select name="group"><option>students</option><option>tutors</option><option>admins</option></select></label>
      <button>Create &amp; email temporary password</button></form></div>`;
    document.getElementById('u').onsubmit = async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try { await api('POST', '/admin/users', { email: f.get('email'), group: f.get('group') }); setStatus('User created', 'ok'); ev.target.reset(); }
      catch (e) { setStatus(e.message, 'bad'); }
    };
  };

  views.health = async () => {
    const r = await fetch('/api/health').then((x) => x.json());
    app.innerHTML = `<div class="card"><h2>System health</h2><pre>${esc(JSON.stringify(r, null, 2))}</pre></div>`;
  };

  // ---------------- router ----------------
  const table = [
    [/^#\/?$/, views.home], [/^#\/exams\/new$/, views.newExam], [/^#\/exams\/(\d+)\/take$/, views.take],
    [/^#\/exams\/(\d+)\/attempts$/, views.attempts], [/^#\/results$/, views.results], [/^#\/assignments$/, views.assignments],
    [/^#\/assignments\/(\d+)$/, views.submissions], [/^#\/admin$/, views.admin], [/^#\/health$/, views.health],
  ];

  async function route() {
    clearInterval(autosaveTimer); clearInterval(clockTimer);
    if (location.hash !== '#/health' && !tokens()) return login();
    const c = claims();
    document.getElementById('who').innerHTML = c ? `${esc(c.email)} (${esc(groups().join(', ') || 'no role')}) <a href="#" id="lo">Sign out</a>` : '';
    document.getElementById('lo')?.addEventListener('click', (e) => { e.preventDefault(); logout(); });
    document.getElementById('nav').innerHTML = c ? `<a href="#/">Exams</a><a href="#/assignments">Assignments</a>
      ${is('students') ? '<a href="#/results">Results</a>' : ''}${is('admins') ? '<a href="#/admin">Admin</a>' : ''}<a href="#/health">Health</a>` : '';
    setStatus('');
    for (const [re, view] of table) {
      const m = (location.hash || '#/').match(re);
      if (m) {
        try { await view(...m.slice(1)); } catch (e) { app.innerHTML = `<div class="card bad">${esc(e.message)}</div>`; }
        return;
      }
    }
    app.innerHTML = '<div class="card">Page not found</div>';
  }

  window.addEventListener('hashchange', route);
  handleRedirect().then(route).catch((e) => { app.innerHTML = `<div class="card bad">${esc(e.message)}</div>`; });
})();
