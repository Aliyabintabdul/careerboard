"""CareerBoard — personal job application organizer (Python standard library + SQLite)."""
from datetime import date, datetime, timedelta
from pathlib import Path
from core import App, ApiError, Csv, Form, now_iso, one, rows, today

STATUSES = ['Saved', 'Applied', 'Screening', 'Interviewing', 'Offer', 'Accepted', 'Rejected', 'Withdrawn']
ACTIVE = ['Applied', 'Screening', 'Interviewing', 'Offer']
SOURCES = ['Company website', 'LinkedIn', 'Job board', 'Referral', 'Recruiter', 'Networking', 'Other']
MODES = ['On-site', 'Hybrid', 'Remote', 'Unspecified']
CURRENCIES = ['AED', 'USD', 'EUR', 'GBP', 'SAR', 'INR', 'CAD', 'AUD']
FORMATS = ['Phone', 'Video', 'On-site', 'Take-home task', 'Other']
OUTCOMES = ['Scheduled', 'Completed', 'Cancelled']

SCHEMA = """
CREATE TABLE applications(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company TEXT NOT NULL, role TEXT NOT NULL, job_url TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, location TEXT NOT NULL DEFAULT '',
  work_mode TEXT NOT NULL DEFAULT 'Unspecified', salary_min REAL CHECK(salary_min>=0), salary_max REAL CHECK(salary_max>=0), currency TEXT NOT NULL DEFAULT 'AED',
  status TEXT NOT NULL, applied_on TEXT, follow_up TEXT, notes TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL);
CREATE INDEX applications_user ON applications(user_id, status);
CREATE TABLE interviews(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE, scheduled_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 45, format TEXT NOT NULL, round_name TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
  prep_notes TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL DEFAULT 'Scheduled', created TEXT NOT NULL);
CREATE INDEX interviews_app ON interviews(application_id);
CREATE INDEX interviews_user ON interviews(user_id, scheduled_at);
CREATE TABLE status_history(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE, from_status TEXT, to_status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created TEXT NOT NULL)
"""


def migrate_v1(c):
    for stmt in SCHEMA.split(';'):
        c.execute(stmt)
    if c.execute("SELECT 1 FROM sqlite_master WHERE name='records'").fetchone():
        legacy = {'Saved': 'Saved', 'Applied': 'Applied', 'Interview': 'Interviewing', 'Offer': 'Offer'}
        for r in c.execute('SELECT * FROM records').fetchall():
            role, _, company = (r['title'] or 'Role').partition(' · ')
            status, ts = legacy.get(r['status'], 'Saved'), now_iso()
            aid = c.execute("""INSERT INTO applications(user_id,company,role,source,salary_max,status,applied_on,follow_up,notes,created,updated)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)""", (r['user_id'], company or 'Unknown company', role, r['category'] if r['category'] in SOURCES else 'Other',
                                               r['amount'], status, None if status == 'Saved' else ts[:10], r['due'], r['notes'] or '', ts, ts)).lastrowid
            history(c, r['user_id'], aid, None, status, 'Migrated from earlier version')
        c.execute('ALTER TABLE records RENAME TO legacy_records')
        if c.execute("SELECT 1 FROM sqlite_master WHERE name='events'").fetchone():
            c.execute('ALTER TABLE events RENAME TO legacy_events')


