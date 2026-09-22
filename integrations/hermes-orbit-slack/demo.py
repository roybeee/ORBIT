"""Local component demo: real plugin + Hermes ledger + SQLite + loopback HTTP.
Remote ORBIT and Slack are explicitly synthetic fixtures, NOT a backend proof.
Run with pytest available (the shared ledger fixture is reused).
"""
import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).parent / 'tests'))
from test_plugin import PAYLOAD, load, origin


def main():
    saved = {}
    calls = []
    approval = {}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass
        def respond(self, value):
            body = json.dumps(value).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def do_POST(self):
            calls.append('POST receipt')
            saved.update(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            self.respond({'id': 'fixture-receipt'})
        def do_GET(self):
            path = urlsplit(self.path).path
            if path == '/api/auth.test':
                calls.append('GET fixture Slack auth')
                self.respond({'ok': True, 'team_id': 'T_TEST'})
            elif path == '/api/conversations.replies':
                calls.append('GET fixture Slack approval')
                self.respond({'ok': True, 'messages': [approval]})
            else:
                calls.append('GET receipt and target')
                self.respond({'id': 'fixture-receipt', 'status': 'completed', **saved,
                              'target': {'id': 'fixture-task', 'type': 'task', 'task': {
                                  'id': 'fixture-task', 'projectId': 'project-a',
                                  'title': PAYLOAD['change']['text'], 'due': PAYLOAD['change']['due']}}})
    with tempfile.TemporaryDirectory(prefix='orbit-demo-') as home:
        os.environ['HERMES_HOME'] = home
        os.environ['ORBIT_SLACK_DIRECTIVE_URL'] = 'https://fixture.invalid/directives'
        os.environ['ORBIT_SLACK_INGEST_KEY'] = 'synthetic-not-a-secret'
        os.environ['SLACK_BOT_TOKEN'] = 'synthetic-not-a-secret'
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def configure(plugin):
            real_http = plugin.http_json
            def local_http(url, token, method='GET', body=None):
                parsed = urlsplit(url)
                assert parsed.hostname in ('fixture.invalid', 'slack.com')
                local_url = f'http://127.0.0.1:{server.server_port}' + parsed.path
                if parsed.query:
                    local_url += '?' + parsed.query
                return real_http(local_url, token, method, body)
            plugin.http_json = local_http
            return plugin
        try:
            plugin = configure(load())
            options = [{'label': 'Sample task', 'destination': 'orbit', 'project': {'id': 'project-a'}, 'change': PAYLOAD['change']},
                       {'label': 'Sample knowledge-base note', 'destination': 'knowledge_base', 'change': {'kind': 'note', 'title': 'Sample', 'text': 'Sample only', 'date': '2026-09-22'}}]
            with origin():
                pending = json.loads(plugin.sync_directive(dict(PAYLOAD, alternatives=options)))
            assert pending['state'] == 'needs_confirmation' and not calls
            plugin = configure(load())  # Durable request survives module reload.
            approval.update(user='U_TEST', ts='1790000000.000003', text=f"ORBIT 승인 {pending['request_id']} 1")
            with origin(event='Ev-approval', client='client-approval', ts=approval['ts']):
                first = json.loads(plugin.sync_directive({'request_id': pending['request_id']}))
                replay = json.loads(plugin.sync_directive({'request_id': pending['request_id']}))
            with plugin.database() as db:
                rows = db.execute('SELECT state,selected,remote_id FROM requests').fetchall()
            assert first['success'] and replay['success']
            assert len(rows) == 1 and rows[0]['state'] == 'completed' and rows[0]['selected']
            assert calls.count('POST receipt') == 1
            assert saved['source']['eventId'] == 'Ev1'
            print(json.dumps({'demo': 'actual component / synthetic remote fixtures', 'production_verified': False,
                              'pending_before_approval': pending['state'], 'restart_resume': first['state'],
                              'replay': replay['state'], 'durable_request_rows': len(rows),
                              'receipt_posts': calls.count('POST receipt'), 'origin_preserved': True,
                              'http_calls': calls}, ensure_ascii=False, indent=2))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    main()
