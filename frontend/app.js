// CareerBoard — job application organizer UI
const { api, esc, $, $$, toast, dialog, confirmBox, bindForm, money, today, addDays, fmtDate, fmtStamp, qs, options, route, download, loading } = Lib;
const root = $('#app');
let me = null, meta = null, month = today().slice(0, 7);
const filters = { q: '', status: '', source: '', work_mode: '', focus: '', sort: '' };
const ivFilter = { when: 'upcoming', outcome: '' };
const cache = new Map();
const PROGRESS = ['Saved', 'Applied', 'Screening', 'Interviewing', 'Offer', 'Accepted'];
const COLORS = { Saved: '#9aa8b8', Applied: '#2c63c9', Screening: '#6a4bc4', Interviewing: '#d99a1e', Offer: '#22b38a', Accepted: '#127a5c', Rejected: '#c23b3b', Withdrawn: '#6b6b6b' };
const ICONS = {
  dashboard: '<path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/>',
  applications: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  interviews: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
};
Lib.setUnauthorized(() => { if (me) { me = null; renderAuth('Your session ended. Please sign in again.'); } });

function renderAuth(notice = '', mode = 'login') {
  const reg = mode === 'register';
  root.innerHTML = `<div class="auth"><div class="auth-card"><section class="auth-side"><span class="logo" style="color:var(--navy)"><i>C</i>CareerBoard</span>
    <h1>Your job search, organized in one board.</h1><ul><li>Track every application, salary range and follow-up date</li><li>Log interviews with preparation notes</li>
    <li>See response rates calculated from your own records</li></ul><p class="hint">CareerBoard is a personal organizer. It does not submit applications or fetch live vacancies.</p></section>
    <section class="auth-form"><h2>${reg ? 'Create your account' : 'Sign in'}</h2><form id="auth-form" novalidate>
    <label>Email<input type="email" name="email" autocomplete="username" required></label>
    <label>Password<input type="password" name="password" minlength="10" required autocomplete="${reg ? 'new-password' : 'current-password'}"></label>
    <p class="form-error" role="alert">${esc(notice)}</p><button class="btn primary" type="submit">${reg ? 'Create account' : 'Sign in'}</button></form>
    <button class="btn link" data-auth="${reg ? 'login' : 'register'}">${reg ? 'Have an account? Sign in' : 'No account yet? Create one'}</button>
    <p class="hint">${reg ? 'At least 10 characters. Your board starts empty and private.' : 'Seeded demo (if enabled): demo@example.com · DemoPass123!'}</p></section></div></div>`;
  $('[data-auth]').onclick = e => renderAuth('', e.target.dataset.auth);
  bindForm($('#auth-form'), async data => { me = (await api(reg ? 'register' : 'login', 'POST', data)).user; meta = await api('meta'); location.hash = '#/'; render(); });
  $('#auth-form input').focus();
}

