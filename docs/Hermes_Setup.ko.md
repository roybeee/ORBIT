# Mac의 헤르메스를 Orbit에 연결하기

Orbit v0.5는 **이미 사용하는 Hermes Agent를 대화의 실행 주체로 연결**합니다. Orbit에서 OpenAI 키를 입력하거나 모델을 선택하지 않습니다. Hermes에 설정된 모델·공급자를 그대로 사용하며, 사용량 처리는 그 Hermes 설정을 따릅니다.

폰의 Orbit과 Mac의 Hermes는 서로 다른 기기에서 실행됩니다. 연결을 완성하려면 **Mac에서 실행 중인 gateway의 HTTPS 주소와 연결 암호**가 필요합니다. 이 문서와 설정 스크립트를 저장하는 것만으로 Mac에 설치되거나 연결되지는 않습니다.

## 1. 현재 사용하는 프로필 준비

### Slack에서 ORBIT 개발을 지시할 때

Slack·Hermes에서 시작하는 코드 수정도 [AGENTS.md](../AGENTS.md)와 [GitHub 개발 절차](GitHub_Connect.ko.md)를 따릅니다. 매 작업마다 `roybeee/ORBIT` 원격 `main`을 fetch하고 SHA를 직접 확인한 뒤 해당 커밋에서 작업 브랜치를 만듭니다. 진행 중인 변경은 보존하고 최신 `main`과 통합합니다. 이전 대화, 로컬 캐시, Sites의 별도 브랜치를 개발 기준으로 사용하지 않습니다.

타입 검사·전체 테스트와 PR의 **Validate Orbit**이 성공해야 병합합니다. 배포는 병합된 GitHub 소스를 기준으로 별도로 확인합니다. 이 문서를 저장하는 것만으로 이미 실행 중인 Mac/Slack 세션의 체크아웃이나 설정이 변경되지는 않습니다.

Mac에서 ORBIT 저장소를 받거나 갱신한 다음, 실제 Hermes 프로필 폴더를 지정해 실행합니다. 아래 기본 폴더 예시는 현재 프로필에 맞게 바꾸세요.

```bash
python3 scripts/configure-hermes-orbit.py --profile-home "$HOME/.hermes"
```

예를 들어 현재 설정이 `~/.hermes-cos`에 있으면 그 폴더를 지정합니다. 도구는 기존 Hermes 실행 파일을 찾고, 설정을 백업한 뒤 연결을 준비합니다. 현재 모델 자격을 복사해서 Orbit으로 보내지 않습니다. 기존 연결 암호가 있으면 유지하며, 없으면 생성해 프로필의 `orbit-connection-key.txt`에 저장합니다. 실패한 설정 명령은 백업으로 복구합니다.

기존 `platform_toolsets.api_server` 도구 목록을 확인하고 **그대로 유지**합니다. 이 API 경로는 Orbit의 일반 대화와 승인된 독립 실행이 함께 사용합니다. 개발 실행에 필요한 `terminal`, `file`, `delegation` 등을 이 스크립트가 새로 허용하거나 제거하지 않습니다. Slack 등 다른 메시징 플랫폼의 도구 설정도 유지합니다.

API 도구 목록이 없거나 읽을 수 없으면 연결 설정을 바꾸기 전에 중단합니다. 현재 프로필의 `hermes tools`에서 API Server에 필요한 도구를 명시적으로 선택하고 다시 실행하세요. 기존 목록이 있는데도 확인하지 못하면 Hermes의 `config get platform_toolsets.api_server --json` 지원을 확인하세요. 도구 선택과 실제 도구 사용 권한은 별개이며, 재시작 후 `delegate_task` 사용 가능 여부와 하위 실행 결과까지 확인해야 개발팀 위임을 완료한 것으로 볼 수 있습니다.

대화·제안용 프로필을 의도적으로 준비할 때만 `--proposal-only`를 추가합니다. 이 옵션은 API 도구 목록을 `["no_mcp"]`로 변경하므로 **기본 코드 수정·하위 에이전트 위임 도구를 제외**합니다. `no_mcp`는 “기본 개발 도구를 유지하고 MCP만 제외”하는 선택이 아닙니다. 이전 스크립트로 이미 이 설정이 적용된 프로필은 자동 복구하지 않으며, 필요한 도구를 직접 선택해야 합니다. 사용자 지정 context engine·플러그인은 별도 도구를 추가할 수 있어 이 옵션이 완전한 실행 격리를 보장하지는 않습니다. 기존 API 사용에 영향을 주면 별도 프로필을 준비하세요.

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

공식 동작은 [Hermes API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server), [프로필 명령](https://hermes-agent.nousresearch.com/docs/reference/profile-commands), [플랫폼 도구 설정 구현](https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/tools_config.py)을 참고하세요.
