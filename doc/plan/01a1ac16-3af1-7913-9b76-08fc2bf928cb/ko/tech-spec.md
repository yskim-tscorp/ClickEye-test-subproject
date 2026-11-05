---
type: plan-document
title: 사내 도서 대여 서비스 기술 스펙
description: 사내 도서 대여 서비스 1차 오픈의 스택, 모듈 인터페이스, 데이터 모델, 마이그레이션, 외부 연동, 시험 경계, 보존·삭제와 공통 개발 규칙
status: approved
tags: [plan, tech_spec]
plan: 01a1ac16-3af1-7913-9b76-08fc2bf928cb
stage: tech_spec
lang: ko
---

# 사내 도서 대여 서비스 기술 스펙

용어는 `plan/glossary.md` 를 따른다. 구성 요소 id(C-01~C-09)와 결정 id(S3-D1~D16)는 `plan/architecture.md` 의 것이다. 이 문서의 결정은 S4-D1 부터 번호를 붙이며 본문은 결정자가 `decisions.json` 에 기록한다. 레포에는 `README.md` 한 개뿐이고(`README.md:1`) 소스·매니페스트·마이그레이션·테스트가 없으므로 아래의 모든 것이 신규이며 따를 기존 관례도 없다.

## 1. 쉬운 말 요약

서비스는 TypeScript 한 언어로 만든 웹 서비스 1개와 PostgreSQL 1개이고, 화면은 같은 서비스가 내려 주는 모바일 360px 웹이다. 임직원·도서·권·대여 건·세션 다섯 가지를 저장하며 권의 「대여 중」 표시는 저장하지 않고 대여 건에서 읽을 때 계산하므로, 한 권이 두 사람에게 나가거나 반쯤 처리된 대여가 남는 일을 저장소가 막는다. 비밀번호와 사번은 어디에도 저장하지 않고, 이름·부서·회사 메일은 필요한 동안만 보관한 뒤 매일 정리 작업이 지우고, 브라우저와의 HTTPS 는 서비스 앞의 사내 프록시가 맡는다. 남은 위험은 세 가지로, 첫째와 둘째인 회사 계정 시스템이 회사 메일을 돌려주고 연동할 수 있는지와 50건이 동시에 한 권을 빌릴 때 정확히 한 건만 성공하는지는 문서로 확인할 수 없어 구현 첫 단계에서 실험한다(10절). 셋째, 로그인 시도 횟수 제한은 요구사항 A-19 에 따라 서비스에 두지 않으므로 한 클라이언트의 반복 요청이 회사 계정 동시 호출 상한 10건을 채우면 그동안 새 로그인이 막히고(이미 로그인한 사용자는 영향 없음) 이 점은 가정 A-14 에 적었다.

## 2. 스택

레포에 기존 언어·프레임워크·DB 가 없으므로 아래는 모두 새로 들이는 것이다(`README.md:1`). 선택 기준은 ① 1차 6주 일정(`plan/requirements.md#NFR-05`), ② 서버와 화면이 같은 검증 규칙을 쓰는 것(`S3-D14`), ③ 부분 유일 인덱스와 동시성 시험이 되는 실제 DB(`S3-D1`, `S3-D2`), ④ 사내 서버 한 대에서 운영 부담이 적은 것(`S3-D3`)이다. 라이선스는 각 프로젝트의 공개 표기 기준이며, 의존성을 실제로 추가하는 변경에서 잠금 파일(`package-lock.json`)로 다시 확인한다.

### 2.1 새로 들이는 것

| 이름(버전) | 쓰는 곳 | 이유 | 라이선스 | 채택하지 않은 대안 |
|---|---|---|---|---|
| TypeScript(strict) on Node.js 24 LTS | 서버·화면·공유 코드 전부 | 한 언어로 서버와 화면이 같은 검증 함수·상수·타입을 쓴다. 새 언어 두 개를 6주에 익히지 않는다(결정 S4-D1, ADR 0002) | TypeScript Apache-2.0, Node.js MIT | Java/Spring Boot 서버 + 별도 화면, Go 서버 + 화면 — 검증 규칙을 두 언어로 따로 구현해야 해 정본 하나(`checklist:architecture#2`)를 지키기 어렵다 |
| Fastify 5 | HTTP 서버(C-02) | JSON 스키마 검증이 내장돼 OpenAPI 의 스키마를 그대로 경로 검증에 쓸 수 있다. 요청 id·구조화 로그(pino)가 내장이다 | MIT | Express — 검증·로그를 따로 붙여야 한다. NestJS — 이 규모에 층이 많다 |
| `@fastify/cookie`, `@fastify/csrf-protection`, `@fastify/helmet`, `@fastify/static` | 쿠키, CSRF, 보안 헤더, 화면 파일 제공 | Fastify 공식 플러그인이라 같은 유지 관리 주체다. 직접 만든 보안 코드를 줄인다 | MIT | 직접 구현 — 보안 코드는 직접 만들지 않는다 |
| Ajv 8, ajv-formats | 입력 검증(서버 실행 시 컴파일, 화면은 빌드 때 생성) | OpenAPI 의 JSON 스키마를 검증 규칙의 정본으로 쓴다(S3-D14) | MIT | zod — 규칙을 코드로 다시 써야 해 정본이 둘이 된다 |
| yaml | `api/openapi.yaml` 읽기 | 명세를 서버 시작 때 읽어 경로 검증과 화면용 검증 함수를 만든다 | ISC | js-yaml — 동등, 새로 고를 이유 없음 |
| openapi-typescript | 명세에서 TypeScript 타입 생성(개발 도구) | 화면의 API 호출 타입이 명세에서 나와 어긋나면 컴파일이 깨진다(`checklist:architecture#4`) | MIT | 손으로 쓴 타입 — 드리프트가 생긴다 |
| pg(node-postgres) 8 | PostgreSQL 연결·질의(C-07) | `INSERT … ON CONFLICT DO NOTHING` 영향 행 수와 트랜잭션을 그대로 다룬다(S3-D15) | MIT | Prisma·TypeORM — 부분 유일 인덱스와 충돌 처리 문장을 추상화 뒤에 숨긴다. Kysely — 이 규모에 질의 수가 적어 손으로 쓴 SQL 로 충분하다 |
| node-pg-migrate | 마이그레이션 실행 | SQL 파일에 위로(up)·아래로(down) 구간을 한 파일에 둔다 | MIT | dbmate — 별도 실행 파일이 하나 더 필요하다. Flyway — Java 런타임이 필요하다 |
| React 19, React DOM | 웹 화면(C-01) | 영역마다 로딩·빈·오류 상태를 따로 보이는 화면 설계(`plan/ui-spec.md#4`)를 상태로 다루기 쉽다 | MIT | 서버 렌더링 + htmx — 영역별 재시도·대화상자 초점 관리를 직접 짜야 한다 |
| React Router 7 | 화면 경로 | 경로 5개(로그인·검색·상세·내 대여 현황·없는 경로) | MIT | 경로 라이브러리 없이 직접 — 뒤로 가기·초점 이동을 다시 만들어야 한다 |
| Vite | 화면 빌드 | 빌드 결과가 정적 파일이라 서비스가 그대로 내려 준다. 인라인 스크립트가 없다 | MIT | Webpack — 설정이 무겁다 |
| pino(Fastify 내장) | 구조화 로그 | 마스킹 경로 지정이 된다(`checklist:security#8`) | MIT | 직접 로그 — 마스킹을 놓치기 쉽다 |
| Vitest | 시험 실행 | TypeScript 를 바로 실행하고 서버·화면 시험을 한 도구로 돌린다 | MIT | Jest — 설정이 더 필요하다 |
| Playwright, @axe-core/playwright | 브라우저 스모크 시험(360px, 접근성 점검) | 360px 가로 스크롤 없음·초점·대비 같은 화면 요구(`plan/ui-spec.md#4`)는 브라우저에서만 잡힌다 | Playwright Apache-2.0, axe-core 연동 MPL-2.0(개발 전용, 배포물 미포함) | Cypress — 동등, 새로 고를 이유 없음 |
| ESLint, typescript-eslint | 정적 검사와 의존 방향 강제 | 모듈 사이 가져오기 금지(3.1절)를 기계로 검사한다 | MIT | 리뷰만으로 지키기 — 어겨도 안 잡힌다 |
| PostgreSQL 17 | 데이터 저장소(C-07) | 부분 유일 인덱스·생성 열·`ON CONFLICT` 가 필요하다(S3-D2). `gen_random_uuid()` 가 확장 없이 내장이다 | PostgreSQL License | 다른 DB — 부분 유일 인덱스 요구에 맞는 대안이 이미 S3-D2 에서 탈락했다 |
| nginx | HTTPS 종단(2.2절) | 인증서 파일을 서비스가 읽지 않게 하고 80→443 이동·HSTS·본문 한도를 맡긴다 | BSD-2-Clause | Caddy — 사내 IT 운영 표준 정보가 없어 가장 널리 쓰이는 것을 고른다 |
| age | 백업 파일 암호화(7.4절) | 공개키로만 암호화하므로 서버에 복호화 키가 없어 서버가 뚫려도 과거 백업이 열리지 않는다(S4-D30) | BSD-3-Clause | gpg — 키 관리 설정이 무겁다. 서버 안 대칭키 — 서버 침해 때 백업도 함께 열린다 |
| Linux + systemd(서비스·타이머) | 프로세스 관리, 정리 작업 스케줄(C-08) | S3-D16 의 「OS 스케줄러 매일 1회」를 타이머 단위 파일로 구현한다 | systemd LGPL-2.1 이상(운영체제 구성 요소) | cron — 실패 로그·재시도 설정이 약하다 |

화면의 CSS 는 디자인 시스템이 없어(`plan/ui-spec.md#1. 개요`) 의존성 없이 CSS 변수와 Vite 내장 CSS 모듈로 직접 쓴다. 대화상자는 브라우저 기본 `<dialog>` 요소(초점 가둠·Esc 내장)를 쓴다. 아이콘은 쓰지 않는다(`plan/ui-spec.md#G-21`). 회사 계정 연동 라이브러리(LDAP·OIDC 등)는 스파이크 S3-D5 결과로 정해지므로 이 표에 없다 — 정해지면 새 결정으로 추가한다.

### 2.2 HTTPS 종단 위치(S3-D13 이 미룬 것)

**서비스 앞의 nginx 가 종단한다.** nginx 는 같은 서버의 443 에서 사내 CA 인증서(A-07 of S3)로 TLS 를 끝내고, 80 은 443 으로 영구 이동시키며, 서비스(Node)는 `127.0.0.1` 의 평문 HTTP 포트에만 바인드한다. 선택 이유는 세 가지다. 첫째, 개인키 파일을 서비스 계정이 읽지 않아 서비스가 뚫려도 키가 새지 않는다(`checklist:security#7`). 둘째, 인증서 교체가 서비스 재시작 없이 되고 80→443 이동·HSTS 가 한 곳에 있다. 셋째, 서비스가 사내망 어디서든 직접 열리지 않아 S3-D10 의 「인터넷에 노출하지 않음」과 맞다. 대가는 프로세스가 하나 더 있다는 것이다. nginx 설정 요지(구체 파일은 S6 의 운영 Task):

| 항목 | 값 |
|---|---|
| 인증서·개인키 경로 | `<COMPANY_CA_CERT_PATH>`, `<COMPANY_CA_KEY_PATH>`(운영 서버에서 IT 가 둔 파일, 레포에 없음) |
| 요청 본문 한도 | 2 MiB(서비스의 한도 1 MiB 가 먼저 걸려 400 입력 검증 오류가 되게 한다). 2 MiB 를 넘어 nginx 가 413 을 내는 경우는 아래 `error_page` 로 `VALIDATION_FAILED`(400)가 된다 |
| 위임 시간 제한 | 읽기 15초(회사 계정 호출 10초 + 여유) |
| 프록시 오류 응답 | 413·502·503·504(서비스 다운·무응답 포함)은 nginx 가 만든 HTML 이라 11.1절 형식이 아니다. `error_page` 로 `default_type application/json` 의 11.1절 형식 JSON 을 직접 돌려준다 — 413 은 `VALIDATION_FAILED`(400), 502·503·504 는 `UNAVAILABLE`(503). `message` 는 11.3절 `UNAVAILABLE` 의 「그 밖」 문구, `details` 는 `[]`, `trace_id` 는 `$request_id` 다(S4-D32). 화면이 JSON 해석에 실패해도 11.5절의 「응답 해석 실패 → 영역 안 안내」로 흡수된다 |
| 전달 헤더 | `X-Request-Id: $request_id`, `X-Forwarded-Proto https`. 서비스는 루프백 주소에서 온 것만 믿는다 |
| HSTS | `max-age=31536000`(하위 도메인 포함 안 함) |
| 서비스 쿠키 | 서비스가 `Secure` 를 명시로 붙인다(프록시 뒤 평문 연결에서도 붙도록 자동 판정에 기대지 않는다) |

### 2.3 실행 환경과 디렉터리

| 항목 | 값 |
|---|---|
| 실행 | 사내 서버 1대, Linux, systemd 단위 `book-loan.service`(서비스), `book-loan-cleanup.service` + `book-loan-cleanup.timer`(C-08) |
| 서버 시각 | 사내 시간 서버(NTP)와 동기화한다. 반납 예정일·연체가 서버 시각에 기대므로 운영 준비 항목이다 |
| 설정 | 모두 환경변수. 목록과 역할별 값 파일은 7.5절 |
| 빌드 산출물 | `dist/` 에 서버 JS 와 화면 정적 파일. 배포는 `npm ci --omit=dev` 로 만든 운영 의존성만 담은 묶음을 서버에 올린다(운영 서버가 npm 레지스트리에 접속하지 않고 개발 도구는 묶음에 없다) |
| 공급망 점검(foundation Task 의 CI) | ① 설치는 `npm ci --ignore-scripts`(설치 스크립트가 꼭 필요한 패키지만 이름을 적은 예외 목록으로 따로 실행). ② `npm audit --omit=dev` 가 정한 임계 이상(high 이상)을 찾으면 실패. ③ 전이 의존성까지 라이선스를 점검해 MIT·ISC·BSD·Apache-2.0 만 허용하고 개발 전용 MPL-2.0 은 `devDependencies` 에서만 허용, 그 밖은 실패(S4-D34) |

레포 디렉터리(전부 신규):

```
api/openapi.yaml                 검증·오류 코드·문구의 정본(S5 가 작성)
db/migrations/                   0001~0005 SQL 마이그레이션
ops/                             nginx 설정, systemd 단위, 역할 생성 SQL, 백업 스크립트
src/shared/                      명세에서 생성한 상수·타입, 검색어 정규화
src/server/{http,auth,catalog,loans,clock,db,jobs,tools}/
src/web/                         React 화면
tests/                           api/, loans/, jobs/, e2e/, support/
```

## 3. 모듈

