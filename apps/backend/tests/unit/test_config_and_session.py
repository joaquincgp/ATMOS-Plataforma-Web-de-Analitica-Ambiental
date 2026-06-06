from app.core.config import Settings
from app.db import session as db_session


def test_settings_parse_cors_origins_from_comma_separated_string() -> None:
    assert Settings.parse_cors_origins(" http://a.test, http://b.test ,, ") == [
        "http://a.test",
        "http://b.test",
    ]


def test_settings_parse_cors_origins_preserves_existing_list() -> None:
    origins = ["http://localhost:5173"]

    assert Settings.parse_cors_origins(origins) is origins


def test_get_db_closes_session(monkeypatch) -> None:
    closed = False

    class FakeSession:
        def close(self) -> None:
            nonlocal closed
            closed = True

    fake_session = FakeSession()
    monkeypatch.setattr(db_session, "SessionLocal", lambda: fake_session)

    generator = db_session.get_db()
    assert next(generator) is fake_session

    try:
        next(generator)
    except StopIteration:
        pass

    assert closed is True
