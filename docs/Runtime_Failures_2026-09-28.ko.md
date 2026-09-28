# orbit-daily-runtime 실패 추적 (2026-09-28)

검증 기준 GitHub main: `be0098ba000608eb77f7cee246102e605b0643cb`.

## 운영에서 확인한 사실

| 실패 알림(KST) | 직전 실제 예외(UTC) | 다음 실행 |
|---|---|---|
| 2026-09-27 14:34:10 | 05:34:07.084, `Error: Orbit runtime HTTP 503`, inline eval line 11 | 05:34:18 wake-up complete, 05:34:21 성공 |
| 2026-09-28 14:48:02 | 05:47:58.952, `Error: Orbit runtime HTTP 502`, inline eval line 11 | 05:48:08 wake-up complete, 05:48:11 성공 |

두 번 모두 Node v26.9.0에서 `!response.ok`를 곧바로 throw 하여 exit 1이 됐다. 인증 오류나 시작 시 문법 오류로 확인된 것이 아니다. 실패 후 다음 실행은 이미 회복됐다.

Render 설정은 `archive/main-76769c8`, auto-deploy off, build `node --version`, 시작 명령은 파일을 읽지 않는 `node --input-type=module -e '…'`였다. 따라서 main 수정이나 PR 병합만으로 해당 런타임 명령은 바뀌지 않는다.

main의 `scripts/runtime-tick.mjs`에 502와 503 응답을 각각 주입하고 실제 Node 자식 프로세스로 실행했다. 둘 다 exit 1 및 운영과 같은 오류 문자열이 재현됐다(HTTP 응답 mocked, 프로세스 실행 real).

## 원인 범위

확인된 클라이언트 문제는 일시적인 502/503 응답 한 번에 복구 시도 없이 실패하는 동작이다. **응답을 발생시킨 근본 서버 예외는 미확인**이다. `/api/runtime/tick` 자체도 `tickRuntime` 예외를 503으로 변환하므로 503이 게이트웨이 문제라는 단정은 불가능하다. 502도 상태 코드만으로 특정 공급자/네트워크 원인을 단정하지 않는다. 이 변경은 일시 실패 복구이며 서버 원인 해결의 증거가 아니다.

## 저장소 변경

- 502/503/504만 1초·2초 후 최대 두 번 재시도. 한 wake-up 전체에 걸친 총 재시도 제한.
- 전체 복구 기한 180초, 단일 요청 최대 150초. 정상 active 단계 진행은 기존 50초/12단계 제한 유지.
- 지속 오류는 여전히 비정상 종료한다. 인증 오류, 429, 일반 500, transport 오류, 잘못된 JSON을 성공으로 숨기지 않는다.
- 진단 로그는 상태 코드와 재시도 번호만 기록. 토큰·응답 본문은 기록하지 않는다.

## 운영에서 필요한 후속 조치

1. 검증된 PR을 main에 병합한 후 Render 서비스의 branch를 `main`, start command를 `node scripts/runtime-tick.mjs`로 변경한다. 기존 비밀 환경변수와 매분 스케줄을 유지한다. build command `node --version`으로 충분하며 npm 의존성은 필요 없다.
2. 변경된 소스를 배포하고 실행 로그에서 새 재시도 문구와 성공/실패를 확인한다. 재시작만 하면 기존 inline 명령이 다시 실행되므로 수정 적용이 아니다.
3. 계속 502/503이 나면 해당 시각의 Sites gateway/worker 로그를 확보한다. 특히 503의 경우 `tickRuntime` 내부 예외를 연결할 관측 자료가 필요하다.

이 작업에서는 Render 설정 변경·재배포·수동 실행을 하지 않았다. 연결된 도구에 branch/start command 수정 기능이 없고, 원인 불명의 운영 작업을 재실행해 해결됐다고 보고하지 않는다. `published`/`runtime-verified`는 not_run이다.