def seed(c, uid):
    d = lambda n: (date.today() + timedelta(days=n)).isoformat()
    ts = now_iso()
    apps = [
        ('Nova Systems (fictional)', 'Frontend Engineer', 'https://careers.nova.example/frontend', 'Company website', 'Dubai', 'Hybrid', 11000, 14000, 'AED', 'Interviewing', d(-12), d(2)),
        ('Atlas Cloud (fictional)', 'Cloud Developer', '', 'Referral', 'Abu Dhabi', 'On-site', 15000, 18000, 'AED', 'Screening', d(-8), d(-1)),
        ('Bloom Health (fictional)', 'Full-stack Developer', 'https://bloom.example/jobs/42', 'Job board', 'Remote', 'Remote', 60000, 75000, 'USD', 'Applied', d(-3), d(6)),
        ('Quill Media (fictional)', 'React Developer', '', 'LinkedIn', 'London', 'Hybrid', None, None, 'GBP', 'Saved', None, d(1)),
        ('Harbor Logistics (fictional)', 'Software Engineer', '', 'Recruiter', 'Dubai', 'On-site', 13000, 13000, 'AED', 'Rejected', d(-30), None),
        ('Pixel Forge (fictional)', 'UI Engineer', '', 'Networking', 'Berlin', 'Hybrid', 55000, 65000, 'EUR', 'Offer', d(-25), d(3)),
    ]
    ids = []
    for a in apps:
        aid = c.execute("""INSERT INTO applications(user_id,company,role,job_url,source,location,work_mode,salary_min,salary_max,currency,status,applied_on,follow_up,notes,created,updated)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (uid, *a, 'Fictional demo application.', ts, ts)).lastrowid
        history(c, uid, aid, None, a[9], 'Demo data')
        ids.append(aid)
    for i, when, fmt, rnd, outcome in [(0, d(2) + 'T10:30', 'Video', 'Technical interview', 'Scheduled'), (0, d(-5) + 'T14:00', 'Phone', 'Recruiter screen', 'Completed'),
                                       (1, d(4) + 'T09:00', 'Phone', 'Recruiter screen', 'Scheduled'), (5, d(-15) + 'T11:00', 'On-site', 'Final round', 'Completed')]:
        c.execute("""INSERT INTO interviews(user_id,application_id,scheduled_at,duration_min,format,round_name,contact,prep_notes,outcome,created)
            VALUES(?,?,?,?,?,?,?,?,?,?)""", (uid, ids[i], when, 45, fmt, rnd, 'Hiring team', 'Review the job description and prepare two project stories.', outcome, ts))


app = App('CareerBoard', 'careerboard', Path(__file__).parent, [migrate_v1], seed)


def history(c, uid, aid, old, new, note=''):
    c.execute('INSERT INTO status_history(user_id,application_id,from_status,to_status,note,created) VALUES(?,?,?,?,?,?)', (uid, aid, old, new, note, now_iso()))


def application_form(body):
    f = Form(body)
    f.text('company', True, 160); f.text('role', True, 160); f.url('job_url'); f.choice('source', SOURCES, 'Other')
    f.text('location', False, 120); f.choice('work_mode', MODES, 'Unspecified')
    f.number('salary_min', False, 0, 1e9); f.number('salary_max', False, 0, 1e9); f.choice('currency', CURRENCIES, 'AED')
    f.choice('status', STATUSES, 'Saved'); f.date('applied_on'); f.date('follow_up'); f.text('notes', False, 5000)
    v = f.values
    f.check(v['salary_min'] is None or v['salary_max'] is None or v['salary_min'] <= v['salary_max'], 'salary_max', 'Maximum must be at least the minimum.')
    f.check(v['status'] == 'Saved' or v['applied_on'], 'applied_on', 'Add the date you applied (required once a role is past “Saved”).')
    f.check(not v['applied_on'] or v['applied_on'] <= today(), 'applied_on', 'Application date cannot be in the future.')
    return f.done()


def interview_form(c, uid, body):
    f = Form(body)
    f.number('application_id', True, 1, 1e12, integer=True); f.datetime('scheduled_at', True)
    f.number('duration_min', False, 5, 600, integer=True, default=45); f.choice('format', FORMATS, 'Video')
    f.text('round_name', False, 120); f.text('contact', False, 160); f.text('prep_notes', False, 5000); f.choice('outcome', OUTCOMES, 'Scheduled')
    v = f.done()
    app_row = c.execute('SELECT * FROM applications WHERE id=? AND user_id=?', (v['application_id'], uid)).fetchone()
    if not app_row:
        raise ApiError(400, 'Choose one of your applications.', 'validation_error', {'application_id': 'Choose one of your applications.'})
    return v, app_row


APP_SELECT = """SELECT a.*, (SELECT COUNT(*) FROM interviews i WHERE i.application_id=a.id) AS interview_count,
  (SELECT MIN(scheduled_at) FROM interviews i WHERE i.application_id=a.id AND i.outcome='Scheduled' AND i.scheduled_at>=:now) AS next_interview
  FROM applications a WHERE a.user_id=:uid"""


def app_query(ctx):
    sql, args = APP_SELECT, {'uid': ctx.uid, 'now': datetime.now().strftime('%Y-%m-%dT%H:%M'), 'today': today()}
    if ctx.q('q'):
        sql += ' AND (a.company LIKE :q OR a.role LIKE :q OR a.location LIKE :q OR a.notes LIKE :q)'; args['q'] = f"%{ctx.q('q')}%"
    if ctx.q('status') in STATUSES:
        sql += ' AND a.status=:status'; args['status'] = ctx.q('status')
    if ctx.q('source') in SOURCES:
        sql += ' AND a.source=:source'; args['source'] = ctx.q('source')
    if ctx.q('work_mode') in MODES:
        sql += ' AND a.work_mode=:mode'; args['mode'] = ctx.q('work_mode')
    focus = ctx.q('focus')
    if focus == 'active':
        sql += " AND a.status IN ('Applied','Screening','Interviewing','Offer')"
    elif focus == 'followup':
        sql += " AND a.follow_up<=date(:today,'+7 days') AND a.status NOT IN ('Accepted','Rejected','Withdrawn')"
    order = {'company': 'a.company COLLATE NOCASE', 'follow_up': 'a.follow_up IS NULL, a.follow_up', 'status': 'a.status'}.get(ctx.q('sort'), 'a.applied_on IS NULL, a.applied_on DESC, a.id DESC')
    return rows(ctx.db.execute(f'{sql} ORDER BY {order}', args))


@app.route('GET', '/api/meta')
def meta(ctx):
    return {'statuses': STATUSES, 'active': ACTIVE, 'sources': SOURCES, 'modes': MODES, 'currencies': CURRENCIES, 'formats': FORMATS, 'outcomes': OUTCOMES}


@app.route('GET', '/api/dashboard')
def dashboard(ctx):
    c, uid, t, now = ctx.db, ctx.uid, today(), datetime.now().strftime('%Y-%m-%dT%H:%M')
    by_status = {s: 0 for s in STATUSES}
    for r in c.execute('SELECT status, COUNT(*) n FROM applications WHERE user_id=? GROUP BY status', (uid,)):
        by_status[r['status']] = r['n']
    applied = c.execute('SELECT COUNT(*) FROM applications WHERE user_id=? AND applied_on IS NOT NULL', (uid,)).fetchone()[0]
    responded = c.execute("""SELECT COUNT(*) FROM applications a WHERE a.user_id=? AND a.applied_on IS NOT NULL AND (a.status IN ('Screening','Interviewing','Offer','Accepted')
        OR EXISTS(SELECT 1 FROM interviews i WHERE i.application_id=a.id)
        OR EXISTS(SELECT 1 FROM status_history h WHERE h.application_id=a.id AND h.to_status IN ('Screening','Interviewing','Offer')))""", (uid,)).fetchone()[0]
    upcoming = rows(c.execute("""SELECT i.*, a.company, a.role FROM interviews i JOIN applications a ON a.id=i.application_id
        WHERE i.user_id=? AND i.outcome='Scheduled' AND i.scheduled_at>=? ORDER BY i.scheduled_at LIMIT 6""", (uid, now)))
    followups = rows(c.execute("""SELECT id, company, role, status, follow_up FROM applications WHERE user_id=? AND follow_up<=date(?,'+7 days')
        AND status NOT IN ('Accepted','Rejected','Withdrawn') ORDER BY follow_up""", (uid, t)))
    sources = rows(c.execute('SELECT source, COUNT(*) n FROM applications WHERE user_id=? GROUP BY source ORDER BY n DESC', (uid,)))
    week = (date.today() - timedelta(days=date.today().weekday())).isoformat()
    return {'total': sum(by_status.values()), 'by_status': by_status, 'active': sum(by_status[s] for s in ACTIVE), 'applied': applied, 'responded': responded,
            'response_rate': round(responded / applied * 100) if applied else None,
            'applied_this_week': c.execute('SELECT COUNT(*) FROM applications WHERE user_id=? AND applied_on>=?', (uid, week)).fetchone()[0],
            'interviews_upcoming': c.execute("SELECT COUNT(*) FROM interviews WHERE user_id=? AND outcome='Scheduled' AND scheduled_at>=?", (uid, now)).fetchone()[0],
            'interviews_done': c.execute("SELECT COUNT(*) FROM interviews WHERE user_id=? AND outcome='Completed'", (uid,)).fetchone()[0],
            'upcoming': upcoming, 'followups': followups, 'overdue_followups': sum(1 for f in followups if f['follow_up'] < t), 'sources': sources}


@app.route('GET', '/api/calendar')
def calendar(ctx):
    month = ctx.q('month') or today()[:7]
    try:
        start = date.fromisoformat(month + '-01')
    except ValueError:
        raise ApiError(400, 'Use month=YYYY-MM.', 'validation_error', {'month': 'Use YYYY-MM.'})
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    a, b = start.isoformat(), end.isoformat()
    events = rows(ctx.db.execute("""SELECT 'followup' kind, id application_id, follow_up date, NULL time, company, role, status detail FROM applications
        WHERE user_id=? AND follow_up>=? AND follow_up<? AND status NOT IN ('Accepted','Rejected','Withdrawn')
        UNION ALL SELECT 'interview', i.application_id, substr(i.scheduled_at,1,10), substr(i.scheduled_at,12,5), a.company, a.role, i.format || ' · ' || i.outcome
        FROM interviews i JOIN applications a ON a.id=i.application_id WHERE i.user_id=? AND i.scheduled_at>=? AND i.scheduled_at<?
        ORDER BY date, time""", (ctx.uid, a, b, ctx.uid, a, b)))
    return {'month': month, 'events': events}


@app.route('GET', '/api/applications')
def list_apps(ctx):
    return app_query(ctx)


@app.route('POST', '/api/applications')
def create_app(ctx):
    v, ts = application_form(ctx.body), now_iso()
    aid = ctx.db.execute("""INSERT INTO applications(user_id,company,role,job_url,source,location,work_mode,salary_min,salary_max,currency,status,applied_on,follow_up,notes,created,updated)
        VALUES(:uid,:company,:role,:job_url,:source,:location,:work_mode,:salary_min,:salary_max,:currency,:status,:applied_on,:follow_up,:notes,:ts,:ts)""", {**v, 'uid': ctx.uid, 'ts': ts}).lastrowid
    history(ctx.db, ctx.uid, aid, None, v['status'], 'Created')
    return 201, {'id': aid}


@app.route('GET', '/api/applications/{id}')
def get_app(ctx):
    a = one(ctx.db, 'SELECT * FROM applications WHERE id=? AND user_id=?', (ctx.params['id'], ctx.uid), 'Application')
    a['interviews'] = rows(ctx.db.execute('SELECT * FROM interviews WHERE application_id=? AND user_id=? ORDER BY scheduled_at', (a['id'], ctx.uid)))
    a['history'] = rows(ctx.db.execute('SELECT from_status, to_status, note, created FROM status_history WHERE application_id=? AND user_id=? ORDER BY id DESC', (a['id'], ctx.uid)))
    return a


@app.route('PUT', '/api/applications/{id}')
def update_app(ctx):
    old = one(ctx.db, 'SELECT * FROM applications WHERE id=? AND user_id=?', (ctx.params['id'], ctx.uid), 'Application')
    v = application_form(ctx.body)
    ctx.db.execute("""UPDATE applications SET company=:company,role=:role,job_url=:job_url,source=:source,location=:location,work_mode=:work_mode,salary_min=:salary_min,
        salary_max=:salary_max,currency=:currency,status=:status,applied_on=:applied_on,follow_up=:follow_up,notes=:notes,updated=:ts WHERE id=:id AND user_id=:uid""",
                   {**v, 'ts': now_iso(), 'id': old['id'], 'uid': ctx.uid})
    if old['status'] != v['status']:
        history(ctx.db, ctx.uid, old['id'], old['status'], v['status'])
    return {'ok': True}


@app.route('POST', '/api/applications/{id}/status')
def set_status(ctx):
    old = one(ctx.db, 'SELECT * FROM applications WHERE id=? AND user_id=?', (ctx.params['id'], ctx.uid), 'Application')
    f = Form(ctx.body); status = f.choice('status', STATUSES); f.done()
    if status == old['status']:
        return {'ok': True}
    applied_on = old['applied_on'] or (today() if status != 'Saved' else None)
    ctx.db.execute('UPDATE applications SET status=?, applied_on=?, updated=? WHERE id=?', (status, applied_on, now_iso(), old['id']))
    history(ctx.db, ctx.uid, old['id'], old['status'], status)
    return {'ok': True}


@app.route('DELETE', '/api/applications/{id}')
def delete_app(ctx):
    one(ctx.db, 'SELECT id FROM applications WHERE id=? AND user_id=?', (ctx.params['id'], ctx.uid), 'Application')
    ctx.db.execute('DELETE FROM applications WHERE id=? AND user_id=?', (ctx.params['id'], ctx.uid))
    return {'ok': True}


@app.route('GET', '/api/interviews')
def list_interviews(ctx):
    sql = """SELECT i.*, a.company, a.role, a.status FROM interviews i JOIN applications a ON a.id=i.application_id WHERE i.user_id=?"""
    args = [ctx.uid]
    if ctx.q('outcome') in OUTCOMES:
        sql += ' AND i.outcome=?'; args.append(ctx.q('outcome'))
    if ctx.q('when') == 'upcoming':
        sql += ' AND i.scheduled_at>=?'; args.append(datetime.now().strftime('%Y-%m-%dT%H:%M'))
    return rows(ctx.db.execute(sql + ' ORDER BY i.scheduled_at DESC', args))


@app.route('POST', '/api/interviews')
def create_interview(ctx):
    v, a = interview_form(ctx.db, ctx.uid, ctx.body)
    iid = ctx.db.execute("""INSERT INTO interviews(user_id,application_id,scheduled_at,duration_min,format,round_name,contact,prep_notes,outcome,created)
        VALUES(?,?,?,?,?,?,?,?,?,?)""", (ctx.uid, a['id'], v['scheduled_at'], v['duration_min'], v['format'], v['round_name'], v['contact'], v['prep_notes'], v['outcome'], now_iso())).lastrowid
    if a['status'] in ('Saved', 'Applied', 'Screening'):  # an interview implies the application is in the interview stage
        ctx.db.execute('UPDATE applications SET status=?, applied_on=COALESCE(applied_on, ?), updated=? WHERE id=?', ('Interviewing', today(), now_iso(), a['id']))
        history(ctx.db, ctx.uid, a['id'], a['status'], 'Interviewing', 'Interview added')
    return 201, {'id': iid}


@app.route('PUT', '/api/interviews/{id}')
def update_interview(ctx):
    one(ctx.db, 'SELECT id FROM interviews WHERE id=? AND user_id=?', (ctx.params['id'], ctx.uid), 'Interview')
    v, a = interview_form(ctx.db, ctx.uid, ctx.body)
    ctx.db.execute("""UPDATE interviews SET application_id=?,scheduled_at=?,duration_min=?,format=?,round_name=?,contact=?,prep_notes=?,outcome=? WHERE id=? AND user_id=?""",
                   (a['id'], v['scheduled_at'], v['duration_min'], v['format'], v['round_name'], v['contact'], v['prep_notes'], v['outcome'], ctx.params['id'], ctx.uid))
    return {'ok': True}


@app.route('DELETE', '/api/interviews/{id}')
def delete_interview(ctx):
    one(ctx.db, 'SELECT id FROM interviews WHERE id=? AND user_id=?', (ctx.params['id'], ctx.uid), 'Interview')
    ctx.db.execute('DELETE FROM interviews WHERE id=? AND user_id=?', (ctx.params['id'], ctx.uid))
    return {'ok': True}


@app.route('GET', '/api/export/applications')
def export_apps(ctx):
    data = [[a['company'], a['role'], a['status'], a['source'], a['location'], a['work_mode'], a['salary_min'], a['salary_max'], a['currency'],
             a['applied_on'], a['follow_up'], a['interview_count'], a['job_url'], a['notes']] for a in app_query(ctx)]
    return Csv(f'careerboard-applications-{today()}.csv', ['Company', 'Role', 'Status', 'Source', 'Location', 'Work mode', 'Salary min', 'Salary max', 'Currency',
                                                           'Applied on', 'Follow-up', 'Interviews', 'Job URL', 'Notes'], data)


if __name__ == '__main__':
    app.main(8002)
