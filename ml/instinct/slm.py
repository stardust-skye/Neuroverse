"""On-device small language model: reaction event + on-screen text -> question + rewrite request.

EEG says *that* and *where* the wearer reacted, never *why*. The SLM proposes a likely
reason from the text and phrases it as a question; the wearer confirms with a nod.
Runs locally through Ollama; falls back to rules when Ollama is unavailable.
"""

from __future__ import annotations

import json
import os
import re

import httpx

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
SLM_MODEL = os.environ.get("INSTINCT_SLM_MODEL", "llama3.2:3b")
CATEGORIES = ("recipient_name", "tone_aggressive", "tone_formal", "factual", "other")

_AGGRESSIVE = re.compile(r"\b(demand|immediately|unacceptable|ridiculous|must|right now|or else)\b", re.I)
_FORMAL = re.compile(r"\b(pursuant|hereby|kindly|i hope this (email|message) finds you well|esteemed)\b", re.I)
_GREETING = re.compile(r"^\s*(dear|hi|hello|hey)\s+([A-Z][a-z]+)", re.I)


def guess_category(chunk: str, request: str) -> str:
    greeting = _GREETING.match(chunk)
    if greeting and greeting.group(2).lower() not in request.lower():
        return "recipient_name"
    if _AGGRESSIVE.search(chunk):
        return "tone_aggressive"
    if _FORMAL.search(chunk):
        return "tone_formal"
    if re.search(r"\d", chunk):
        return "factual"
    return "other"


QUESTIONS = {
    "recipient_name": "wrong name?",
    "tone_aggressive": "too aggressive?",
    "tone_formal": "too stiff?",
    "factual": "that detail looks wrong?",
    "other": "something off here?",
}


def template(chunk: str, request: str, reading: dict) -> dict:
    category = guess_category(chunk, request)
    return {
        "category": category,
        "question": f"You reacted to “{chunk.strip()}” — {QUESTIONS[category]} Nod to fix, shake to keep.",
        "request": (f"The user had an involuntary negative reaction (score {reading.get('score', 0):.2f}) "
                    f"to the phrase “{chunk.strip()}”. Likely issue: {category.replace('_', ' ')}. "
                    "Rewrite only that phrase."),
        "engine": "rules",
    }


def interpret(chunk: str, draft: str, request: str, reading: dict) -> dict:
    fallback = template(chunk, request, reading)
    known = fallback["category"] if fallback["category"] != "other" else None
    task = (f"The likely issue was already determined by a check: {known.replace('_', ' ')}. Do not change it. "
            if known else
            f"Infer the most likely issue from the text only; category must be one of {', '.join(CATEGORIES)}. ")
    prompt = (
        "You run on an EEG headset. The wearer just had an involuntary negative brain/frown reaction "
        "while reading one phrase of an AI-written draft. EEG cannot say why. "
        f"User's original request: {request}\nFull draft: {draft}\nPhrase they reacted to: {chunk}\n"
        + task +
        "Reply as JSON with keys: category, question (a yes/no question of max 6 words about that issue, ends with ?), "
        "request (one sentence telling a writing assistant how to rewrite only that phrase)."
    )
    try:
        response = httpx.post(f"{OLLAMA_URL}/api/chat", timeout=8.0, json={
            "model": SLM_MODEL, "stream": False, "format": "json", "options": {"temperature": 0.2},
            "messages": [{"role": "user", "content": prompt}],
        })
        response.raise_for_status()
        data = json.loads(response.json()["message"]["content"])
        category = known or (data.get("category") if data.get("category") in CATEGORIES else "other")
        # Known issue types get fixed, stage-safe wording; the SLM phrases only ambiguous cases.
        question = QUESTIONS[category] if known else str(data.get("question") or QUESTIONS[category]).strip()
        return {
            "category": category,
            "question": f"You reacted to “{chunk.strip()}” — {question} Nod to fix, shake to keep.",
            "request": str(data.get("request") or fallback["request"]).strip(),
            "engine": f"ollama:{SLM_MODEL}",
        }
    except Exception:
        return fallback


def status() -> dict:
    try:
        tags = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=1.5).json()
        names = [m["name"] for m in tags.get("models", [])]
        return {"available": SLM_MODEL in names or any(n.startswith(SLM_MODEL) for n in names),
                "model": SLM_MODEL, "installed": names}
    except Exception:
        return {"available": False, "model": SLM_MODEL, "installed": []}
