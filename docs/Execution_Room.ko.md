# Orbit 실행실

AI 에이전트 화면 상단 **실행실 → 새 업무 지시**, 또는 입력창의 **업무 지시**에서 실행할 내용을 적습니다. 프로젝트와 기존 할 일을 선택하면 그 기록을 함께 전달합니다. **지시하고 실행**은 별도의 검토 카드 없이 해당 지시를 실제 Hermes에 보냅니다.

Google 일정은 **참고 일정**, 이미 등록된 Orbit 할 일은 **연결 업무**로 구분합니다. 아직 생성되지 않은 할 일이나 일정의 식별자를 기존 할 일로 연결하지 않습니다. 잘못된 연결은 승인 전에 실제 기록으로 한 번 재확인하며, 지시문과 실행 범위는 유지합니다. 대상을 특정할 수 없으면 실행하지 않고 추가 확인을 안내합니다.

일반 대화에서도 개발·조사·자료 작성 등을 요청하면 에이전트 실행 지시 카드가 생성됩니다. 카드의 지시문을 확인하고 승인하면 동일한 실행실에 등록됩니다. 저장된 todo와 실제 실행 접수는 구분됩니다.

## 실행과 제어

- 각 지시는 독립 세션으로 실행됩니다. 한 지시가 진행 중이어도 다른 지시와 일반 대화를 계속할 수 있습니다. 동시에 열어둘 수 있는 지시는 소유자당 12개이며, 실제 병렬 실행 수는 Hermes 설정에 따릅니다.
- 실행실은 활성화·설정된 도구 목록을 확인합니다. `delegate_task`가 있으면 Hermes가 하위 에이전트에 독립 작업을 위임할 수 있습니다. 기본 MCP 서버 목록은 이 조회에 모두 표시되지 않을 수 있습니다.
- 실행 중 **추가 지시 전달**과 **중지**를 사용할 수 있습니다. 지원하지 않는 Hermes 버전에서는 해당 기능을 안내합니다. 중지는 이미 수행된 변경을 되돌리지 않습니다.
- Hermes의 실행 승인이 발생하면 실제 명령과 요청을 표시합니다. **이번 작업만 승인** 또는 **거절**하며, 전역 승인 정책은 변경하지 않습니다.
- 실행 종료 후 결과와 실행 기록을 저장합니다. 연결된 할 일은 결과를 확인한 뒤 완료로 표시합니다. **Orbit과 결과 검토하기**는 실제 실행 기록을 대화에서 조회합니다.

## 권한과 실제 연결

Orbit은 소유자가 연결한 Hermes 환경의 기존 도구와 계정 권한을 사용합니다. 새 권한을 스스로 만들거나 거절된 권한을 우회하지 않습니다. 지시문에 없는 외부 메시지, 게시, 병합, 삭제, 결제나 접근권한 확대는 승인된 것으로 간주하지 않습니다.

`dev-lead` 같은 이름은 실행 대상의 단서입니다. 실제 에이전트·프로필 등록을 확인해야 하며, 기본 프로필의 실행을 다른 에이전트에 전달했다고 표시하지 않습니다. 다른 Hermes 프로필은 해당 프로필의 실제 연결과 인증이 필요합니다. 연결되지 않은 Slack 개발팀이나 별도 호스트를 자동으로 제어할 수 있는 기능은 아닙니다.

Hermes가 켜져 있으면 접수한 작업은 Orbit을 닫아도 계속됩니다. 실행 결과는 Orbit을 다시 열었을 때 조회하여 저장합니다. Hermes 실행 기록이 만료되기 전에 Orbit을 열어 결과를 가져오세요. 외부 호스트가 꺼졌거나 권한을 거절하면 그 상태를 표시합니다.

## 실행 계약과 복구

- Native `/v1/runs` 사용. 모델 API, 임의 `agent`/`assignee`/`toolsets` 필드 없이 실제 gateway 설정을 따릅니다.
- `/v1/capabilities`의 실행·조회·중지 및 durable idempotency 기능과 보존 기간을 확인합니다.
- 소유자별 D1 실행 원장에 정확한 요청, 연결 지문, 별도 세션, 실행 번호와 결과를 저장합니다.
- 전송 확인이 유실되어도 동일 요청·키로만 재확인합니다. 중복 방지 보존 기간 만료, 연결 또는 암호 변경, 실행 기록 유실 시 자동 재실행하지 않습니다.
- 추가 지시·실행 승인 응답은 정확한 현재 실행에만 전달합니다. 이미 종료된 실행에 대한 추가 지시는 실패로 표시하여 입력을 보존합니다.
- 실제 실행 및 테스트 증거를 결과로 요청하지만, 에이전트의 텍스트 보고만으로 목표 달성을 확정하지 않습니다.

확인한 upstream 계약: [Hermes API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server), [run handlers](https://github.com/NousResearch/hermes-agent/blob/main/gateway/platforms/api_server_runs.py), [idempotency](https://github.com/NousResearch/hermes-agent/blob/main/gateway/platforms/api_server_run_idempotency.py).


## Google 반복 시리즈 전체 삭제

Hermes 독립 실행에 Orbit Google OAuth가 자동으로 전달되지 않는다. 캘린더 시리즈 삭제는 대화의 `google.event.deleteSeries` 승인 카드에서 Orbit 서버가 직접 수행한다. API 토큰은 Hermes에 보내지 않는다.

- 실시간 primary 캘린더의 쓰기 권한, 실제 제목, 원본 반복 시리즈, ETag를 검증한 후 카드를 저장한다. 승인 시 계정과 ETag를 재검증한다.
- 전체 시리즈 삭제만 지원한다. 단일 회차/이후 회차 삭제 요청은 전체 삭제로 바꾸지 않는다.
- DELETE 전에 기존 action result에 대상을 저장한다. 204 빈 응답을 정상 처리하고 원본 및 향후 instances와 iCalUID 조회로 잔존을 확인한다. 확인 실패는 반영 완료가 아니다. 같은 카드에서 재시도한다.
- 이 작업은 Orbit 할 일을 생성·수정·완료하지 않는다. 기존 todo는 그대로 유지된다.
- 이전 Hermes 결과에서 도구 없음으로 막혔으면 ‘Orbit과 결과 검토하기’로 기존 지시를 읽어 직접 삭제 카드를 제안받는다.
- Google 401/403이나 갱신 실패 시 Orbit 연결 → Google Calendar에서 일정 권한으로 재인증한다.

Google 공식 계약: [삭제](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete), [조건부 변경](https://developers.google.com/workspace/calendar/api/guides/version-resources), [반복 회차 조회](https://developers.google.com/workspace/calendar/api/v3/reference/events/instances).
