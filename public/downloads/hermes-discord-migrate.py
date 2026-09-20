#!/usr/bin/env python3
"""Migrate an installed Hermes profile from Slack to Discord without deleting history.
Run with the Python interpreter used by the existing Hermes installation.
Credentials are prompted invisibly; never pass tokens on the command line.
"""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from urllib.request import Request
from urllib.error import HTTPError

ID = re.compile(r"^[0-9]{17,20}$")

def api(token, path):
    request = Request('https://discord.com/api/v10' + path,
                      headers={'Authorization': 'Bot ' + token, 'User-Agent': 'OrbitMigration/1.0'})
    # Discord API endpoints below are fixed; no user-controlled host or redirects.
    from urllib.request import HTTPRedirectHandler, build_opener
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    try:
        with build_opener(NoRedirect).open(request, timeout=12) as response:
            return json.loads(response.read(2_000_000))
    except HTTPError as error:
        raise RuntimeError('Discord HTTP %s: 봇 토큰·서버·채널 권한을 확인하세요.' % error.code) from None

def read_env(text):
    values = {}
    for line in text.splitlines():
        match = re.match(r'^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$', line)
        if match:
            values[match[1]] = match[2].strip('\"\'')
    return values

def patch_env(text, changes):
    remaining = dict(changes)
    output = []
    for line in text.splitlines():
        match = re.match(r'^\s*(?:export\s+)?([A-Z0-9_]+)\s*=', line)
        if match and match[1] in changes:
            key = match[1]
            if key in remaining:
                output.append(key + '=' + remaining.pop(key))
        else:
            output.append(line)
    output.extend(key + '=' + value for key, value in remaining.items())
    return '\n'.join(output) + '\n'

def target(value, channel_map, default_channel):
    if value == 'slack':
        mapped = channel_map.get('slack')
        if not mapped or not ID.fullmatch(str(mapped)):
            raise ValueError('기본 Slack 수신처도 channel-map의 slack 키로 명시해야 합니다.')
        return 'discord:' + str(mapped)
    if isinstance(value, str) and value.startswith('slack:'):
        old = value[6:]
        # A Slack thread is a separate destination. Never collapse it into its
        # parent channel, which can disclose a private approval or result.
        mapped = channel_map.get(old)
        if not mapped or not ID.fullmatch(str(mapped)):
            raise ValueError('Slack 수신처 %s에 해당하는 Discord 채널 매핑이 필요합니다.' % old)
        return 'discord:' + str(mapped)
    return value

def job_changes(jobs, channel_map, default_channel):
    updates = []
    for job in jobs:
        # Disabled/completed jobs are historical records, not delivery routes.
        if job.get('enabled') is False or job.get('state') == 'completed':
            continue
        delivery = job.get('deliver', 'origin')
        def resolve(value):
            origin = job.get('origin') or {}
            if value in (None, 'origin') and origin.get('platform') == 'slack':
                destination = str(origin.get('chat_id', ''))
                if origin.get('thread_id'):
                    destination += ':' + str(origin['thread_id'])
                return target('slack:' + destination, channel_map, default_channel)
            return target(value, channel_map, default_channel)
        changed = [resolve(v) for v in delivery] if isinstance(delivery, list) else resolve(delivery)
        # Explicit Slack instructions can also occur in jobs with local delivery.
        if re.search(r'slack|슬랙', str(job.get('prompt', '')), re.I):
            raise ValueError('예약 %s 본문에 Slack 전용 지시가 있어 내용을 먼저 수정해야 합니다.' % job.get('id'))
        if changed != delivery:
            updates.append((str(job['id']), delivery, changed))
    return updates

