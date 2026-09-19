import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('migration', Path(__file__).parent.parent / 'public/downloads/hermes-discord-migrate.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)

class MigrationTest(unittest.TestCase):
    def test_only_selected_environment_keys_change(self):
        original = 'MODEL=keep\nSLACK_BOT_TOKEN=secret\nexport DISCORD_BOT_TOKEN=old\nDISCORD_BOT_TOKEN=duplicate\n'
        updated = migration.patch_env(original, {'DISCORD_BOT_TOKEN':'new'})
        self.assertIn('MODEL=keep', updated)
        self.assertIn('SLACK_BOT_TOKEN=secret', updated)
        self.assertEqual(updated.count('DISCORD_BOT_TOKEN='), 1)
    def test_deliver_and_origin_are_mapped_without_rewriting_history(self):
        jobs = [{'id':'a','deliver':'slack'}, {'id':'b','deliver':['local','slack:COLD']}, {'id':'c','deliver':'origin','origin':{'platform':'slack','chat_id':'COLD'}}]
        expected = [('a','slack','discord:222222222222222222'),('b',['local','slack:COLD'],['local','discord:333333333333333333']),('c','origin','discord:333333333333333333')]
        self.assertEqual(migration.job_changes(jobs, {'COLD':'333333333333333333'}, '222222222222222222'), expected)
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
