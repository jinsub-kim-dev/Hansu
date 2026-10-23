"""복기 노트: 사용자가 보관한 포지션과 날짜별 메모. 로그인한 사용자 본인의 것만 다룬다."""

from datetime import UTC, datetime

import chess
from fastapi import APIRouter, Depends, Response, status
from sqlmodel import Session, col, func, select

from app.analysis.positions import board_from_input, position_key
from app.auth.access import current_user_id
from app.db import get_session
from app.i18n import AppError
from app.models.db import ReviewNote, ReviewPosition
from app.models.schemas import ReviewIn, ReviewNoteIn, ReviewNoteOut, ReviewOut, ReviewPatch

router = APIRouter(prefix="/reviews", tags=["reviews"])

MAX_REVIEWS = 2000  # 사용자당
MAX_LINE = 600  # 수순 길이 (ply)
MAX_TAGS = 10
MAX_TAG_LEN = 20
MAX_NOTE_LEN = 4000
MAX_URL_LEN = 500


def require_user(user_id: int | None = Depends(current_user_id)) -> int:
    if user_id is None:
        raise AppError("login_required", status_code=401)
    return user_id


def _utc(dt: datetime | None) -> datetime | None:
    """SQLite는 시간대를 지우므로 UTC로 되돌린다."""
    return dt.replace(tzinfo=UTC) if dt is not None and dt.tzinfo is None else dt


def _out(review: ReviewPosition, notes: list[ReviewNote]) -> ReviewOut:
    return ReviewOut(
        id=review.id,
        start_fen=review.start_fen,
        moves=review.moves.split(),
        fen=review.fen,
        color=review.color,
        my_move=review.my_move,
        my_idea=review.my_idea,
        best_move=review.best_move,
        classification=review.classification,
        tags=review.tags or [],
        source_url=review.source_url,
        game_date=review.game_date,
        reviewed_at=_utc(review.reviewed_at),
        created_at=_utc(review.created_at),
        updated_at=_utc(review.updated_at),
        notes=[ReviewNoteOut(id=n.id, body=n.body, created_at=_utc(n.created_at)) for n in notes],
    )


def _notes(session: Session, review_ids: list[int]) -> dict[int, list[ReviewNote]]:
    out: dict[int, list[ReviewNote]] = {i: [] for i in review_ids}
    if review_ids:
        rows = session.exec(
            select(ReviewNote).where(col(ReviewNote.review_id).in_(review_ids)).order_by(ReviewNote.id)
        ).all()
        for n in rows:
            out[n.review_id].append(n)
    return out


def _get(session: Session, user_id: int, review_id: int) -> ReviewPosition:
    review = session.get(ReviewPosition, review_id)
    if review is None or review.user_id != user_id:  # 남의 노트는 있는지도 알리지 않는다
        raise AppError("review_not_found", status_code=404)
    return review


def _replay(start_fen: str, moves: list[str]) -> chess.Board:
    """시작 포지션에서 수순을 두어 도착한 보드. 둘 수 없는 수가 있으면 오류."""
    if len(moves) > MAX_LINE:
        raise AppError("too_many_moves", max=MAX_LINE)
    board = board_from_input(fen=start_fen)
    for uci in moves:
        _push_check(board, uci)
        board.push_uci(uci)
    return board


def _push_check(board: chess.Board, uci: str) -> None:
    try:
        ok = chess.Move.from_uci(uci) in board.legal_moves
    except ValueError:
        ok = False
    if not ok:
        raise AppError("illegal_move", uci=uci)


def _move(board: chess.Board, uci: str | None) -> str | None:
    """이 포지션에서 둘 수 있는 수인지 확인한다. 비어 있으면 None."""
    if not uci:
        return None
    _push_check(board, uci)
    return uci


def _tags(tags: list[str]) -> list[str]:
    cleaned = list(dict.fromkeys(t.strip() for t in tags if t.strip()))
    if len(cleaned) > MAX_TAGS:
        raise AppError("too_many_tags", max=MAX_TAGS)
    if any(len(t) > MAX_TAG_LEN for t in cleaned):
        raise AppError("tag_too_long", max=MAX_TAG_LEN)
    return cleaned


def _url(url: str | None) -> str | None:
    url = (url or "").strip()
    if not url:
        return None
    if len(url) > MAX_URL_LEN or not url.lower().startswith(("http://", "https://")):
        raise AppError("invalid_url")
    return url


def _note_body(body: str) -> str:
    body = body.strip()
    if not body:
        raise AppError("note_empty")
    if len(body) > MAX_NOTE_LEN:
        raise AppError("note_too_long", max=MAX_NOTE_LEN)
    return body


@router.get("", response_model=list[ReviewOut])
def list_reviews(session: Session = Depends(get_session), user_id: int = Depends(require_user)):
    """내 복기 노트 (최근에 바꾼 순)."""
    reviews = session.exec(
        select(ReviewPosition)
        .where(ReviewPosition.user_id == user_id)
        .order_by(col(ReviewPosition.updated_at).desc())
    ).all()
    notes = _notes(session, [r.id for r in reviews])
    return [_out(r, notes[r.id]) for r in reviews]


