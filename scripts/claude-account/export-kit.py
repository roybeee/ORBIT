#!/usr/bin/env python3
"""Build a kit for moving this Claude account's skills and settings to another account.

Run it inside a Claude Code session of the SOURCE account (cloud or local).
Skills synced from claude.ai land in ~/.claude/skills/synced/<org_user>/ with a
manifest.json; this script packages them for the TARGET account and writes an
inventory plus a checklist. It never reads credentials (~/.claude.json, session
keys, connector tokens): connectors and secrets are re-authorized by hand.

Usage:
  python3 scripts/claude-account/export-kit.py [--out outputs/claude-account-kit]
      [--routines routines.json] [--preferences preferences.txt] [--include-builtin]

--routines     JSON returned by the Claude_Code_Remote list_triggers tool (optional)
--preferences  text of claude.ai Settings > Profile preferences (optional)
"""
import argparse
import csv
import datetime as dt
import io
import json
import os
import re
import shutil
import sys
import tarfile
import zipfile
from pathlib import Path

BUILTIN_SOURCES = {"anthropic", "anthropic-example"}
SECRET_RE = re.compile(
    r"(sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}"
    r"|xox[abpr]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)"
)
KST = dt.timezone(dt.timedelta(hours=9))


def find_manifest(root: Path) -> Path:
    found = sorted(root.glob("*/manifest.json"))
    if not found:
        sys.exit(f"manifest.json not found under {root} (is this a Claude Code session of the source account?)")
    if len(found) > 1:
        print(f"note: {len(found)} synced buckets, using {found[0].parent.name}", file=sys.stderr)
    return found[0]


def zip_skill(src: Path, dest: Path) -> int:
    """claude.ai upload format: a ZIP whose root holds <name>/SKILL.md."""
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(src.rglob("*")):
            if f.is_file():
                zf.write(f, Path(src.name) / f.relative_to(src))
    return dest.stat().st_size


def scan_secrets(src: Path) -> list[str]:
    hits = []
    for f in src.rglob("*"):
        if not f.is_file() or f.stat().st_size > 2_000_000:
            continue
        try:
            text = f.read_text(errors="ignore")
        except OSError:
            continue
        for n, line in enumerate(text.splitlines(), 1):
            if SECRET_RE.search(line):
                hits.append(f"{f}:{n}")
    return hits


def cron_kst(expr: str) -> str:
    """Describe a UTC 5-field cron in KST when minute/hour are plain numbers."""
    parts = expr.split()
    if len(parts) != 5 or not (parts[0].isdigit() and parts[1].isdigit()) or expr.startswith("CRON_TZ"):
        return expr
    minute, hour = int(parts[0]), int(parts[1])
    shifted = hour + 9
    dow = parts[4]
    if shifted >= 24 and dow != "*":
        # the KST day is one later than the UTC day
        def bump(tok):
            if "-" in tok:
                a, b = tok.split("-")
                return f"{(int(a) + 1) % 7}-{(int(b) + 1) % 7}"
            return str((int(tok) + 1) % 7) if tok.isdigit() else tok
        dow = ",".join(bump(t) for t in dow.split(","))
    return f"CRON_TZ=Asia/Seoul {minute} {shifted % 24} {parts[2]} {parts[3]} {dow}"


