# 헤르메스를 Orbit에 연결하기 (Mac · Hetzner 서버)

Orbit v0.5는 **이미 사용하는 Hermes Agent를 대화의 실행 주체로 연결**합니다. Orbit에서 OpenAI 키를 입력하거나 모델을 선택하지 않습니다. Hermes에 설정된 모델·공급자를 그대로 사용하며, 사용량 처리는 그 Hermes 설정을 따릅니다.

폰의 Orbit과 Mac의 Hermes는 서로 다른 기기에서 실행됩니다. 연결을 완성하려면 **Mac에서 실행 중인 gateway의 HTTPS 주소와 연결 암호**가 필요합니다. 이 문서와 설정 스크립트를 저장하는 것만으로 Mac에 설치되거나 연결되지는 않습니다.

## 1. 현재 사용하는 프로필 준비

Mac에서 ORBIT 저장소를 받거나 갱신한 다음, 실제 Hermes 프로필 폴더를 지정해 실행합니다. 아래 기본 폴더 예시는 현재 프로필에 맞게 바꾸세요.

```bash
python3 scripts/configure-hermes-orbit.py --profile-home "$HOME/.hermes"
```

예를 들어 현재 설정이 `~/.hermes-cos`에 있으면 그 폴더를 지정합니다. 도구는 기존 Hermes 실행 파일을 찾고, 설정을 백업한 뒤 연결을 준비합니다. 현재 모델 자격을 복사해서 Orbit으로 보내지 않습니다. 기존 연결 암호가 있으면 유지하며, 없으면 생성해 프로필의 `orbit-connection-key.txt`에 저장합니다. 실패한 설정 명령은 백업으로 복구합니다.

API 실행 경로의 `platform_toolsets.api_server`를 `["no_mcp"]`로 설정합니다. 이 경로에서 읽기 요청과 승인할 변경 제안을 Orbit이 처리하도록 하기 위한 설정입니다. 다른 메시징 플랫폼의 도구 설정은 유지합니다. 이미 다른 프런트엔드가 같은 API 경로를 사용 중이면 Orbit용 별도 프로필을 준비하세요. 사용자 지정 context engine이 추가하는 도구와 별도 Hermes 자동화는 Hermes 설정에서 관리합니다.

## 2. Gateway 시작

현재 프로필로 실행 중인 gateway를 정상적으로 다시 시작합니다. 수동 실행 예시:

```bash
HERMES_HOME="$HOME/.hermes" hermes gateway
```

설정 스크립트는 gateway를 종료하거나 중복 실행하지 않습니다. 실행 방식이 서비스라면 기존 서비스의 재시작 절차를 사용하세요. 최신 Hermes의 `/v1/capabilities`가 실행 시작, 상태 조회, 중지, 중복 실행 방지를 지원해야 합니다.

## 3. HTTPS 주소와 연결 암호 등록

이미 사용하는 인증된 HTTPS 게이트웨이 또는 터널을 `http://127.0.0.1:8642`로 연결합니다. 안정적인 주소를 사용하고 `Authorization` 헤더를 전달해야 합니다. Orbit은 다른 호스트로의 리디렉션을 따라가지 않습니다. 아직 주소가 없으면 먼저 Mac에 도달하는 HTTPS 경로가 필요합니다. `localhost`, 사설 IP, 휴대폰에만 열린 주소는 호스팅된 Orbit 서버에서 사용할 수 없습니다.

앱 오른쪽 위 **연결 → 헤르메스 에이전트**에 다음 두 가지를 입력합니다.

| 입력 | 값 |
|---|---|
| 헤르메스 연결 주소 | 실제 HTTPS 기본 주소. 멀티 프로필이면 `/p/프로필명` 포함 |
| 헤르메스 연결 암호 | 해당 프로필의 `API_SERVER_KEY`, 또는 스크립트가 만든 암호 파일 내용 |

**헤르메스 연결 확인**은 인증한 Hermes의 기능을 조회하고, 인증 없이 접근할 수 없는지도 확인합니다. 연결 확인은 모델의 응답 생성까지 시험하지는 않습니다. 실제 대화를 시작하면 Hermes 실행 상태가 표시됩니다. Mac이 꺼져 있거나 잠자기로 네트워크가 끊기면 연결이 완료되지 않습니다.

## 3-1. Hetzner 서버를 거쳐 밀집 워크스테이션의 Hermes를 연결하기

