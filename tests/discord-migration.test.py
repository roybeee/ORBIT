import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
from unittest.mock import patch
from types import SimpleNamespace
spec = importlib.util.spec_from_file_location('migration', Path(__file__).parent.parent / 'public/downloads/hermes-discord-migrate.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)

class MigrationTest(unittest.TestCase):
    def test_restore_preserves_sessions_and_job_execution_counters(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'.env').write_text('SLACK_BOT_TOKEN=old');(root/'config.yaml').write_text('slack: enabled')
            (root/'cron').mkdir();(root/'cron/jobs.json').write_text('{"repeat":3}')
            saved=migration.backup(root,['.env','config.yaml','cron/jobs.json'])
            (root/'.env').write_text('DISCORD_BOT_TOKEN=new');(root/'discord-migration.json').write_text('{}')
            (root/'state.db').write_text('sessions unchanged');(root/'cron/jobs.json').write_text('{"repeat":4}')
            migration.restore_settings(root,saved)
            self.assertEqual((root/'.env').read_text(),'SLACK_BOT_TOKEN=old')
            self.assertFalse((root/'discord-migration.json').exists())
            self.assertEqual((root/'cron/jobs.json').read_text(),'{"repeat":4}')
            self.assertEqual((root/'state.db').read_text(),'sessions unchanged')
            self.assertEqual(saved.stat().st_mode & 0o777,0o700)
            self.assertEqual((saved/'.env').stat().st_mode & 0o777,0o600)
    def test_service_restart_also_requires_active_status(self):
        with patch.object(migration.subprocess,'run',side_effect=[SimpleNamespace(returncode=0),SimpleNamespace(returncode=1)]):
            with self.assertRaises(RuntimeError):migration.restart_service('hermes-gateway')
    def test_channel_restriction_replaces_wildcards_in_both_config_layers(self):
        config={'discord':{'allowed_channels':'*','free_response_channels':'*'},'platforms':{'discord':{'extra':{'allowed_channels':'*'}}}}
        allowed=migration.staged_discord(config,['222222222222222222'])
        self.assertEqual(allowed,'222222222222222222')
        self.assertEqual(config['discord']['allowed_channels'],allowed)
        self.assertEqual(config['platforms']['discord']['extra']['allowed_channels'],allowed)
        self.assertEqual(config['discord']['free_response_channels'],'')
    def test_thread_delivery_requires_exact_mapping(self):
        jobs=[{'id':'a','deliver':'origin','origin':{'platform':'slack','chat_id':'COLD','thread_id':'123.456'}}]
        with self.assertRaises(ValueError):migration.job_changes(jobs,{'COLD':'333333333333333333'},'222222222222222222')
        self.assertEqual(migration.job_changes(jobs,{'COLD:123.456':'333333333333333333'},'222222222222222222')[0][2],'discord:333333333333333333')
    def test_ambiguous_default_and_natural_language_slack_block_cutover(self):
        for job in [{'id':'a','deliver':'slack'},{'id':'b','deliver':'local','prompt':'이 결과는 슬랙 승인함으로 보내세요.'}]:
            with self.assertRaises(ValueError):migration.job_changes([job],{},'222222222222222222')
    def test_disabled_historical_jobs_are_not_rewritten(self):
        jobs=[{'id':'a','enabled':False,'deliver':'slack:COLD','prompt':'Slack으로 보내라'},{'id':'b','state':'completed','deliver':'slack:COLD'}]
        self.assertEqual(migration.job_changes(jobs,{},'222222222222222222'),[])
    def test_shared_bot_token_is_rejected_without_printing_secret(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);peer=root/'profiles'/'team';peer.mkdir(parents=True)
            (peer/'.env').write_text('DISCORD_BOT_TOKEN=private-test-token')
            with self.assertRaises(ValueError) as error:migration.ensure_unique_bot(root,'private-test-token')
            self.assertNotIn('private-test-token',str(error.exception))
    def test_cutover_requires_every_live_check_and_current_stage_identity(self):
        receipt={'bot':'bot','channel':'channel','probe':'current-probe'}
        with self.assertRaises(ValueError):migration.validate_cutover_evidence(None,receipt,Path('/profile'))
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'evidence.json'
            evidence={'profile':'/profile',**receipt,'runId':'run-1','orbitRecordId':'record-1','checks':{name:{'passed':True,'evidence':'test receipt'} for name in migration.REQUIRED_CHECKS}}
            path.write_text(json.dumps(evidence));migration.validate_cutover_evidence(path,receipt,Path('/profile'))
            evidence['checks']['scheduled_delivery']['passed']=False
            path.write_text(json.dumps(evidence))
            with self.assertRaises(ValueError):migration.validate_cutover_evidence(path,receipt,Path('/profile'))
    def test_only_selected_environment_keys_change(self):
        original = 'MODEL=keep\nSLACK_BOT_TOKEN=secret\nexport DISCORD_BOT_TOKEN=old\nDISCORD_BOT_TOKEN=duplicate\n'
        updated = migration.patch_env(original, {'DISCORD_BOT_TOKEN':'new'})
        self.assertIn('MODEL=keep', updated)
        self.assertIn('SLACK_BOT_TOKEN=secret', updated)
        self.assertEqual(updated.count('DISCORD_BOT_TOKEN='), 1)
    def test_deliver_and_origin_are_mapped_without_rewriting_history(self):
        jobs = [{'id':'a','deliver':'slack'}, {'id':'b','deliver':['local','slack:COLD']}, {'id':'c','deliver':'origin','origin':{'platform':'slack','chat_id':'COLD'}}]
        expected = [('a','slack','discord:222222222222222222'),('b',['local','slack:COLD'],['local','discord:333333333333333333']),('c','origin','discord:333333333333333333')]
        self.assertEqual(migration.job_changes(jobs, {'slack':'222222222222222222','COLD':'333333333333333333'}, '222222222222222222'), expected)
        self.assertEqual(jobs[2]['origin']['platform'], 'slack')
    def test_missing_mappings_and_embedded_slack_commands_stop_before_changes(self):
        with self.assertRaises(ValueError):
            migration.job_changes([{'id':'a','deliver':'slack:COLD'}], {}, '222222222222222222')
        with self.assertRaises(ValueError):
            migration.job_changes([{'id':'a','deliver':'slack','prompt':'send platform=slack'}], {}, '222222222222222222')
    def test_other_delivery_destinations_are_unchanged(self):
        self.assertEqual(migration.job_changes([{'id':'a','deliver':'telegram'}, {'id':'b','deliver':'origin','origin':{'platform':'discord'}}], {}, '222222222222222222'), [])
    def test_origin_in_multiple_destinations_is_mapped(self):
        jobs = [{'id':'a','deliver':['origin','local'],'origin':{'platform':'slack','chat_id':'COLD'}}]
        self.assertEqual(migration.job_changes(jobs, {'COLD':'333333333333333333'}, '222222222222222222'), [('a',['origin','local'],['discord:333333333333333333','local'])])
        with self.assertRaises(ValueError):
            migration.job_changes([{'id':'b','deliver':'local','prompt':'send platform=slack'}], {}, '222222222222222222')

if __name__ == '__main__': unittest.main()
