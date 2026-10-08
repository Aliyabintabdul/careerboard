import tempfile, unittest
from datetime import date, timedelta
from pathlib import Path
import harness
from harness import Client, Server

TODAY = date.today()
SOON = (TODAY + timedelta(days=3)).isoformat() + 'T10:00'


class CareerBoardTests(harness.AppTestCase):
    def new_app(self, c, **kw):
        body = {'company': 'Nova', 'role': 'Engineer', 'source': 'Referral', 'status': 'Applied', 'applied_on': TODAY.isoformat(), 'currency': 'AED', **kw}
        return self.assertStatus(c.post('/api/applications', body), 201)['id']

    def test_application_validation(self):
        c = self.client('val@example.com')
        e = self.assertStatus(c.post('/api/applications', {'company': '', 'role': 'X', 'status': 'Applied', 'job_url': 'ftp://x', 'salary_min': 9, 'salary_max': 5}), 400)
        self.assertTrue({'company', 'applied_on', 'job_url', 'salary_max'} <= set(e['fields']))
        future = (TODAY + timedelta(days=2)).isoformat()
        self.assertStatus(c.post('/api/applications', {'company': 'A', 'role': 'B', 'status': 'Applied', 'applied_on': future}), 400)
        self.assertStatus(c.post('/api/applications', {'company': 'A', 'role': 'B', 'status': 'Saved'}), 201)  # Saved needs no date

    def test_application_interview_relationship_and_metrics(self):
        c = self.client('rel@example.com')
        aid = self.new_app(c, follow_up=(TODAY - timedelta(days=1)).isoformat())
        self.new_app(c, company='Atlas', status='Rejected')
        iid = self.assertStatus(c.post('/api/interviews', {'application_id': aid, 'scheduled_at': SOON, 'format': 'Video', 'prep_notes': 'STAR stories'}), 201)['id']
        a = self.assertStatus(c.get(f'/api/applications/{aid}'), 200)
        self.assertEqual(a['status'], 'Interviewing')  # interview moves the application forward
        self.assertEqual([i['id'] for i in a['interviews']], [iid])
        self.assertEqual([h['to_status'] for h in a['history']], ['Interviewing', 'Applied'])
        d = self.assertStatus(c.get('/api/dashboard'), 200)
        self.assertEqual((d['applied'], d['responded'], d['response_rate'], d['interviews_upcoming'], d['overdue_followups']), (2, 1, 50, 1, 1))
        cal = c.get('/api/calendar?month=' + SOON[:7])[1]['events']
        self.assertIn('interview', [e['kind'] for e in cal])
        self.assertStatus(c.post('/api/interviews', {'application_id': aid, 'scheduled_at': 'tomorrow'}), 400)
        self.assertStatus(c.put(f'/api/interviews/{iid}', {'application_id': aid, 'scheduled_at': SOON, 'format': 'Phone', 'outcome': 'Completed'}), 200)
        self.assertEqual(c.get('/api/interviews?outcome=Completed')[1][0]['format'], 'Phone')
        self.assertStatus(c.post(f'/api/applications/{aid}/status', {'status': 'Offer'}), 200)
        self.assertEqual(len(c.get('/api/applications?status=Offer')[1]), 1)
        self.assertEqual(len(c.get('/api/applications?q=atlas')[1]), 1)
        self.assertStatus(c.delete(f'/api/applications/{aid}'), 200)
        self.assertEqual(c.get('/api/interviews')[1], [])  # interviews cascade with their application

    def test_account_isolation(self):
        a, b = self.client('ia@example.com'), self.client('ib@example.com')
        aid = self.new_app(a)
        iid = self.assertStatus(a.post('/api/interviews', {'application_id': aid, 'scheduled_at': SOON}), 201)['id']
        self.assertEqual(b.get('/api/applications')[1], [])
        self.assertEqual(b.get('/api/interviews')[1], [])
        self.assertStatus(b.get(f'/api/applications/{aid}'), 404)
        self.assertStatus(b.put(f'/api/applications/{aid}', {'company': 'x', 'role': 'y'}), 404)
        self.assertStatus(b.post('/api/interviews', {'application_id': aid, 'scheduled_at': SOON}), 400)
        self.assertStatus(b.delete(f'/api/interviews/{iid}'), 404)
        self.assertEqual(b.get('/api/dashboard')[1]['total'], 0)

    def test_csv_export_filters_and_neutralises_formulas(self):
        c = self.client('csv@example.com')
        self.new_app(c, company='@SUM(A1)', notes='=1+1')
        self.new_app(c, company='Other', status='Saved', applied_on='')
        status, text = c.get('/api/export/applications?status=Applied', raw=True)
        self.assertEqual(status, 200)
        self.assertIn("'@SUM(A1)", text); self.assertIn("'=1+1", text); self.assertNotIn('Other', text)


class Persistence(unittest.TestCase):
    def test_restart_keeps_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            srv = Server(Path(tmp) / 'p.sqlite3').start()
            c = Client(srv.port); c.register('p@example.com')
            c.post('/api/applications', {'company': 'Kept', 'role': 'Dev', 'status': 'Saved'})
            srv.stop(); srv.start()
            c2 = Client(srv.port); c2.login('p@example.com')
            self.assertEqual(c2.get('/api/applications')[1][0]['company'], 'Kept')
            srv.stop()


if __name__ == '__main__':
    unittest.main()