def atomic_write(path, text):
    descriptor, temporary = tempfile.mkstemp(prefix='.discord-', dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def backup(profile, names):
    directory = profile / 'discord-migration-backups' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    directory.mkdir(parents=True, mode=0o700)
    directory.parent.chmod(0o700)
    directory.chmod(0o700)
    for name in names:
        path = profile / name
        if path.is_file():
            dest = directory / name
            dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copy2(path, dest)
            dest.chmod(0o600)
    return directory

def ensure_unique_bot(profile, token):
    root = profile.parent.parent if profile.parent.name == 'profiles' else profile
    peers = [root] + list((root / 'profiles').glob('*'))
    for peer in peers:
        if peer.resolve() == profile.resolve():
            continue
        path = peer / '.env'
        if path.is_file() and read_env(path.read_text()).get('DISCORD_BOT_TOKEN') == token:
            raise ValueError('다른 프로필에 같은 Discord 봇 토큰이 있습니다: ' + peer.name)

def staged_discord(config, channels):
    # Hermes seeds per-profile extras from this top-level section. Set both
    # layers so an existing wildcard or free-response value cannot survive.
    allowed = ','.join(sorted(set(channels)))
    settings = {'allowed_channels': allowed, 'require_mention': True,
                'free_response_channels': '', 'auto_thread': True}
    config.setdefault('discord', {}).update(settings)
    platform = config.setdefault('platforms', {}).setdefault('discord', {})
    platform['enabled'] = True
    platform.setdefault('extra', {}).update(settings)
    config['group_sessions_per_user'] = True
    return allowed

REQUIRED_CHECKS = ('owner_command', 'profile_execution', 'progress_and_result',
                   'orbit_project_record', 'approval_defer_reject_stop',
                   'unauthorized_rejected', 'duplicate_restart_retry',
                   'scheduled_delivery', 'attachments_threads')

def validate_cutover_evidence(path, receipt, profile):
    if not path:
        raise ValueError('실제 업무 검증 보고서 --verification이 필요합니다. Slack을 유지합니다.')
    evidence = json.loads(path.read_text())
    for key, value in [('profile', str(profile)), ('bot', receipt['bot']),
                       ('channel', receipt['channel']), ('probe', receipt['probe'])]:
        if evidence.get(key) != value:
            raise ValueError('검증 보고서의 대상이 현재 stage와 다릅니다: ' + key)
    if not evidence.get('runId') or not evidence.get('orbitRecordId'):
        raise ValueError('실제 HERMES 실행 ID와 ORBIT 기록 ID가 필요합니다.')
    for name in REQUIRED_CHECKS:
        check = evidence.get('checks', {}).get(name, {})
        if check.get('passed') is not True or not isinstance(check.get('evidence'), str) or not check['evidence'].strip():
            raise ValueError('실제 검증이 완료되지 않았습니다: ' + name)
    return evidence

def verify_gateway_receipt(token, channel, user, bot, probe, since):
    messages = api(token, '/channels/' + channel + '/messages?limit=100')
    requests = [m for m in messages if m.get('author', {}).get('id') == user and probe in m.get('content', '') and m.get('timestamp', '') >= since]
    for request in requests:
        if any(m.get('author', {}).get('id') == bot and m.get('message_reference', {}).get('message_id') == request['id'] for m in messages):
            return True
        # Hermes may have created a thread on the mention (thread ID = starter ID).
        try:
            replies = api(token, '/channels/' + request['id'] + '/messages?limit=50')
        except RuntimeError:
            continue
        if any(m.get('author', {}).get('id') == bot and m['id'] != request['id'] and m.get('timestamp', '') >= request.get('timestamp', '') for m in replies):
            return True
    return False

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['inspect', 'stage', 'cutover'])
    parser.add_argument('--profile', type=Path, default=Path('~/.hermes'))
    parser.add_argument('--hermes-source', type=Path)
    parser.add_argument('--channel-map', type=Path, help='JSON: Slack channel ID -> Discord channel ID')
    parser.add_argument('--verification', type=Path, help='실제 실행 ID·ORBIT 기록 ID와 9개 검증 근거를 담은 JSON')
    parser.add_argument('--service', help='현재 프로필의 systemd 사용자 서비스 이름. 지정한 서비스만 재시작합니다.')
    args = parser.parse_args()
    profile = args.profile.expanduser().resolve()
    if not (profile / 'config.yaml').is_file():
        parser.error('기존 Hermes 프로필의 config.yaml을 찾지 못했습니다.')
    if args.service and not re.fullmatch(r'[A-Za-z0-9_.@-]+', args.service):
        parser.error('서비스 이름을 확인하세요.')
    source = args.hermes_source.expanduser().resolve() if args.hermes_source else Path('~/.hermes/hermes-agent').expanduser().resolve()
    if not (source / 'gateway' / 'config.py').is_file():
        parser.error('--hermes-source에 기존 Hermes 소스 폴더를 지정하세요.')
    sys.path.insert(0, str(source))
    os.environ['HERMES_HOME'] = str(profile)
    import yaml
    from cron.jobs import list_jobs, update_job
    env_path = profile / '.env'
    original_env = env_path.read_text() if env_path.exists() else ''
    current = read_env(original_env)
    jobs = list_jobs(include_disabled=True)
    slack_jobs = [j for j in jobs if 'slack' in json.dumps(j.get('deliver', '')) or (j.get('origin') or {}).get('platform') == 'slack']
    print('프로필:', profile)
    print('Slack 예약:', len(slack_jobs), '/ Discord 토큰 설정:', bool(current.get('DISCORD_BOT_TOKEN')))
    if args.action == 'inspect':
        for job in slack_jobs:
            print('예약:', job.get('id'), '/ 수신처:', job.get('deliver', 'origin'))
        print('대화 이력과 세션 파일은 변경하지 않습니다.')
        return
    config_path = profile / 'config.yaml'
    config = yaml.safe_load(config_path.read_text()) or {}
    if not isinstance(config, dict):
        raise RuntimeError('config.yaml 형식을 확인하세요.')
    receipt_path = profile / 'discord-migration.json'
    if args.action == 'stage':
        token = getpass.getpass('Discord 봇 토큰 (화면에 표시되지 않음): ').strip()
        user = input('본인의 Discord 사용자 ID: ').strip()
        channel = input('이 프로필의 Discord 수신 채널 ID: ').strip()
        if not ID.fullmatch(user) or not ID.fullmatch(channel) or not re.fullmatch(r'[A-Za-z0-9._-]{30,300}', token):
            raise ValueError('ID 또는 봇 토큰 형식을 확인하세요.')
        bot = api(token, '/users/@me')
        selected = api(token, '/channels/' + channel)
        if not bot.get('bot') or selected.get('type') != 0 or not selected.get('guild_id'):
            raise ValueError('서버의 일반 텍스트 채널과 봇 토큰이 필요합니다.')
        api(token, '/guilds/' + selected['guild_id'] + '/members/' + user)
        api(token, '/channels/' + channel + '/messages?limit=1')
        ensure_unique_bot(profile, token)
        mapping = json.loads(args.channel_map.read_text()) if args.channel_map else {}
        if not isinstance(mapping, dict):
            raise ValueError('채널 매핑은 JSON 객체여야 합니다.')
        channels = {channel}
        for destination in mapping.values():
            if not ID.fullmatch(str(destination)):
                raise ValueError('Discord 채널 ID 형식을 확인하세요.')
            destination_info = api(token, '/channels/' + str(destination))
            if destination_info.get('guild_id') != selected['guild_id'] or destination_info.get('type') not in (0, 11, 12):
                raise ValueError('모든 수신처는 같은 Discord 서버의 텍스트 채널 또는 스레드여야 합니다.')
            channels.add(str(destination))
        saved = backup(profile, ['.env', 'config.yaml', 'gateway.json', 'cron/jobs.json', 'discord-migration.json'])
        allowed = staged_discord(config, channels)
        changes = {'DISCORD_BOT_TOKEN':token, 'DISCORD_ALLOWED_USERS':user, 'DISCORD_ALLOWED_ROLES':'',
                   'DISCORD_ALLOW_ALL_USERS':'false', 'DISCORD_HOME_CHANNEL':channel,
                   'DISCORD_HOME_CHANNEL_NAME':'ORBIT', 'DISCORD_REQUIRE_MENTION':'true',
                   'DISCORD_FREE_RESPONSE_CHANNELS':'', 'DISCORD_ALLOWED_CHANNELS':allowed,
                   'DISCORD_ALLOW_BOTS':'none', 'DISCORD_COMMAND_SYNC_POLICY':'off',
                   'DISCORD_HISTORY_BACKFILL':'false'}
        # Shared channel contents are not silently imported into the owner's agent.
        atomic_write(env_path, patch_env(original_env, changes))
        atomic_write(config_path, yaml.safe_dump(config, allow_unicode=True, sort_keys=False))
        probe = 'ORBIT-연결확인-' + os.urandom(4).hex()
        receipt = {'user':user, 'channel':channel, 'bot':bot['id'], 'probe':probe,
                   'guild':selected['guild_id'], 'channels':sorted(channels),
                   'since':datetime.now(timezone.utc).isoformat(), 'backup':str(saved), 'stage':'configured'}
        atomic_write(receipt_path, json.dumps(receipt, ensure_ascii=False, indent=2))
        print('Discord 설정 저장. 백업:', saved)
        print('게이트웨이 재시작 후 채널에서 봇을 멘션하고 다음 문구를 보내세요:', probe)
    else:
        if not receipt_path.exists():
            raise RuntimeError('stage로 Discord를 먼저 연결하세요.')
        receipt = json.loads(receipt_path.read_text())
        validate_cutover_evidence(args.verification, receipt, profile)
        token = current.get('DISCORD_BOT_TOKEN', '')
        if not verify_gateway_receipt(token, receipt['channel'], receipt['user'], receipt['bot'], receipt['probe'], receipt['since']):
            raise RuntimeError('Discord에서 본인의 연결확인 메시지와 HERMES 답변을 확인하지 못했습니다. Slack을 유지합니다.')
        mapping = json.loads(args.channel_map.read_text()) if args.channel_map else {}
        if not isinstance(mapping, dict):
            raise ValueError('채널 매핑은 JSON 객체여야 합니다.')
        updates = job_changes(jobs, mapping, receipt['channel'])
        # Validate every destination before changing any job.
        for destination in set(mapping.values()):
            if not ID.fullmatch(str(destination)):
                raise ValueError('Discord 채널 ID 형식을 확인하세요.')
            selected = api(token, '/channels/' + str(destination))
            if selected.get('guild_id') != receipt.get('guild') or str(destination) not in receipt.get('channels', []):
                raise ValueError('stage에서 검증한 같은 서버의 허용 수신처만 사용할 수 있습니다.')
        saved = backup(profile, ['.env', 'config.yaml', 'gateway.json', 'cron/jobs.json', 'discord-migration.json'])
        applied = []
        try:
            for job_id, old, new in updates:
                if update_job(job_id, {'deliver':new}) is None:
                    raise RuntimeError('예약 수신처를 변경하지 못했습니다: ' + job_id)
                applied.append((job_id, old))
            # Disable the adapter in all recognized config layers; retain history.
            config.setdefault('platforms', {}).setdefault('slack', {})['enabled'] = False
            config['platforms']['slack'].pop('token', None)
            atomic_write(config_path, yaml.safe_dump(config, allow_unicode=True, sort_keys=False))
            legacy = profile / 'gateway.json'
            if legacy.exists():
                obj = json.loads(legacy.read_text())
                obj.setdefault('platforms', {}).setdefault('slack', {})['enabled'] = False
                obj['platforms']['slack'].pop('token', None)
                atomic_write(legacy, json.dumps(obj, ensure_ascii=False, indent=2))
            atomic_write(env_path, patch_env(original_env, {'SLACK_BOT_TOKEN':'', 'SLACK_APP_TOKEN':''}))
            receipt['stage'] = 'cutover'
            receipt['cutoverBackup'] = str(saved)
            receipt['migratedJobs'] = [j[0] for j in updates]
            atomic_write(receipt_path, json.dumps(receipt, ensure_ascii=False, indent=2))
        except Exception:
            for job_id, old in reversed(applied):
                update_job(job_id, {'deliver':old})
            for name in ['.env', 'config.yaml', 'gateway.json', 'discord-migration.json']:
                if (saved / name).exists():
                    atomic_write(profile / name, (saved / name).read_text())
            raise
        print('Discord 전환 설정 완료. 예약 이전:', len(updates), '/ 백업:', saved)
        print('과거 Slack 대화·세션 기록은 그대로 보존했습니다.')
    if args.service:
        result = subprocess.run(['systemctl', '--user', 'restart', args.service], check=False)
        if result.returncode:
            raise RuntimeError('설정은 저장했지만 서비스 재시작에 실패했습니다. 해당 프로필의 서비스를 확인하세요.')
        print('지정한 게이트웨이 서비스를 재시작했습니다.')
    else:
        print('이 프로필의 기존 Hermes gateway 서비스를 재시작하세요.')

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('전환 중단:', type(error).__name__, str(error) if isinstance(error, (RuntimeError, ValueError)) else '설치 경로와 Hermes Python 환경을 확인하세요.', file=sys.stderr)
        sys.exit(1)