const pages = { '': 'Dashboard', applications: 'Applications', interviews: 'Interviews', calendar: 'Calendar' };
function shell(page) {
  root.innerHTML = `<a class="skip" href="#main">Skip to content</a><div class="layout"><aside class="side"><a class="logo" href="#/"><i>C</i><span>CareerBoard</span></a>
    <nav aria-label="Main">${Object.entries(pages).map(([k, l]) => `<a href="#/${k}" ${page === k ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${ICONS[k || 'dashboard']}</svg>${l}</a>`).join('')}</nav>
    <div class="side-foot"><span class="email">${esc(me.email)}</span><button class="btn sm" data-act="logout">Sign out</button></div></aside>
    <div class="content"><header class="topbar"><div><h1>${pages[page] ?? 'Not found'}</h1><div class="sub">${fmtDate(today(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
    <div class="acts">${page === 'applications' ? '<button class="btn" data-act="export">Export CSV</button>' : ''}${page === 'interviews' || page === 'calendar' ? '<button class="btn" data-act="new-interview">Add interview</button>' : ''}<button class="btn primary" data-act="new-app">+ Application</button></div></header>
    ${me.is_demo ? '<div class="demo">Demo workspace · companies, roles and interviews shown here are fictional sample data.</div>' : ''}
    <main id="main" class="page" tabindex="-1">${loading()}</main></div></div>`;
  return $('#main');
}

async function render() {
  if (!me) return renderAuth();
  const [page = '', id] = route();
  const main = shell(page);
  try {
    if (page === '') await viewDashboard(main);
    else if (page === 'applications') { await viewApplications(main); if (id) openApp(+id); }
    else if (page === 'interviews') await viewInterviews(main);
    else if (page === 'calendar') await viewCalendar(main);
    else main.innerHTML = '<div class="empty">Page not found. <a href="#/">Go to dashboard</a></div>';
  } catch (e) { if (e.status !== 401) main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

const pill = s => { const i = PROGRESS.indexOf(s); return `<span class="pill s-${esc(s)}">${esc(s)}</span>${i >= 0 ? `<span class="steps" aria-hidden="true">${PROGRESS.slice(1).map((_, k) => `<i class="${k < i ? 'on' : ''}"></i>`).join('')}</span>` : ''}`; };
const salary = a => a.salary_min == null && a.salary_max == null ? '<span class="hint">—</span>' : a.salary_min != null && a.salary_max != null && a.salary_min !== a.salary_max
  ? `${a.currency} ${money(a.salary_min)}–${money(a.salary_max)}` : money(a.salary_max ?? a.salary_min, a.currency);
const fu = (d, closed) => !d ? '<span class="hint">—</span>' : `<span class="${!closed && d < today() ? 'late' : ''}">${fmtDate(d, { day: 'numeric', month: 'short' })}</span>`;
const closed = s => ['Accepted', 'Rejected', 'Withdrawn'].includes(s);
const dt = s => s ? new Date(s).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

async function viewDashboard(main) {
  const d = await api('dashboard');
  if (!d.total) { main.innerHTML = '<div class="empty"><h2>No applications yet</h2><p>Add the roles you are considering or have applied to. Metrics appear as soon as you save records.</p><button class="btn primary" data-act="new-app">Add your first application</button></div>'; return; }
  const maxSrc = Math.max(...d.sources.map(s => s.n), 1);
  main.innerHTML = `<section class="kpis" aria-label="Key metrics">
    <div class="kpi accent"><span>Active applications</span><b>${d.active}</b><small>of ${d.total} tracked</small></div>
    <div class="kpi"><span>Applied this week</span><b>${d.applied_this_week}</b><small>${d.applied} applied in total</small></div>
    <div class="kpi"><span>Response rate</span><b>${d.response_rate == null ? '—' : d.response_rate + '%'}</b><small>${d.responded} of ${d.applied} moved past “Applied”</small></div>
    <div class="kpi"><span>Upcoming interviews</span><b>${d.interviews_upcoming}</b><small>${d.interviews_done} completed</small></div>
    <div class="kpi"><span>Offers</span><b>${d.by_status.Offer + d.by_status.Accepted}</b><small>${d.by_status.Accepted} accepted</small></div>
    <div class="kpi"><span>Follow-ups due</span><b class="${d.overdue_followups ? 'late' : ''}">${d.followups.length}</b><small>${d.overdue_followups} overdue · next 7 days</small></div></section>
    <div class="grid-dash"><div style="display:grid;gap:16px;align-content:start">
      <section class="card"><h2>Pipeline by stage</h2><div class="funnel" role="img" aria-label="${meta.statuses.map(s => `${s} ${d.by_status[s]}`).join(', ')}">
        ${meta.statuses.filter(s => d.by_status[s]).map(s => `<i style="flex:${d.by_status[s]};background:${COLORS[s]}" title="${s}: ${d.by_status[s]}"></i>`).join('')}</div>
        <div class="legend">${meta.statuses.map(s => `<span style="--c:${COLORS[s]}"><a href="#/applications" data-status-link="${s}">${s}</a> ${d.by_status[s]}</span>`).join('')}</div></section>
      <section class="card"><h2>Upcoming interviews <a class="btn link" href="#/interviews">All interviews</a></h2>${d.upcoming.length ? `<ul class="rowlist">${d.upcoming.map(i => `<li><span><button class="rowbtn" data-open="${i.application_id}"><span class="co">${esc(i.company)}</span></button> · ${esc(i.round_name || i.format)}<br><span class="hint">${esc(i.role)} · ${esc(i.format)}</span></span><span class="when">${dt(i.scheduled_at)}</span></li>`).join('')}</ul>` : '<p class="hint">No interviews scheduled.</p>'}</section>
    </div><div style="display:grid;gap:16px;align-content:start">
      <section class="card"><h2>Follow-ups · next 7 days <a class="btn link" href="#/calendar">Calendar</a></h2>${d.followups.length ? `<ul class="rowlist">${d.followups.map(f => `<li><span><button class="rowbtn" data-open="${f.id}"><span class="co">${esc(f.company)}</span></button><br><span class="hint">${esc(f.role)}</span></span><span class="when">${fu(f.follow_up)}${f.follow_up < today() ? '<br><span class="late">overdue</span>' : ''}</span></li>`).join('')}</ul>` : '<p class="hint">Nothing due this week.</p>'}</section>
      <section class="card"><h2>Where applications come from</h2>${d.sources.map(s => `<div class="bar"><span>${esc(s.source)}</span><span class="t"><i style="width:${s.n / maxSrc * 100}%"></i></span><b class="num">${s.n}</b></div>`).join('')}</section>
    </div></div>`;
}

async function viewApplications(main) {
  main.innerHTML = `<div class="filters"><label class="grow">Search<input type="search" data-filter="q" value="${esc(filters.q)}" placeholder="Company, role, location, notes"></label>
    <label>Status<select data-filter="status"><option value="">All statuses</option>${options(meta.statuses, filters.status)}</select></label>
    <label>Source<select data-filter="source"><option value="">All sources</option>${options(meta.sources, filters.source)}</select></label>
    <label>Work mode<select data-filter="work_mode"><option value="">Any</option>${options(meta.modes, filters.work_mode)}</select></label>
    <label>Show<select data-filter="focus">${options([['', 'Everything'], ['active', 'Active only'], ['followup', 'Follow-up due ≤ 7 days']], filters.focus)}</select></label>
    <label>Sort<select data-filter="sort">${options([['', 'Applied (newest)'], ['follow_up', 'Follow-up date'], ['company', 'Company A–Z'], ['status', 'Status']], filters.sort)}</select></label></div>
    <div id="results">${loading()}</div>`;
  main.refresh = async () => {
    const list = await api('applications?' + qs(filters));
    list.forEach(a => cache.set(a.id, a));
    $('#results').innerHTML = list.length ? `<div class="tablebox"><table class="stack"><caption class="sr">Applications</caption><thead><tr><th>Company / role</th><th>Status</th><th>Source</th><th>Location</th><th class="num">Salary</th><th>Applied</th><th>Follow-up</th><th class="num">Interviews</th></tr></thead><tbody>
      ${list.map(a => `<tr><td class="wide"><button class="rowbtn" data-open="${a.id}"><span class="co">${esc(a.company)}</span><br><span class="role">${esc(a.role)}</span></button></td>
        <td class="wide">${pill(a.status)}</td><td class="hide-sm">${esc(a.source)}</td><td>${esc(a.location || '—')}<br><span class="role">${esc(a.work_mode)}</span></td>
        <td class="num">${salary(a)}</td><td>${a.applied_on ? fmtDate(a.applied_on, { day: 'numeric', month: 'short' }) : '<span class="hint">Not yet</span>'}</td>
        <td>${fu(a.follow_up, closed(a.status))}</td><td class="num hide-sm">${a.interview_count}${a.next_interview ? `<br><span class="role">next ${fmtDate(a.next_interview.slice(0, 10), { day: 'numeric', month: 'short' })}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">${list.length} application${list.length === 1 ? '' : 's'} shown. Export includes exactly these rows.</p>`
      : `<div class="empty">${Object.values(filters).some(Boolean) ? 'No applications match these filters.' : 'No applications yet.'}<br><button class="btn primary" data-act="new-app">Add application</button></div>`;
  };
  await main.refresh();
}

async function openApp(id) {
  let a;
  try { a = await api('applications/' + id); } catch (e) { return toast(e.message, 'err'); }
  cache.set(a.id, a);
  const d = dialog(`<div class="dh"><div><h2>${esc(a.company)}</h2><div class="hint">${esc(a.role)}</div></div><button class="btn sm" data-close aria-label="Close details">✕</button></div>
    <div class="db"><div>${pill(a.status)}</div>
    <div><h3 class="hint" style="margin-bottom:6px">Move to stage</h3><div class="stepper" role="group" aria-label="Application status">${meta.statuses.map(s => `<button data-set-status="${s}" aria-pressed="${s === a.status}">${s}</button>`).join('')}</div></div>
    <dl class="facts"><div><dt>Source</dt><dd>${esc(a.source)}</dd></div><div><dt>Location</dt><dd>${esc(a.location || '—')} · ${esc(a.work_mode)}</dd></div>
      <div><dt>Salary range</dt><dd>${salary(a)}</dd></div><div><dt>Applied on</dt><dd>${a.applied_on ? fmtDate(a.applied_on) : 'Not yet applied'}</dd></div>
      <div><dt>Follow-up</dt><dd>${fu(a.follow_up, closed(a.status))}</dd></div><div><dt>Job posting</dt><dd>${a.job_url ? `<a href="${esc(a.job_url)}" target="_blank" rel="noopener noreferrer">Open link ↗</a>` : '—'}</dd></div></dl>
    ${a.notes ? `<div class="notes">${esc(a.notes)}</div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-edit-app>Edit</button><button class="btn primary" data-add-iv>+ Interview</button><button class="btn danger" data-del-app>Delete</button></div>
    <section><h3 style="margin-bottom:8px">Interviews (${a.interviews.length})</h3><div style="display:grid;gap:8px">${a.interviews.map(i => `<article class="iv"><div class="top"><b>${esc(i.round_name || i.format)}</b><span class="pill s-${i.outcome === 'Completed' ? 'Offer' : i.outcome === 'Cancelled' ? 'Withdrawn' : 'Interviewing'}">${esc(i.outcome)}</span></div>
      <span class="hint">${dt(i.scheduled_at)} · ${i.duration_min} min · ${esc(i.format)}${i.contact ? ' · ' + esc(i.contact) : ''}</span>${i.prep_notes ? `<div class="prep">${esc(i.prep_notes)}</div>` : ''}
      <div><button class="btn sm" data-edit-iv="${i.id}">Edit</button> <button class="btn sm danger" data-del-iv="${i.id}">Delete</button></div></article>`).join('') || '<p class="hint">No interviews logged.</p>'}</div></section>
    <section><h3 style="margin-bottom:6px">Status history</h3><ul class="hist">${a.history.map(h => `<li>${fmtStamp(h.created)} — ${h.from_status ? `${esc(h.from_status)} → ` : ''}<b>${esc(h.to_status)}</b>${h.note ? ` · ${esc(h.note)}` : ''}</li>`).join('')}</ul></section></div>`, { className: 'drawer' });
  const reopen = async msg => { d.close(); toast(msg); const m = $('#main'); if (m && m.refresh) await m.refresh(); openApp(id); };
  d.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t) return;
    try {
      if (t.dataset.setStatus) { await api(`applications/${id}/status`, 'POST', { status: t.dataset.setStatus }); reopen('Status updated'); }
      else if ('editApp' in t.dataset) { d.close(); appForm(a); }
      else if ('addIv' in t.dataset) { d.close(); interviewForm({ application_id: id }); }
      else if (t.dataset.editIv) { d.close(); interviewForm(a.interviews.find(i => i.id === +t.dataset.editIv)); }
      else if (t.dataset.delIv && await confirmBox('Delete this interview record and its preparation notes?', { title: 'Delete interview' })) { await api('interviews/' + t.dataset.delIv, 'DELETE'); reopen('Interview deleted'); }
      else if ('delApp' in t.dataset && await confirmBox(`Delete the ${a.role} application at ${a.company}? Its ${a.interviews.length} interview record(s) will also be deleted.`, { title: 'Delete application' })) {
        await api('applications/' + id, 'DELETE'); d.close(); toast('Application deleted'); go('#/applications');
      }
    } catch (err) { toast(err.message, 'err'); }
  });
}

async function viewInterviews(main) {
  main.innerHTML = `<div class="filters"><label>When<select data-ivfilter="when">${options([['upcoming', 'Upcoming'], ['', 'All dates']], ivFilter.when)}</select></label>
    <label>Outcome<select data-ivfilter="outcome"><option value="">Any outcome</option>${options(meta.outcomes, ivFilter.outcome)}</select></label></div><div id="results">${loading()}</div>`;
  main.refresh = async () => {
    const list = await api('interviews?' + qs(ivFilter));
    $('#results').innerHTML = list.length ? `<div class="tablebox"><table class="stack"><thead><tr><th>When</th><th>Company / role</th><th>Round</th><th>Format</th><th>Outcome</th><th>Preparation</th><th><span class="sr">Actions</span></th></tr></thead><tbody>
      ${list.map(i => `<tr><td>${dt(i.scheduled_at)}</td><td class="wide"><button class="rowbtn" data-open="${i.application_id}"><span class="co">${esc(i.company)}</span><br><span class="role">${esc(i.role)}</span></button></td>
        <td>${esc(i.round_name || '—')}</td><td>${esc(i.format)} · ${i.duration_min}m</td><td>${esc(i.outcome)}</td><td class="wide hint">${esc((i.prep_notes || '').slice(0, 90))}</td>
        <td><button class="btn sm" data-edit-interview='${i.id}'>Edit</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">No interviews ${ivFilter.when ? 'coming up' : 'recorded'}.<br><button class="btn primary" data-act="new-interview">Add interview</button></div>`;
    main.list = list;
  };
  await main.refresh();
}

async function viewCalendar(main) {
  const { events } = await api('calendar?month=' + month);
  const first = new Date(month + '-01T00:00:00'), offset = (first.getDay() + 6) % 7;
  const start = addDays(month + '-01', -offset), days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const byDay = events.reduce((m, e) => ((m[e.date] ||= []).push(e), m), {});
  const evBtn = e => `<button class="ev ${e.kind}" data-open="${e.application_id}" title="${esc(`${e.kind === 'interview' ? 'Interview ' + e.time : 'Follow-up'} · ${e.company} — ${e.role}`)}">${e.kind === 'interview' ? esc(e.time) + ' ' : '↻ '}${esc(e.company)}</button>`;
  main.innerHTML = `<div class="calhead"><button class="btn" data-month="-1" aria-label="Previous month">‹</button><h2>${first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2>
    <button class="btn" data-month="1" aria-label="Next month">›</button><button class="btn ghost" data-month="0">Today</button>
    <span class="legend" style="margin-left:auto"><span style="--c:var(--navy)">Interview</span><span style="--c:var(--mint)">Follow-up</span></span></div>
    <div class="cal" role="grid" aria-label="Month view">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('')}
    ${days.map(d => `<div class="day ${d.slice(0, 7) !== month ? 'out' : ''} ${d === today() ? 'today' : ''}"><span class="dn">${+d.slice(8)}</span>${(byDay[d] || []).map(evBtn).join('')}</div>`).join('')}</div>
    <div class="agenda card">${events.length ? `<ul class="rowlist">${events.map(e => `<li><span>${evBtn(e)}<span class="hint">${esc(e.role)} · ${esc(e.detail)}</span></span><span class="when">${fmtDate(e.date, { weekday: 'short', day: 'numeric', month: 'short' })}${e.time ? ' ' + e.time : ''}</span></li>`).join('')}</ul>` : '<p class="hint">No follow-ups or interviews this month.</p>'}</div>
    ${events.length ? '' : '<p class="hint">No follow-ups or interviews this month. Add a follow-up date to an application or schedule an interview.</p>'}`;
}

function appForm(a = {}) {
  const d = dialog(`<h2>${a.id ? 'Edit application' : 'New application'}</h2><form novalidate><div class="grid2">
    <label>Company<input name="company" required maxlength="160" value="${esc(a.company)}"></label><label>Role<input name="role" required maxlength="160" value="${esc(a.role)}"></label>
    <label class="full">Job posting URL<input name="job_url" type="url" placeholder="https://" value="${esc(a.job_url)}"></label>
    <label>Source<select name="source">${options(meta.sources, a.source || 'Company website')}</select></label><label>Status<select name="status">${options(meta.statuses, a.status || 'Saved')}</select></label>
    <label>Location<input name="location" maxlength="120" value="${esc(a.location)}"></label><label>Work mode<select name="work_mode">${options(meta.modes, a.work_mode || 'Unspecified')}</select></label>
    <label>Salary min<input name="salary_min" type="number" min="0" step="any" value="${a.salary_min ?? ''}"></label><label>Salary max<input name="salary_max" type="number" min="0" step="any" value="${a.salary_max ?? ''}"></label>
    <label>Currency<select name="currency">${options(meta.currencies, a.currency || 'AED')}</select></label><span class="hint" style="align-self:end">Enter the period the employer quoted (monthly or yearly) and note it below.</span>
    <label>Date applied<input name="applied_on" type="date" max="${today()}" value="${esc(a.applied_on)}"></label><label>Follow-up date<input name="follow_up" type="date" value="${esc(a.follow_up)}"></label>
    <label class="full">Notes<textarea name="notes" maxlength="5000">${esc(a.notes)}</textarea></label></div>
    <p class="form-error" role="alert"></p><div class="dlg-actions"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save application</button></div></form>`);
  bindForm($('form', d), async data => {
    const r = await api(a.id ? 'applications/' + a.id : 'applications', a.id ? 'PUT' : 'POST', data);
    d.close(); toast(a.id ? 'Application updated' : 'Application added');
    go('#/applications/' + (a.id || r.id));
  });
}

async function interviewForm(i = {}) {
  const apps = await api('applications');
  if (!apps.length) return toast('Add an application before logging interviews.', 'err');
  const d = dialog(`<h2>${i.id ? 'Edit interview' : 'Log an interview'}</h2><form novalidate><div class="grid2">
    <label class="full">Application<select name="application_id">${options(apps.map(a => [a.id, `${a.company} — ${a.role}`]), i.application_id)}</select></label>
    <label>Date & time (your local time)<input name="scheduled_at" type="datetime-local" required value="${esc(i.scheduled_at)}"></label>
    <label>Duration (minutes)<input name="duration_min" type="number" min="5" max="600" value="${i.duration_min ?? 45}"></label>
    <label>Format<select name="format">${options(meta.formats, i.format || 'Video')}</select></label><label>Outcome<select name="outcome">${options(meta.outcomes, i.outcome || 'Scheduled')}</select></label>
    <label>Round<input name="round_name" maxlength="120" placeholder="e.g. Technical interview" value="${esc(i.round_name)}"></label><label>Interviewer / contact<input name="contact" maxlength="160" value="${esc(i.contact)}"></label>
    <label class="full">Preparation notes<textarea name="prep_notes" maxlength="5000">${esc(i.prep_notes)}</textarea></label></div>
    <p class="hint">Adding an interview to a Saved, Applied or Screening application moves it to Interviewing.</p>
    <p class="form-error" role="alert"></p><div class="dlg-actions"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save interview</button></div></form>`);
  bindForm($('form', d), async data => {
    await api(i.id ? 'interviews/' + i.id : 'interviews', i.id ? 'PUT' : 'POST', data);
    d.close(); toast('Interview saved'); render();
  });
}

const actions = {
  logout: async () => { try { await api('logout', 'POST'); } finally { me = null; location.hash = ''; renderAuth('You have signed out.'); } },
  'new-app': () => appForm(), 'new-interview': () => interviewForm(),
  export: () => download('export/applications?' + qs(filters)),
};
root.addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-open],[data-month],[data-edit-interview],[data-status-link]'); if (!t) return;
  if (t.dataset.act && actions[t.dataset.act]) { e.preventDefault(); actions[t.dataset.act](t); }
  else if (t.dataset.open) openApp(+t.dataset.open);
  else if (t.dataset.month) { const n = +t.dataset.month, dd = new Date(month + '-01T00:00:00'); if (n) dd.setMonth(dd.getMonth() + n); month = n ? dd.toLocaleDateString('en-CA').slice(0, 7) : today().slice(0, 7); render(); }
  else if (t.dataset.editInterview) interviewForm(($('#main').list || []).find(i => i.id === +t.dataset.editInterview));
  else if (t.dataset.statusLink) { Object.assign(filters, { status: t.dataset.statusLink, focus: '', q: '' }); }
});
let timer;
root.addEventListener('input', e => {
  const k = e.target.dataset.filter || e.target.dataset.ivfilter; if (!k) return;
  (e.target.dataset.filter ? filters : ivFilter)[k] = e.target.value;
  clearTimeout(timer); timer = setTimeout(() => { const m = $('#main'); m && m.refresh && m.refresh().catch(err => toast(err.message, 'err')); }, 200);
});
const go = h => { if (location.hash === h) render(); else location.hash = h; };
window.addEventListener('hashchange', () => { if (!me) return; const [p, id] = route(); if (p === 'applications' && id && $('#results')) { $('#main').refresh().catch(() => {}); openApp(+id); } else render(); });

(async () => {
  try { me = (await api('session')).user; meta = await api('meta'); render(); }
  catch (e) { e.status === 401 ? renderAuth() : (root.innerHTML = `<div class="loading">${esc(e.message)}</div>`); }
})();