C-01~C-09 모두 신규다. 시그니처는 TypeScript 로 적고 구현을 정하는 것이 아니라 호출 모양을 확정한다. 날짜는 한국 표준시 달력 날짜 문자열 `KstDate`(`'YYYY-MM-DD'`), 시각은 `Date` 이다.

### 3.1 의존 방향

```
C-01 ──(HTTP, 생성 타입)──▶ C-02 ──▶ C-03, C-04, C-05 ──▶ C-07, C-06
C-08 ──▶ C-07, C-06        C-09 ──▶ C-07, C-06        C-04 ⇢ C-05 금지, C-05 ⇢ C-04 금지
```

- 화면(`src/web`)은 서버 코드를 가져오지 않는다. 가져오는 것은 `src/shared` 와 생성 타입뿐이다.
- C-04·C-05 는 서로를 가져오지 않는다. 도서 상세의 「내가 연체 중인가」는 C-02 의 경로 처리가 둘을 각각 불러 합친다.
- C-02(`src/server/http`)만 요청·응답 객체를 안다. 모듈(C-03~C-05)은 HTTP 를 모른다.
- 위 규칙은 ESLint `no-restricted-imports` 를 디렉터리별로 걸어 기계 검사한다(S6 foundation Task).
- 조립은 `src/server/main.ts` 한 곳에서 한다. 시험은 같은 조립 함수 `buildApp` 에 대역을 넣는다(8절).

### 3.2 C-01 웹 화면 — `src/web/`

- 의존: C-02(HTTP 만), `src/shared`.
- 화면 경로 → 화면 id:

| 경로 | 화면 | 비고 |
|---|---|---|
| `/login` | SCR-01 | 로그인 전용. 상단 바에 이동 링크·로그아웃 없음 |
| `/books` (`?q=&page=`) | SCR-02 | 검색어는 주소에 둔다(새로고침해도 유지) |
| `/books/:bookId` | SCR-03 | `BOOK_NOT_FOUND` 이면 SCR-06 을 같은 주소에서 보인다 |
| `/employees/:employeeId/loans` | SCR-04, SCR-05(대화상자) | 상단 바 「내 대여 현황」은 내 id 로 이동. 남의 id 면 `FORBIDDEN` → SCR-08 |
| 그 밖의 모든 경로 | SCR-06 | 서비스는 `/api` 가 아닌 GET 에 `index.html` 을 돌려 준다 |

- 화면 내부 API 클라이언트(`src/web/api/client.ts`, 생성 타입 사용). 모든 변경 호출은 CSRF 머리말을 붙이고, 응답 오류는 11.3절의 `code` 로 가른다:

```ts
searchBooks(q: string, page: number): Promise<BookSearchPage>;
getBook(bookId: string): Promise<BookDetail>;
borrowBook(bookId: string, requestId: string): Promise<BorrowResult>;
listEmployeeLoans(employeeId: string): Promise<MyLoans>;
returnLoan(loanId: string): Promise<ReturnResult>;
login(account: string, password: string): Promise<{ employeeId: string }>;
logout(): Promise<void>;
getSession(): Promise<{ employeeId: string }>;
getPublicConfig(): Promise<{ itSupportExt: string }>;
```

- **요청 식별자 발급 규칙**: `crypto.randomUUID()` 로 「대여」를 누를 때 만든다. 응답을 못 받은 채 끝났으면(네트워크 실패·시간 초과) 같은 값을 다시 쓰고, 성공이든 거절이든 응답을 받으면 다음 누름에서 새 값을 만든다. 이렇게 해야 응답 유실 뒤 재시도가 같은 제출이 되고(`plan/requirements.md#US-07`), 의도한 두 번째 대여는 별개가 된다. 처리 중에는 버튼이 `aria-disabled` 라 연타가 새 제출을 만들지 않는다.
- **「불러오지 못함」 표시**: 응답이 없거나 5xx 이면 영역 안 안내만 쓴다(11.5절).
- 검증: 로그인 두 칸은 빌드 때 생성한 검증 함수로 확인하고 서버가 준 `details[].field` 와 같은 칸 아래 문구로 보인다(`plan/ui-spec.md#SCR-01`). 검색어는 `src/shared` 의 정규화 함수로 100자에서 자른 뒤 보낸다.
- 보안: 사용자 입력·도서 필드는 React 의 기본 이스케이프 출력만 쓰고 `dangerouslySetInnerHTML` 는 ESLint 로 금지한다(`checklist:security#5`). 화면 스크립트는 `script-src 'self'` 에서 돌고 `unsafe-eval`·인라인 스크립트가 없다(검증 함수를 Ajv standalone 으로 미리 생성하는 이유).

### 3.3 C-02 서비스 진입 계층 — `src/server/http/`

- 의존: C-03, C-04, C-05, C-06(세션 만료 판정), C-07(세션 저장).
- 하는 일: 요청 id 부여, 보안 헤더, 쿠키·세션 확인, CSRF 확인, 명세 기반 입력 검증, 소유 확인에 필요한 `employeeId` 주입, 오류 이름→응답 변환, 로그. 규칙 판단은 하지 않는다.

```ts
export interface AppDeps {
  config: Config;
  db: Db;                         // C-07
  clock: Clock;                   // C-06
  companyAccount: CompanyAccountPort; // C-03 의 교체 지점
}
export function buildApp(deps: AppDeps): Promise<FastifyInstance>;

// 세션(같은 디렉터리의 session.ts) — buildApp 이 deps.db·deps.clock 으로 한 번 만들어 처리기에 넘긴다(숨은 전역 없음, S4-D33)
export interface SessionStore {
  create(tx: Tx, employeeId: EmployeeId): Promise<{ sessionId: string; expiresAt: Date }>;  // 로그인 트랜잭션 안에서. 시각은 clock.now()
  resolve(sessionId: string): Promise<EmployeeId | null>;       // 만료된 행은 null
  destroy(sessionId: string): Promise<void>;
}
export function createSessionStore(db: Db, clock: Clock): SessionStore;
```

- 경로 처리기는 명세의 `operationId` 로 등록한다. 명세에 있는데 처리기가 없거나 그 반대면 서버가 시작하지 않는다(드리프트 차단).
- API 면(연산 목록 — 요청·응답 스키마는 S5 의 `api/openapi.yaml` 이 정본):

| operationId | 메서드·경로 | 세션 | CSRF | 모듈 | 화면 |
|---|---|---|---|---|---|
| getPublicConfig | GET `/api/public-config` | 불필요 | 불필요 | C-02 | SCR-01 |
| getCsrfToken | GET `/api/csrf` | 불필요 | 불필요 | C-02 | SCR-01 |
| login | POST `/api/session` | 불필요 | 필요 | C-03 | SCR-01 |
| getSession | GET `/api/session` | 필요 | 불필요 | C-02 | 모든 화면 |
| logout | DELETE `/api/session` | 필요 | 필요 | C-02 | 상단 바 |
| searchBooks | GET `/api/books` | 필요 | 불필요 | C-04 | SCR-02 |
| getBook | GET `/api/books/{bookId}` | 필요 | 불필요 | C-04, C-05 | SCR-03 |
| getBookCover | GET `/api/books/{bookId}/cover` | 필요 | 불필요 | C-04 | SCR-02, SCR-03 |
| borrowBook | POST `/api/books/{bookId}/loans` | 필요 | 필요 | C-05 | SCR-03 |
| listEmployeeLoans | GET `/api/employees/{employeeId}/loans` | 필요 | 불필요 | C-05 | SCR-04 |
| returnLoan | POST `/api/loans/{loanId}/return` | 필요 | 필요 | C-05 | SCR-04, SCR-05 |
| getHealth | GET `/healthz` | 불필요 | 불필요 | C-02 | 없음(운영) |

- `listEmployeeLoans` 의 경로 id 가 세션의 임직원과 다르면 존재 여부와 상관없이 `FORBIDDEN` 이다(S3-D8, `plan/requirements.md#US-09`). `returnLoan` 은 남의 건·없는 건 모두 `FORBIDDEN` 이다.
- 세션 쿠키 이름 `__Host-session`, 속성 `HttpOnly; Secure; SameSite=Strict; Path=/`(도메인 속성 없음). 값은 CSPRNG 32바이트를 base64url 로 만든 것이고 DB 에는 SHA-256 해시(32바이트)만 둔다(S3-D12). 유지 시간은 만들 때부터 8시간 절대 만료이며 활동으로 늘리지 않는다(A-01). 로그인 성공마다 새 식별자를 발급하고 요청에 실린 이전 세션이 있으면 지운다.
- CSRF: `GET /api/csrf` 가 비밀 값을 `__Host-csrf` 쿠키(HttpOnly·Secure·SameSite=Strict)로 심고 토큰을 응답으로 준다. 화면은 모든 변경 요청에 `X-CSRF-Token` 머리말로 되돌려 보낸다(이중 제출). 변경 요청은 `Origin` 도 `ALLOWED_ORIGIN` 과 같아야 한다. 로그인 성공 때 세션과 함께 CSRF 비밀 값도 새로 발급한다(로그인 CSRF 포함 — `plan/architecture.md#5. 신뢰 경계`).
- 보안 헤더(`@fastify/helmet`): `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. `/api` 응답은 `Cache-Control: no-store`, 표지는 `private, max-age=86400` 에 더해 `Content-Disposition: inline` 과 `Content-Security-Policy: sandbox`(표지 파일이 직접 열려도 스크립트가 돌지 않게)를 붙인다.
- 경로 id 형식 오류의 응답 코드는 11.3절 끝의 규칙을 따른다(`listEmployeeLoans`·`returnLoan` → `FORBIDDEN`, `getBook`·`getBookCover`·`borrowBook` → `BOOK_NOT_FOUND`).

### 3.4 C-03 회사 계정 인증 어댑터 — `src/server/auth/`

- 의존: C-07(임직원 쓰기). 외부 시스템은 `CompanyAccountPort` 하나 뒤에만 있다.

```ts
export interface CompanyPerson {
  email: string;               // 필수. 정규화 전 값
  name: string | null;
  department: string | null;
}
export interface CompanyAccountPort {
  authenticate(input: { account: string; password: string; signal: AbortSignal }): Promise<CompanyPerson>;
  // 실패: CompanyAuthRejected(계정·비밀번호 불일치) 또는 CompanyAuthUnavailable(무응답·연결 실패·형식 이상)
}
export class AuthError extends Error { code: 'AUTH_FAILED' | 'AUTH_UNAVAILABLE' }

// 정규화를 마친 값. verifyCompanyAccount 만 만들고 upsertEmployee 만 받는다
export interface VerifiedPerson {
  email: string;               // 앞뒤 공백 제거 + 소문자, 3~254자, '@' 하나
  name: string | null;         // 1~100자로 자른 값, 없으면 null
  department: string | null;
}

// 아래 두 함수(src/server/auth/login.ts)는 테스트 seam 이 아니라 C-02 의 login 처리기만 부르는 내부 함수다.
// 승인된 seam 은 CompanyAccountPort 하나뿐이다(S3-D5).
export function verifyCompanyAccount(port: CompanyAccountPort, input: { account: string; password: string }): Promise<VerifiedPerson>;  // 외부 호출만, DB 미사용, 10초
export function upsertEmployee(tx: Tx, person: VerifiedPerson, now: Date): Promise<EmployeeId>;   // 만들기 또는 이름·부서 갱신
```

- `verifyCompanyAccount` 가 DB 트랜잭션 밖에 있는 이유: 외부 호출 10초 동안 DB 연결을 쥐지 않는다. 로그인 처리기(C-02)는 `verifyCompanyAccount` → `db.tx(upsertEmployee + sessionStore.create)` 순서이고, 임직원 행과 세션이 한 트랜잭션이라 C-08 이 둘 사이를 파고들지 못한다.
- `upsertEmployee` 는 `INSERT … ON CONFLICT (email) DO UPDATE SET name, department, updated_at` 이고 **이름·부서가 그대로여도 `updated_at` 을 항상 `clock.now()` 로 쓴다**(조건부 갱신으로 최적화하지 않는다). 정리 작업의 삭제 경합 방어가 이 갱신에 기댄다(3.9절, S4-D28).
- `verifyCompanyAccount` 규칙: `AbortSignal.timeout(COMPANY_AUTH_TIMEOUT_MS)`(기본 10000), 재시도 없음, 동시 호출 `COMPANY_AUTH_CONCURRENCY`(기본 10)를 넘으면 기다리지 않고 `UNAVAILABLE`(운영 상한 — `plan/architecture.md#6. 배치와 운영`), 받은 값 중 `email`·`name`·`department` 외에는 버린다. 회사 메일이 없거나 형식이 틀리면(`@` 하나, 254자 이하) 로그인을 허용하지 않고 `AUTH_UNAVAILABLE` 이다 — 사용자에게는 「회사 계정 확인을 하지 못했습니다」이고 로그에는 사유 `EMAIL_MISSING` 만 남긴다(`plan/requirements.md#A-13`).
- 회사 메일은 앞뒤 공백 제거 후 소문자로 바꿔 저장·비교한다(S3 A-05). 이름·부서가 오지 않으면 저장값도 비운다(A-02).
- 실제 구현 파일 이름은 연동 방식이 정해진 뒤 `company-account-<방식>.ts` 로 둔다(스파이크 S3-D5). 시험 대역은 `tests/support/fake-company-account.ts`.

### 3.5 C-04 도서 조회 모듈 — `src/server/catalog/`

- 의존: C-07. C-05 와 서로 가져오지 않는다.

```ts
export interface BookListItem { bookId: string; title: string; author: string; hasCover: boolean; availableCount: number }
export interface BookDetail extends BookListItem {
  publisher: string | null; description: string | null;
  copies: { copyNo: number; available: boolean }[];   // copyNo 오름차순
}
export interface Catalog {
  searchBooks(input: { query: string; page: number }): Promise<{ items: BookListItem[]; hasNext: boolean }>;
  getBook(input: { bookId: string }): Promise<BookDetail>;            // 없으면 CatalogError('BOOK_NOT_FOUND')
  openCover(input: { bookId: string }): Promise<{ stream: Readable; contentType: string } | null>;
}
```

