# 묘수 (Myosu)

**Myosu** is a personal chess game-review tool. It imports your games from Chess.com and Lichess and shows, for any position, which moves *you* and *your opponents* actually played — drawn as arrows on the board, with win/draw/loss rates, Stockfish evaluations and opening names.

체스닷컴·리체스 대국 기록으로 **"이 포지션에서 나는 주로 뭘 뒀고, 상대들은 뭘 뒀는지"**를 보드 위 화살표로 보여주는 체스 복기 도구입니다.

![묘수 화면](docs/screenshot.png)

## 주요 기능

- **계정 연결로 대국 가져오기**: 리체스 계정을 OAuth 로그인으로 연결하면 내 대국을 자동으로 가져옵니다(체스닷컴은 OAuth 승인 대기 중). 본인이 연결한 계정의 대국만 볼 수 있습니다. 처음에는 최근 3년치, 이후에는 마지막 대국 이후의 새 대국만 받습니다.
- **포지션별 다음 수 통계**: 어떤 포지션이든(FEN·PGN 입력, 보드에서 직접 두기) 내가 둔 수와 상대들이 둔 수를 대국 수·비율·승무패와 함께 보여줍니다. 수순이 달라도 같은 포지션이면 합쳐서 셉니다.
- **보드 위 화살표**: 자주 둔 수일수록 굵게, 엔진 판정에 따라 초록(좋은 수)·노랑(부정확·실수)·빨강(블런더)으로 그립니다. 엔진 최선 수는 보라 점선입니다.
- **Stockfish 분석**: 평가 막대, 엔진 후보 수 3개, 통계에 나온 각 수의 평가와 판정. Lichess 클라우드 평가에 있는 포지션은 바로 보여주고, 없으면 브라우저에서 Stockfish 18(WebAssembly)로 계산합니다. 서버 사양과 상관없이 빠르고, 엔진 파일(약 7MB)은 처음 한 번만 받습니다.
- **오프닝 이름**: 현재 포지션의 ECO 코드·오프닝 이름과 이론 수를 보여줍니다.
- **필터**: 내 진영(백/흑), 기간, 시간 규칙(불렛·블리츠·래피드·클래시컬·일일).
- 키보드 수순 이동(← → Home End), 착수음, 밝은/어두운 테마.

## 구성

| | |
|---|---|
| 백엔드 | Python · FastAPI · SQLModel(SQLite) · python-chess · Stockfish |
| 프론트엔드 | React · TypeScript · Vite · chess.js · react-chessboard · Stockfish.js(WebAssembly) |

```
backend/    FastAPI 앱 (수집기, 통계, 엔진 분석, 오프닝, 로그인)
frontend/   React 앱
scripts/    개발 서버 실행 스크립트 (dev.ps1)
```

설계와 데이터 흐름은 [CLAUDE.md](CLAUDE.md)에 자세히 정리되어 있습니다.

## 실행하기

필요한 것: Python 3.12+와 [uv](https://docs.astral.sh/uv/), Node.js 20+, 화면의 엔진 분석은 브라우저에서 돌아 Stockfish를 따로 설치하지 않아도 됩니다. 백엔드 API `/api/analysis/position`만 [Stockfish](https://stockfishchess.org/)를 씁니다(없으면 그 API만 꺼집니다).

**Windows (한 번에 실행/종료)**

```
.\dev start     # 백엔드(:8000)와 프론트엔드(:5173)를 백그라운드로 실행
.\dev stop
.\dev status
.\dev logs
```

**직접 실행**

```bash
cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev      # http://localhost:5173
```

**테스트**

```bash
cd backend && uv run pytest
cd frontend && npm run typecheck
```

### 배포

| 역할 | 서비스 | 설정 |
|---|---|---|
| 화면 | Vercel | Root Directory `frontend`. `frontend/vercel.json`이 `/api/*`를 백엔드로 넘긴다 |
| 백엔드 | Render (Docker) | Root Directory `backend`, `backend/Dockerfile`(Stockfish 포함). 상태 확인 `/api/health` |
| DB | Supabase Postgres | `DATABASE_URL`에 Session pooler 주소. Data API는 끈다 |

로컬에서는 `backend/.env`(커밋하지 않음)에 `DATABASE_URL` 등을 적으면 읽는다. 없으면 SQLite(`backend/data/chess.db`)를 쓴다.

### 환경 변수 (모두 선택)

| 이름 | 설명 |
|---|---|
| `DATABASE_URL` | 기본 `backend/data/chess.db`. Postgres(`postgresql://...`)도 가능 |
| `STOCKFISH_PATH` | 비어 있으면 PATH에서 찾음 |
| `ENGINE_DEPTH` / `ENGINE_MULTIPV` / `ENGINE_THREADS` / `ENGINE_HASH_MB` | 백엔드 엔진 API 설정 (기본 18 / 3 / CPU 절반 / 128) |
| `IMPORT_HISTORY_YEARS` | 처음 가져올 기간(년), 기본 3 |
| `IMPORT_RATE_LIMIT_PER_HOUR` | IP당 시간당 새 가져오기 작업 수, 기본 20 (0이면 제한 없음) |
| `USER_AGENT_CONTACT` | 체스닷컴·리체스 API 요청에 붙일 연락처 |
| `PUBLIC_BASE_URL` | 앱 주소, OAuth 콜백에 사용. 기본 `http://localhost:5173` |
| `SECRET_KEY` | 세션 쿠키 서명 키. 없으면 `backend/data/secret_key`에 생성 |
| `LICHESS_CLIENT_ID` | 기본 `myosu` |
| `CHESSCOM_CLIENT_ID` / `CHESSCOM_CLIENT_SECRET` | 체스닷컴 OAuth 승인 후 설정 |

## 데이터 출처

- 대국 데이터: [Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api), [Lichess API](https://lichess.org/api)
- 오프닝 이름: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0) — `backend/app/data/openings/`
- 착수음: [PyChess](https://github.com/pychess/pychess) (GPL-3.0-or-later), [Lichess](https://github.com/lichess-org/lila) SFX (AGPL-3.0-or-later) — 각 폴더의 `LICENSE.txt` 참고 (`frontend/public/sounds/`)
- 기물 그림·아이콘: [react-chessboard](https://github.com/Clariity/react-chessboard)에 포함된 기물 SVG
- 엔진: [Stockfish.js](https://github.com/nmrugg/stockfish.js) 18 lite (GPL-3.0) — `frontend/public/engine/`
- 엔진 평가: [Lichess 클라우드 평가](https://lichess.org/api#tag/Analysis/operation/apiCloudEval)

## 라이선스

Copyright (C) 2026 jinsub-kim-dev

이 프로그램은 [GNU Affero General Public License v3.0](LICENSE) 이상(AGPL-3.0-or-later)으로 배포합니다. 수정한 버전을 배포하거나 네트워크 서비스로 제공할 때는 같은 라이선스로 소스 코드를 공개해야 합니다.

함께 들어 있는 제3자 자료는 각자의 라이선스를 따릅니다: Stockfish.js(GPL-3.0, `frontend/public/engine/COPYING.txt`), 착수음(GPL-3.0-or-later / AGPL-3.0-or-later, `frontend/public/sounds/*/LICENSE.txt`), 오프닝 목록(CC0, `backend/app/data/openings/SOURCE.txt`).
