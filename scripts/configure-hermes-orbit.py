#!/usr/bin/env python3
"""Prepare an existing local Hermes profile for Orbit; never install a model provider.

Run on the Mac that already runs Hermes. Secrets stay inside that profile.
No network, gateway restart, tunnel publication, or model call is performed here.
"""
import argparse
import ast
import datetime
import json
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


def read_api_toolsets(binary, process_env):
    result = subprocess.run([binary, "config", "get", "platform_toolsets.api_server", "--json"],
                            env=process_env, check=True, capture_output=True, text=True, timeout=30)
    selected = json.loads(result.stdout)
    # Older Hermes config commands stored list arguments as strings. Preserve
    # that existing representation; only interpret it to validate/report here.
    if isinstance(selected, str):
        selected = ast.literal_eval(selected)
    if not isinstance(selected, list) or any(not isinstance(item, str) or not item.strip() for item in selected):
        raise ValueError("API toolsets must be an explicit list")
    return selected


def main():
    parser = argparse.ArgumentParser(description="기존 Hermes를 Orbit에 연결할 준비를 합니다.")
    parser.add_argument("--profile-home", required=True, type=Path,
                        help="현재 사용하는 Hermes 프로필 폴더")
    parser.add_argument("--max-concurrent-runs", type=int, default=10, help="동시 Hermes 실행 수 (기본 10)")
    parser.add_argument("--proposal-only", action="store_true",
                        help="명시적으로 API 도구를 대화·제안용 [no_mcp]로 제한합니다. 개발/위임용 설정이 아닙니다.")
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
    process_env = dict(os.environ, HERMES_HOME=str(profile))
    selected_toolsets = ["no_mcp"]
    if not args.proposal_only:
        try:
            selected_toolsets = read_api_toolsets(binary, process_env)
        except (subprocess.SubprocessError, OSError, ValueError, SyntaxError):
            parser.error("기존 API 도구 목록을 확인하지 못해 연결 설정을 변경하지 않았습니다. "
                         "현재 프로필의 Hermes tools에서 API Server 도구를 명시적으로 선택한 뒤 다시 실행하세요. "
                         "목록이 이미 설정되어 있다면 Hermes의 config get --json 지원을 확인하세요. "
                         "대화·제안만 필요하면 --proposal-only를 지정하세요. 기본 개발 도구를 자동으로 허용하지 않습니다.")
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
    # Preserve explicitly configured API tools for native work orders. A missing
    # selection must not silently inherit broad defaults when API is enabled.
    try:
        subprocess.run([binary, "config", "set", "gateway.api_server.max_concurrent_runs", str(args.max_concurrent_runs)],
                       env=process_env, check=True, capture_output=True, timeout=30)
        if args.proposal_only:
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
    print("API 도구를 대화·제안용으로 설정했습니다." if args.proposal_only else "기존 API 도구 선택을 변경하지 않았습니다.")
    if not any(item != "no_mcp" for item in selected_toolsets):
        print("기본 개발·위임 도구가 선택되어 있지 않습니다. 이 설정만으로 코드 수정이나 개발팀 호출이 가능해지지 않습니다.")
        print("실제 개발 실행에는 현재 프로필의 API Server에 필요한 도구와 delegation을 직접 선택한 뒤 사용 가능 여부를 확인해야 합니다.")
    print("실제 도구 권한·하위 에이전트 실행은 아직 검증하지 않았습니다. Slack 도구 설정은 변경하지 않았습니다.")
    print("연결 암호 파일:", profile / "orbit-connection-key.txt")
    print("설정 백업:", backup)
    print("이 프로필의 Hermes gateway를 다시 시작한 뒤 HTTPS 연결 주소를 준비하세요.")
    print("연결 암호는 Orbit 연결 화면에만 입력하세요. 이 스크립트는 암호를 출력하지 않습니다.")


if __name__ == "__main__":
    main()
