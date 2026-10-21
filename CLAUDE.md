# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 한수 (Hansu) — 체스 분석 프로그램

이 프로그램은 체스닷컴(Chess.com), 리체스(Lichess.org) 등의 체스 플랫폼의 플레이어 대전 기록을 바탕으로, 플레이어의 체스 수순 통계와 체스 엔진 등의 분석을 통해 체스 복기를 도와주는 역할을 수행한다.

### 체스닷컴
체스닷컴은 https://www.chess.com/news/view/published-data-api 에서 제공하는 Published-Data API를 사용한다.

- 인증 없는 읽기 전용 API. `GET /pub/player/{username}/games/archives`로 월별 아카이브 URL 목록을 받은 뒤, `GET /pub/player/{username}/games/{YYYY}/{MM}`로 해당 월의 대국(PGN 포함)을 가져온다.
- 요청은 순차적으로 보낸다. 병렬 요청 시 `429 Too Many Requests`가 발생할 수 있다. 연락처가 담긴 `User-Agent` 헤더를 붙인다.
- 지난 달의 아카이브는 더 이상 바뀌지 않으므로 한 번 가져오면 DB에 캐시하고, 현재 달만 다시 조회한다.
- 처음 가져올 때는 최근 `IMPORT_HISTORY_YEARS`년(기본 3년) 동안 끝난 대국만 받는다. 그 이후 업데이트는 DB에 저장된 그 플레이어의 마지막 대국이 끝난 시각부터, 그 달 이후의 아카이브만 요청해 그 뒤에 끝난 대국만 추가한다(`importers/chesscom.py`의 `import_player`). 중간에 끊긴 가져오기도 같은 방식으로 이어서 받는다. 프론트엔드 `PlayerPanel`은 입력한 아이디에 저장된 대국이 없으면 "가져오기"(기간은 `GET /api/import-settings`), 있으면 "업데이트"(마지막 대국 이후)로 안내하고, 선택된 플레이어 카드에 저장 대국 수·마지막 대국·업데이트 버튼을 보여준다.

### 리체스
- `GET https://lichess.org/api/games/user/{username}` (헤더 `Accept: application/x-ndjson`)로 대국을 스트리밍으로 받는다. `since`/`until`, `pgnInJson=true` 등의 쿼리 파라미터를 사용한다.
- 동시에 한 요청만 보낸다. `429`를 받으면 최소 1분 기다린 뒤 다시 시도한다.
- 수집기는 `importers/lichess.py`. 사용자 확인은 `GET /api/user/{username}`(404면 없는 아이디, 표시 이름도 여기서 받는다). 대국은 `sort=dateAsc`, `perfType`(표준 체스 속도만), `pgnInJson=true`로 받고, 변형 체스와 결과 없이 끝난 대국(aborted 등)은 버린다. 속도는 공통 time_class로 바꾼다(ultraBullet→bullet, correspondence→daily, classical은 그대로).
- Lichess의 `since`는 대국 *시작* 시각 기준이다. 처음 가져올 때는 최근 `IMPORT_HISTORY_YEARS`년, 업데이트 때는 저장된 마지막 대국 종료 시각 7일 전부터 받고 중복은 외부 ID로 거른다. 7일보다 오래 이어진 통신 체스 대국은 업데이트에서 놓칠 수 있다.
- 월 단위 아카이브가 없으므로 진행률은 받은 대국 수(`ImportProgress.games_seen`)로 보여준다.

## 아키텍처

백엔드는 **FastAPI**(Python), 프론트엔드는 **React**로 구성한 모노레포다.

```
backend/                 FastAPI 앱
  app/
    main.py              앱 생성, 라우터 등록, CORS 설정
    api/                 HTTP 라우터 (players, games, analysis, stats)
    importers/           플랫폼별 대국 수집기 (chesscom.py, lichess.py)
    analysis/            엔진 분석(engine.py), 수순·오프닝 통계(stats.py)
    models/              DB 모델(SQLAlchemy/SQLModel), API 스키마(Pydantic)
    db.py                DB 세션 / 연결
  tests/
frontend/                React 앱 (Vite)
  src/
    api/                 백엔드 호출 클라이언트
    components/          체스보드, 수순 목록, 평가 그래프 등
    pages/               플레이어 검색, 대국 목록, 대국 복기, 통계 대시보드
```

### 실행

루트의 `dev.cmd`(= `scripts/dev.ps1`)로 두 서버를 함께 다룬다: `.\dev start | stop | restart | status | logs`. 백그라운드로 띄우고 PID는 `.dev/`, 로그는 `.dev/logs/`에 둔다. `stop`은 PID 파일과 포트(8000, 5173) 점유 프로세스를 트리째 종료한다. Stockfish 경로는 `STOCKFISH_PATH` → PATH → winget 설치 폴더 순으로 찾는다. 개별 실행은 아래와 같다.

```
cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000   # API: http://127.0.0.1:8000/docs
cd backend && uv run pytest                                                 # 백엔드 테스트
cd frontend && npm install && npm run dev                                  # http://localhost:5173 (/api는 8000으로 프록시)
cd frontend && npm run typecheck
```

환경 변수: `DATABASE_URL`(기본 `backend/data/chess.db`, 실행 위치와 무관), `USER_AGENT_CONTACT`, `CORS_ORIGINS`, `IMPORT_HISTORY_YEARS`(처음 가져올 기간, 기본 3), `SECRET_KEY`, `PUBLIC_BASE_URL`, `LICHESS_CLIENT_ID`, `CHESSCOM_CLIENT_ID`/`CHESSCOM_CLIENT_SECRET`, `STOCKFISH_PATH`(비어 있으면 PATH의 `stockfish`), `ENGINE_DEPTH`(기본 18), `ENGINE_MULTIPV`(엔진 후보 수 개수, 기본 3), `ENGINE_THREADS`(기본 CPU 절반), `ENGINE_HASH_MB`(기본 128).

### 엔진 평가

`GET /api/analysis/position?fen=...&moves=<uci>...`는 포지션의 엔진 후보 수(MultiPV, `position.lines`)와 주어진 수들의 평가를 돌려준다. `EngineEval.rank`는 포지션 행에서는 분석한 후보 수 개수, 수 행에서는 후보 순위다(rank 없는 옛 포지션 행은 다시 분석). 캐시(`EngineEval`, 포지션 키·수·깊이 단위)에 없으면 `AnalysisService`의 작업자 스레드(엔진 프로세스 1개)에 분석을 예약하고 `status=pending`을 돌려주며, 프론트엔드가 `done`이 될 때까지 폴링한다. 응답 점수는 백 기준이고, 수 분류(best/good/inaccuracy/mistake/blunder)는 Lichess식 기대 승률 손실로 매긴다(`analysis/engine.py`의 `classify`). `init_db`는 모델에 새로 생긴 nullable 컬럼을 기존 테이블에 `ALTER TABLE`로 추가한다(그 밖의 스키마 변경은 아직 마이그레이션 도구가 없다). 프론트엔드는 평가를 체스닷컴식 세로 평가 막대(`EvalBar`)와 후보 수 목록(`EnginePanel`)으로 보여준다. 테스트는 가짜 분석기를 쓰고, 실제 Stockfish 테스트는 엔진이 없으면 건너뛴다.

### 계정 연결 (OAuth 로그인)

