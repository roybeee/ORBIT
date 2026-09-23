## 해결하는 문제

## 변경된 사용자 동작

## 검증

각 검사 결과는 `passed | failed | blocked | not_run` 중 하나와 `real | mocked`로 적는다(예: `npm test` passed · real, OpenAI 호출 stub 테스트는 mocked). `blocked`/`not_run`은 이유를 함께 적는다.

- 작업 시작 시 직접 확인한 GitHub `main` SHA:
- PR head SHA / 소스 tree:
- [ ] 최신 `AGENTS.md` 확인 및 병합 직전 원격 `main` 재확인
- [ ] Typecheck
- [ ] `npm test` 전체 통과 및 현재 PR 코드의 `Validate Orbit` 성공
- [ ] 자동 머지(`gh pr merge --auto --merge`, main 최신화 필수) 완료 후 원격 `main` SHA 재확인
- [ ] Scheduling, approval and storage tests
- [ ] Build and SSR smoke test
- [ ] Necessary mobile/keyboard checks for this change

## 데이터 / 연동 / 복구 영향

- 소스/배포 상태(`merged` / `published` / `runtime-verified`, AGENTS.md "State vocabulary"):
- Sites 배포 여부 / 배포했다면 GitHub SHA와 Sites 버전 (`docs/releases/` 기록, `verify-deploy.sh` 결과):

연결 Issue:
