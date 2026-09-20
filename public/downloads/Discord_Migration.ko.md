# ORBIT · HERMES의 Discord 전환

## 1. ORBIT 연결
ORBIT의 연결 → Discord 업무 채널에서 봇 토큰, 서버 ID, 전용 텍스트 채널 ID, 본인의 사용자 ID를 입력합니다. 토큰은 서버에서 암호화하며 다시 표시하지 않습니다.

Discord Developer Portal → Bot에서 Message Content Intent를 켜세요. 봇에는 해당 채널의 보기, 메시지 전송, 기록 읽기 권한이 필요합니다. 다른 사람이 볼 수 있는 채널에 연결하면 ORBIT의 보고 내용도 그 사람에게 보입니다. 본인 전용 채널을 사용하세요.

연결한 뒤 테스트 알림을 보내고 `!orbit 도움말`을 입력하세요. 서버 자동 실행의 최근 실행 시간이 표시되어야 앱을 닫아도 명령과 알림이 이어집니다. 현재 예약 실행 주기에 따라 수신 지연이 생길 수 있습니다.

- `!orbit 질문 내용`: ORBIT의 기록을 참고해 답변하고 실행 제안을 저장합니다.
- `!orbit 실행 내용`: 기존 HERMES·ASIDE 업무 실행 흐름으로 연결합니다.
- `!orbit 프로젝트`: 내 ORBIT 프로젝트 이름과 번호를 조회합니다.
- `!orbit 실행 [프로젝트:프로젝트번호] 내용`: 대상 프로젝트에 업무와 대화를 연결합니다. 번호를 생략하면 확실한 이름·키워드 일치만 자동 분류하고 불명확하면 미분류로 남깁니다.
- `!orbit 상태`: 최근 업무와 검토할 제안 번호를 표시합니다.
- `!orbit 승인 제안번호`: ORBIT의 기존 검토 규칙에 따라 적용합니다.
- `!orbit 보류 제안번호 YYYY-MM-DD 이유`: 향후 재검토 날짜와 이유를 보관합니다.
- `!orbit 거절 제안번호`: 제안을 거절합니다.
- `!orbit 중지 업무번호`: 실행 중지를 요청하고 결과를 확인합니다.
- `!orbit 허용 업무번호 승인요청번호`: 해당 HERMES 실행 승인 요청을 한 번 허용합니다.
- `!orbit 차단 업무번호 승인요청번호`: 해당 요청을 거절합니다.

대화와 실행 결과는 ORBIT에도 저장됩니다. 새 명령의 접수 기록에는 Discord 원본 링크·메시지 ID·사용자 ID·시각·업무 ID를 함께 보관하고, 명령마다 독립 대화를 만들어 프로젝트 맥락을 분리합니다. ORBIT의 새 응답·실행 상태·검토 제안을 연결한 채널에 보냅니다. 과거 메시지는 새 명령으로 실행하지 않습니다. 명령은 지정한 본인의 계정만 허용하고 봇 메시지는 실행하지 않습니다. Discord 게시 실패가 실행 결과를 취소하지는 않습니다. 오래된 불명확한 발송은 중복 발송을 피하기 위해 수동 확인 상태로 남습니다.

`!orbit`는 일반 텍스트 명령입니다. Discord의 네이티브 슬래시 명령과 파일·음성 기능은 다음 단계의 HERMES 직접 연결을 사용합니다. 첨부파일 원본은 ORBIT의 기존 업로드 화면 또는 직접 연결한 HERMES에 전달하세요.

## 2. 기존 HERMES를 직접 연결
다운로드한 `hermes-discord-migrate.py`를 기존 HERMES 서버로 옮깁니다. 해당 설치의 Python 환경(PyYAML과 Hermes 모듈이 있는 환경)으로 실행하세요.

```bash
python hermes-discord-migrate.py inspect --profile /home/hermes/.hermes --hermes-source /home/hermes/.hermes/hermes-agent
python hermes-discord-migrate.py stage --profile /home/hermes/.hermes --hermes-source /home/hermes/.hermes/hermes-agent --service hermes-gateway
```

이 도구는 Discord 토큰을 화면에 표시하지 않는 입력으로 받습니다. Slack 설정을 백업한 뒤 Discord를 먼저 켭니다. 게이트웨이가 재시작되면 지정한 Discord 채널에서 봇을 멘션하고 도구가 출력한 연결확인 문구를 보내세요. 실제 답변이 확인되어야 cutover가 진행됩니다. Developer Portal의 Server Members Intent도 HERMES 버전에 따라 필요합니다.

## 3. Slack 예약 수신처 이전과 전환
기존 예약이 특정 Slack 채널을 대상으로 한다면 채널 매핑 JSON을 만드세요. 키는 실제 Slack 채널 ID, 값은 실제 Discord 채널 ID입니다. 매핑이 없는 예약을 임의의 채널로 옮기지 않습니다.

```bash
python hermes-discord-migrate.py cutover --profile /home/hermes/.hermes --hermes-source /home/hermes/.hermes/hermes-agent --channel-map channel-map.json --verification verification.json --service hermes-gateway
```

