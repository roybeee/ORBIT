# ORBIT 안드로이드 앱

기존 ORBIT 계정과 업무 데이터를 사용하는 Android 앱입니다. 웹 업무 화면은 Android Browser Helper의 Trusted Web Activity(TWA)로 연결하며, 안드로이드 공유 메뉴와 받은 파일 보관함은 앱이 직접 제공합니다. 연결된 브라우저의 로그인 세션을 사용하므로 별도의 앱용 비밀번호나 서버 토큰을 저장하지 않습니다.

현재 ORBIT 주소는 로그인으로 보호된 Sites입니다. 도메인 소유 확인 파일을 브라우저가 공개적으로 확인할 수 없으면 안전한 Custom Tab으로 열리며 주소 표시줄이 보입니다. 이때도 기존 소유자 인증을 그대로 거칩니다. 주소 표시줄 없는 TWA 실행은 공개된 Digital Asset Links 설정이 가능한 도메인으로 연결한 뒤 활성화할 수 있습니다. 앱에서 사이트 접근 제한을 우회하지 않습니다.

## 구성

| 항목 | 값 |
| --- | --- |
| 정식 패키지 | `co.mealzip.orbit` |
| 베타 패키지 | `co.mealzip.orbit.debug` |
| 최소 버전 | Android 8.0, API 26 |
| 컴파일·대상 버전 | API 36 |
| Java | 17 |
| Gradle / Android Gradle Plugin | 8.11.1 / 8.10.1 |
| Android Browser Helper | 2.7.3 |
| 연결 주소 | `https://orbit-personal-os.hflameb.chatgpt.site/` |

앱을 설치해도 PC의 Hermes·ASIDE 실행 환경이 자동으로 휴대폰으로 옮겨지지는 않습니다. ORBIT에 연결한 서버 또는 켜진 PC가 계속 해당 작업을 수행합니다. 푸시 알림·기기 백그라운드 작업·오프라인 업무 편집은 이번 패키지에서 추가하지 않습니다.

## 베타 빌드와 설치

Android Studio에서 이 `android` 폴더를 프로젝트로 엽니다. SDK Manager에서 Android SDK Platform 36과 Build Tools 35.0.0을 설치하고 Gradle JDK를 17로 설정합니다. 명령행에서는 `ANDROID_HOME`을 SDK 위치로 지정하거나, 추적하지 않는 `local.properties`에 `sdk.dir`을 적습니다.

macOS / Linux:

```bash
cd android
./gradlew testDebugUnitTest lintDebug assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Windows PowerShell:

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

APK를 휴대폰에서 직접 열어 설치할 수도 있습니다. 휴대폰의 설치 안내에 따라 해당 다운로드 앱의 설치를 허용하면 **ORBIT Beta** 아이콘이 추가됩니다. 베타와 향후 정식 ORBIT은 별도 패키지이므로 함께 설치할 수 있으며, 앱의 로컬 공유 보관함도 서로 독립적입니다. 웹 업무 데이터는 같은 계정에 연결됩니다.

디버그 인증서는 개발 환경별로 다릅니다. 서로 다른 컴퓨터·CI에서 만든 베타 APK가 같은 서명이라고 가정하면 안 됩니다. 업데이트 시 서명 불일치가 나오면 이전 베타의 받은 파일을 먼저 처리한 후 제거하고 다시 설치합니다. 앱 제거는 로컬 받은 파일을 삭제합니다. 정식 배포에서는 아래의 고정된 업로드 키와 Play App Signing을 사용합니다.

## 휴대폰에서 확인할 동작

1. ORBIT Beta를 열고 기존 ORBIT 소유자 계정으로 로그인합니다. 대화·일정·프로젝트 데이터가 기존 웹과 같은지 확인합니다.
2. 갤러리·파일 앱·브라우저에서 공유를 눌러 ORBIT Beta가 표시되는지 확인합니다. 텍스트, 링크, 이미지, PDF, 복수 파일을 각각 보냅니다.
3. 받은 파일 보관함에서 파일 목록을 확인합니다. 현재 비공개 Sites 연결에서는 보관함의 안내에 따라 ORBIT의 첨부 선택기에서 **ORBIT 받은 파일**을 선택합니다. 공유한 텍스트·링크도 텍스트 파일로 받아 첨부할 수 있습니다. 서버 업로드와 메시지 전송은 기존 ORBIT 화면에서 확정합니다.
4. 파일 선택기에 표시된 문서를 연 뒤 실제 전송·업로드까지 확인합니다. 앱 종료 후 다시 열어 받은 파일이 남아 있는지도 확인합니다.
5. 뒤로 가기, 화면 회전, 로그인 만료, 연결 끊김 후 재시도, 파일 삭제를 확인합니다. 인증 만료 또는 첨부 취소 시 업무가 완료되었다고 표시되지 않아야 합니다.

자동 빌드와 단위 검사는 실제 갤럭시 기기의 OS 공유 목록·Chrome 로그인·파일 선택기 동작 검증을 대신하지 않습니다.

## 정식 서명과 Play Store AAB

릴리스 빌드는 네 가지 환경 변수가 모두 있어야 실행됩니다. 서명 값이 없으면 명시적으로 실패하며 디버그 키를 정식 키로 재사용하지 않습니다.

| 환경 변수 | 내용 |
| --- | --- |
| `ORBIT_KEYSTORE_FILE` | 업로드용 JKS 또는 keystore의 절대 경로 |
| `ORBIT_KEYSTORE_PASSWORD` | 저장소 비밀번호 |
| `ORBIT_KEY_ALIAS` | 업로드 키 별칭 |
| `ORBIT_KEY_PASSWORD` | 키 비밀번호 |

비밀 저장소 또는 로컬 셸에서 위 값을 주입한 후 실행합니다. 서명 파일·비밀번호·실제 사용자 데이터를 저장소에 커밋하지 않습니다. Play Console 신규 업로드마다 `orbitVersionCode`를 증가시킵니다.

```bash
cd android
./gradlew lintRelease bundleRelease -PorbitVersionCode=2 -PorbitVersionName=0.1.1
```

출력은 `app/build/outputs/bundle/release/app-release.aab`입니다. AAB는 휴대폰에 직접 설치하는 파일이 아니라 Play Console에 업로드하는 배포 묶음입니다. Play 내부 테스트 → 기기 점검 → 운영 출시 순서로 진행합니다. 개발자 계정, 업로드 키, 앱 설명·스크린샷, 개인정보처리방침, 데이터 보안 정보와 심사 제출이 별도로 필요합니다. 현재 저장소의 빌드 워크플로는 Play에 자동 게시하지 않습니다.

## GitHub Actions

`Android app` 워크플로는 Android 코드의 PR과 `main` 변경 시 단위 검사·Lint·베타 APK 빌드·APK 서명 검사를 수행하고 결과를 보관합니다. 새 개발은 기능 브랜치와 PR로 검토합니다.

서명된 AAB는 `workflow_dispatch`에서 `signed_release=true`로 실행할 때만 만듭니다. `android-release` Environment에 다음 Secrets를 등록합니다.

- `ORBIT_KEYSTORE_BASE64`: 업로드 키 파일 바이트를 Base64로 인코딩한 값.
- `ORBIT_KEYSTORE_PASSWORD`
- `ORBIT_KEY_ALIAS`
- `ORBIT_KEY_PASSWORD`

워크플로가 임시 키 파일을 생성하고 빌드 후 삭제합니다. AAB와 난독화 매핑만 결과물에 포함합니다. 비밀 값이 하나라도 없으면 릴리스 작업은 실패합니다. 조직 정책에 맞게 Environment의 배포 브랜치·검토자 제한을 설정할 수 있습니다.

## 도메인 변경과 전체 화면 TWA

서버와 인증을 해당 도메인에 실제 배포한 다음 `-PorbitOrigin=https://선택한-도메인`으로 빌드할 수 있습니다. 값은 경로·쿼리·인증 정보 없는 HTTPS origin이어야 합니다. 앱 내부 URL과 딥 링크 호스트는 동일한 값으로 생성됩니다.

공개적으로 접근 가능한 `https://선택한-도메인/.well-known/assetlinks.json`에 앱 패키지와 **Play 앱 서명 인증서** SHA-256 지문을 연결합니다. 업로드 인증서와 Play 앱 서명 인증서는 다를 수 있습니다. 직접 배포한 APK나 베타 테스트는 그 APK를 서명한 인증서와 해당 패키지 이름을 별도로 등록해야 합니다. 인증된 업무 화면이나 API를 공개로 전환할 필요는 없습니다.