Mac Mini 워크스테이션의 Hermes는 전원이 꺼지거나 잠자기에 들어가면 응답하지 않습니다. Hetzner 서버는 두 가지 방식으로 쓸 수 있습니다. 두 방식 모두 Orbit에는 **Hetzner 서버의 HTTPS 주소**를 등록합니다.

| 방식 | Hermes가 실제로 실행되는 곳 | Hetzner 서버의 역할 |
|---|---|---|
| A. 서버 실행 | Hetzner 서버(Linux) | gateway 실행 + HTTPS 종단 |
| B. 릴레이 | 밀집 워크스테이션(Mac) | 워크스테이션이 열어 둔 SSH 역방향 터널을 HTTPS로 공개 |

### 공통: 서버에 도메인과 HTTPS 준비

1. Hetzner Cloud 콘솔에서 서버의 공인 IPv4를 확인하고, 보유한 도메인의 A 레코드(예: `hermes.example.com`)를 그 IP로 지정합니다. 도메인이 없으면 `<IP를 하이픈으로 연결>.sslip.io`(예: `1-2-3-4.sslip.io`) 형식의 이름을 그대로 쓸 수 있습니다. Orbit은 순수 IP 주소, `localhost`, 사설망 이름을 거부합니다.
2. 방화벽은 22, 80, 443만 엽니다. 8642 포트는 외부에 열지 않습니다.

```bash
sudo ufw allow 22,80,443/tcp && sudo ufw enable
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'CADDY'
hermes.example.com {
    reverse_proxy 127.0.0.1:8642
}
CADDY
sudo systemctl reload caddy
```

Caddy는 인증서를 자동 발급하고 `Authorization` 헤더를 그대로 전달합니다. 다른 호스트로 리디렉션하는 설정은 넣지 마세요.

### 방식 A: Hetzner 서버에서 Hermes 실행

서버에 sudo 권한이 있는 일반 사용자로 접속해 Hermes를 설치한 뒤, 이 저장소의 준비 스크립트를 그 프로필에 실행합니다. 모델 공급자 자격은 서버의 프로필 `.env`에 직접 둡니다.

```bash
git clone https://github.com/roybeee/ORBIT.git && cd ORBIT
python3 scripts/configure-hermes-orbit.py --profile-home "$HOME/.hermes"
hermes gateway install        # systemd 사용자 서비스 등록
sudo loginctl enable-linger "$USER"   # 로그아웃·재부팅 후에도 유지
hermes gateway status
```

연결 암호는 `~/.hermes/orbit-connection-key.txt`에 있습니다. Orbit에는 `https://hermes.example.com`을 등록합니다.

### 방식 B: 워크스테이션의 Hermes를 Hetzner로 릴레이

워크스테이션에서 준비 스크립트를 실행하고 gateway를 켠 뒤, 워크스테이션이 서버로 역방향 터널을 유지합니다. 서버의 Caddy는 위 설정 그대로 터널 포트를 공개합니다.

```bash
# 워크스테이션(Mac)에서
python3 scripts/configure-hermes-orbit.py --profile-home "$HOME/.hermes"
brew install autossh
autossh -M 0 -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -R 127.0.0.1:8642:127.0.0.1:8642 deploy@hermes.example.com
```

터널을 launchd 항목으로 등록해 로그인 시 자동 시작하게 하세요. 이 방식은 워크스테이션이 꺼지면 연결이 끊기므로, 워크스테이션 전원 독립이 목적이면 방식 A를 권장합니다.

### Orbit에 등록하고 확인

앱 오른쪽 위 **연결 → 헤르메스 에이전트**에 HTTPS 주소와 연결 암호를 입력하고 **헤르메스 연결 확인**을 누릅니다. 확인이 실패하면 서버에서 다음을 먼저 점검합니다.

```bash
curl -sS https://hermes.example.com/v1/capabilities            # 401이어야 정상 (암호 보호)
curl -sS -H "Authorization: Bearer $(cat ~/.hermes/orbit-connection-key.txt)" \
  https://hermes.example.com/v1/capabilities | head -c 300     # hermes.api_server.capabilities
```

## 4. Plaud와 업무 흐름

Orbit에서 **Plaud 연결**을 누르고 계정을 승인합니다. 인증 화면이 열리지 않으면 같은 카드 아래의 오류 또는 **인증 화면 직접 열기**를 확인합니다. ChatGPT 안에서 연결한 Plaud 계정과 Orbit의 권한은 별도입니다.