@router.get("/lookup", response_model=ReviewOut | None)
def lookup_review(fen: str, session: Session = Depends(get_session), user_id: int = Depends(require_user)):
    """이 포지션을 보관했으면 그 노트, 아니면 null. 수순이 달라도 같은 포지션이면 찾는다."""
    key = position_key(board_from_input(fen=fen))
    review = session.exec(
        select(ReviewPosition).where(ReviewPosition.user_id == user_id, ReviewPosition.position_key == key)
    ).first()
    return _out(review, _notes(session, [review.id])[review.id]) if review else None


@router.post("", response_model=ReviewOut, status_code=status.HTTP_201_CREATED)
def create_review(
    body: ReviewIn,
    response: Response,
    session: Session = Depends(get_session),
    user_id: int = Depends(require_user),
):
    """포지션을 보관한다. 이미 보관한 포지션이면 그 노트를 그대로 돌려준다(200)."""
    board = _replay(body.start_fen, body.moves)
    key = position_key(board)
    existing = session.exec(
        select(ReviewPosition).where(ReviewPosition.user_id == user_id, ReviewPosition.position_key == key)
    ).first()
    if existing:
        response.status_code = status.HTTP_200_OK
        return _out(existing, _notes(session, [existing.id])[existing.id])
    count = session.exec(select(func.count()).where(ReviewPosition.user_id == user_id)).one()
    if count >= MAX_REVIEWS:
        raise AppError("review_limit", max=MAX_REVIEWS)

    review = ReviewPosition(
        user_id=user_id,
        start_fen=board_from_input(fen=body.start_fen).fen(),
        moves=" ".join(body.moves),
        fen=board.fen(),
        position_key=key,
        color=body.color,
        my_move=_move(board, body.my_move),
        my_idea=_move(board, body.my_idea),
        best_move=_move(board, body.best_move),
        classification=body.classification,
        tags=_tags(body.tags),
        source_url=_url(body.source_url),
        game_date=body.game_date,
    )
    session.add(review)
    session.flush()
    notes = []
    if body.note and body.note.strip():
        notes.append(ReviewNote(review_id=review.id, body=_note_body(body.note)))
        session.add(notes[0])
    session.commit()
    return _out(review, notes)


@router.get("/{review_id}", response_model=ReviewOut)
def get_review(review_id: int, session: Session = Depends(get_session), user_id: int = Depends(require_user)):
    review = _get(session, user_id, review_id)
    return _out(review, _notes(session, [review.id])[review.id])


@router.patch("/{review_id}", response_model=ReviewOut)
def update_review(
    review_id: int,
    body: ReviewPatch,
    session: Session = Depends(get_session),
    user_id: int = Depends(require_user),
):
    review = _get(session, user_id, review_id)
    board = chess.Board(review.fen)
    sent = body.model_fields_set
    if "color" in sent and body.color:
        review.color = body.color
    for name in ("my_move", "my_idea", "best_move"):
        if name in sent:
            setattr(review, name, _move(board, getattr(body, name)))
    if "classification" in sent:
        review.classification = body.classification
    if "tags" in sent:
        review.tags = _tags(body.tags or [])
    if "source_url" in sent:
        review.source_url = _url(body.source_url)
    if "game_date" in sent:
        review.game_date = body.game_date
    if "reviewed" in sent:
        review.reviewed_at = datetime.now(UTC) if body.reviewed else None
    review.updated_at = datetime.now(UTC)
    session.add(review)
    session.commit()
    return _out(review, _notes(session, [review.id])[review.id])


@router.delete("/{review_id}")
def delete_review(review_id: int, session: Session = Depends(get_session), user_id: int = Depends(require_user)):
    review = _get(session, user_id, review_id)
    for note in _notes(session, [review.id])[review.id]:
        session.delete(note)
    session.delete(review)
    session.commit()
    return {"ok": True}


@router.post("/{review_id}/notes", response_model=ReviewOut, status_code=status.HTTP_201_CREATED)
def add_note(
    review_id: int,
    body: ReviewNoteIn,
    session: Session = Depends(get_session),
    user_id: int = Depends(require_user),
):
    """메모를 하나 더 남긴다. 노트 전체를 돌려준다."""
    review = _get(session, user_id, review_id)
    session.add(ReviewNote(review_id=review.id, body=_note_body(body.body)))
    review.updated_at = datetime.now(UTC)
    session.add(review)
    session.commit()
    return _out(review, _notes(session, [review.id])[review.id])


@router.delete("/{review_id}/notes/{note_id}", response_model=ReviewOut)
def delete_note(
    review_id: int,
    note_id: int,
    session: Session = Depends(get_session),
    user_id: int = Depends(require_user),
):
    review = _get(session, user_id, review_id)
    note = session.get(ReviewNote, note_id)
    if note is None or note.review_id != review.id:
        raise AppError("review_not_found", status_code=404)
    session.delete(note)
    session.commit()
    return _out(review, _notes(session, [review.id])[review.id])