참고: [AGP 8.10 호환성](https://developer.android.com/build/releases/agp-8-10-0-release-notes), [Android Browser Helper 릴리스](https://github.com/GoogleChrome/android-browser-helper/releases), [TWA 개요](https://developer.chrome.com/docs/android/trusted-web-activity/overview).

## 0.1.0 베타의 초기 검증 결과 — 2026-09-19

`testDebugUnitTest lintDebug assembleDebug`를 함께 실행해 성공했습니다. 단위 검사 24개(공유 보관함 16개, 문서 제공자 5개, URL 정책 3개)가 모두 통과했습니다. 경로 이탈, 취소, 읽기 권한, 원자적 파일 보관과 만료 처리를 포함합니다. Android Lint는 오류 0개, 경고 9개, 참고 1개입니다. 경고에는 한국어 전용 UI의 번역·아이콘 관련 항목과 최신 백업 설정 권고가 포함되며, 임시 공유 파일은 백업 대상에서 제외되는 `noBackupFilesDir`에 저장합니다.

생성한 베타 APK는 서명 검사를 통과했으며 `co.mealzip.orbit.debug`, 버전 `0.1.0-beta`, 최소 API 26·대상 API 36입니다. 빌드 시점 파일 크기는 5,225,823바이트, SHA-256은 `c229616dee6208eafc9d66740a54b327f81b97c6cd3d983b430ff8cae7aa2405`입니다. 재빌드 시 서명 키와 빌드 환경에 따라 해시는 달라질 수 있습니다. 정식 서명 변수가 없을 때 릴리스가 실패하는 보호 동작도 확인했습니다.

실제 휴대폰 또는 에뮬레이터에서 로그인·공유·첨부 흐름을 실행한 상태는 아닙니다. 정식 업로드 키가 제공되지 않아 서명된 AAB를 만들지 않았고, Play Store에 게시하지 않았습니다. APK 설치 후 위의 휴대폰 확인 절차가 남아 있습니다.

## 0.1.1 베타 실행 종료 수정

0.1.0에서 홈 화면의 ORBIT 열기·오늘의 업무·대시보드를 누르면 앱이 종료되는 문제가 보고되었습니다. Browser Helper가 실행 시 활성화/비활성화하는 `ManageDataLauncherActivity`가 manifest에서 빠져 있었습니다. Android는 존재하지 않는 컴포넌트의 상태를 변경하면 예외를 발생시킵니다. 필수 Activity와 설정 URL을 명시하고, 브라우저 검색에 필요한 HTTP intent 가시성도 추가했습니다. ORBIT 업무 주소와 실제 통신은 계속 HTTPS만 허용합니다.

브라우저 실행에 실패하면 받은 파일을 유지한 홈 화면으로 돌아와 재시도·주소 복사를 안내합니다. 실패 후 자동 실행 상태도 해제합니다. manifest 누락 여부는 실제 설치 정보를 읽는 회귀 검사로 확인합니다. Robolectric의 컴포넌트 활성화 모형은 이 Android 예외를 그대로 재현하지 않으므로 단순 실행 테스트만으로 판정하지 않습니다.

수정 APK는 버전 `0.1.1-beta`, versionCode `2`이며, 전달했던 0.1.0 APK와 같은 베타 서명 키로 빌드합니다. 이전 앱을 삭제하지 않고 APK를 열어 **업데이트**하면 로컬 받은 파일을 유지할 수 있습니다. 이 업데이트 안내는 동일한 인증서로 서명한 배포 파일에 해당하며 GitHub Actions의 임시 디버그 인증서와는 구별해야 합니다.

`testDebugUnitTest lintDebug assembleDebug`가 성공했고, 기존 24개와 실행 회귀 검사 9개를 합한 33개 검사가 통과했습니다. 누락 manifest에서는 새 검사에 `NameNotFoundException`이 발생하며, 수정 후 통과하는 것을 확인했습니다. 오류 복구·주소 복사·각 버튼의 목적지와 첨부 안내를 포함합니다. 실제 APK 안의 컴포넌트 선언과 이전 배포 APK와의 서명 인증서 일치도 확인했습니다. 실제 갤럭시에서 업데이트 설치 후 ORBIT 화면으로 전환되는지는 추가 확인이 필요합니다.


## 고정 서명 직접 설치판 0.1.4

기존 `co.mealzip.orbit.debug` 베타의 키를 복구하지 못해, 새 직접 설치판은
`co.mealzip.orbit` 패키지를 사용합니다. 기존 베타를 삭제하지 않고 함께 설치할 수 있습니다.
일반 실행은 안내 화면을 건너뛰고 오늘 화면을 엽니다. 같은 브라우저/계정의 웹 데이터로 연결하며,
기존 베타의 로컬 받은 파일은 자동 이전하지 않습니다.

CI의 `assembleDirect` 결과는 의도적으로 **미서명** 상태입니다. 배포 전 반드시
`scripts/sign-direct.sh`로 개인 보관된 `ORBIT-Android-Signing-Backup.zip`의 고정 키를 사용해 서명합니다.
개인 키와 비밀번호를 저장소 또는 공개 CI 결과물에 넣지 않습니다.
스크립트는 인증서가 아래 값과 다르면 출력 APK 생성을 거부합니다.

- 인증서 SHA-256: `e433dd8a8eb8ab6632b165522f906a32625c25b3514adc0d60baea3cd20c2252`
- 다음 업데이트: 같은 패키지/키 유지, versionCode 5보다 큰 값 사용
- `ORBIT_KEYSTORE_FILE`: 백업 내 orbit-direct.p12의 로컬 경로
- `ORBIT_KEYSTORE_PASSWORD_FILE`: 백업 내 store-password.txt의 로컬 경로
- 명령: `bash scripts/sign-direct.sh app/build/outputs/apk/direct/app-direct-unsigned.apk ORBIT.apk`

이 직접 설치판은 Play Store 배포가 아닙니다. 기존 release 빌드의 필수 서명 검사도 유지합니다.
