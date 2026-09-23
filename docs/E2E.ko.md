# E2E 스모크 (Playwright)

핵심 사용자 여정 하나를 실제 브라우저(Chromium)로 끝까지 확인합니다. `npm test`(빌드 + 전체 테스트 게이트)에는 포함되지 않으며, `npm run test:e2e`로 따로 실행합니다.

## 무엇을 확인하나

`e2e/core-journey.spec.ts`, 모바일(390×844)과 데스크톱(1280×800) 두 뷰포트에서 각각 실행합니다.

1. 로그인한 사용자로 `/`를 열면 "오늘" 화면이 나온다.
2. "프로젝트 추가"에서 제목을 비우고 "추가하기"를 누르면 폼이 막히고 `/api/workspace` 쓰기 요청이 나가지 않는다 (실패 경로).
3. 제목을 넣고 저장하면 `POST /api/workspace`가 200을 돌려주고 프로젝트 상세가 열린다.
4. 페이지를 새로 고친 뒤 "프로젝트" 화면에 같은 프로젝트가 남아 있다 (로컬 D1에 저장됨).
5. 신원 헤더 없이 요청하면 `/api/workspace`는 401(`code: "AUTH"`), `/`는 `/signin-with-chatgpt`로 307 리다이렉트된다 (실패 경로).

화면 캡처는 `e2e/capture-manifest.ts`에 선언된 화면만 찍으며, `e2e/artifacts/screens/<viewport>-<screen>.png`와 같은 이름의 `.json`(screen, route, viewport, 크기, 파일명)으로 남깁니다. `e2e/artifacts/`는 git에 올라가지 않습니다. 실패하면 trace와 HTML 리포트도 `e2e/artifacts/`에 남습니다.

## 실제(real) vs 대체(mocked)

| 대상 | 상태 | 설명 |
| --- | --- | --- |
| 앱 서버 | real | `vite` 개발 서버 + Cloudflare 플러그인(workerd). 운영과 같은 라우트·서버 컴포넌트 코드 |
| 저장소(D1) | real (로컬) | `.wrangler/state`의 로컬 D1. `e2e/serve.sh`가 `drizzle/` 마이그레이션을 먼저 적용 |
| 로그인 | 대체 | ChatGPT Sites 로그인 자체는 로컬에 없습니다. Sites 프록시가 로그인 후 붙이는 `oai-authenticated-user-*` 헤더를 Playwright가 직접 붙입니다. 앱 코드는 바꾸지 않았고, 기존 빌드 테스트(`tests/rendered-html.test.mjs`)와 같은 방식입니다. 테스트마다 새 사용자 id를 씁니다 |
| OpenAI / Hermes / Slack / Plaud | 없음 | 로컬에 키·연동이 없어 호출되지 않습니다. 이 여정은 이 연동에 의존하지 않습니다 |
| 운영 Sites 배포 | 확인 안 함 | 이 스모크는 소스 검증이며 배포 검증(`verify-deploy.sh`)을 대신하지 않습니다 |

## 로컬에서 실행

```bash
npm ci
npx playwright install chromium   # 처음 한 번
npm run test:e2e
```

- Playwright가 `e2e/serve.sh`로 앱을 4317 포트에 띄우고 끝나면 내립니다. 이미 떠 있으면 재사용합니다(CI 제외).
- 포트 변경: `ORBIT_E2E_PORT=4400 npm run test:e2e`
- 이미 실행 중인 다른 주소에 붙이기: `ORBIT_E2E_BASE_URL=http://localhost:5173 npm run test:e2e` (이 경우 로컬 D1 마이그레이션은 직접 적용되어 있어야 합니다)
- 한 뷰포트만: `npm run test:e2e -- --project mobile`
- 리포트 보기: `npx playwright show-report e2e/artifacts/report`

로컬 D1은 개발 서버와 같은 `.wrangler/state`를 씁니다. 테스트는 매번 새 사용자로 프로젝트를 만들 뿐 기존 데이터를 지우지 않습니다.

## CI

`.github/workflows/e2e-smoke.yml`의 `e2e-smoke` 잡이 PR과 `main` push마다 Chromium을 설치하고 `npm run test:e2e`를 실행한 뒤 `e2e/artifacts/`를 `e2e-artifacts`로 업로드합니다.

지금은 **비차단(non-blocking)** 입니다. 테스트 단계에 `continue-on-error: true`가 있어 실패해도 잡은 초록으로 끝나고 경고 annotation만 남기며, `main-integration` 룰셋의 필수 체크는 여전히 `validate`뿐입니다.

## 차단(blocking)으로 올리는 방법

충분히 안정적이면(예: 연속 2주 또는 PR 20건 이상 실패 없음):

1. `e2e-smoke.yml`에서 테스트 단계의 `continue-on-error: true`와 "Report a failed smoke" 경고 단계를 지웁니다.
2. GitHub 저장소 설정의 `main-integration` 룰셋 필수 상태 체크에 `e2e-smoke`를 추가합니다(소유자 작업).
3. `AGENTS.md`의 병합 조건 설명에 `e2e-smoke`를 함께 적습니다.