헤르메스는 Orbit에 필요한 기록 조회를 요청합니다. Orbit이 사용자별 위키·업무·Plaud 읽기 도구·Google 기본 캘린더를 조회해 돌려줍니다. 최종 제안은 검토함에 표시되고, 사용자가 승인한 뒤에만 Orbit의 업무·문서·일정에 반영됩니다. Google 일정 생성도 별도 승인 카드가 필요합니다.

연결이 끊겨도 대화를 다시 열면 저장한 실행 번호로 이어서 확인합니다. 화면을 닫은 동안에는 Orbit의 추가 조회 단계가 대기하고, 이미 시작한 Hermes 실행은 Hermes에서 계속될 수 있습니다. **요청 중지**는 종료 상태를 확인한 뒤 제안을 버립니다. 연결 암호만 바뀌었다면 같은 주소로 새 암호를 저장해 실행을 복구할 수 있습니다.

## 5. 실행 중 Hermes 상태에 따른 동작

| Hermes 실행 상태 | Orbit 동작 |
|---|---|
| `queued` · `running` · `stopping` | 화면을 열어 둔 동안 4초마다 상태를 확인합니다. 20분이 지나면 중지를 요청합니다. |
| `waiting_for_approval` (터미널 등 네이티브 도구 실행 승인 요청) | Orbit 대화는 조회 프로토콜만 사용하므로 Orbit이 승인 요청을 **거절**(`deny`)하고 실행을 이어갑니다. 대화에는 거절한 도구 이름만 표시하고 명령 내용은 표시하지 않습니다. Hermes 도구가 필요한 작업은 Mac의 Hermes에서 직접 실행하세요. |
| `completed` | 응답을 검토 카드로 검증해 저장합니다. |
| `failed` · `cancelled` | 제안을 저장하지 않고 대화를 실패로 표시합니다. Hermes가 전달한 오류 요약을 함께 보여 줍니다. |
| `interrupted` (gateway 재시작) | 제안 없이 실패로 표시하고 다시 요청하도록 안내합니다. |
| 실행 번호를 찾지 못함 (404) | gateway가 실행 기록을 잃은 상태입니다. 실패로 표시하고 다시 요청하도록 안내합니다. |
| 429 · 동시 실행 제한 | 실행 번호를 유지한 채 잠시 후 다시 확인합니다. |
| 400 · 요청 형식 거부 | 같은 요청을 반복하지 않고 실패로 표시합니다. Hermes 업데이트가 필요할 수 있습니다. |

## 6. 생각 노력 정도(reasoning effort)

Orbit은 대화마다 Hermes에 노력 정도를 직접 지정합니다. 평소 요청은 `medium`으로 보내고, 문장에 **깊게·깊이·깊은·심층·꼼꼼·신중·철저·곰곰**(영문 deeply/thorough)처럼 더 생각하라는 표현이 있으면 그 대화의 모든 라운드를 `high`로 보냅니다. 다음 대화에는 이어지지 않으므로 필요할 때마다 표현을 넣으면 됩니다. Hermes 설정 파일의 `reasoning_effort` 값은 Orbit 대화에는 적용되지 않고 Slack 등 다른 경로에만 적용됩니다.

Slack·CLI 등 Orbit 밖의 대화에도 같은 규칙을 적용하려면 서버의 Hermes 소스에 `scripts/hermes-deep-effort-patch.py`를 적용합니다. 이 스크립트는 gateway가 대화마다 노력 정도를 정하는 지점에 같은 단어 규칙을 넣고, 원본을 백업한 뒤 문법 검사를 통과할 때만 적용합니다. Hermes v0.21.0(2026.8.31) 기준으로 확인했으며, 코드 위치가 다른 버전에서는 아무것도 바꾸지 않고 멈춥니다. 적용 후 `hermes gateway restart`가 필요하고, 설정 파일의 `reasoning_effort`는 `medium`으로 둡니다.

```bash
python3 scripts/hermes-deep-effort-patch.py ~/.hermes/hermes-agent
```

`API_SERVER_KEY`를 프로필 `.env`에 두면 gateway가 API 서버를 자동으로 켭니다. 설정 파일에서 `api_server`를 명시적으로 `enabled: false`로 꺼 둔 프로필은 그 설정을 먼저 지워야 합니다.

공식 동작은 [Hermes API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server), [프로필 명령](https://hermes-agent.nousresearch.com/docs/reference/profile-commands), [플랫폼 도구 설정 구현](https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/tools_config.py)을 참고하세요.
