#!/usr/bin/env python3
"""Prepare an existing local Hermes profile for Orbit; never install a model provider.

Run on the Mac that already runs Hermes. Secrets stay inside that profile.
No network, gateway restart, tunnel publication, or model call is performed here.
"""
import argparse
import datetime
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile


def private_write(path, text):
    fd, temporary = tempfile.mkstemp(prefix="orbit-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(text)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description="기존 Hermes를 Orbit에 연결할 준비를 합니다.")
    parser.add_argument("--profile-home", required=True, type=Path,
                        help="현재 사용하는 Hermes 프로필 폴더")
    parser.add_argument("--max-concurrent-runs", type=int, default=10, help="동시 Hermes 실행 수 (기본 10)")
    args = parser.parse_args()
    if not 2 <= args.max_concurrent_runs <= 100:
        parser.error("동시 실행 수는 2~100 사이로 지정해 주세요.")
    profile = args.profile_home.expanduser().resolve()
    config, dotenv = profile / "config.yaml", profile / ".env"
    binary = shutil.which("hermes")
    if not binary:
        candidate = Path.home() / ".local/bin/hermes"
        binary = str(candidate) if candidate.is_file() else None
    if not binary or not config.is_file():
        parser.error("기존 Hermes 실행 파일과 프로필의 config.yaml이 필요합니다. 설치 위치를 확인해 주세요.")
    if config.is_symlink() or dotenv.is_symlink():
        parser.error("설정이 링크인 경우 실제 프로필 폴더를 지정해 주세요.")
    original = dotenv.read_text(encoding="utf-8") if dotenv.exists() else ""
    match = re.search(r"^\s*(?:export\s+)?API_SERVER_KEY\s*=\s*(.*?)\s*$", original, re.M)
    if len(re.findall(r"^\s*(?:export\s+)?API_SERVER_KEY\s*=", original, re.M)) > 1:
        parser.error("연결 암호 설정이 중복되어 있습니다. 현재 사용하는 값을 하나로 정리해 주세요.")
    key = match.group(1).strip().strip("\"'") if match else secrets.token_urlsafe(32)
    if not re.fullmatch(r"[\x21-\x7e]{20,500}", key):
        parser.error("기존 API_SERVER_KEY가 20자 이상의 단일 연결 암호인지 확인해 주세요.")
    backup = profile / "orbit-setup-backups" / (datetime.datetime.now().strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(3))
    backup.mkdir(parents=True, mode=0o700)
    os.chmod(backup.parent, 0o700)
    private_write(backup / "config.yaml", config.read_text(encoding="utf-8"))
    if dotenv.exists():
        private_write(backup / "env.backup", original)
    changes = {
        "API_SERVER_KEY": key,
        "API_SERVER_ENABLED": "true",
        "API_SERVER_HOST": "127.0.0.1",
        "API_SERVER_PORT": "8642",
    }
    updated = original
    for name, value in changes.items():
        pattern = rf"^\s*(?:export\s+)?{name}\s*=.*$"
        if re.search(pattern, updated, re.M):
            updated = re.sub(pattern, name + "=" + value, updated, flags=re.M)
        else:
            updated = updated.rstrip("\n") + "\n" + name + "=" + value + "\n"
    private_write(dotenv, updated)
    process_env = dict(os.environ, HERMES_HOME=str(profile))
    # The API lane gets Orbit's read/proposal protocol. Explicit no_mcp also
    # prevents globally configured MCP servers from being silently inherited.
    try:
        subprocess.run([binary, "config", "set", "gateway.api_server.max_concurrent_runs", str(args.max_concurrent_runs)],
                       env=process_env, check=True, capture_output=True, timeout=30)
        subprocess.run([binary, "config", "set", "platform_toolsets.api_server", '["no_mcp"]'],
                       env=process_env, check=True, capture_output=True, timeout=30)
    except (subprocess.SubprocessError, OSError):
        private_write(config, (backup / "config.yaml").read_text(encoding="utf-8"))
        if (backup / "env.backup").exists():
            private_write(dotenv, original)
        else:
            dotenv.unlink(missing_ok=True)
        parser.error("Hermes 설정 명령이 실패해 기존 설정으로 복구했습니다. Hermes 버전을 확인해 주세요.")
    private_write(profile / "orbit-connection-key.txt", key + "\n")
    print("Orbit 연결 준비를 마쳤습니다. 기존 모델/공급자 설정을 사용합니다.")
    print("연결 암호 파일:", profile / "orbit-connection-key.txt")
    print("설정 백업:", backup)
    print("이 프로필의 Hermes gateway를 다시 시작한 뒤 HTTPS 연결 주소를 준비하세요.")
    print("연결 암호는 Orbit 연결 화면에만 입력하세요. 이 스크립트는 암호를 출력하지 않습니다.")


if __name__ == "__main__":
    main()
