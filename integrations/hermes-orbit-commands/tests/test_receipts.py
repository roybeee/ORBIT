import asyncio
import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path

HERE = Path(__file__).parents[1] / 'receipts.py'
spec = importlib.util.spec_from_file_location('orbit_receipts_under_test', HERE)
receipts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receipts)

class Platform:
    def __init__(self, value):
        self.value = value


SLACK = Platform('slack')
ORIGIN = {'workspace': 'T1', 'channel': 'C0B31KPEB61', 'user': 'U1', 'message_ts': '1790313921.880000', 'thread_ts': '', 'event_id': 'Ev1'}
TEXT = '오후 2시 미팅 진행, 참석자 이선미교수, 박혜영대표, 김동경대표, 나. 4시·6시 회의도 등록해 줘'


def event(text=TEXT, platform=SLACK, **source):
    src = types.SimpleNamespace(platform=platform, chat_id='C0B31KPEB61', user_id='U1', scope_id='T1', thread_id=None, is_bot=False, message_id=None)
    for key, value in source.items():
        setattr(src, key, value)
    return types.SimpleNamespace(text=text, message_id='1790313921.880000', source=src, metadata={}, internal=False)


class Adapter:
    def __init__(self):
        self.sent = []

    async def send(self, chat_id, content, reply_to=None, metadata=None):
        self.sent.append((chat_id, content))


class ReceiptsTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.posts, self.replies = [], []
        self.r = receipts.Receipts(Path(self.home.name) / 'state' / 'requests.sqlite3', post=self.post, origin=lambda: dict(ORIGIN))
        self.r.kick = lambda: None  # deliveries run only when a test flushes
        self.adapter = Adapter()
        self.gateway = types.SimpleNamespace(adapters={SLACK: self.adapter})

    def tearDown(self):
        self.home.cleanup()

    def post(self, body):
        self.posts.append(body)
        return self.replies.pop(0) if self.replies else (200, {'status': 'ok'})

    def dispatch(self, ev=None):
        async def run():
            result = self.r.on_dispatch(event=ev or event(), gateway=self.gateway)
            await asyncio.sleep(0)
            return result
        return asyncio.run(run())

    def outbox(self):
        with self.r.db() as conn:
            return [row['body'] for row in conn.execute('SELECT body FROM outbox ORDER BY seq')]

    def test_every_slack_message_is_saved_before_the_agent_runs(self):
        self.r.quota_state = lambda: None
        self.assertIsNone(self.dispatch(), 'with the provider available the agent runs as usual')
        self.assertEqual(len(self.outbox()), 1, 'saved locally before anything else')
        self.r.flush()
        self.assertEqual(self.posts[0]['action'], 'receive')
        self.assertEqual(self.posts[0]['text'], TEXT)
        self.assertEqual(self.posts[0]['source'], {'platform': 'slack', 'workspaceId': 'T1', 'requesterId': 'U1', 'channelId': 'C0B31KPEB61', 'messageTs': '1790313921.880000'})
        self.assertEqual(self.outbox(), [])
        self.assertEqual(self.adapter.sent, [])

    def test_a_spent_quota_answers_with_the_real_cause_and_skips_the_agent(self):
        self.r.quota_state = lambda: {'kind': 'quota', 'retry_after': 79663}
        self.r.accepted = lambda source: True
        self.assertEqual(self.dispatch(), {'action': 'skip', 'reason': 'orbit_provider_quota'})
        reply = self.adapter.sent[0][1]
        self.assertIn('AI 사용량 한도 소진', reply)
        self.assertIn('인증 정보 문제는 아니므로', reply)
        self.assertIn('ORBIT에 보관했습니다', reply)
        self.assertIn('아직 일정·할 일은 등록되지 않았습니다', reply)
        self.assertNotIn('authentication', reply.lower())
        self.r.flush()
        self.assertEqual([p['action'] for p in self.posts], ['receive', 'outcome'], 'the receipt is delivered before its outcome')
        self.assertEqual((self.posts[1]['outcome'], self.posts[1]['kind'], self.posts[1]['retryAfterSeconds']), ('limit', 'quota', 79663))

    def test_a_requester_orbit_refuses_is_not_told_the_request_was_kept_and_their_text_stays_in_hermes(self):
        self.r.quota_state = lambda: None
        self.replies = [(403, {'error': 'source_scope_mismatch'})]
        self.dispatch()
        self.r.flush()
        self.assertIs(self.r.accepted(receipts.slack_source(event())), False)
        self.r.quota_state = lambda: {'kind': 'rate_limit', 'retry_after': 40}
        self.assertEqual(self.dispatch()['action'], 'skip')
        reply = self.adapter.sent[0][1]
        self.assertIn('일시적 요청 제한', reply)
        self.assertNotIn('보관', reply)
        self.assertIn('다시 보내 주세요', reply)
        self.assertEqual(self.outbox(), [], 'nothing about a refused requester is sent to ORBIT again')

    def test_an_unknown_requester_is_not_asked_to_resend(self):
        self.r.quota_state = lambda: {'kind': 'quota', 'retry_after': None}
        self.dispatch()
        reply = self.adapter.sent[0][1]
        self.assertIn('보관하고 있습니다', reply)
        self.assertIn('다시 보내지 않아도 됩니다', reply)
        self.assertEqual(self.posts, [], 'no delivery happens on the gateway loop')

    def test_without_a_way_to_reply_the_agent_still_runs(self):
        self.r.quota_state = lambda: {'kind': 'quota', 'retry_after': None}
        self.gateway.adapters = {}
        self.assertIsNone(self.dispatch())
        self.r.flush()
        self.assertEqual([p['action'] for p in self.posts], ['receive'], 'the receipt is kept; the running agent reports its own outcome')

    def test_orbit_outage_keeps_order_and_retries_later(self):
        self.r.quota_state = lambda: None
        self.dispatch()
        self.r.report(receipts.build_source('T1', 'C0B31KPEB61', 'U1', '1790313921.880000'), 'answered')
        self.replies = [(503, {})]
        self.r.flush()
        self.assertEqual(len(self.outbox()), 2, 'nothing is dropped while ORBIT is unavailable')
        with self.r.db() as conn:
            conn.execute('UPDATE outbox SET next_at=0')
        self.r.flush()
        self.assertEqual([p['action'] for p in self.posts], ['receive', 'receive', 'outcome'])
        self.assertEqual(self.outbox(), [])

    def test_a_failure_the_turn_recovers_from_is_not_reported(self):
        # Hermes marks a usage-limit 429 non-retryable but then rotates credentials or falls back.
        self.r.on_api_error(status_code=429, retryable=False, error={'message': 'You exceeded your current quota'})
        self.r.on_api_success()
        self.r.on_llm_done()
        self.r.flush()
        self.assertEqual([p['outcome'] for p in self.posts], ['answered'])
        self.assertEqual(self.r.pending, {})

    def test_a_failure_without_any_later_success_is_reported_once_the_turn_is_over(self):
        self.r.on_api_error(status_code=429, retryable=True, error={'message': 'rate limited'})
        self.r.on_api_error(status_code=429, retryable=False, error={'message': 'You exceeded your current quota; retry after 3600s'})
        self.assertEqual(self.outbox(), [], 'nothing is reported while Hermes may still recover')
        self.r.settle(receipts.receipt_key(receipts.build_source('T1', 'C0B31KPEB61', 'U1', '1790313921.880000')))
        self.r.flush()
        self.assertEqual([p['outcome'] for p in self.posts], ['limit'])
        self.assertEqual((self.posts[0]['kind'], self.posts[0]['retryAfterSeconds']), ('quota', 3600))

    def test_authentication_failure_and_normal_answer(self):
        self.r.on_api_error(status_code=401, retryable=False, error={'message': 'invalid token'})
        for key in list(self.r.pending):
            self.r.settle(key)
        other = dict(ORIGIN, message_ts='1790313999.000100')
        self.r.origin = lambda: other
        self.r.on_llm_done(assistant_response='등록했습니다.')
        self.r.flush()
        self.assertEqual([(p['outcome'], p.get('kind')) for p in self.posts], [('failed', 'auth'), ('answered', None)])

    def test_non_slack_commands_and_bots_are_ignored(self):
        self.r.quota_state = lambda: {'kind': 'quota', 'retry_after': 10}
        for ev in (event(platform=Platform('telegram')), event(text='/stop'), event(is_bot=True), event(text='  ')):
            self.assertIsNone(self.dispatch(ev))
        self.assertEqual(self.outbox(), [])

    def test_long_korean_text_fits_what_orbit_accepts(self):
        text = receipts.clip('가' * 5000 + '😀' * 10)
        self.assertLessEqual(len(text.encode('utf-8')), receipts.TEXT_BYTES)
        self.assertLessEqual(len(text.encode('utf-16-le')) // 2, receipts.TEXT_UNITS)
        emoji = receipts.clip('😀' * 3000)
        self.assertLessEqual(len(emoji.encode('utf-16-le')) // 2, receipts.TEXT_UNITS)

    def test_ledger_event_id_and_workspace_are_used(self):
        ledger = types.ModuleType('gateway.slack_event_ledger')
        ledger.get_origin = lambda cid: {'workspace_scope': 'TLEDGER', 'event_id': 'EvLedger', 'message_ts': '1790313921.880000'} if cid == 'c1' else None
        sys.modules['gateway'] = types.ModuleType('gateway')
        sys.modules['gateway.slack_event_ledger'] = ledger
        try:
            ev = event()
            ev.metadata = {'slack_origin_correlation_id': 'c1'}
            source = receipts.slack_source(ev)
        finally:
            sys.modules.pop('gateway.slack_event_ledger', None)
            sys.modules.pop('gateway', None)
        self.assertEqual((source['workspaceId'], source['eventId']), ('TLEDGER', 'EvLedger'))

    def test_quota_state_reads_the_credential_pool(self):
        entry = lambda status, code: types.SimpleNamespace(last_status=status, last_error_code=code)
        pools = {}
        module = types.ModuleType('agent.credential_pool')
        module.STATUS_EXHAUSTED = 'exhausted'
        module.load_pool = lambda provider: pools[provider]
        sys.modules['agent'] = types.ModuleType('agent')
        sys.modules['agent.credential_pool'] = module

        def pool(entries, available=False, until=None):
            return types.SimpleNamespace(has_credentials=lambda: bool(entries), has_available=lambda: available, entries=lambda: entries, next_available_at=lambda: until)
        try:
            pools['openai-codex'] = pool([entry('exhausted', 429)], until=receipts.time.time() + 79663)
            state = self.r.quota_state()
            self.assertEqual(state['kind'], 'quota')
            self.assertAlmostEqual(state['retry_after'], 79663, delta=2)
            pools['openai-codex'] = pool([entry('exhausted', 429)], until=receipts.time.time() + 60)
            self.assertEqual(self.r.quota_state()['kind'], 'rate_limit')
            pools['openai-codex'] = pool([entry('exhausted', 401)])
            self.assertIsNone(self.r.quota_state(), 'an exhausted credential that is not a 429 is left to the core')
            pools['openai-codex'] = pool([entry('ok', None)], available=True)
            self.assertIsNone(self.r.quota_state())
        finally:
            sys.modules.pop('agent.credential_pool', None)
            sys.modules.pop('agent', None)


if __name__ == '__main__':
    unittest.main()