도구는 아래 실제 검증 보고서와 연결확인 대화·봇 응답을 확인하고, 기존 Hermes의 예약 변경 API를 사용해 수신처를 옮긴 뒤 Slack 어댑터를 끕니다. 변경 전 설정과 예약은 프로필의 `discord-migration-backups`에 보관합니다. 대화 이력·메모리·세션은 삭제하지 않습니다. 시스템 서비스 환경에 Slack 토큰이 별도로 지정돼 있다면 해당 서비스의 토큰 설정도 제거해야 합니다.

`capital`, `dev-lead`, `team` 등 별도 프로필은 각각의 실제 경로와 서비스 이름으로 같은 절차를 진행하세요. 여러 독립 게이트웨이가 같은 봇 토큰으로 동시에 접속하지 않도록 프로필별 봇을 사용하세요. stage는 다른 프로필 환경에 같은 토큰이 있으면 중단하며, 지정한 채널만 허용합니다. 슬래시 명령 자동 등록은 끕니다. 추가 수신 채널은 stage에도 같은 channel-map을 전달해 검증합니다. 활성 예약 본문에 Slack 또는 슬랙이 있으면 전환을 중단합니다. 일시정지·완료 예약과 origin의 과거 출처는 변경하지 않습니다. 기본 수신처 `slack`도 매핑의 `slack` 키로 명시해야 합니다. 스레드는 `채널ID:스레드ID` 전체를 별도로 매핑해야 하며 부모 채널로 축약하지 않습니다. 별도 MCP·Kanban 알림 구독과 AGENTS/SOUL 지침도 직접 점검해야 합니다.

## 4. 예약 코칭과 기록
ORBIT의 나의 궤도 → 앱을 닫아도 챙기기에서 받을 곳을 ‘Hermes에 연결한 내 Discord’로 선택할 수 있습니다. 이 선택은 HERMES의 `DISCORD_HOME_CHANNEL`이 적용된 뒤 사용하세요. 기존 Slack·새 Discord 기록은 연결된 HERMES 프로필이 API로 제공하는 범위에서 ORBIT 통합 기록으로 수집합니다. 다른 프로필을 별도로 연결하지 않았다면 그 프로필의 기록까지 수집했다고 표시하지 않습니다.

## 검증 범위
코드는 봇 검증·권한 확인·소유자 제한·명령 중복 방지·알림 재시도·이전 기록 보존을 지원합니다. 실제 Discord 봇 인증정보와 HERMES 서버에 적용한 뒤, 한 번의 지시가 실행·승인·결과 저장까지 이어지는지 확인해야 운영 전환 완료입니다. Slack 구독 해지나 과거 전체 Slack 파일을 Discord로 가져오는 작업은 수행하지 않습니다.

## 운영 전환 검증 보고서

`verification.json`은 stage에서 출력한 실제 `profile`, `bot`, `channel`, `probe`와 검증한 `runId`, `orbitRecordId`를 포함해야 합니다. `checks` 객체의 각 항목은 `passed: true`, `evidence: "실제 메시지 링크·실행 ID·검증 로그 위치"` 형식입니다. 다음 항목이 하나라도 미검증이면 Slack은 유지됩니다. 테스트용 가짜 ID나 단위 테스트 통과를 실제 검증 근거로 사용하지 마세요.

- `owner_command`: 허용 사용자 명령 접수
- `profile_execution`: 올바른 실제 프로필 실행
- `progress_and_result`: Discord 진행·최종 결과 수신
- `orbit_project_record`: 같은 업무의 ORBIT 프로젝트·결과 저장
- `approval_defer_reject_stop`: 승인·보류·거절·중지 실동작
- `unauthorized_rejected`: 허용 외 계정·채널 차단
- `duplicate_restart_retry`: 중복 입력·재시작·통신 재시도 검증
- `scheduled_delivery`: 지정 수신처 예약 실행
- `attachments_threads`: 기존 사용 파일·스레드 대응 검증

보고서는 운영자의 검증 기록이며, 도구가 각 근거의 진위를 자동 판별하는 것은 아닙니다. 전체 검증 이후에만 cutover를 실행하세요.

## 복구

전환 후 문제가 있으면 같은 프로필과 서비스로 다음 명령을 실행합니다.

```bash
python hermes-discord-migrate.py rollback --profile /home/hermes/.hermes --hermes-source /home/hermes/.hermes/hermes-agent --service hermes-gateway
```

cutover 복구는 Slack 병행 연결 상태로 돌아가고, stage 복구는 stage 전 설정으로 돌아갑니다. 변경한 예약의 수신처만 되돌리고 실행 횟수·세션·메시지는 보존합니다. 전환 이후 다른 운영자가 수신처를 수정했다면 자동 복구를 중단합니다. 서비스 재시작 실패 시에는 이전 설정을 복구한 뒤 활성 상태를 확인합니다. `active`는 프로세스 확인이며 실제 Slack 수신·발송 복구는 별도의 테스트 메시지와 예약 검증이 필요합니다.
