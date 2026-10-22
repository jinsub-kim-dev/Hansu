# 묘수 백엔드 (FastAPI + Stockfish). Render 등 Docker 호스팅용.
# DB는 외부(Supabase Postgres)를 DATABASE_URL로 쓰므로 컨테이너에는 상태를 두지 않는다.
FROM python:3.13-slim

# Debian의 stockfish 패키지는 /usr/games/stockfish에 설치된다.
RUN apt-get update \
    && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

# 의존성 먼저 설치해 코드만 바뀌었을 때 이 단계를 캐시로 건너뛴다.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app

# 무료 인스턴스(메모리 512MB, CPU 적음)에 맞춘 엔진 기본값. 배포 환경 변수로 바꿀 수 있다.
ENV PATH="/app/.venv/bin:$PATH" \
    STOCKFISH_PATH=/usr/games/stockfish \
    ENGINE_THREADS=1 \
    ENGINE_HASH_MB=32 \
    ENGINE_DEPTH=16

EXPOSE 8000
# Render는 PORT를 정해 준다. 앞단(Vercel, Render) 프록시의 X-Forwarded-* 헤더를 믿는다.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
