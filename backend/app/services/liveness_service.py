import base64
import hashlib
import hmac
import json
import os
import time
from typing import Dict, Optional, Tuple


class LivenessService:
    def __init__(self, secret_key: str):
        self.secret_key = secret_key.encode("utf-8")
        self._used_session_ids = set()
        self._recent_sessions: Dict[str, Dict[str, int]] = {}

    def _b64url_encode(self, data: bytes) -> str:
        return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")

    def _b64url_decode(self, data: str) -> bytes:
        padding = "=" * (-len(data) % 4)
        return base64.urlsafe_b64decode(data + padding)

    def _sign(self, payload_b64: str) -> str:
        digest = hmac.new(self.secret_key, payload_b64.encode("utf-8"), hashlib.sha256).digest()
        return self._b64url_encode(digest)

    def create_liveness_token(self, voter_id: str, purpose: str, ttl_seconds: int = 180) -> str:
        now = int(time.time())
        payload = {
            "sid": self._b64url_encode(os.urandom(18)),
            "voter_id": voter_id.strip().lower(),
            "purpose": purpose,
            "iat": now,
            "exp": now + ttl_seconds,
        }
        payload_b64 = self._b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        signature = self._sign(payload_b64)
        return f"{payload_b64}.{signature}"

    def verify_liveness_token(
        self,
        token: str,
        voter_id: str,
        purpose: str,
        consume: bool = False,
    ) -> Tuple[bool, str, Optional[dict]]:
        try:
            payload_b64, signature = token.split(".", 1)
        except ValueError:
            return False, "Malformed liveness token", None

        expected = self._sign(payload_b64)
        if not hmac.compare_digest(signature, expected):
            return False, "Invalid liveness token signature", None

        try:
            payload = json.loads(self._b64url_decode(payload_b64).decode("utf-8"))
        except Exception:
            return False, "Invalid liveness token payload", None

        now = int(time.time())
        sid = payload.get("sid")
        if not sid:
            return False, "Invalid liveness token session", None

        if int(payload.get("exp", 0)) < now:
            return False, "Liveness token expired. Please blink-verify again.", None

        if payload.get("voter_id") != voter_id.strip().lower():
            return False, "Liveness token does not match voter ID", None

        if payload.get("purpose") != purpose:
            return False, "Liveness token purpose mismatch", None

        if sid in self._used_session_ids:
            return False, "Liveness token already used. Please blink-verify again.", None

        if consume:
            self._used_session_ids.add(sid)

        return True, "OK", payload

    def mark_recent_session(self, voter_id: str, purpose: str, ttl_seconds: int = 300) -> None:
        now = int(time.time())
        voter_key = voter_id.strip().lower()
        if voter_key not in self._recent_sessions:
            self._recent_sessions[voter_key] = {}
        self._recent_sessions[voter_key][purpose] = now + ttl_seconds

    def has_recent_session(self, voter_id: str, purpose: str) -> bool:
        now = int(time.time())
        voter_key = voter_id.strip().lower()
        expiry = self._recent_sessions.get(voter_key, {}).get(purpose)
        return bool(expiry and expiry >= now)

    def consume_recent_session(self, voter_id: str, purpose: str) -> None:
        voter_key = voter_id.strip().lower()
        if voter_key in self._recent_sessions:
            self._recent_sessions[voter_key].pop(purpose, None)


liveness_service: Optional[LivenessService] = None


def get_liveness_service(secret_key: str) -> LivenessService:
    global liveness_service
    if liveness_service is None:
        liveness_service = LivenessService(secret_key)
    return liveness_service
