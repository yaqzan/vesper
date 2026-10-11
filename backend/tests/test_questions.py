"""Memoir-questions endpoints against a throwaway vault.

    py -3.11 -m pytest backend/tests -q
"""
import importlib
import json
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture()
def vault(tmp_path, monkeypatch):
    monkeypatch.setenv("VAULT_RECORDINGS_DIR", str(tmp_path))
    monkeypatch.setenv("RATE_LIMIT_API_PER_MIN", "0")
    monkeypatch.setenv("RATE_LIMIT_TRANSCRIBE_PER_MIN", "0")
    sys.path.insert(0, str(BACKEND))
    main = importlib.reload(importlib.import_module("main"))
    day = tmp_path / "2026-10-09"
    day.mkdir()
    (day / "questions.json").write_text(json.dumps({
        "date": "2026-10-09", "status": "open",
        "questions": [
            {"id": "q1", "topic": "who", "quote": "sam came by", "question": "Who is Sam?",
             "guess": "Samir", "blocking": True, "answer": None},
            {"id": "q2", "topic": "what", "quote": "the thing", "question": "What thing?",
             "guess": None, "blocking": True, "answer": None},
        ]}), encoding="utf-8")
    (tmp_path / "2026-10-01").mkdir()
    (tmp_path / "2026-10-01" / "questions.json").write_text(
        json.dumps({"date": "2026-10-01", "status": "resolved", "questions": []}), encoding="utf-8")
    return main, tmp_path, TestClient(main.app)


def test_lists_only_unresolved_days(vault):
    _, _, client = vault
    days = client.get("/api/questions").json()
    assert [d["date"] for d in days] == ["2026-10-09"]
    assert [q["id"] for q in days[0]["questions"]] == ["q1", "q2"]


def test_text_and_guess_answers_are_written_to_the_vault(vault):
    _, root, client = vault
    assert client.post("/api/questions/2026-10-09/q1/answer", json={"accept_guess": True}).status_code == 200
    r = client.post("/api/questions/2026-10-09/q2/answer", json={"text": " the new desk "})
    assert r.json()["questions"][1]["answer"]["text"] == "the new desk"
    saved = json.loads((root / "2026-10-09" / "questions.json").read_text(encoding="utf-8"))
    assert saved["questions"][0]["answer"]["via"] == "guess"
    assert saved["questions"][1]["answer"]["text"] == "the new desk"
    assert saved["questions"][0]["question"] == "Who is Sam?"  # questions themselves untouched
    assert client.delete("/api/questions/2026-10-09/q2/answer").json()["questions"][1]["answer"] is None


def test_voice_answer_waits_for_the_worker_then_shows_its_text(vault):
    main, root, client = vault
    r = client.post("/api/questions/2026-10-09/q2/voice",
                    files={"audio": ("a.webm", b"fake-audio", "audio/webm")})
    assert r.json()["questions"][1]["answer"] == {"via": "voice", "text": None, "pending": True}
    assert (root / "2026-10-09" / "answers" / "q2.webm").exists()
    assert main.pending_voice_answers() == 1
    (root / "2026-10-09" / "answers" / "q2.txt").write_text("It was the desk.", encoding="utf-8")
    assert main.pending_voice_answers() == 0
    q2 = client.get("/api/questions").json()[0]["questions"][1]
    assert q2["answer"] == {"via": "voice", "text": "It was the desk.", "pending": False}


def test_rejects_bad_ids_and_resolved_days(vault):
    _, _, client = vault
    assert client.post("/api/questions/2026-10-09/..%2Fx/answer", json={"text": "x"}).status_code != 200
    assert client.post("/api/questions/2026-10-09/q.1/answer", json={"text": "x"}).status_code == 400
    assert client.post("/api/questions/not-a-date/q1/answer", json={"text": "x"}).status_code == 400
    assert client.post("/api/questions/2026-10-01/q1/answer", json={"text": "x"}).status_code == 409
    assert client.post("/api/questions/2026-10-09/q1/answer", json={"text": "  "}).status_code == 400