- `query` 는 이미 정규화돼 들어온다(공백 모두 제거·소문자·100자 — `src/shared/search-query.ts`, 규칙은 `plan/requirements.md#A-22`). 비어 있으면 전체 도서다. LIKE 와일드카드(`%`, `_`, `\`)는 이스케이프하고 값은 매개변수로 바인딩한다(`checklist:security#4`).
- 쪽 크기 20(명세의 확장 값 `x-page-size`), `LIMIT 21` 로 읽어 21번째 존재 여부를 `hasNext` 로 쓴다. 정렬은 제목(`COLLATE "C"`) 오름차순, 같으면 도서 id 순(A-05).
- `availableCount` = 그 도서의 권 중 열린 대여 건(반납일 비어 있음)이 없는 권의 수. 저장하지 않는다(S3-D7). 「열린 대여 건이 없는 권」 판정(`NOT EXISTS (SELECT 1 FROM loans WHERE copy_id = c.id AND returned_at IS NULL)`)은 C-07 의 `src/server/db/loans.ts` 한 곳에만 있고(`countFreeCopiesByBook`·`listFreeCopies`·`copyAvailability`), 검색·상세의 집계(C-04)와 borrow 의 후보 선택(C-05)이 같은 조각을 쓴다(S4-D35). 둘 사이에 드리프트가 없는지는 8.1절 seam 2 가 시험한다.
- 표지: `books.cover_file` 이 있으면 `COVER_DIR` 아래 그 이름의 파일을 읽는다. 이름은 DB 제약으로 `/`·`..` 를 못 담고, 읽기 전에 `fs.realpath` 로 해석한 파일 경로가 `COVER_DIR` 를 `realpath` 한 경로 아래인지 확인한다(심볼릭 링크로 밖을 가리키면 `null`). 응답 형식은 확장자로 정하고(png·jpg·webp) `nosniff`, `Content-Disposition: inline`, `Content-Security-Policy: sandbox` 를 붙인다(S4-D36). 파일이 없거나 이름이 없으면 `null` 이고 화면은 회색 자리 상자를 보인다(`plan/requirements.md#A-14`).

### 3.6 C-05 대여·반납 모듈 (핵심) — `src/server/loans/`

- 의존: C-06(오늘 날짜·현재 시각), C-07(질의 함수). 규칙은 이 모듈에만 있다.

```ts
export type LoansErrorCode =
  | 'OVERDUE_BLOCKED' | 'NO_COPY_AVAILABLE' | 'BOOK_NOT_FOUND' | 'FORBIDDEN'
  | 'ALREADY_RETURNED' | 'REQUEST_ID_CONFLICT' | 'UNAVAILABLE';
export class LoansError extends Error { code: LoansErrorCode }   // 7종 밖의 예외는 던지지 않는다

export interface BorrowInput  { employeeId: EmployeeId; bookId: string; requestId: string /* UUID */ }
export interface BorrowResult { loanId: string; bookTitle: string; dueOn: KstDate; replayed: boolean }
export interface ReturnInput  { employeeId: EmployeeId; loanId: string }
export interface ReturnResult { loanId: string; returnedOn: KstDate }
export interface MyLoansItem  { loanId: string; bookTitle: string; dueOn: KstDate; overdue: boolean }
export interface MyLoansResult { items: MyLoansItem[]; hasOverdue: boolean }   // dueOn 오름차순, 같으면 먼저 빌린 순

export interface Loans {
  borrow(input: BorrowInput): Promise<BorrowResult>;
  returnLoan(input: ReturnInput): Promise<ReturnResult>;
  myLoans(input: { employeeId: EmployeeId }): Promise<MyLoansResult>;
}
```

`EmployeeId` 는 임직원 행의 id 이고, 임직원은 회사 메일로 구분되므로(`plan/architecture.md#3.1`) 세션이 가리키는 id 가 곧 회사 메일로 구분한 임직원이다.

오류 7종(닫힌 목록)과 상태 코드·문구는 11.3절의 정본 표에 있다. 연산 순서(`plan/architecture.md#4.3`, `#4.4` 의 구현):

**borrow** — 읽기 커밋(READ COMMITTED) 트랜잭션 하나:
1. 도서가 없으면 `BOOK_NOT_FOUND`.
2. `(employee_id, request_id)` 로 기존 대여 건을 찾는다(`loans_employee_id_request_id_key`). 있고 같은 도서면 첫 결과를 `replayed: true` 로 돌려주고 끝낸다. 다른 도서면 `REQUEST_ID_CONFLICT`.
3. 본인의 열린 대여 건 중 `due_on < 오늘(KST)` 가 있으면 `OVERDUE_BLOCKED`(`loans_open_by_employee_idx`).
4. 그 도서에서 열린 대여 건이 없는 권을 `copy_no` 순으로 읽는다(`db/loans.ts` 의 `listFreeCopies` — 판정 조각을 C-04 집계와 공유, `book_copies_book_id_copy_no_key`, `loans_one_open_per_copy`). 후보가 없으면 `NO_COPY_AVAILABLE`.
5. 후보를 순서대로, 각 삽입을 `SAVEPOINT` 로 감싸 `INSERT … ON CONFLICT (copy_id) WHERE returned_at IS NULL DO NOTHING RETURNING id` 로 삽입한다(부분 유일 인덱스는 `ON CONFLICT ON CONSTRAINT` 로 지정할 수 없어 인덱스 추론 형식을 쓴다). 이 형식은 `loans_one_open_per_copy` 충돌만 삼키고 `loans_employee_id_request_id_key` 충돌은 삼키지 않는다.
   - 1행이면 성공이다.
   - 0행이면 **그 권이 이미 열린 대여 건을 가졌다고 단정할 수 있다**(다른 제약은 0행이 되지 않는다). 다음 후보를 시도한다.
   - 23505(유일 제약 위반)가 오고 제약 이름이 `loans_employee_id_request_id_key` 이면 같은 `(임직원, 요청 식별자)` 의 삽입이 동시에 성공한 것이다. 오류가 난 문장에서 트랜잭션이 중단되므로 `ROLLBACK TO SAVEPOINT` 로 복구한 뒤 2단계 조회를 다시 한다 — 같은 쌍이 있으면 그 결과를(같은 도서면 `replayed: true`, 다른 도서면 `REQUEST_ID_CONFLICT`) 돌려준다. 다른 제약 이름의 23505 는 `UNAVAILABLE` 이다.
   - 시도 횟수 상한은 그 도서의 권 수다(S3-D15).
6. 후보를 다 쓰면 `NO_COPY_AVAILABLE` 을 내기 **전에** 2단계 조회를 한 번 더 한다(권이 하나뿐일 때 같은 요청이 먼저 그 권을 가져가 0행이 된 경우를 재생으로 돌려주기 위해). 그래도 없으면 `NO_COPY_AVAILABLE`. 이 경합(같은 요청 식별자 동시 2회, 권 1개·2개 이상)은 스파이크로 끝내지 않고 8.1절 seam 2·3 의 상시 자동 시험이다. `dueOn` = 오늘 + 14일(달력 날짜 덧셈), `loaned_at` = `clock.now()`. 14일 규칙은 이 모듈 한 곳에만 있다(DB 는 「예정일이 대여일 이후」만 지킨다).
7. 질의 상한: 질의 시간 초과 5초, 전체 3초 이내가 목표(`plan/requirements.md#NFR-07`). 저장소 오류·시간 초과는 트랜잭션을 전부 되돌리고 `UNAVAILABLE` 이다. 거절(연체·권 없음)은 저장하지 않는다(A-06 of S3).

**returnLoan** — 한 문장 갱신: `UPDATE loans SET returned_at = $now WHERE id = $loanId AND employee_id = $employeeId AND returned_at IS NULL RETURNING id`. 1행이면 `returnedOn` = 오늘(KST). 0행이면 `id` 로 한 번 더 읽어 없거나 남의 건이면 `FORBIDDEN`, 내 건이고 이미 반납됐으면 `ALREADY_RETURNED`. 연체 중이어도 반납한다(`plan/requirements.md#A-28`).

**myLoans** — 본인의 열린 대여 건을 `due_on, loaned_at, id` 순으로 읽고 `overdue = (due_on < 오늘)`, `hasOverdue = items.some(overdue)`.

### 3.7 C-06 시계 — `src/server/clock/`

```ts
export type KstDate = string & { readonly __brand: 'KstDate' };   // 'YYYY-MM-DD'
export interface Clock { now(): Date; today(): KstDate }
export class SystemClock implements Clock {   // 생성자에 시각 읽기 함수를 받아 시험에서 바꿔 끼울 수 있다
  constructor(readNow?: () => Date);          // 기본 () => new Date(). today = now + 9시간의 UTC 날짜
}
export class FixedClock implements Clock {
  constructor(initial: Date | string);   // 예: '2028-02-20T10:00:00+09:00'
  set(next: Date | string): void; advanceDays(n: number): void;
}
export function addDays(date: KstDate, days: number): KstDate;    // UTC 날짜 산술, 평년·윤년 처리
```

한국 표준시는 일광절약시간이 없어 +9시간 고정으로 계산하며 시간대 라이브러리를 들이지 않는다. 의존: 없음. 날짜 경계(1월 15일은 연체 아님, 16일부터 연체, 윤년 2028-02-20 → 03-05, 평년 2027-02-20 → 03-06 — `plan/requirements.md#A-25`)를 고정 시계로 시험한다.

### 3.8 C-07 데이터 저장소 — `src/server/db/`

- 의존: `pg`. 규칙 없는 얇은 질의 함수만 둔다. 어댑터는 하나뿐이라 저장소 포트를 만들지 않는다(S3-D1, `plan/architecture.md#3.3`).

```ts
export interface Db {
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;       // READ COMMITTED, 예외면 롤백
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}
export function createDb(opts: { connectionString: string; poolMax: number; statementTimeoutMs: number }): Db;
```

- 풀 크기 `DB_POOL_MAX`(기본 10), 질의 시간 초과 `DB_STATEMENT_TIMEOUT_MS`(기본 5000), 연결 획득 대기 3초. 넘으면 `UNAVAILABLE`(`plan/architecture.md#6. 배치와 운영`).
- 질의 함수는 테이블별 파일(`employees.ts`, `books.ts`, `loans.ts`, `sessions.ts`)에 이름 있는 함수로 둔다. 모든 값은 매개변수 바인딩이며 문자열 이어 붙이기를 쓰지 않는다.
- 연결 문자열은 `${DATABASE_URL}` 로만 받는다.

### 3.9 C-08 기록 보관 정리 작업 — `src/server/jobs/`

- 의존: C-06, C-07(`${CLEANUP_DATABASE_URL}` 의 별도 계정).

```ts
export interface CleanupReport { expiredSessions: number; expiredLoans: number; orphanEmployees: number }
export function runCleanup(deps: { db: Db; clock: Clock; log: Logger }): Promise<CleanupReport>;
// 실행 파일: node dist/server/jobs/cleanup-main.js   (성공 0, 실패 1)
```

순서와 규칙(재실행해도 결과가 같다 — S3-D16):
1. 만료된 세션(`expires_at < now`) 삭제.
2. 반납한 지 5년이 지난 대여 건 삭제: `returned_at < 기준` 이고 기준은 「오늘(KST) − 5년」의 한국 표준시 자정이다. 반납한 날부터 5년째 되는 날까지 보관하고 그 다음 날 실행에서 지운다(A-06). 한 번에 1000행씩 반복해 잠금을 짧게 한다. 반납 안 된 건은 지우지 않는다.
3. 대여 건이 하나도 없고 세션도 없고 마지막 로그인 갱신(`updated_at`)이 24시간 이상 지난 임직원 행 삭제. **세 조건을 한 `DELETE` 문**(READ COMMITTED)으로 낸다: `DELETE FROM employees e WHERE e.updated_at < $기준 AND NOT EXISTS (SELECT 1 FROM loans WHERE employee_id = e.id) AND NOT EXISTS (SELECT 1 FROM sessions WHERE employee_id = e.id)`. 조회 후 삭제로 나누지 않는다. 로그인의 `upsertEmployee` 는 변경이 없어도 항상 `updated_at` 을 `clock.now()` 로 쓰므로(3.4절), 삭제 문이 행을 잠글 때 이미 로그인이 그 행을 갱신했다면 PostgreSQL 이 갱신된 행 버전으로 `updated_at` 조건을 다시 평가해 삭제하지 않는다(`NOT EXISTS` 의 하위 조회는 문장 시작 스냅샷이라 새 세션을 못 볼 수 있어 이 갱신 조건이 방어선이다). 반대로 삭제가 먼저 끝나면 로그인은 `ON CONFLICT` 에서 새 행을 만든다 — 어느 방향이든 세션이 가리키는 임직원 행은 항상 존재한다(S4-D28). 정리 기준 시각(`clock.now() − 24시간`)은 앱 시계이고 로그인 갱신도 앱 시계 값이라, 서버와 DB 시계가 어긋나도 24시간 여유가 로그인과 정리 사이 경합을 덮는다.
4. 로그에 지운 행 수만 남긴다(이름·메일 없음). 하나라도 실패하면 오류를 로그로 남기고 종료 코드 1 로 끝난다. 다음 날 다시 돈다.

`book-loan-cleanup.timer` 는 매일 한국 표준시 03:30 에 실행하고(`OnCalendar`, `Persistent=true` 로 꺼져 있던 날 보충) 서비스와 같은 서버에서 돈다. 실행 시각은 타이머 단위 파일의 값이다(S3 6절은 환경변수라 했으나 타이머는 환경변수로 시각을 받지 못한다 — 보완으로 보고).

### 3.10 C-09 초기 적재 도구 — `src/server/tools/`

- 의존: C-06, C-07(`${SEED_DATABASE_URL}` 의 별도 계정), `COVER_DIR`.

```ts
export interface CatalogFile {
  books: { ref: string; title: string; author: string; publisher?: string; description?: string; coverFile?: string; copies: number }[];
  removeRefs?: string[];
}
export interface CatalogReport { added: number; updated: number; copiesAdded: number; copiesRemoved: number; failures: { ref: string; reason: string }[] }
export function applyCatalog(deps: { db: Db; clock: Clock; coverDir: string; log: Logger }, input: CatalogFile, opts: { dryRun: boolean }): Promise<CatalogReport>;
// 실행 파일: node dist/server/tools/catalog-main.js --file <경로> [--dry-run]
```

- `ref`(`books.catalog_ref`)가 도서의 안정된 키라 같은 파일을 다시 돌려도 결과가 같다.
- 시각은 `deps.clock.now()` 로 넣는다(시각 열에 DB 기본값이 없다 — 4절 규칙). `books.created_at`·`book_copies.created_at` 은 삽입 때, `books.updated_at` 은 **`applyCatalog` 가 도서를 UPDATE 하는 문장마다** 같은 `clock.now()` 값으로 직접 쓴다(트리거를 두지 않는다 — S4-D39). 고정 시계로 시험할 수 있다.
- 길이 한도(제목 300자·저자 200자·출판사 200자·소개 5000자, `catalog_ref` 64자)는 `src/shared/limits.ts` 의 상수 한 곳에서 오고 `CatalogFile` 검증이 이 값을 쓴다. DB 의 길이 `CHECK` 도 같은 숫자이며 8.3절 시험이 둘의 일치를 확인한다(A-13).
- 권 수를 줄이는 변경은 가장 큰 `copy_no` 부터 지우되, 대여 건(열렸든 닫혔든)이 하나라도 있는 권이면 그 도서 항목만 실패로 보고하고 건너뛴다(A-03, `plan/requirements.md#A-30`). 도서 한 건마다 트랜잭션이라 한 항목의 실패가 다른 항목을 되돌리지 않는다.
- 표지 파일이 `COVER_DIR` 에 없거나 확장자가 png·jpg·webp 가 아니거나 **파일 시그니처(매직 바이트)가 확장자와 맞지 않으면**(PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, WebP `RIFF` + 8번째 바이트부터 `WEBP`) 그 항목은 실패로 보고한다. 해석한 실제 경로가 `COVER_DIR` 의 `realpath` 아래인지도 3.5절과 같은 방식으로 확인한다.
- 시험·개발용 자리표시자 도서 파일은 `tests/support/catalog-sample.json`(규모 미정 — `plan/requirements.md#A-26`).

## 4. 데이터 모델

규칙: 시각은 `timestamptz`, 날짜는 한국 표준시 달력 날짜(`date`)다. 시각 열에는 DB 기본값을 두지 않고 앱이 C-06 시계 값을 넣는다(시험과 운영의 시간원이 하나). 저장된 파생값(권 상태·대여 가능 권수·연체)은 없다(S3-D1, S3-D7, ADR 0001). **개인정보** 열에 `●` 가 있는 것이 개인정보다. 사번·비밀번호·세션 평문을 담는 열은 어느 테이블에도 없다(`plan/requirements.md#NFR-03`, `#NFR-04`) — 열 이름 목록을 시험으로 고정한다(8절).

### 4.1 employees(임직원)

| 열 | 타입 | NULL | 제약 | 개인정보 | 설명 |
|---|---|---|---|---|---|
| id | uuid | NOT NULL | PK, 기본 `gen_random_uuid()` | 가명 id | 로그·경로에 쓰는 내부 id. 순서를 추측할 수 없다 |
| email | text | NOT NULL | UNIQUE, CHECK(소문자·앞뒤 공백 없음·3~254자·`@` 포함) | ● 회사 메일 | 임직원 구분값. 저장 전 소문자로 바꾼다 |
| name | text | NULL | CHECK(NULL 이거나 1~100자) | ● 이름 | 못 받으면 비워 둔다 |
| department | text | NULL | CHECK(NULL 이거나 1~100자) | ● 부서 | 못 받으면 비워 둔다 |
| created_at | timestamptz | NOT NULL | | | |
| updated_at | timestamptz | NOT NULL | | | 로그인 때마다 `clock.now()` 로 갱신(이름·부서가 그대로여도). C-08 의 24시간 보호 기준 |

`name`·`department` 는 **현재 이 값을 읽는 화면이 없다**(`plan/ui-spec.md` 의 1차 화면은 임직원 이름을 보이지 않는다). 2차의 관리자 연체 목록(요구사항 F-12 등)에서 쓸 값이다. 질문 S4-Q1 이 권장안 「계속 저장」으로 닫혀(결정 로그 S4-Q1) 요구사항 F-02·A-32 대로 저장·갱신을 유지한다(가정 A-15).

### 4.2 books(도서)

| 열 | 타입 | NULL | 제약 | 개인정보 | 설명(화면 필드) |
|---|---|---|---|---|---|
| id | bigint | NOT NULL | PK, `GENERATED ALWAYS AS IDENTITY` | | 도서 id(주소에 쓴다) |
| catalog_ref | text | NOT NULL | UNIQUE, CHECK(영숫자·`.`·`_`·`-` 1~64자) | | C-09 적재 파일의 도서 키. 화면에 보이지 않는다 |
| title | text | NOT NULL | CHECK(1~300자) | | 제목 |
| author | text | NOT NULL | CHECK(1~200자) | | 저자 |
| publisher | text | NULL | CHECK(NULL 이거나 1~200자) | | 출판사 |
| description | text | NULL | CHECK(NULL 이거나 1~5000자) | | 소개 |
| cover_file | text | NULL | CHECK(NULL 이거나 영숫자·`.`·`_`·`-` 로 된 1~100자 이름이고 확장자가 png·jpg·webp 중 하나) | | 표지 파일 이름. 파일은 `COVER_DIR` 에 둔다 |
| title_key | text | NOT NULL | `GENERATED ALWAYS AS (lower(regexp_replace(title, '[\t\n\v\f\r    -     　﻿]', '', 'g'))) STORED` | | 검색 비교용 키(공백 제거·소문자) |
| author_key | text | NOT NULL | 같은 방식으로 `author` 에서 생성 | | 검색 비교용 키 |
| created_at | timestamptz | NOT NULL | | | |
| updated_at | timestamptz | NOT NULL | | | `applyCatalog` 가 UPDATE 마다 `clock.now()` 로 쓴다(3.10절) |

공백 범위는 PostgreSQL 의 `\s`(로케일에 따라 전각 공백 U+3000·NBSP 가 빠질 수 있다)에 맡기지 않고 위처럼 **문자 클래스를 직접 쓴다**. 이 집합은 JavaScript `\s` 와 같으며(`src/shared/search-query.ts` 가 같은 클래스를 상수 하나로 가지고 검색어 정규화에 쓴다) 8.3절 시험이 둘의 일치를 확인한다(S4-D38).

검색은 `title_key LIKE '%' || 검색어 || '%' ESCAPE '\'` 와 `author_key` 에 대한 같은 조건의 합집합이다. 검색어 쪽도 같은 정규화(공백 모두 제거·소문자)를 거쳐 `plan/requirements.md#A-22` 의 「공백을 제거한 뒤 비교·대소문자 무시」를 한 곳에서 지킨다. DB 는 한글·영문 소문자 변환이 되는 UTF-8 로케일(`C.UTF-8` 또는 `ko_KR.UTF-8`)로 만든다.

### 4.3 book_copies(권)

| 열 | 타입 | NULL | 제약 | 개인정보 | 설명(화면 필드) |
|---|---|---|---|---|---|
| id | bigint | NOT NULL | PK, `GENERATED ALWAYS AS IDENTITY` | | |
| book_id | bigint | NOT NULL | FK → books(id) `ON DELETE RESTRICT` | | |
| copy_no | integer | NOT NULL | CHECK(1 이상), UNIQUE(book_id, copy_no) | | 「권 1」「권 2」의 순번(`plan/ui-spec.md#SCR-03`) |
| created_at | timestamptz | NOT NULL | | | |

**권 상태 열은 없다.** 「대여 가능」「대여 중」은 `loans` 에서 읽을 때 계산한다(ADR 0001).

### 4.4 loans(대여 건)

| 열 | 타입 | NULL | 제약 | 개인정보 | 설명(화면 필드) |
|---|---|---|---|---|---|
| id | uuid | NOT NULL | PK, 기본 `gen_random_uuid()` | | 대여 건 id(반납 주소에 쓴다. 추측 불가) |
| employee_id | uuid | NOT NULL | FK → employees(id) `ON DELETE RESTRICT` | 누가 빌렸는지(가명 id) | |
| copy_id | bigint | NOT NULL | FK → book_copies(id) `ON DELETE RESTRICT` | | 어느 권 |
| request_id | uuid | NOT NULL | UNIQUE(employee_id, request_id) | | 화면이 제출마다 발급한 요청 식별자 |
| loaned_at | timestamptz | NOT NULL | | | 언제 빌렸는지 |
| due_on | date | NOT NULL | CHECK(`due_on > (loaned_at AT TIME ZONE 'Asia/Seoul')::date`) | | 반납 예정일(한국 표준시 날짜) |
| returned_at | timestamptz | NULL | CHECK(NULL 이거나 `returned_at >= loaned_at`) | | 비어 있으면 열린 대여 건 |

```sql
-- 0003_loans.sql 의 핵심(예시)
CREATE UNIQUE INDEX loans_one_open_per_copy ON loans (copy_id) WHERE returned_at IS NULL;
```

권당 열린 대여 건이 둘이 될 수 없는 것을 이 부분 유일 인덱스가 지킨다(NFR-06). `borrow` 는 이 충돌을 인덱스 추론 형식 `ON CONFLICT (copy_id) WHERE returned_at IS NULL DO NOTHING` 으로만 삼킨다(부분 유일 인덱스는 `ON CONFLICT ON CONSTRAINT` 로 지정할 수 없다). `UNIQUE(employee_id, request_id)` 충돌은 삼키지 않고 23505 로 올라오며 처리기가 제약 이름 `loans_employee_id_request_id_key` 로 가려 3.6절 5단계대로 재조회한다(S4-D24). `ON DELETE RESTRICT` 두 개 때문에 대여 건이 남아 있는 권·임직원은 지워지지 않는다 — 대여 기록이 가리키는 권이 사라지는 것을 막고(`plan/requirements.md#A-30`), 임직원 행은 대여 건이 5년 뒤 지워진 다음에야 정리된다(S3-D16). `loans` 는 이름 있는 임직원 정보를 직접 담지 않고 가명 id 만 가리킨다.

### 4.5 sessions(세션)

| 열 | 타입 | NULL | 제약 | 개인정보 | 설명 |
|---|---|---|---|---|---|
| id_hash | bytea | NOT NULL | PK, CHECK(32바이트) | | 세션 식별자의 SHA-256 해시. 평문은 저장하지 않는다(S3-D12) |
| employee_id | uuid | NOT NULL | FK → employees(id) `ON DELETE CASCADE` | 가명 id | |
| created_at | timestamptz | NOT NULL | | | |
| expires_at | timestamptz | NOT NULL | CHECK(`expires_at > created_at`) | | 만든 때 + 8시간 |

### 4.6 인덱스와 그것을 쓰는 조회

모든 인덱스(제약이 만드는 것 포함)와 쓰는 조회다. 조회 이름은 3절 모듈 연산이다.

| 인덱스 | 테이블·열 | 쓰는 조회 |
|---|---|---|
| employees_pkey | employees(id) | 정리 작업의 임직원 행 삭제, `loans`·`sessions` 의 참조 확인 |
| employees_email_key | UNIQUE employees(email) | 로그인 `upsertEmployee` 의 `ON CONFLICT (email) DO UPDATE` |
| books_pkey | books(id) | `getBook`·`borrow` 의 도서 조회, `book_copies` 참조 확인 |
| books_catalog_ref_key | UNIQUE books(catalog_ref) | C-09 가 적재 파일의 키로 기존 도서를 찾기 |
| books_title_id_idx | books(title COLLATE "C", id) | `searchBooks` 의 정렬·쪽 나눔(검색어가 비어 있는 전체 목록 포함) |
| book_copies_pkey | book_copies(id) | `loans` 의 참조 확인, `borrow` 삽입 대상 권 |
| book_copies_book_id_copy_no_key | UNIQUE book_copies(book_id, copy_no) | `getBook` 권 목록(순번 순), `borrow` 의 후보 권 읽기, `searchBooks` 의 도서별 대여 가능 권수 집계, C-09 권 추가·삭제 |
| loans_pkey | loans(id) | `returnLoan` 의 갱신과 0행일 때 재조회 |
| loans_employee_id_request_id_key | UNIQUE loans(employee_id, request_id) | `borrow` 의 멱등 조회(2단계·23505 뒤 재조회), 정리 작업의 「대여 건 없는 임직원」 확인 |
| loans_one_open_per_copy | UNIQUE loans(copy_id) WHERE returned_at IS NULL | `borrow` 의 `ON CONFLICT (copy_id) WHERE returned_at IS NULL DO NOTHING` 중재, `searchBooks`·`getBook` 의 대여 가능 권수·권별 상태(열린 대여 건 없음 확인) |
| loans_open_by_employee_idx | loans(employee_id, due_on, loaned_at) WHERE returned_at IS NULL | `myLoans` 의 정렬 조회, `borrow` 의 본인 연체 확인 |
| loans_returned_at_idx | loans(returned_at) WHERE returned_at IS NOT NULL | 정리 작업의 5년 경과 대여 건 삭제 |
| loans_copy_id_idx | loans(copy_id) | C-09 의 권 삭제 때 대여 건 유무 확인과 외래 키 제한 검사 |
| sessions_pkey | sessions(id_hash) | 모든 요청의 세션 확인, 로그아웃 삭제 |
| sessions_employee_id_idx | sessions(employee_id) | 정리 작업의 「유효한 세션 없는 임직원」 확인, 임직원 삭제 시 연쇄 삭제 |
| sessions_expires_at_idx | sessions(expires_at) | 정리 작업의 만료 세션 삭제 |

**인덱스를 두지 않은 조회와 이유**
- 검색의 부분 일치(`title_key`·`author_key` 의 `LIKE '%…%'`): 도서가 수천 권 이하라(`plan/architecture.md#10. 가정 A-04`) 순차 읽기가 한 자릿수 밀리초이고, 한국어 검색어는 두 글자가 흔해 3글자 단위 인덱스(pg_trgm)가 거의 도움이 안 된다. 도서가 1만 권을 넘거나 검색이 1초를 넘으면 pg_trgm GIN 인덱스를 전진 마이그레이션으로 더한다(A-09). 스파이크 S3-D11 이 검색 응답 시간도 함께 잰다.
- 정리 작업의 임직원 행 스캔: 임직원 행이 임직원 수(수백~천 명 규모)를 넘지 않고 하루 1회다.

### 4.7 화면 「데이터」 필드와 모델·연동의 연결

`plan/ui-spec.md` 의 화면별 「데이터」 표의 필드가 모두 아래 어딘가로 이어진다.

| 화면 | 필드 | 이어지는 곳 |
|---|---|---|
| SCR-01 | 회사 계정(사번 또는 메일) | 저장하지 않는다. `login` 요청 → C-03 `verifyCompanyAccount` → 회사 계정 시스템 (최대 254자, 공백만 불가) |
| SCR-01 | 비밀번호 | 저장·로그 금지. 같은 경로로 전달만(최대 1024자). 로그의 요청 본문 기록을 끈다 |
| SCR-01 | IT 지원 안내 | 환경변수 `IT_SUPPORT_EXT` → `getPublicConfig`. 오류 문구에도 같은 값이 들어간다 |
| SCR-01 | 로그인 실패 안내 | 오류 `AUTH_FAILED`·`AUTH_UNAVAILABLE`(11.3절) |
| SCR-01 | 되돌아옴 안내 | 서버 값 없음. 화면이 `SESSION_EXPIRED` 를 받은 경로에 따라 문구를 고른다(11.5절) |
| SCR-02 | 검색어 | 요청 매개변수 `q`(정규화·100자) → `books.title_key`·`author_key` |
| SCR-02 | 표지 | `books.cover_file` → `getBookCover` |
| SCR-02 | 제목·저자 | `books.title`, `books.author` |
| SCR-02 | 대여 가능 권수 / 모두 대여 중 | 계산: 열린 대여 건이 없는 `book_copies` 수(0이면 「모두 대여 중」) |
| SCR-02 | 「다음」 | `hasNext`(`LIMIT 21` 로 판정) |
| SCR-03 | 표지·제목·저자·출판사·소개 | `books.cover_file`·`title`·`author`·`publisher`·`description` |
| SCR-03 | 권별 상태 | `book_copies.copy_no` + 계산(열린 대여 건 유무) |
| SCR-03 | 대여 가능 권수, 「대여」 비활성 사유(연체) | 계산 + `getBook` 이 `myLoans` 의 `hasOverdue` 를 함께 돌려줌 |
| SCR-03 | 요청 식별자 | `loans.request_id` ← `borrowBook` 본문 |
| SCR-03 | 대여 결과(제목·반납 예정일) | `BorrowResult.bookTitle`·`dueOn`(← `books.title`, `loans.due_on`) |
| SCR-04 | 도서 제목, 반납 예정일 | `MyLoansItem.bookTitle`, `dueOn` |
| SCR-04 | 연체 여부, 연체 안내 | 계산: `due_on < 오늘(KST)` 이고 `returned_at IS NULL`. `hasOverdue` |
| SCR-04 | 「반납」, 반납 실패·이미 반납됨 안내 | `loanId` → `returnLoan`. 오류 `ALREADY_RETURNED`·`UNAVAILABLE` |
| SCR-05 | 반납할 도서 제목, 「반납하기」「취소」 | 이미 불러온 `MyLoansItem.bookTitle`. 확정 때만 `returnLoan` |
| SCR-06, SCR-08 | 안내 문구, 「도서 검색으로 돌아가기」 | 오류 `BOOK_NOT_FOUND`·`FORBIDDEN`, 알 수 없는 화면 경로 |
| 상단 바 | 「로그아웃」, 이동 링크 | `logout`, `getSession` 이 준 내 `employeeId` 로 만든 경로 |

### 4.8 데이터베이스 역할(최소 권한)

`plan/architecture.md#5. 신뢰 경계`가 S4 로 미룬 권한 표다. 역할 자체는 운영자가 `ops/create-roles.sql` 로 만들고(비밀번호는 `${…}` 환경변수로 따로 둔다), 마이그레이션 `0005` 는 권한만 부여한다.

| 역할 | 쓰는 곳 | 권한 |
|---|---|---|
| app_web | 서비스(C-02~C-05) | employees: SELECT, INSERT, UPDATE(name, department, updated_at). books·book_copies: SELECT. loans: SELECT, INSERT, UPDATE(returned_at). sessions: SELECT, INSERT, DELETE. 그 밖 모든 DELETE·DDL 없음 |
| app_cleanup | 정리 작업(C-08) | sessions·loans·employees: SELECT, DELETE |
| app_seed | 적재 도구(C-09) | books·book_copies: SELECT, INSERT, UPDATE, DELETE. loans: SELECT |
| app_migrate | 마이그레이션 | 스키마 소유자(DDL). 서비스가 쓰지 않는다 |

- 모든 권한은 스키마 한정이다: 위 표의 권한에 더해 앱 역할 셋에 **`GRANT USAGE ON SCHEMA <스키마>`** 를 주고, 테이블 권한도 `<스키마>` 안 테이블에만 준다(다른 스키마·`public` 에는 주지 않는다). `ON CONFLICT … DO UPDATE`·`DO NOTHING` 의 충돌 대상 열 확인에는 그 열의 SELECT 권한이 필요하므로 `app_web` 은 `employees`·`loans` 에 SELECT 를 가진다.
- `app_web` 에는 `idle_in_transaction_session_timeout = '15s'` 를 역할 설정(`ALTER ROLE app_web SET …`, `ops/create-roles.sql`)으로 둔다. 처리기 버그로 트랜잭션을 연 채 멈춘 연결이 잠금을 쥐고 풀을 말리는 일을 막는다(S4-D37).

## 5. 마이그레이션

도구는 node-pg-migrate 이고 파일은 `db/migrations/` 의 SQL 이다. 한 파일 안에 `-- Up Migration` 과 `-- Down Migration` 구간을 둔다. 레포에 기존 마이그레이션이 없어 번호는 0001 부터다. **지금 DB 는 비어 있다**(신규 서비스) — 기존 행의 기본값 채우기·큰 테이블 잠금 문제는 이번 묶음에 해당 없다.

| 순서 | 파일 | 만드는 것 | 되돌리기(down) | 잠금 위험 | 기존 행 기본값 |
|---|---|---|---|---|---|
| 1 | `0001_employees.sql` | employees 와 제약·인덱스 | `DROP TABLE employees` | 새 테이블이라 없음 | 해당 없음(빈 DB) |
| 2 | `0002_books_and_copies.sql` | books(생성 열 포함), book_copies, 인덱스 | `DROP TABLE book_copies; DROP TABLE books` | 새 테이블이라 없음 | 해당 없음 |
| 3 | `0003_loans.sql` | loans, 부분 유일 인덱스 외 인덱스 5개 | `DROP TABLE loans` | 새 테이블이라 없음 | 해당 없음 |
| 4 | `0004_sessions.sql` | sessions, 인덱스 2개 | `DROP TABLE sessions` | 새 테이블이라 없음 | 해당 없음 |
| 5 | `0005_roles_grants.sql` | 역할 4개에 4.8절 권한 부여. 대상 스키마는 `current_schema()` 를 읽어 `format('%I', …)` 로 만드는 `DO` 블록으로 정한다(스키마 이름을 파일에 박지 않는다). 역할이 없으면 안내 메시지와 함께 실패 | `REVOKE` 로 부여한 권한 회수 | 없음(권한 변경) | 해당 없음 |

- **되돌릴 수 없는 경우**: 1~4번의 `down` 은 테이블과 그 안의 데이터를 지운다. 그래서 **오픈 전(데이터가 없을 때)과 시험 환경에서만** 쓴다. 오픈 뒤에는 `down` 을 운영에서 실행하지 않고 새 마이그레이션으로 전진 수정한다. 실수로 운영 데이터를 지웠으면 백업(9절, 35일)에서 복원한다.
- **순서**: 1→2→3→4→5. `down` 은 반대 순서(5→1)다. 3번은 1·2번의 테이블을 참조하고 4번은 1번을 참조한다.
- **역할은 클러스터 전역이다**: 역할은 스키마가 아니라 PostgreSQL 클러스터에 속하고 `ops/create-roles.sql` 이 따로 만든다(마이그레이션이 만들지 않는다). 시험·CI 에서는 **시험 DB 준비 단계(시험 실행 전 한 번, 전역 준비 단계)가 `ops/create-roles.sql` 을 먼저 실행**한다 — 역할이 이미 있으면 건너뛰는 멱등 `DO` 블록이라 다시 실행해도 된다. 시험 파일마다 새 스키마를 만들고 0005 가 그 스키마에만 GRANT 하므로, 병렬로 도는 시험 파일들이 역할을 공유해도 서로의 권한·데이터와 충돌하지 않는다(역할 자체를 파일마다 만들거나 지우지 않는다). 시험은 이 역할들로 실제 질의를 돌려 권한 부족을 잡는다(8.3절, S4-D37).
- **이후 변경 규칙**(오픈 뒤 첫 변경부터): 새 열은 NULL 허용 또는 상수 기본값으로 더하고, 큰 테이블의 인덱스는 `CREATE INDEX CONCURRENTLY` 로 만든다. 이 문장은 트랜잭션 안에서 실행할 수 없으므로 node-pg-migrate 에서 해당 파일만 무트랜잭션으로 지정하는 방법(파일 단위 옵션)을 **구현 첫 단계에서 확인**하고, 지원되지 않으면 그 마이그레이션만 JS 파일로 쓴다. 마이그레이션 세션은 `SET lock_timeout = '5s'` 로 시작해 오래 막히면 실패하게 한다. 열 삭제·이름 변경은 「새 열 추가 → 앱 전환 → 옛 열 삭제」 세 번에 나눈다(`checklist:dba#1`, `#2`, `#7`).
- **실행**: `MIGRATE_DATABASE_URL`(`app_migrate`)로 `npm run migrate:up`. 첫 배포는 서비스를 띄우기 전에 실행한다. 시험은 시험 DB 에서 `up` 전체와 `down` 전체를 한 번씩 돌려 되돌림이 동작하는지 확인한다(`checklist:dba#1`).

## 6. 외부 의존성

분류는 「프로세스 내」「로컬 대체 가능」「원격·자사」「진짜 외부」 넷 중 하나다.

| 이름 | 분류 | 테스트 방법 | 근거 |
|---|---|---|---|
| PostgreSQL 17 | 로컬 대체 가능 | 시험용 별도 PostgreSQL 인스턴스(`${TEST_DATABASE_URL}`, 로컬 설치 또는 컨테이너)에서 시험 파일마다 새 스키마를 만들고 마이그레이션을 적용한다. 부분 유일 인덱스·`ON CONFLICT` 동작을 메모리 대역으로 흉내 내지 않는다 | `S3-D2`, `S3-D11`, `checklist:dba#9` |
| 회사 계정 시스템 | 원격·자사 | CI 는 `CompanyAccountPort` 의 대역(`FakeCompanyAccount`)으로 성공·거절·무응답·회사 메일 없음을 시험한다. 실제 시스템과의 계약은 IT 가 준 시험 계정으로 스파이크 S3-D5 에서 한 번 확인한다(CI 에 넣지 않는다) | `S3-D5`, `plan/architecture.md#3.3` |
| 시계(서버 시각, 사내 시간 서버) | 프로세스 내 | `Clock` 인터페이스의 `FixedClock` 으로 날짜를 고정한다 | `S3-D7`, `plan/requirements.md#A-25` |
| nginx(HTTPS 종단) | 로컬 대체 가능 | 시험 서버에서 자체 서명 인증서로 같은 설정을 띄워 80→443 이동·헤더·본문 한도를 점검 목록으로 확인한다. API 시험은 프록시 없이 서비스를 직접 호출한다 | `S3-D13`, `checklist:infra#2` |
| 사내 CA 인증서 | 원격·자사 | IT 가 발급한다. 개발·시험은 자체 서명 인증서로 대체한다. 만료일을 운영 점검 목록에 둔다 | `plan/architecture.md#10. 가정 A-07` |
| systemd 타이머(정리 작업 스케줄) | 로컬 대체 가능 | 정리 로직은 `runCleanup` 을 시험 DB·고정 시계로 직접 호출해 시험한다. 타이머 단위 파일은 `systemd-analyze calendar` 로 문법과 다음 실행 시각을 확인한다 | `S3-D16` |
| 파일 시스템(`COVER_DIR` 표지 파일) | 로컬 대체 가능 | 시험마다 임시 디렉터리를 `COVER_DIR` 로 쓴다 | `plan/ui-spec.md#SCR-02` |
| 백업 저장 장치(서버 디스크와 별도 장치) | 원격·자사 | IT 가 제공한다. 오픈 전에 복원 시험 1회로 확인한다(CI 밖) | `plan/architecture.md#6. 배치와 운영` |
| 브라우저(Chromium, Playwright) | 로컬 대체 가능 | 시험 서버를 띄우고 360px 화면으로 스모크 시험을 돌린다 | `plan/requirements.md#NFR-02` |
| npm 레지스트리(패키지 받기) | 진짜 외부 | 빌드 때만 접속한다. 잠금 파일로 버전을 고정하고 배포 서버는 접속하지 않는다. 시험에서 호출하지 않는다 | `checklist:security#7` |

## 7. 외부 연동

### 7.1 회사 계정 시스템

| 항목 | 정함 |
|---|---|
| 방향·목적 | 서비스 → 회사 계정 시스템. 로그인 화면에서 받은 계정·비밀번호를 전달해 확인하고 이름·부서·회사 메일을 받는다 |
| 인터페이스 | `CompanyAccountPort.authenticate`(3.4절)가 확정. 연동 프로토콜(LDAP·OIDC·REST 등)은 **스파이크 S3-D5** 로 정하며 어댑터 파일 하나만 바뀐다 |
| 제한 시간 | 10초(`COMPANY_AUTH_TIMEOUT_MS`, 기본 10000). 넘으면 `AUTH_UNAVAILABLE` |
| 재시도 | 없음. 틀린 비밀번호의 재시도가 계정 잠금 정책을 건드리고(`plan/requirements.md#A-19`), 사용자를 더 오래 기다리게 한다. 사용자가 다시 누른다 |
| 동시 호출 | 최대 10(`COMPANY_AUTH_CONCURRENCY`). 넘으면 기다리지 않고 `UNAVAILABLE` |
| 전송 | TLS 이고 서버 인증서를 검증한다. 사내 CA 는 `NODE_EXTRA_CA_CERTS=${COMPANY_CA_BUNDLE_PATH}` 로 믿는다. 인증서 검증을 끄는 설정은 두지 않는다 |
| 접속 정보 | `${COMPANY_AUTH_URL}`. 서비스 자신을 식별하는 비밀값이 필요하면(방식에 따라) `${COMPANY_AUTH_CLIENT_SECRET}` 로 받는다 — 스파이크 결과로 확정 |
| 받는 값 | `email`(필수), `name`, `department`. 그 밖의 응답은 버린다. 사번은 받아도 쓰지 않고 저장하지 않는다 |
| 기록 | 계정·비밀번호·응답 본문을 로그에 남기지 않는다. 결과 종류(`ok`/`rejected`/`timeout`/`email_missing`)와 걸린 시간만 남긴다 |
| 장애 시 | 새 로그인만 실패하고 세션이 살아 있는 사용자는 계속 쓴다(`plan/architecture.md#6. 배치와 운영`) |
| 방화벽 | 서비스 → 회사 계정 시스템 방향 허용을 운영 준비 항목에 둔다 |

### 7.2 PostgreSQL

같은 서버의 루프백 연결(`127.0.0.1`)이라 연결 구간 TLS 는 쓰지 않는다. DB 가 다른 서버로 가면 `sslmode=verify-full` 로 바꾼다. 접속 문자열은 `${DATABASE_URL}`(`app_web`), `${CLEANUP_DATABASE_URL}`, `${SEED_DATABASE_URL}`, `${MIGRATE_DATABASE_URL}` 로만 받고 형태는 `postgresql://<DB_USER>:<DB_PASSWORD>@127.0.0.1:5432/<DB_NAME>` 이다.

### 7.3 화면 ↔ 서비스

같은 출처(same-origin)라 CORS 를 열지 않는다. 쿠키는 `SameSite=Strict`, 변경 요청은 CSRF 머리말과 `Origin` 확인을 거친다(3.3절).

### 7.4 백업

`pg_dump -Fc` 를 하루 1회 systemd 타이머로 실행해 서버 디스크와 별도 장치에 쓰고 `COVER_DIR` 도 함께 복사한다. 35일이 지난 파일을 같은 스크립트가 지운다(S3 A-09). 오픈 전에 복원 시험을 1회 하고 절차를 `ops/` 에 문서화한다(`plan/architecture.md#6. 배치와 운영`). 덤프에는 이름·메일이 들어 있으므로 아래를 지킨다(S4-D30).

- **암호화**: 덤프는 `age` 의 공개키(수신자 키)로 암호화한 뒤에만 백업 장치에 쓴다. 복호화용 개인키는 **서버에도 서비스 계정에도 두지 않고** 운영 담당자가 7.5절의 비밀값 규정에 따라 별도 비밀값 보관소에 둔다. 서버에는 공개키 파일 경로(`BACKUP_AGE_RECIPIENT_FILE`, 역할별 값 파일 `backup.env`, 소유자 root·0600)만 있다. 서버가 뚫려도 과거 백업은 열리지 않는다. 암호화 전 평문 덤프는 임시 파일 없이 파이프로 `age` 에 넘겨 디스크에 남기지 않는다.
- **DB 접속**: 백업 타이머는 DB 서버 운영체제 계정의 로컬 소켓 인증으로 `pg_dump` 를 실행해 접속 비밀값이 없다. 서비스 계정은 백업을 실행하지도 읽지도 못한다.
- **백업 장치 접근 주체(이 목록 밖은 접근 불가)**: ① 백업 타이머를 실행하는 root 서비스 단위(쓰기·35일 삭제), ② IT 운영 담당자(복원 권한 — 개인키 보관자와 같은 역할), ③ IT 가 지정한 장치 관리자(장치 자체 관리, 파일 복호화 불가). 서비스 계정과 개발팀은 접근하지 않는다. 담당자 명단은 운영 준비 항목에 두고 이 문서에는 역할만 적는다.
- **복원 시험 사본의 폐기**: 복원 시험은 운영과 분리된 시험 서버의 임시 DB 에서만 한다. 끝나면 ① 임시 DB 를 `DROP DATABASE` 하고 ② 복호화한 덤프·`COVER_DIR` 복사본을 삭제하고 ③ 시험 서버의 개인키 사본이 있으면 지운다. 폐기 완료를 날짜와 담당자 역할만 담은 한 줄로 `ops/` 의 복원 절차 체크리스트에 남긴다(이름·메일 같은 내용은 남기지 않는다).

### 7.5 설정 목록(환경변수)

| 이름 | 필수 | 기본 | 비밀값 | 설명 |
|---|---|---|---|---|
| `DATABASE_URL` | 예 | | 예 | 서비스용 DB 접속(`app_web`) |
| `CLEANUP_DATABASE_URL` | 정리 작업 | | 예 | `app_cleanup` |
| `SEED_DATABASE_URL` | 적재 도구 | | 예 | `app_seed` |
| `MIGRATE_DATABASE_URL` | 마이그레이션 | | 예 | `app_migrate` |
| `COMPANY_AUTH_URL` | 예 | | 아니오 | 회사 계정 시스템 주소 |
| `COMPANY_AUTH_CLIENT_SECRET` | 방식에 따라 | | 예 | 스파이크 S3-D5 결과로 필요 여부 확정 |
| `COMPANY_AUTH_TIMEOUT_MS` | 아니오 | 10000 | 아니오 | 회사 계정 호출 제한 시간 |
| `COMPANY_AUTH_CONCURRENCY` | 아니오 | 10 | 아니오 | 동시 호출 상한 |
| `NODE_EXTRA_CA_CERTS` | 예(운영) | | 아니오 | 사내 CA 번들 경로 |
| `SESSION_TTL_HOURS` | 아니오 | 8 | 아니오 | 세션 유지 시간 |
| `ALLOWED_ORIGIN` | 예 | | 아니오 | 허용 출처 `https://<SERVICE_HOST>` |
| `HOST`, `PORT` | 아니오 | `127.0.0.1`, 3000 | 아니오 | 서비스가 듣는 주소(루프백) |
| `COVER_DIR` | 예 | | 아니오 | 표지 파일 디렉터리 |
| `IT_SUPPORT_EXT` | 예(운영) | `<IT 지원 내선>` | 아니오 | 로그인 화면·오류 문구의 IT 지원 내선 |
| `DB_POOL_MAX` | 아니오 | 10 | 아니오 | DB 연결 풀 크기 |
| `DB_STATEMENT_TIMEOUT_MS` | 아니오 | 5000 | 아니오 | 질의 시간 초과 |
| `LOG_LEVEL` | 아니오 | `info` | 아니오 | 로그 수준 |
| `BACKUP_AGE_RECIPIENT_FILE` | 백업 | | 아니오 | 백업 암호화 공개키 파일 경로(개인키는 서버에 없다 — 7.4절) |

시작할 때 위 목록을 스키마로 검사해 필수 값이 없거나 형식이 틀리면 서비스가 시작하지 않는다. **검증 오류는 변수 이름과 규칙 이름(`required`·`format` 등)만 출력하고 값은 출력하지 않는다**(11.1절 `details` 와 같은 원칙, 11.6절). 저장소에는 `.env.example`(값 대신 `<…>` 자리표시자)만 두고 실제 값 파일은 두지 않는다.

**역할별 값 파일(S4-D29)**: 비밀값은 역할마다 따로 둔 `EnvironmentFile` 로만 넘기고 단위 파일의 `Environment=` 줄·레포·로그에 쓰지 않는다. 각 파일은 소유자 root, 모드 0600이다. 서비스용 `web.env` 만 서비스 계정이 읽기 전용으로 읽을 수 있게(그룹 읽기 0640, 쓰기 불가) 한다. 값이 `EnvironmentFile` 에만 있으므로 `systemctl show` 와 단위 파일 출력에는 파일 경로만 나오고 값은 나오지 않는다.

| 파일 | 쓰는 단위 | 담는 비밀값 | 읽을 수 있는 주체 |
|---|---|---|---|
| `web.env` | `book-loan.service` | `DATABASE_URL`, `COMPANY_AUTH_CLIENT_SECRET`(필요 시) | root, 서비스 계정(읽기 전용) |
| `cleanup.env` | `book-loan-cleanup.service` | `CLEANUP_DATABASE_URL` | root |
| `seed.env` | 적재 도구 실행(운영 담당자가 수동 실행) | `SEED_DATABASE_URL` | root |
| `migrate.env` | 마이그레이션 실행(배포 때) | `MIGRATE_DATABASE_URL` | root |
| `backup.env` | 백업 타이머 | (비밀값 없음 — 공개키 경로만) | root |

서비스·정리·적재·마이그레이션은 서로의 파일을 읽지 못하므로 서비스가 뚫려도 `app_cleanup`·`app_seed`·`app_migrate` 의 접속 정보가 새지 않는다(4.8절 최소 권한 유지). 서비스에 필요한 비밀이 아닌 설정(`ALLOWED_ORIGIN` 등)은 같은 `web.env` 에 둬도 된다. 백업 복호화용 개인키는 서버에 두지 않는다(7.4절).

## 8. 테스트 seam

레포에 테스트가 없어 따를 선례가 없다(`README.md:1`). 시험 도구와 규칙을 이 문서가 처음 정한다. 가장 위(사용자에 가까운) seam 부터 적고, 높은 seam 일수 시나리오를 적게 둔다.

### 8.1 seam 목록

| # | seam | 도구·방법 | 잡는 것 | 놓치는 것 |
|---|---|---|---|---|
| 1 | 브라우저 스모크 — 360px 화면 | Playwright 가 시험 서버(대역 인증 + 시험 DB)를 띄우고 로그인→검색→상세→대여→내 대여 현황→반납 흐름 1개, 연체 거절 1개, 접근 불가(남의 현황 주소) 1개. 각 화면에 axe 접근성 점검 | 화면과 API 의 연결, 가로 스크롤 없음, 초점·알림 영역, 영역 안 오류 안내 | 모든 문구·분기(분기 전부는 seam 2~3 이 맡는다), 실제 회사 계정, 프록시·TLS, 지원 브라우저 전체(Chromium 하나) |
| 2 | HTTP API — **주 seam** | `buildApp(deps)` 가 만든 서버에 Fastify `inject` 로 요청한다. 실제 PostgreSQL(시험 스키마), `FixedClock`, `FakeCompanyAccount`를 주입한다 | 계약·검증·오류 형식과 상태 코드, 세션·CSRF·소유 확인, 멱등, 동시성(여러 요청을 동시에 보내 한 권에 한 건만 성공; **같은 요청 식별자 동시 2회 — 권 1개일 때와 2개 이상일 때 모두 대여 건 1건이고 두 응답의 `loanId` 가 같다**; 같은 요청 식별자로 다른 도서 동시 요청은 `REQUEST_ID_CONFLICT`), 검색·상세의 대여 가능 권수와 borrow 결과가 일치(권을 빌리고 반납할 때마다 두 값이 맞고, 권 수만큼 빌린 뒤 `NO_COPY_AVAILABLE`), DB 제약, 개인정보 열 목록, 마스킹된 로그 | 브라우저 렌더링, 프록시·TLS·HSTS, 실제 회사 계정 연동, 실제 네트워크 지연 |
| 3 | C-05 인터페이스 `borrow`·`returnLoan`·`myLoans` | HTTP 없이 모듈을 직접 호출, 실제 DB + `FixedClock` | 날짜 경계(1/15 연체 아님·1/16 연체, 월말·윤년), 연체 거절, 권 재시도, 같은 요청 식별자 재전송, 소유 확인 조합을 싸게 많이. 3.6절 5단계의 모든 갈래를 상시 자동 시험으로 건다 — 0행(권이 나감)·23505(`loans_employee_id_request_id_key`)·SAVEPOINT 복구 뒤 재조회, 같은 요청 식별자 동시 2회(권 1개·2개 이상), 같은 요청 식별자로 다른 도서 | HTTP 상태 코드·쿠키·CSRF, 화면 문구 |
| 4 | C-06 시계 | `FixedClock`·`addDays`·`SystemClock.today` 의 한국 표준시 변환을 직접 호출 | 자정 경계(UTC 14:59:59 → 한국 23:59:59, 15:00:00 → 다음 날), 윤년 덧셈 | 서버 시각 자체가 틀린 경우(운영 NTP 점검) |
| 5 | C-03 인증 대역 `FakeCompanyAccount` | 성공·거절·영원히 안 끝남(`COMPANY_AUTH_TIMEOUT_MS=50` 로 시험)·회사 메일 없음·이름 없음을 흉내 낸다. seam 2 에서 주입 | 로그인 분기(`AUTH_FAILED`·`AUTH_UNAVAILABLE`), 임직원 만들기·갱신, 소문자 메일 구분, 비밀번호가 DB·로그에 없음 | 실제 프로토콜·인증서 검증·응답 형식 — **스파이크 S3-D5 로만 확인** |
| 6 | C-08 정리 작업 `runCleanup` | 시험 DB 에 날짜별 행을 심고 `FixedClock` 으로 실행해 남은 행을 읽는다 | 5년 경계(5년째 되는 날은 남고 다음 날 삭제), 반납 안 된 건 보존, 만료 세션 삭제, 대여·세션 없는 임직원 삭제와 24시간 보호, 재실행 안전. **삭제와 로그인(`upsertEmployee`+세션 생성) 동시 실행 경합 시험 — 두 방향**(삭제 문이 먼저 시작해 잠금을 기다리는 경우, 로그인이 먼저 시작해 커밋을 기다리는 경우)에서 결과가 모두 「세션이 가리키는 임직원 행이 항상 존재」 | systemd 타이머가 실제로 도는지(단위 파일 점검으로 대신) |
| 7 | C-09 `applyCatalog` | 시험 DB·임시 `COVER_DIR` 로 직접 호출 | 재실행 안전, 대여 건 있는 권 삭제 거절, 표지 파일 검사(확장자·시그니처·`realpath` 밖 링크), 고정 시계로 `created_at`·`updated_at` 확인 | 실제 도서 목록 파일의 품질 |

### 8.2 좋은 테스트의 정의

- 공개 인터페이스(위 seam 의 HTTP·모듈 연산)만 부르고 **외부에서 보이는 동작**(응답, 상태 코드, 이후 읽기 결과, 남은 행)만 확인한다. 내부 함수·SQL 문자열·호출 횟수를 확인하지 않는다.
- 자기 코드의 모듈(C-04·C-05·C-07)을 흉내 내지 않는다. 대역은 외부 경계에만 쓴다 — 회사 계정(`FakeCompanyAccount`)과 시간(`FixedClock`).
- DB 는 실제 PostgreSQL 이다. 시험 파일마다 새 스키마를 만들고 마이그레이션을 적용하며 시험 사이에는 테이블 내용을 지운다. 대역 저장소를 쓰지 않는다(`checklist:dba#9`).
- 한 시험은 하나의 동작을 확인하고, 이름이 그 동작을 말한다(예: 「반납 예정일 다음 날부터 연체이므로 새 대여를 거절한다」).
- 시험 데이터는 자리표시자만 쓴다(`user1@example.com`, 「시험 도서 A」). 실제 임직원 정보는 쓰지 않는다.
- 동시성 시험은 고정된 대기 시간 대신 모든 요청을 동시에 시작해 결과 집합(성공 1건·`NO_COPY_AVAILABLE` n−1건)으로 판정한다.
- 시험이 실패한 이유를 응답의 `code`·`trace_id` 만으로 알 수 있어야 한다.

### 8.3 기계로 고정하는 시험(요구를 코드로)

| 시험 | 근거 |
|---|---|
| 모든 테이블의 열 이름 집합이 4절과 같다(사번·비밀번호·세션 평문 열 없음, 개인정보 열은 `employees` 의 3개뿐) | `plan/requirements.md#NFR-03`, `#NFR-04` |
| 마이그레이션 `up` 전체 → `down` 전체 → `up` 전체가 성공한다 | `checklist:dba#1` |
| 명세의 모든 연산에 처리기가 있고 그 반대도 같다 | `checklist:architecture#4` |
| 모든 오류 응답이 11.1절 형식이다(응답 본문에 스택·SQL·경로가 없다) | `checklist:security#8` |
| 로그를 수집해 비밀번호·세션 값·이름·회사 메일·DB 접속 문자열 형태(`postgresql://…`)가 없다. 설정 검증 오류 출력에 값이 없고 변수 이름·규칙 이름만 있다 | `S3-D12`, `checklist:security#8` |
| 앱 역할(`app_web`·`app_cleanup`·`app_seed`)로 접속해 각 역할의 실제 질의를 돌린다 — `app_web` 의 열 단위 `UPDATE(name, department, updated_at)`·`ON CONFLICT` 가 필요로 하는 SELECT·스키마 USAGE 부족이 없고, 허용 밖 동작(예: `app_web` 의 `DELETE FROM loans`, `UPDATE employees SET email`)은 권한 오류다. 시험 DB 준비 단계가 `ops/create-roles.sql` 을 먼저 실행한다(5절) | 4.8절, `checklist:dba#9` |
| 오류 코드 집합: `api/openapi.yaml` 이 정의한 오류 코드 = 11.2·11.3절 코드 집합 | `checklist:architecture#4` |
| `title_key`·`author_key` 가 JS 정규화(`src/shared/search-query.ts`)와 같다 — 전각 공백(U+3000)·NBSP(U+00A0)가 섞인 한국어 제목, 대문자 라틴이 섞인 제목(예: `Test　Ｂook 책`)을 DB 에 넣어 PG 키와 JS 결과를 비교하고 그 키로 검색이 된다 | `plan/requirements.md#A-22` |
| DB 길이 `CHECK`(제목 300·저자 200·출판사 200·소개 5000·`catalog_ref` 64)가 `src/shared/limits.ts` 값과 같다(경계값 N자 허용·N+1자 거절) | 4.2절, A-13 |
## 9. 보존·삭제

개인정보 열은 4절에 `●` 로 표시했다. 접근은 서비스 계정(`app_web`)·정리 작업과 7.4절의 백업 장치 접근 주체로 한정된다(백업 파일은 암호화돼 있다). 아래 기간의 합은 「삭제 실행은 매일 03:30 한국 표준시」를 전제로 한다.

| 데이터 | 보관 기간 | 삭제 방식 | 기간 근거 |
|---|---|---|---|
| 대여 건(`loans`, 반납 기록 포함) | 반납한 날(한국 표준시)부터 5년째 되는 날까지. 반납 안 된 건은 반납될 때까지 | C-08 이 매일 1회, 다음 날 실행에서 1000행씩 삭제 | 결정 로그 seq 7 `S1-Q5`, `plan/requirements.md#A-24`, `S3-D9` |
| 임직원(`employees`) | 대여 건이 있는 동안, 또는 유효한 세션이 있는 동안. 둘 다 없고 마지막 로그인 갱신이 24시간 지나면 다음 실행에서 삭제. 이름·부서는 현재 읽는 화면이 없으나 요구사항 F-02·A-32 대로 저장·갱신을 유지한다 — S4-Q1 로 계속 저장 확정(가정 A-15) | C-08(한 `DELETE` 문 — 3.9절) | `S3-D16`, `plan/requirements.md#NFR-03`(필요한 동안만 보관) |
| 세션(`sessions`) | 만든 때부터 8시간. 로그아웃하면 즉시 | 로그아웃은 행 삭제, 만료 행은 C-08 이 삭제(만료된 행은 확인 단계에서 이미 무효) | `plan/requirements.md#A-17`, `S3-D4` |
| 도서·권(`books`, `book_copies`) | 삭제 기한 없음(개인정보 아님). 대여 건이 남은 권은 그 건이 지워질 때까지 못 지운다 | 개발팀 요청으로 C-09 가 삭제 | `plan/requirements.md#A-26`, `#A-30` |
| 표지 파일(`COVER_DIR`) | 도서가 있는 동안 | 도서를 지울 때 C-09 가 안내만 한다(파일은 사람이 지운다) | 개인정보 아님 |
| 로그 | 일 단위로 순환하고 30일 보관 | `logrotate` 일 단위, 30개 | `plan/architecture.md#6. 배치와 운영`. 로그에는 개인정보가 없어 보관 기간이 개인정보 기간과 무관하다 |
| 백업 파일 | 35일(`age` 공개키로 암호화한 파일만 — 7.4절) | 백업 스크립트가 35일이 지난 파일을 삭제. 복원 시험 사본은 시험 직후 폐기(7.4절) | `plan/architecture.md#10. 가정 A-09 of S3` |
| 비밀번호·사번 | 저장하지 않음(보관 기간 없음) | 해당 없음 | `plan/requirements.md#NFR-03`, `#NFR-04` |

주의 두 가지. ① 삭제된 대여 건은 백업에 최대 35일 더 남으므로 실제 소멸은 「5년 + 35일」이다. 이 차이를 개인정보 방침에 반영해야 한다(운영 준비 항목). ② 임직원 행이 지워지면 같은 회사 메일로 다시 로그인할 때 새 id 가 생긴다. 지워진 시점에는 연결된 대여 건이 없으므로 기록이 끊기는 일은 없다.

## 10. 스파이크 필요

문서로 판정할 수 없어 구현의 맨 앞 Task 로 실험한다. 기획 잡은 셸이 없어 실험하지 못한다.

| id | 무엇을 실험하나 | 판정 기준 | 실패하면 |
|---|---|---|---|
| S3-D5 | 회사 계정 시스템이 인증 때 이름·부서·회사 메일을 돌려주는지, 어떤 방식(프로토콜)으로 연동하는지. IT 가 준 시험 계정으로 `CompanyAccountPort` 구현 하나를 만들어 호출한다 | 회사 메일이 반드시 오고, 응답이 10초 안이며, 전송이 TLS 이고 서버 인증서를 검증한다. 필요한 비밀값 이름이 정해진다(`${COMPANY_AUTH_CLIENT_SECRET}` 여부) | 임직원 구분(`plan/requirements.md#A-29`)이 성립하지 않으므로 요구사항 단계 재협의 |
| S3-D11 | 한 권에 50건 동시 `borrow` 에서 1건만 성공하는지, 같은 요청 식별자를 동시에 2회 보내면 대여 건이 1건인지, 응답이 3초 이내인지, 풀 크기 10과 질의 시간 초과 5초·연결 대기 3초가 이 부하를 감당하는지. 검색(도서 수천 건)의 응답 시간도 함께 잰다 | 위 항목이 모두 맞고 검색이 1초 이내 | 풀·재시도 방식을 고치거나 쓰기를 직렬화한다. 후보 권 읽기에서 같은 첫 권으로 호송(모두 첫 권을 기다림)이 생기면 `listFreeCopies` 를 `FOR UPDATE SKIP LOCKED` 후보 읽기로 바꾼다. 검색이 느리면 4.6절의 pg_trgm 인덱스를 더한다 |

S4-D24(권 중재 구조)는 스파이크 항목이 아니다. 인덱스 추론 형식의 `ON CONFLICT`·제약 이름 판별·SAVEPOINT 재조회로 **설계를 확정**했고, 정확성(같은 요청 식별자 동시 2회의 권 1개·2개 이상, 서로 다른 사람 N명, 같은 요청 식별자로 다른 도서)은 8.1절 seam 2·3 의 상시 자동 시험이 지킨다. S3-D11 의 부하 실험이 같은 경합을 50건 규모로 한 번 더 확인하고(① 1건 성공·나머지 `NO_COPY_AVAILABLE`, ② 대여 건 1건·두 응답 같은 `loanId`, ③ `REQUEST_ID_CONFLICT`), 실패하면 위 S3-D11 의 실패 대안(직렬화, `FOR UPDATE SKIP LOCKED` 후보 읽기)을 쓴다.

## 11. 공통 개발 영역

레포에 공통 코드가 아직 없다. **이 절 전체를 S6 가 foundation Task 로 만든다**(오류 형식·코드 목록·검증 기반·화면 오류 처리). 다른 Task 는 이 기반 위에서 연산을 더한다.

### 11.1 오류 응답 형식

모든 `/api` 오류는 같은 JSON 모양이다. 형식·코드 목록은 `api/openapi.yaml` 의 `components` 에 한 번 정의하고 모든 연산이 `$ref` 로 쓴다(`checklist:architecture#9`).

```json
{
  "code": "VALIDATION_FAILED",
  "message": "입력한 내용을 확인해 주세요.",
  "details": [{ "field": "account", "rule": "required" }],
  "trace_id": "4f1c2a9e0b7d4e6f8a3b5c7d9e1f2a3b"
}
```

- `details` 는 항상 배열이다(없으면 `[]`). 항목은 `field`(요청의 필드 이름)와 `rule`(`required`·`maxLength`·`pattern`·`format` 같은 규칙 이름)뿐이며 **보낸 값은 담지 않는다**(비밀번호가 응답·로그에 되돌아가지 않게).
- `trace_id` 는 요청 id 이고 응답 머리말 `X-Request-Id` 와 같다. 프록시가 준 값이 32자리 16진수일 때만 믿고 아니면 서버가 만든다. 같은 값으로 로그를 찾는다.
- 스택·SQL·서버 경로·토큰·다른 사람의 정보는 어떤 응답에도 없다(`checklist:security#8`). 잡히지 않은 예외는 `UNAVAILABLE` 로 바꾸고 상세는 로그에만 남긴다.

### 11.2 상태 코드 규칙

| 상태 | 쓰는 경우 |
|---|---|
| 400 | **모든 입력 오류 하나로**(경로 id 형식 오류는 예외 — 11.3절 끝): 필수 값 없음·길이·형식·알 수 없는 필드·본문 한도 초과(nginx 의 413 포함 — 2.2절) 등 잘못된 요청 전부. 코드는 `VALIDATION_FAILED` |
| 401 | 인증되지 않음: `AUTH_FAILED`(로그인 거절), `SESSION_EXPIRED`(세션 없음·만료) |
| 403 | 허용되지 않음: `FORBIDDEN`(남의 것·없는 것), `CSRF_REJECTED` |
| 404 | 없음: `BOOK_NOT_FOUND`, `ROUTE_NOT_FOUND`(`/api` 아래 없는 경로·메서드) |
| 409 | 현재 상태와 충돌: `OVERDUE_BLOCKED`, `NO_COPY_AVAILABLE`, `ALREADY_RETURNED`, `REQUEST_ID_CONFLICT` |
| 503 | 저장소 오류·시간 초과·동시 인증 호출 상한: `UNAVAILABLE` |
| 504 | 회사 계정 시스템 무응답·연결 실패·응답 형식 이상: `AUTH_UNAVAILABLE` |
| 500 | 예상하지 못한 서버 오류: 코드는 `UNAVAILABLE` |

성공은 200(조회·반납·로그아웃), 새 대여는 201, 같은 요청 식별자의 재전송은 200(`replayed: true`)이다. 코드가 정본이고 상태 코드는 일반 규칙이다 — 화면은 `code` 로 분기한다.

### 11.3 오류 코드 목록과 문구

**아래 표는 열람용 사본이다 — S5 `openapi.yaml` 과 다르면 openapi 가 이긴다.** 문구는 `plan/ui-spec.md` 의 화면 문구와 같고 「무엇이 잘못됐는지 + 다음에 할 일」을 담는다. 서버의 `message` 가 이 문구이며 `<IT 지원 내선>` 은 `IT_SUPPORT_EXT` 값으로 바뀐다. 문구의 정본은 `api/openapi.yaml`(오류 코드 정의) 한 곳이고, 화면은 같은 명세에서 빌드 때 생성한 표를 쓴다 — 서버가 응답하지 못한 경우(연결 끊김)에도 같은 문구가 나오게 하기 위해서다.

| 코드 | 상태 | 언제 | 문구 | 화면 처리 |
|---|---|---|---|---|
| `OVERDUE_BLOCKED` | 409 | 대여 때 본인에게 연체 건이 있다 | 연체 중인 도서가 있어 새로 빌릴 수 없습니다. 내 대여 현황에서 연체 도서를 반납한 뒤 다시 빌려 주세요. | SCR-03 안내 블록 + 보조 버튼 「내 대여 현황으로」 |
| `NO_COPY_AVAILABLE` | 409 | 대여 가능 권이 없다(마지막 권을 먼저 빌려 간 경우 포함) | 방금 모든 권이 대여 중이 되었습니다. 도서 상세나 검색 화면으로 돌아가 다른 도서를 찾아 주세요. | SCR-03 안내 블록 + 「도서 검색으로 돌아가기」 |
| `BOOK_NOT_FOUND` | 404 | 도서 id 가 없다(경로 id 형식 오류·범위 밖 포함) | 도서를 찾을 수 없습니다 | SCR-06(버튼 「도서 검색으로 돌아가기」가 다음 행동) |
| `FORBIDDEN` | 403 | 남의 대여 건·남의 현황 주소·없는 대여 건(존재를 알리지 않는다), 형식이 틀린 임직원·대여 건 id | 접근할 수 없습니다 | SCR-08(버튼 「도서 검색으로 돌아가기」가 다음 행동) |
| `ALREADY_RETURNED` | 409 | 내 건인데 이미 반납됨 | 이미 반납된 도서입니다. 내 대여 현황을 다시 불러와 확인해 주세요. | SCR-04 상단 안내 블록 + 「현황 다시 불러오기」 |
| `REQUEST_ID_CONFLICT` | 409 | 같은 사람이 같은 요청 식별자로 다른 도서를 요청 | 대여가 되지 않았습니다. 내 대여 현황에서 확인한 뒤 필요하면 다시 빌려 주세요. | SCR-03 안내 블록(일반 실패 안내) |
| `UNAVAILABLE` | 503/500 | 저장소 오류·시간 초과·동시 인증 호출 초과·예상 못한 오류 | 연산마다 아래 표 | 실패한 영역 안 안내 |
| `AUTH_FAILED` | 401 | 회사 계정 시스템이 계정·비밀번호를 거절 | 계정 또는 비밀번호가 맞지 않습니다. 다시 입력해 주세요. 계속되면 IT 지원(내선 `<IT 지원 내선>`)에 문의하세요 | SCR-01 입력 칸 아래·버튼 위 안내 블록, 비밀번호 칸 비움, 초점은 안내 블록 |
| `AUTH_UNAVAILABLE` | 504 | 10초 무응답·연결 실패·회사 메일 없음 | 회사 계정 확인을 하지 못했습니다. 다시 시도해 주세요. 계속되면 IT 지원(내선 `<IT 지원 내선>`)에 문의하세요 | SCR-01 안내 블록 |
| `VALIDATION_FAILED` | 400 | 입력 검증 실패 | 입력한 내용을 확인해 주세요. 로그인은 `details` 의 필드별로 「회사 계정을 입력해 주세요」「비밀번호를 입력해 주세요」 | 로그인은 해당 칸 아래 문구와 초점. 그 밖은 영역 안 안내 |
| `SESSION_EXPIRED` | 401 | 세션 쿠키가 없거나 서버에서 만료·삭제됨 | 로그인 유지 시간이 지났거나 로그인하지 않았습니다. 다시 로그인해 주세요. | SCR-01 로 이동. 문구는 11.5절 |
| `CSRF_REJECTED` | 403 | CSRF 머리말·쿠키·`Origin` 불일치 | 요청을 확인하지 못했습니다. 화면을 새로 고친 뒤 다시 시도해 주세요. | 영역 안 안내. 화면이 토큰을 새로 받는다(자동 재시도는 하지 않는다) |
| `ROUTE_NOT_FOUND` | 404 | `/api` 아래 없는 경로·메서드 | 요청한 주소를 찾을 수 없습니다. | 개발 오류용이라 화면에 보이지 않는다(보이면 `UNAVAILABLE` 처럼 영역 안 안내) |

**경로 id 형식 오류(S4-D31)**: 경로의 id 가 형식에 맞지 않거나 범위 밖이면 11.2절의 400 이 아니라 아래 코드가 된다. 존재하지 않는 id 와 구분되지 않게 해 존재 여부를 알리지 않기 위해서다(S3-D8, SCR-08·SCR-06).

| 경로 id | 형식 | 오류 |
|---|---|---|
| `employeeId`, `loanId` (`listEmployeeLoans`·`returnLoan`) | UUID | 형식 오류·범위 밖 모두 `FORBIDDEN`(403) |
| `bookId` (`getBook`·`getBookCover`·`borrowBook`) | 양의 정수 문자열(1 이상 9223372036854775807 이하, 앞의 0 없음) | 형식 오류·bigint 범위 밖 모두 `BOOK_NOT_FOUND`(404) |

이 매핑은 `api/openapi.yaml` 의 경로 매개변수 확장 값(예: `x-invalid-id-error: FORBIDDEN`)으로 두고 서버가 읽는다. 판정은 11.6절 순서의 세션 확인 뒤에 한다 — 로그인하지 않은 요청은 `SESSION_EXPIRED` 가 먼저다. 본문·쿼리의 형식 오류(예: 요청 식별자 UUID 아님, `page` 범위 밖)는 그대로 `VALIDATION_FAILED`(400)이다.

`UNAVAILABLE` 의 연산별 문구(영역 안 안내는 `plan/ui-spec.md` 와 같다. 연결이 끊겨 응답이 없을 때도 같은 문구를 쓴다 — S2-Q1):

| 연산 | 문구 |
|---|---|
| `searchBooks` | 검색하지 못했습니다. 다시 검색해 주세요. 계속되면 IT 지원(내선 `<IT 지원 내선>`)에 문의하세요 |
| `getBook` | 도서 정보를 불러오지 못했습니다. 다시 불러오거나 도서 검색으로 돌아가 주세요. |
| `listEmployeeLoans` | 대여 현황을 불러오지 못했습니다. 다시 불러와 주세요. |
| `borrowBook` | 대여가 되지 않았거나 결과를 확인하지 못했습니다. 내 대여 현황에서 확인한 뒤 필요하면 다시 빌려 주세요. |
| `returnLoan` | 반납이 되지 않았거나 결과를 확인하지 못했습니다. 내 대여 현황을 다시 불러와 확인한 뒤 필요하면 다시 반납해 주세요. |
| `login`·`logout`·`getSession` 등 그 밖 | 처리하지 못했습니다. 다시 시도해 주세요. 계속되면 IT 지원(내선 `<IT 지원 내선>`)에 문의하세요 |

### 11.4 입력 검증의 정본 위치(S3-D14)

- **정본은 `api/openapi.yaml`(OpenAPI 3.0.3)이다.** 요청 매개변수·본문의 형식·길이·필수 여부와 오류 코드·문구가 이 파일에 있다. S5 가 기획 산출물로 쓰고(`doc/plan/01a1ac16-3af1-7913-9b76-08fc2bf928cb/openapi.yaml`), S6 의 foundation Task 가 그 내용을 `api/openapi.yaml` 로 옮긴다. **옮긴 뒤의 정본은 `api/openapi.yaml` 하나**이고 기획 폴더 사본은 승인 시점의 기록이라 코드가 읽지 않는다(사본의 방향은 기획→레포 한 번뿐이다 — `checklist:architecture#2`).
- **서버**: 시작할 때 명세를 읽어 경로마다 Fastify 스키마(Ajv, 모든 오류 수집, 알 수 없는 필드 거부)로 컴파일한다. 검증 실패는 `VALIDATION_FAILED` 로 바뀐다.
- **화면**: 빌드 때 같은 명세에서 ① `openapi-typescript` 타입, ② Ajv standalone 검증 함수, ③ 상수(`x-page-size`=20, `x-search-truncate`=100, 오류 문구 표)를 `src/shared/generated/` 와 화면 번들에 생성한다. 생성물은 커밋하지 않고 빌드가 만든다.
- **정규화는 규칙이지 검증이 아니다**: 검색어를 공백 제거·소문자·100자로 줄이는 함수는 `src/shared/search-query.ts` 한 곳에 있고 서버와 화면이 같은 것을 가져다 쓴다(`q` 의 명세 상한은 1000자로 두어 그 이상만 400 이다). 100이라는 숫자는 명세의 확장 값에서 온다.
- **드리프트 차단**: CI 가 ① 생성 타입을 다시 만들어 소스와 다르면 실패시키고 ② 8.3절의 「연산–처리기 일치」 시험을 돌린다.
- 로그인 칸: `account` 는 공백이 아닌 글자가 하나 이상이고 254자 이하, `password` 는 1자 이상 1024자 이하(A-07). 요청 식별자는 UUID, `page` 는 1 이상 10000 이하 정수, 경로의 id 들은 각각 정수·UUID 형식이다. 경로 id 의 형식 위반은 400 이 아니라 11.3절 끝의 `FORBIDDEN`·`BOOK_NOT_FOUND` 로 바뀐다.

### 11.5 오류 화면 처리

| 상황 | 처리 | 근거 |
|---|---|---|
| `BOOK_NOT_FOUND` 또는 알 수 없는 화면 경로 | SCR-06 | `plan/ui-spec.md#SCR-06` |
| `FORBIDDEN` | SCR-08 | `plan/ui-spec.md#SCR-08` |
| 500·503·연결 끊김·시간 초과 | **전체 화면 없이** 실패한 영역 안의 안내(11.3절 문구)와 그 안의 다음 행동 버튼(「다시 검색」「다시 불러오기」「현황 다시 불러오기」) | 결정 로그 S2-Q1 (seq 10), `plan/ui-spec.md#4. 화면 공통 규칙` |
| `SESSION_EXPIRED` | SCR-01 로 이동. 「대여」·「반납하기」 중이었으면 제목 위에 「처리되지 않았습니다. 다시 로그인한 뒤 직접 다시 눌러 주세요」, 화면을 열거나 읽는 요청이었으면 「로그인해 주세요」. 서버는 두 경우를 구분하지 않고 화면이 어느 요청이 거절됐는지로 고른다 | `plan/ui-spec.md#SCR-01`(G-18) |
| `AUTH_FAILED`·`AUTH_UNAVAILABLE` | SCR-01 에 머무르며 안내 블록 | `plan/ui-spec.md#SCR-01`(G-01) |
| `VALIDATION_FAILED`(로그인) | 해당 칸 아래 문구 + 그 칸으로 초점 | `plan/ui-spec.md#4. 입력 오류 표시` |
| 응답 해석 실패(JSON 이 아님 — 프록시가 11.1절 형식을 못 낸 경우 포함) | `UNAVAILABLE` 과 같은 영역 안 안내 | 방어, 2.2절 |

### 11.6 그 밖의 공통 기반(foundation Task 범위)

- 요청 처리 순서: 요청 id 부여 → 보안 헤더 → 본문 한도 → 쿠키 → 명세 검증 → 세션 확인 → CSRF 확인(변경 요청) → 처리기 → 오류 변환 → 로그. 세션·CSRF 확인은 `getPublicConfig`·`getCsrfToken`·`login`·`getHealth` 에는 걸지 않는다.
- 로그: pino 구조화 로그에 `time`, `level`, `reqId`, `route`(경로 틀. 실제 주소·검색어는 남기지 않음), `status`, `durationMs`, `employeeId`(가명 id), `code`(오류 코드)만 남긴다. 요청 본문은 기록하지 않고, 마스킹 목록에 `req.headers.cookie`, `req.headers.authorization`, `res.headers["set-cookie"]` 를 두고, 오류 객체·메시지에 섞일 수 있는 **DB 접속 문자열 형태**(`postgres://…`·`postgresql://…`)는 로그 직렬화 단계에서 정규식으로 `[REDACTED]` 로 바꾼다. 이름·회사 메일·비밀번호·세션 값은 어떤 수준에서도 남기지 않는다(S3-D12).
- 설정 검증 오류(7.5절)는 변수 이름과 규칙 이름만 출력하고 값은 출력하지 않는다.
- 헬스: `GET /healthz` 는 프로세스와 `SELECT 1` 성공을 본다. 정상 200 `{"status":"ok"}`, DB 실패 503. 인증·상세 정보 없음.
- 종료: 종료 신호를 받으면 새 요청을 받지 않고 진행 중인 요청을 마친 뒤 DB 연결을 닫는다(대여 트랜잭션이 중간에 끊기지 않게).
- 설정: 7.5절 목록 검사.
- 의존 방향 검사(ESLint)와 명세 드리프트 검사(CI), 시험 지원(`tests/support`: 시험 스키마 생성, `FakeCompanyAccount`, 시험 앱 조립, 개인정보 자리표시자 데이터).

## 12. 가정(기본값으로 정한 것)

이 표의 A- 번호는 이 단계 문서 안의 번호이며 요구사항·화면 설계·아키텍처 문서의 A- 번호와 별개다(그쪽은 「요구사항 A-17」「아키텍처 A-05」처럼 적는다).

| id | 가정 | 권장값 | 이유 | 바꾸려면 |
|---|---|---|---|---|
| A-01 | 로그인 유지 시간의 셈 | 로그인한 때부터 8시간 뒤 끝나는 절대 만료이고 사용 중이어도 늘리지 않는다 | 요구사항 A-17 이 「8시간 유지」만 말했다. 하루 업무 시간 뒤 다시 로그인하는 것이 단순하고 안전하다 | 승인 전에 피드백으로 「사용하면 연장」을 적어 다시 생성 |
| A-02 | 로그인 때 이름·부서를 못 받으면 | 저장된 이름·부서도 비운다(받은 최신 값이 없음) | 요구사항 A-32 가 「최신 값으로 갱신」이라 했고 오래된 값을 남기면 틀린 정보가 남는다 | 승인 전에 피드백으로 「기존 값 유지」를 적어 다시 생성 |
| A-03 | 대여 건이 있는 권·도서의 삭제 | 그 대여 건이 5년 뒤 지워질 때까지 개발팀 변경 요청으로도 삭제할 수 없다(권 수 줄이기도 대여 건이 없는 권만) | 대여 기록이 가리키는 권이 사라지면 대장이 깨진다(요구사항 A-30). 분실·폐기 표시는 1차 범위 밖이다 | 승인 전에 피드백으로 「폐기 처리」를 적어 다시 생성(권 상태가 생겨 범위가 커진다) |
| A-04 | 출판사·소개가 없는 도서 | 해당 줄을 화면에서 숨긴다 | 화면 설계가 비어 있는 경우를 정하지 않았고 빈 줄은 오해를 준다 | 승인 전에 피드백으로 대체 문구를 적어 다시 생성 |
| A-05 | 검색 결과 정렬 | 제목 오름차순(문자 코드 순, 한글은 가나다 순), 같으면 도서 등록 순 | 입력과 화면 설계에 정렬이 없고 쪽을 넘길 때 순서가 흔들리지 않아야 한다 | 승인 전에 피드백으로 정렬을 적어 다시 생성 |
| A-06 | 5년 보관의 셈 | 반납한 날(한국 표준시)부터 5년째 되는 날까지 보관하고 다음 날 실행에서 지운다 | 결정 로그 seq 7 이 「5년 보관」만 정했고 날짜 단위 기간의 일반 관행이다 | 승인 전에 피드백으로 기준일을 적어 다시 생성 |
| A-07 | 로그인 입력 길이 | 계정 칸 254자, 비밀번호 1024자까지 | 요구사항에 길이 제한이 없고 회사 메일 최대 길이와 긴 암호문을 수용하면서 비정상 입력은 막는다 | 승인 전에 피드백으로 길이를 적어 다시 생성 |
| A-08 | 표지 이미지 | 개발팀이 도서 적재 때 png·jpg·webp 파일을 서버 디렉터리에 두고, 없으면 회색 자리 상자를 보인다 | 입력에 표지의 출처가 없다. 외부 서비스를 쓰지 않는다(아키텍처 A-03) | 승인 전에 피드백으로 표지 출처를 적어 다시 생성 |
| A-09 | 검색 인덱스 | 도서가 1만 권 이하이면 별도 검색 인덱스 없이 부분 일치를 순차 읽기로 처리한다 | 아키텍처 A-04 의 수천 권 규모 가정과 응답 3초(NFR-07). 스파이크 S3-D11 이 시간을 잰다 | 규모가 크면 피드백으로 적어 다시 생성. 오픈 뒤라면 전진 마이그레이션으로 인덱스 추가 |
| A-10 | 정리 작업 시각 | 매일 한국 표준시 03:30 | 이용이 가장 적은 시간대이고 입력에 지정이 없다 | 타이머 단위 파일의 시각만 바꾼다(코드 변경 없음) |
| A-11 | 서버 운영체제 | Linux(systemd 사용 가능) | 사내 서버 사양이 입력에 없고 이 구성(타이머·프록시)에 가장 흔하다 | 승인 전에 피드백으로 운영체제를 적어 다시 생성. Windows 서버라면 스케줄러 구현이 달라진다 |
| A-12 | 개발팀 숙련도 | 개발팀이 TypeScript·Node.js 로 개발·운영할 수 있다 | 입력에 팀 기술 스택이 없다. 틀리면 일정(6주)이 가장 먼저 흔들리는 가정이다 | 승인 전에 피드백으로 팀이 쓰는 언어를 적어 다시 생성(스택 절 전체가 바뀐다) |
| A-13 | 도서 필드 길이 한도 | 제목 300자·저자 200자·출판사 200자·소개 5000자·`catalog_ref` 64자. DB 의 길이 `CHECK` 와 `CatalogFile` 검증이 `src/shared/limits.ts` 의 같은 숫자를 쓴다 | 입력에 길이 기준이 없고 일반 도서 정보를 담으면서 비정상 입력은 막는 값이다 | 승인 전에 피드백으로 길이를 적어 다시 생성. 오픈 뒤라면 전진 마이그레이션으로 `CHECK` 를 바꾸고 상수를 함께 바꾼다 |
| A-14 | 로그인 시도 제한 | 서비스에는 계정별·출처별 시도 제한을 두지 않는다(요구사항 A-19: 횟수 제한은 회사 계정 시스템 정책에 따름). 회사 계정 동시 호출 상한 10건이 한 클라이언트의 반복 요청으로 차면 그동안 새 로그인이 막히고 이미 로그인한 사용자는 영향이 없다 | 승인된 요구사항 A-19 가 우선이다. 계정 잠금 정책을 서비스가 이중으로 두지 않는다 | 승인 전에 피드백으로 「서비스에도 시도 제한」을 적어 다시 생성(요구사항 A-19 재협의가 먼저 필요) |
| A-15 | 이름·부서를 읽는 화면이 없어도 저장 유지 | 임직원 이름·부서를 계속 저장·갱신한다 | 요구사항 F-02·A-32 가 저장·갱신을 정했고 2차 관리자 연체 목록(F-12 등)에서 쓸 값이다 | 승인 전에 피드백으로 「저장하지 않음」을 적어 다시 생성(`employees` 열과 3.4절이 바뀐다) |
