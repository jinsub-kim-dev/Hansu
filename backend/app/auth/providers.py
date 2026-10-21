"""플랫폼 OAuth 제공자. Authorization Code + PKCE(S256)로 사용자 본인 확인만 한다.

토큰은 아이디 확인에만 쓰고 저장하지 않는다(리체스는 확인 직후 토큰을 폐기한다).
대국 데이터는 계속 공개 API로 가져온다.
"""

import base64
import hashlib
import secrets
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlencode

import httpx

from app.i18n import AppError


class OAuthError(AppError):
    """사용자에게 보여줄 수 있는 로그인 오류."""


@dataclass(frozen=True)
class Identity:
    username: str  # 소문자
    display_name: str


def new_pkce() -> tuple[str, str]:
    """(code_verifier, code_challenge[S256])."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


class OAuthProvider(Protocol):
    platform: str
    label: str

    @property
    def enabled(self) -> bool: ...
    def authorize_url(self, state: str, challenge: str, redirect_uri: str) -> str: ...
    def identify(self, code: str, verifier: str, redirect_uri: str) -> Identity: ...


class LichessOAuth:
    platform = "lichess"
    label = "리체스"
    BASE = "https://lichess.org"

    def __init__(self, http: httpx.Client, client_id: str):
        self.http = http
        self.client_id = client_id

    @property
    def enabled(self) -> bool:
        return True

    def authorize_url(self, state: str, challenge: str, redirect_uri: str) -> str:
        # scope 없이 요청하면 공개 계정 정보만 읽을 수 있다(아이디 확인에 충분).
        params = {
            "response_type": "code",
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "code_challenge_method": "S256",
            "code_challenge": challenge,
            "state": state,
        }
        return f"{self.BASE}/oauth?{urlencode(params)}"

    def identify(self, code: str, verifier: str, redirect_uri: str) -> Identity:
        resp = self.http.post(
            f"{self.BASE}/api/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": verifier,
                "redirect_uri": redirect_uri,
                "client_id": self.client_id,
            },
        )
        if resp.status_code != 200:
            raise OAuthError("login_verify_failed", platform=self.platform)
        token = resp.json()["access_token"]
        auth = {"Authorization": f"Bearer {token}"}
        try:
            account = self.http.get(f"{self.BASE}/api/account", headers=auth)
            if account.status_code != 200:
                raise OAuthError("account_info_failed", platform=self.platform)
            data = account.json()
        finally:
            # 아이디만 확인하면 되므로 토큰은 바로 폐기한다.
            try:
                self.http.delete(f"{self.BASE}/api/token", headers=auth)
            except httpx.HTTPError:
                pass
        return Identity(username=data["id"].lower(), display_name=data.get("username") or data["id"])


class ChessComOAuth:
    """체스닷컴 OAuth. 승인을 받아 CHESSCOM_CLIENT_ID/SECRET을 설정하기 전까지는 꺼져 있다.

    승인 후 받는 문서의 엔드포인트와 ID 토큰 검증(JWKS)을 채워 넣어야 한다.
    """

    platform = "chesscom"
    label = "체스닷컴"

    def __init__(self, http: httpx.Client, client_id: str, client_secret: str):
        self.http = http
        self.client_id = client_id
        self.client_secret = client_secret

    @property
    def enabled(self) -> bool:
        return False  # TODO: 승인 후 엔드포인트와 토큰 검증을 구현하고 켠다.

    def authorize_url(self, state: str, challenge: str, redirect_uri: str) -> str:
        raise OAuthError("provider_not_ready", platform=self.platform)

    def identify(self, code: str, verifier: str, redirect_uri: str) -> Identity:
        raise OAuthError("provider_not_ready", platform=self.platform)
