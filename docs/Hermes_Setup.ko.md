# Mac의 헤르메스를 Orbit에 연결하기

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

`API_SERVER_KEY`를 프로필 `.env`에 두면 gateway가 API 서버를 자동으로 켭니다. 설정 파일에서 `api_server`를 명시적으로 `enabled: false`로 꺼 둔 프로필은 그 설정을 먼저 지워야 합니다.

공식 동작은 [Hermes API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server), [프로필 명령](https://hermes-agent.nousresearch.com/docs/reference/profile-commands), [플랫폼 도구 설정 구현](https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/tools_config.py)을 참고하세요.
