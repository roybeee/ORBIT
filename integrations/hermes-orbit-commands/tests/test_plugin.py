import contextvars
import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

PLUGIN = Path(__file__).parents[1] / '__init__.py'
ORIGIN = {'workspace': 'TTEST', 'channel': 'CTEST', 'user': 'UTEST', 'message_ts': '1790043198.626399', 'thread_ts': '1790043198.626399', 'event_id': 'EvTEST', 'client_msg_id': ''}
URL = 'https://orbit.example/api/integrations/slack/directives'


def load():
    spec = importlib.util.spec_from_file_location('orbit_commands_plugin', PLUGIN)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Context:
    def __init__(self):
        self.tools, self.sections = {}, []

    def register_tool(self, **kwargs):
        self.tools[kwargs['name']] = kwargs

    def register_system_prompt_section(self, *args, **kwargs):
        self.sections.append(args)


class PluginTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        token = Path(self.home.name) / 'google_token.json'
        token.write_text(json.dumps({'client_id': 'cid', 'client_secret': 'csecret', 'refresh_token': 'rt', 'token_uri': 'https://oauth2.example/token',
                                     'scopes': ['https://www.googleapis.com/auth/tasks']}))
        self.env = {'HERMES_HOME': self.home.name, 'ORBIT_SLACK_DIRECTIVE_URL': URL, 'ORBIT_SLACK_INGEST_KEY': 'ingest', 'ORBIT_SLACK_SITES_BEARER': 'gate'}
        self.saved_env = {k: os.environ.get(k) for k in self.env}
        os.environ.update(self.env)
        self.plugin = load()
        self.plugin.current_origin = lambda: dict(ORIGIN)
        self.calls, self.orbit_replies, self.google_fails = [], [], False
        self.plugin.send = self.fake_send

    def tearDown(self):
        for key, value in self.saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.home.cleanup()

    def fake_send(self, req):
        url = req.full_url
        body = req.data.decode() if req.data else None
        self.calls.append({'url': url, 'method': req.get_method(), 'headers': dict(req.header_items()), 'body': body})
        if url.startswith('https://oauth2.example/token'):
            return 200, {'access_token': 'google-access'}
        if url.startswith('https://tasks.googleapis.com/'):
            return (500, {}) if self.google_fails else (200, {'id': 'gt-%d' % len(self.calls)})
        return self.orbit_replies.pop(0)

    def orbit_calls(self):
        return [c for c in self.calls if '/api/integrations/slack/' in c['url']]

    def google_creates(self):
        return [c for c in self.calls if c['url'].startswith('https://tasks.googleapis.com/')]

    def test_task_goes_to_google_tasks_and_orbit_once_even_when_retried(self):
        done = {'status': 'completed', 'target': {'type': 'task', 'id': 'slack-1', 'title': '가맹 계약서 검토'}, 'project': {'id': 'ofd', 'name': 'Old Ferry Donut'}, 'inbox': False}
        self.orbit_replies = [(200, {'ok': True}), (200, done), (200, done)]
        params = {'title': '가맹 계약서 검토', 'due': '2026-10-02', 'time': '16:00', 'project': '올드페리'}
        first = json.loads(self.plugin.add_task(params))
        second = json.loads(self.plugin.add_task(params))
        self.assertEqual(first['state'], 'completed')
        self.assertEqual(first['orbit']['project'], 'Old Ferry Donut')
        self.assertEqual(len(self.google_creates()), 1, 'a retry must not create a second Google Task')
        google_body = json.loads(self.google_creates()[0]['body'])
        self.assertEqual(google_body['due'], '2026-10-02T00:00:00.000Z')
        self.assertIn('16:00', google_body['notes'])
        preflight, *posts = self.orbit_calls()
        self.assertIn('preflight=1', preflight['url'])
        self.assertEqual(posts[0]['url'], 'https://orbit.example/api/integrations/slack/commands')
        self.assertEqual(posts[0]['headers']['Authorization'], 'Bearer ingest')
        self.assertEqual(posts[0]['headers']['Oai-sites-authorization'], 'Bearer gate')
        wire = json.loads(posts[0]['body'])
        self.assertEqual(wire['source'], {'platform': 'slack', 'workspaceId': 'TTEST', 'requesterId': 'UTEST', 'channelId': 'CTEST',
                                          'messageTs': '1790043198.626399', 'threadId': '1790043198.626399', 'eventId': 'EvTEST'})
        self.assertEqual(wire['command']['googleTask'], first['google_task'])
        self.assertEqual(wire['command']['project'], '올드페리')
        self.assertEqual(wire, json.loads(posts[1]['body']), 'a retry sends the identical request')

    def test_google_failure_stops_before_orbit(self):
        self.google_fails = True
        self.orbit_replies = [(200, {'ok': True})]
        result = json.loads(self.plugin.add_task({'title': '전화', 'due': '2026-10-02'}))
        self.assertEqual((result['state'], result['stage']), ('failed', 'google_task'))
        self.assertEqual([c['method'] for c in self.orbit_calls()], ['GET'], 'only the preflight reached ORBIT')

    def test_a_requester_orbit_rejects_creates_nothing_in_google(self):
        self.orbit_replies = [(403, {'error': 'source_scope_mismatch'})]
        result = json.loads(self.plugin.add_task({'title': '전화', 'due': '2026-10-02'}))
        self.assertEqual((result['state'], result['error']), ('failed', 'source_scope_mismatch'))
        self.assertEqual(self.google_creates(), [])

    def test_ambiguous_project_asks_by_number_and_only_the_requester_can_answer(self):
        asked = {'status': 'needs_confirmation', 'candidates': [{'number': 1, 'id': 'a', 'name': '맵달SEOUL'}, {'number': 2, 'id': 'b', 'name': '맵달BUNSIK'}]}
        done = {'status': 'completed', 'target': {'type': 'note', 'id': 'slack-2', 'title': '메모'}, 'project': {'id': 'b', 'name': '맵달BUNSIK'}}
        self.orbit_replies = [(200, asked), (200, done)]
        first = json.loads(self.plugin.add_note({'title': '메모', 'text': '내용', 'project': '맵달'}))
        self.assertEqual(first['state'], 'needs_confirmation')
        self.assertIn('1. 맵달SEOUL', first['question'])
        self.assertIn('번호로 답해 주세요', first['question'])
        self.plugin.current_origin = lambda: {**ORIGIN, 'user': 'UOTHER', 'message_ts': '1790043299.000100'}
        blocked = json.loads(self.plugin.choose({'request_id': first['request_id'], 'choice': 2}))
        self.assertEqual(blocked['error'], 'request_not_found_for_this_requester')
        self.plugin.current_origin = lambda: {**ORIGIN, 'message_ts': '1790043299.000100'}
        chosen = json.loads(self.plugin.choose({'request_id': first['request_id'], 'choice': 2}))
        self.assertEqual(chosen['state'], 'completed')
        self.assertEqual(json.loads(self.orbit_calls()[-1]['body'])['choice'], 2)

    def test_inbox_and_http_failures_are_reported_honestly(self):
        self.orbit_replies = [(200, {'status': 'completed', 'target': {'type': 'note', 'id': 'n', 'title': 't'}, 'project': {'id': 'slack-inbox', 'name': 'Slack 보관함'}, 'inbox': True}),
                              (403, {'error': 'source_scope_mismatch'})]
        inbox = json.loads(self.plugin.add_note({'title': 't', 'text': 'x'}))
        self.assertTrue(inbox['orbit']['inbox'])
        self.assertIn('Slack 보관함', inbox['note'])
        failed = json.loads(self.plugin.add_note({'title': 't2', 'text': 'y'}))
        self.assertEqual((failed['success'], failed['stage'], failed['error']), (False, 'orbit', 'source_scope_mismatch'))

    def test_without_a_slack_origin_nothing_is_sent(self):
        self.plugin.current_origin = lambda: None
        result = json.loads(self.plugin.add_task({'title': 'x', 'due': '2026-10-02'}))
        self.assertEqual(result['error'], 'slack_origin_required')
        self.assertEqual(self.calls, [])

    def test_missing_configuration_fails_closed(self):
        os.environ['ORBIT_SLACK_SITES_BEARER'] = ''
        result = json.loads(self.plugin.add_note({'title': 't', 'text': 'x'}))
        self.assertEqual(result['error'], 'orbit_configuration_required')
        self.assertEqual(self.orbit_calls(), [])

    def test_legacy_tool_keeps_calendar_behavior_and_points_to_new_tools(self):
        calendar = {'type': 'calendar_agenda', 'events': [{'provider': 'google_calendar', 'provider_event_id': 'x'}]}
        self.assertEqual(json.loads(self.plugin.legacy_sync({'provider_status': 'succeeded', 'change': calendar}))['state'], 'read_from_google')
        self.assertEqual(json.loads(self.plugin.legacy_sync({'provider_status': 'succeeded', 'change': {'kind': 'task'}}))['state'], 'use_new_tool')
        self.assertEqual(self.calls, [])

    def test_origin_comes_from_the_gateway_ledger(self):
        plugin = load()
        ledger = {'workspace_scope': 'TLEDGER', 'channel_id': 'CLEDGER', 'requesting_user': 'ULEDGER', 'message_ts': '1790000000.000001', 'thread_ts': None, 'event_id': 'Ev1', 'client_msg_id': None}
        gateway = types.ModuleType('gateway')
        ledger_module = types.ModuleType('gateway.slack_event_ledger')
        ledger_module.get_origin = lambda correlation: ledger if correlation == 'corr-1' else None
        sys.modules.update({'gateway': gateway, 'gateway.slack_event_ledger': ledger_module})
        names = {'HERMES_SESSION_PLATFORM': 'slack', 'HERMES_SESSION_ORIGIN_CORRELATION_ID': 'corr-1', 'HERMES_SESSION_SCOPE_ID': 'TMODEL',
                 'HERMES_SESSION_CHAT_ID': 'CMODEL', 'HERMES_SESSION_USER_ID': 'UMODEL', 'HERMES_SESSION_MESSAGE_ID': '1790000000.000009'}
        variables = [contextvars.ContextVar(name) for name in names]

        def inside():
            for var in variables:
                var.set(names[var.name])
            return plugin.current_origin()
        try:
            origin = contextvars.Context().run(inside)
        finally:
            sys.modules.pop('gateway.slack_event_ledger', None)
            sys.modules.pop('gateway', None)
        self.assertEqual((origin['workspace'], origin['user'], origin['message_ts'], origin['event_id']), ('TLEDGER', 'ULEDGER', '1790000000.000001', 'Ev1'))
        self.assertIsNone(contextvars.Context().run(plugin.current_origin), 'outside a Slack turn there is no origin')

    def test_registers_five_tools_and_short_guidance(self):
        ctx = Context()
        self.plugin.register(ctx)
        self.assertEqual(sorted(ctx.tools), ['orbit_slack_choose', 'orbit_slack_directive_sync', 'orbit_slack_note', 'orbit_slack_task', 'orbit_slack_today'])
        self.assertLessEqual(len(self.plugin.GUIDANCE), 1200)
        self.assertIn('needs_confirmation', self.plugin.GUIDANCE)

    def test_title_is_the_to_do_itself_without_instruction_words(self):
        self.assertIn("'추가'", self.plugin.GUIDANCE)
        self.assertIn("title 'A'", self.plugin.GUIDANCE)
        ctx = Context()
        self.plugin.register(ctx)
        title = ctx.tools['orbit_slack_task']['schema']['parameters']['properties']['title']
        self.assertIn('never add instruction words', title['description'])
        self.assertEqual(title['maxLength'], 160)

    def test_today_reads_orbit_for_the_slack_requester_only(self):
        summary = {'contract': 'orbit-slack-today-v1', 'date': '2026-09-25', 'counts': {'today': 3, 'overdue': 1, 'doing': 0, 'focus': 1, 'doneToday': 2, 'open': 9},
                   'items': [{'title': '계약서 검토', 'due': '2026-09-25', 'state': 'focus', 'status': 'todo', 'project': 'Old Ferry Donut'}], 'url': 'https://orbit.example/#today'}
        self.orbit_replies = [(200, summary)]
        result = json.loads(self.plugin.today({}))
        self.assertEqual((result['success'], result['counts']['today']), (True, 3))
        self.assertEqual(result['items'][0]['title'], '계약서 검토')
        call, = self.orbit_calls()
        self.assertEqual(call['method'], 'GET')
        self.assertIn('/api/integrations/slack/commands?', call['url'])
        self.assertIn('today=1', call['url'])
        self.assertIn('workspaceId=TTEST', call['url'])
        self.assertIn('requesterId=UTEST', call['url'])
        self.assertEqual(self.google_creates(), [], 'reading ORBIT never touches Google')

    def test_today_reports_failures_instead_of_guessing(self):
        self.orbit_replies = [(403, {'error': 'source_scope_mismatch'})]
        result = json.loads(self.plugin.today({}))
        self.assertEqual((result['success'], result['error']), (False, 'source_scope_mismatch'))
        self.plugin.current_origin = lambda: None
        self.assertEqual(json.loads(self.plugin.today({}))['error'], 'slack_origin_required')

    def test_guidance_sends_orbit_task_questions_to_the_today_tool(self):
        self.assertIn('orbit_slack_today', self.plugin.GUIDANCE)


if __name__ == '__main__':
    unittest.main()