`app/auth/`와 `api/auth.py`. 플랫폼 계정을 Authorization Code + PKCE(S256)로 본인 확인해 `User`–`LinkedAccount`로 연결한다(한 사용자당 플랫폼마다 한 계정, 한 플랫폼 계정은 한 사용자에게만). 토큰은 아이디 확인에만 쓰고 저장하지 않는다(리체스는 확인 직후 폐기). 대국 데이터는 계속 공개 API로 가져오며, 연결하자마자 가져오기 작업을 시작해 `?linked=<platform>&job=<id>`로 앱에 돌려보낸다(오류는 `?auth_error=`). 로그인 상태는 Starlette `SessionMiddleware`의 서명 쿠키(`user_id`)에 둔다.
- 리체스: 등록 없이 `LICHESS_CLIENT_ID`(아무 고유 문자열)로 동작한다.
- 체스닷컴: OAuth 승인 전이라 `ChessComOAuth.enabled`가 False다. 승인 후 `CHESSCOM_CLIENT_ID/SECRET`을 넣고 엔드포인트와 ID 토큰(JWT) 검증을 구현해 켠다. 그동안 프론트엔드는 체스닷컴만 아이디로 가져오기를 남겨 둔다.
- 콜백 주소는 `PUBLIC_BASE_URL`(기본 `http://localhost:5173`) + `/api/auth/{platform}/callback`. 개발 중에는 Vite 프록시를 거쳐 쿠키가 프론트엔드 주소에 붙는다.
- 세션 서명 키는 `SECRET_KEY`, 없으면 개발용으로 `backend/data/secret_key`에 만들어 쓴다.
- 아직 가져오기·분석 API 자체는 로그인 없이도 호출된다(공개 배포 전에 로그인 사용자 기준 제한을 붙여야 한다).

### 다국어 (한국어 / 영어)

- 프론트엔드: 화면 문구는 모두 `frontend/src/i18n/ko.ts`(키의 기준)와 `en.ts`에 둔다. `en.ts`는 `Record<MessageKey, Msg>`라 키가 빠지면 타입 검사가 실패한다. 값은 `{이름}` 자리 채우기 문자열 또는 복수형 등을 위한 함수. 컴포넌트는 `useI18n()`의 `t(키, 값)`·`formatDate`·`formatNumber`를, React 밖 코드는 `translate()`를 쓴다. 언어는 헤더에서 고르고 브라우저에 기억하며(처음엔 브라우저 언어), 모든 API 요청에 `Accept-Language`를 붙인다. 새 문구를 추가할 때 코드에 한글/영문 문장을 직접 쓰지 않는다.
- 백엔드: 사용자에게 보이는 오류는 `app/i18n.py`의 `AppError(코드, **값)`로 던지고, 공통 처리기가 요청의 `Accept-Language`로 `{"detail": 문장, "code": 코드}`를 만든다(헤더가 없으면 한국어). 가져오기 작업 오류·엔진 실패도 코드로 보관했다가 조회하는 요청의 언어로 만든다. OAuth 콜백 오류는 `?auth_error=<코드>`로 넘기고 프론트엔드가 번역한다. 문구는 `MESSAGES`에 한국어·영어를 함께 둔다.

### 오프닝 분류

`backend/app/data/openings/*.tsv`는 [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)(CC0)의 ECO·이름·수순 목록이다. `analysis/openings.py`의 `OpeningBook`이 서버 시작 시 각 수순의 최종 포지션을 포지션 키로 색인한다(약 3,900개, 1초). 포지션으로 찾으므로 트랜스포지션도 인식한다. `GET /api/openings/classify?fen=<시작 FEN>&moves=<uci>...`는 라인에서 마지막으로 지나간 이론 포지션의 오프닝, 현재 포지션이 이론인지(`in_book`), 이탈 후 둔 수, 이론으로 이어지는 다음 수(`continuations`)를 돌려준다. 프론트엔드는 오른쪽 사이드바 맨 위 `OpeningPanel`과 통계 표의 "이론" 표시로 보여준다.

### 포지션 수순 통계