def write_routines(src: Path, out: Path) -> int:
    data = json.loads(src.read_text())
    items = data.get("data", data) if isinstance(data, dict) else data
    lines = ["# Routines (예약 작업)", "",
             "새 계정에서 Claude Code 세션을 열고 아래 항목마다 `create_trigger`로 다시 만들라고 요청하세요.",
             "커넥터 UUID는 계정마다 다르므로 이름으로만 기록했습니다. 커넥터를 먼저 연결한 뒤 만드세요.", ""]
    for t in items:
        st = t.get("derived_state", {})
        conns = [c["name"] for c in t.get("mcp_connections", []) if c.get("name")]
        lines += [
            f"## {t.get('name')}",
            "",
            f"- 스케줄(UTC): `{t.get('cron_expression') or t.get('run_once_at')}`",
            f"- 스케줄(KST 표기로 재생성 권장): `{cron_kst(t.get('cron_expression') or '')}`",
            f"- 모델: `{st.get('model', '(기본)')}`",
            f"- 사용 커넥터: {', '.join(conns) or '없음'}",
            f"- 실행 방식: 매번 새 세션" if not t.get("persist_session") else "- 실행 방식: 같은 세션 이어서",
            "",
            "프롬프트:",
            "",
            "```text",
            st.get("prompt", "").rstrip(),
            "```",
            "",
        ]
    (out / "routines.md").write_text("\n".join(lines))
    return len(items)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="outputs/claude-account-kit")
    ap.add_argument("--skills-root", default=str(Path.home() / ".claude/skills/synced"))
    ap.add_argument("--routines")
    ap.add_argument("--preferences")
    ap.add_argument("--include-builtin", action="store_true",
                    help="also zip Anthropic built-in skills (normally just switched on in Settings)")
    args = ap.parse_args()

    manifest_path = find_manifest(Path(args.skills_root).expanduser())
    bucket = manifest_path.parent
    manifest = json.loads(manifest_path.read_text())
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    (out / "skills-upload").mkdir(parents=True)
    (out / "claude-code").mkdir()

    rows, secret_hits, custom_dirs = [], [], []
    for s in sorted(manifest["skills"], key=lambda s: (s["source"] in BUILTIN_SOURCES, s["name"])):
        name, source = s["name"], s["source"]
        src = bucket / name
        builtin = source in BUILTIN_SOURCES
        size = ""
        if not src.is_dir():
            action = "폴더 없음 — 원래 계정에서 확인"
        elif builtin and not args.include_builtin:
            action = "설정에서 켜기 (Anthropic 기본 스킬)"
        else:
            size = zip_skill(src, out / "skills-upload" / f"{name}.zip")
            secret_hits += scan_secrets(src)
            custom_dirs.append(src)
            action = "플러그인 재설치 또는 ZIP 업로드" if source == "plugin" else "ZIP 업로드"
        rows.append({
            "name": name,
            "source": source,
            "plugin_id": s.get("backingPluginId", ""),
            "updated": s.get("updatedAt", "")[:10],
            "zip_bytes": size,
            "action": action,
            "description": " ".join(s.get("description", "").split())[:160],
        })

    with open(out / "skills-inventory.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    # Claude Code (CLI/desktop) reads personal skills from ~/.claude/skills/<name>/SKILL.md
    with tarfile.open(out / "claude-code" / "skills.tar.gz", "w:gz") as tf:
        for d in custom_dirs:
            tf.add(d, arcname=d.name)
    (out / "claude-code" / "install-skills.sh").write_text(
        "#!/usr/bin/env bash\n"
        "# Installs the exported skills as personal Claude Code skills (~/.claude/skills).\n"
        "# Existing skills with the same name are kept unless --force is given.\n"
        "set -euo pipefail\n"
        "here=\"$(cd \"$(dirname \"$0\")\" && pwd)\"\n"
        "dest=\"${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}\"\n"
        "mkdir -p \"$dest\"\n"
        "tmp=\"$(mktemp -d)\"; trap 'rm -rf \"$tmp\"' EXIT\n"
        "tar -xzf \"$here/skills.tar.gz\" -C \"$tmp\"\n"
        "for d in \"$tmp\"/*/; do\n"
        "  n=\"$(basename \"$d\")\"\n"
        "  if [ -e \"$dest/$n\" ] && [ \"${1:-}\" != --force ]; then echo \"skip $n (exists)\"; continue; fi\n"
        "  rm -rf \"$dest/$n\"; cp -R \"$d\" \"$dest/$n\"; echo \"installed $n\"\n"
        "done\n"
    )
    os.chmod(out / "claude-code" / "install-skills.sh", 0o755)
    # Mirrors the permissions this account's cloud sessions run with; hooks there are
    # provided by the cloud harness itself and are not copied.
    (out / "claude-code" / "settings.template.json").write_text(json.dumps({
        "$schema": "https://json.schemastore.org/claude-code-settings.json",
        "permissions": {"allow": ["Skill"]},
    }, indent=2) + "\n")

    guide = Path(__file__).resolve().parents[2] / "docs" / "Claude_Account_Migration.ko.md"
    if guide.exists():
        shutil.copy(guide, out / "README.ko.md")
    n_routines = write_routines(Path(args.routines), out) if args.routines else 0
    if args.preferences:
        shutil.copy(args.preferences, out / "profile-preferences.txt")

    (out / "secret-scan.txt").write_text(
        "\n".join(secret_hits) + "\n" if secret_hits else "스킬 파일에서 API 키·토큰 패턴이 발견되지 않았습니다.\n")

    uploaded = [r for r in rows if r["zip_bytes"] != ""]
    builtin = [r for r in rows if r["source"] in BUILTIN_SOURCES]
    summary = {
        "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "manifest_last_updated": manifest.get("lastUpdated"),
        "skills_total": len(rows),
        "skills_zipped": len(uploaded),
        "skills_builtin_toggle": len(builtin) if not args.include_builtin else 0,
        "routines": n_routines,
        "secret_hits": len(secret_hits),
    }
    (out / "kit-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")

    bundle = out.parent / f"{out.name}.zip"
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(out.rglob("*")):
            if f.is_file():
                zf.write(f, Path(out.name) / f.relative_to(out))
    print(json.dumps({**summary, "kit_dir": str(out), "bundle": str(bundle),
                      "bundle_bytes": bundle.stat().st_size}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