수집할 때 각 대국의 모든 수를 `PositionMove`(수를 두기 전 포지션 키 + 둔 수)로 색인해 둔다. 포지션 키는 FEN에서 수 카운터를 뺀 앞 4필드(앙파상은 실제로 가능할 때만)라서 트랜스포지션은 같은 포지션으로 합쳐진다. `GET /api/stats/position-moves`는 포지션(FEN 또는 PGN)에서 플레이어 본인이 둔 수(`player`)와 상대들이 둔 수(`opponent`)를 승/무/패(플레이어 기준)와 함께 돌려준다. 필터: `time_class`(여러 번 가능), `color`, `since`/`until`(대국이 끝난 시각, ISO 8601·시간대 포함, until 미포함). 프론트엔드는 통계 패널 상단의 "내 진영"(기본 백)을 보드 아래쪽 진영이자 `color` 필터로 쓰고, 현재 차례가 내 진영이면 "내가 둔 수", 아니면 "상대들이 둔 수" 탭을 연다(내 진영 대국만 세므로 다른 탭은 항상 비어 있어 비활성화한다). 기간 필터(`PeriodFilter`)는 전체 기간 또는 현지 날짜 기준 시작일~종료일(양 끝 포함)을 고르고 이를 since/until로 바꿔 보낸다. 프론트엔드는 이를 빈도에 비례한 두께, 엔진 판정에 따른 색(최선·좋음 초록, 부정확·실수 노랑, 블런더 빨강, 평가 전 회색, `lib/eval.ts`의 `moveColor`)의 SVG 화살표로 보드 위에 그린다. 엔진 최선 수는 보라색 점선이다(`components/MoveArrows.tsx`, react-chessboard 기본 화살표는 화살표별 두께를 지원하지 않음).

### 데이터 흐름

1. **수집(Import)**: 사용자가 플랫폼과 아이디를 입력하면 백엔드가 `importers/`의 해당 수집기로 대국을 가져온다. 각 수집기는 플랫폼 응답을 **공통 `Game` 모델**(플랫폼, 외부 ID, 백/흑 플레이어, 레이팅, 시간 규칙, 결과, 날짜, PGN)로 바꿔 DB에 저장한다. 외부 ID로 중복 저장을 막는다. 이 단계 뒤로는 어느 플랫폼에서 온 대국인지 신경 쓰지 않는다.
2. **파싱**: PGN은 `python-chess`로 파싱해 수 단위 데이터(ply, SAN/UCI, 수를 둔 뒤의 FEN, 남은 시간)를 만든다. 오프닝은 ECO 코드와 이름으로 분류한다.
3. **엔진 분석**: `analysis/engine.py`가 `python-chess`의 `chess.engine`(UCI)으로 Stockfish를 실행해 각 수의 평가값(centipawn/mate), 최선의 수, 평가 손실을 계산하고, 이를 기준으로 Inaccuracy/Mistake/Blunder를 분류한다. 분석은 오래 걸리므로 HTTP 요청 안에서 동기로 실행하지 않는다. 백그라운드 작업으로 돌리고 프론트엔드는 작업 상태를 폴링하거나 WebSocket으로 진행률을 받는다. 결과는 DB에 캐시해 같은 대국을 다시 분석하지 않는다.
4. **통계**: `analysis/stats.py`가 저장된 대국과 분석 결과를 모아 오프닝별 승률, 시간 규칙별 성적, 평균 정확도, 자주 하는 실수 패턴 등을 계산한다.
5. **표시**: React 프론트엔드가 REST API로 데이터를 받아 대국 복기 화면(보드 + 수순 목록 + 평가 그래프 + 엔진 추천 수)과 통계 대시보드를 그린다. 보드 상태 계산과 합법 수 검증은 `chess.js`, 보드 렌더링은 `react-chessboard`를 사용한다.

### 설계 원칙

- 외부 플랫폼 API는 백엔드에서만 호출한다. 프론트엔드는 백엔드 API만 호출한다(CORS 회피, 레이트 리밋과 캐싱을 한곳에서 관리).
- 새 플랫폼을 추가할 때는 `importers/`에 수집기를 하나 추가하고 공통 `Game` 모델로 바꿔 주기만 하면 된다. 분석·통계 코드는 수정하지 않는다.
- Stockfish 실행 파일 경로, DB URL, User-Agent 연락처는 환경 변수로 설정한다.
- 테스트에서는 외부 API 응답을 저장해 둔 fixture(PGN/JSON)로 대체하고, 실제 네트워크를 호출하지 않는다.
