"""Cloud writing model (ChatGPT via the OpenAI API). Only text ever reaches it, never EEG.

Demo mode plants up to two known errors at chunk starts (a wrong recipient name and one
confrontational sentence) so the live reaction is strong and time-locked. Categories the
wearer has already taught the system are not planted again, which shows learning.
"""

from __future__ import annotations

import json
import os
import re

from ml.instinct.memory import PREFERENCE_TEXT

PREFERRED_MODELS = ("gpt-5-nano", "gpt-5-mini", "gpt-4.1-nano", "gpt-4.1-mini", "gpt-4o-mini")
WRONG_NAMES = ("Kevin", "Mark", "Linda")
AGGRESSIVE = "I demand this is dealt with immediately."
_GREETING = re.compile(r"^(\s*(?:Dear|Hi|Hello|Hey)\s+)([A-Z][a-z]+)(.*)$")

_client = None
_model: str | None = None


def _openai():
    global _client
    if _client is None:
        from openai import OpenAI
        _client = OpenAI(timeout=25.0, max_retries=1)
    return _client


def connect() -> dict:
    """Validate the server-side key and pick the model. The key never reaches the browser.

    Checks only the candidate models (listing every model takes ~20 s) and caches success.
    """
    global _model
    if _model:
        return {"connected": True, "model": _model}
    if not os.environ.get("OPENAI_API_KEY"):
        return {"connected": False, "reason": "OPENAI_API_KEY is not set on the local server."}
    wanted = os.environ.get("OPENAI_MODEL")
    last_error = None
    for candidate in ([wanted] if wanted else PREFERRED_MODELS):
        try:
            _openai().models.retrieve(candidate)
            _model = candidate
            return {"connected": True, "model": _model}
        except Exception as error:
            last_error = error
            if type(error).__name__ in ("AuthenticationError", "PermissionDeniedError", "APIConnectionError"):
                break
    return {"connected": False, "reason": f"OpenAI check failed: {type(last_error).__name__}"
            + ("" if wanted else " (set OPENAI_MODEL if your key lacks the default small models)")}


def _chat_json(system: str, user: str) -> dict:
    kwargs = dict(model=_model, response_format={"type": "json_object"},
                  messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
    if _model and (_model.startswith("gpt-5") or _model.startswith("o")):
        kwargs["reasoning_effort"] = "minimal"     # reasoning models are far too slow for a live demo otherwise
    try:
        response = _openai().chat.completions.create(**kwargs)
    except Exception:
        if "reasoning_effort" not in kwargs:
            raise
        kwargs.pop("reasoning_effort")
        response = _openai().chat.completions.create(**kwargs)
    return json.loads(response.choices[0].message.content)


def _recipient(request: str) -> str | None:
    match = re.search(r"\b(?:to|my \w+|email|message|text)\s+([A-Z][a-z]+)\b", request)
    return match.group(1) if match else None


def _offline_draft(request: str) -> list[str]:
    name = _recipient(request) or "there"
    lower = request.lower()
    if "heater" in lower or "landlord" in lower:
        body = ["I wanted to let you know", "that the heater in my flat", "stopped working on Monday.",
                "It gets quite cold at night,", "so I'd be grateful if someone", "could take a look this week.",
                "I'm happy to work around", "whatever time suits you."]
    elif "manager" in lower or "leave" in lower or "early" in lower:
        body = ["I wanted to give you a heads-up", "that I need to leave", "a little early today",
                "for a personal appointment.", "My tasks are on track,", "and I'll be reachable on my phone",
                "if anything comes up."]
    else:
        body = ["I wanted to reach out", "about " + request.rstrip(".") + ".",
                "Let me know what works best for you."]
    return [f"Dear {name},"] + body + ["Thanks so much,", "Rameez"]


def draft(request: str, preferences: list[dict], plant: bool, learned: set[str]) -> dict:
    source = "offline"
    chunks: list[str] = []
    if _model:
        try:
            prefs = "\n".join(f"- {p['text']}" for p in preferences) or "- (none yet)"
            data = _chat_json(
                "You write short, natural emails. Return JSON {\"chunks\": [...]} where the email is split into "
                "reading chunks of 3-9 words in order, each ending at a natural pause; every sentence ends with a period "
                "at the end of a chunk. The first chunk is only the greeting with the recipient's name "
                "(e.g. \"Dear Sarah,\"). Keep the whole email under 70 words. Sign off as Rameez.\n"
                f"Learned preferences of this user:\n{prefs}",
                request)
            chunks = [str(c).strip() for c in data.get("chunks", []) if str(c).strip()]
            source = f"openai:{_model}"
        except Exception:
            chunks = []
    if not chunks:
        chunks, source = _offline_draft(request), "offline"

    items = [{"text": c, "planted": None} for c in chunks]
    if plant:
        greeting = _GREETING.match(items[0]["text"])
        if greeting and "recipient_name" not in learned:
            wrong = next(n for n in WRONG_NAMES if n.lower() != greeting.group(2).lower())
            items[0] = {"text": f"{greeting.group(1)}{wrong}{greeting.group(3)}", "planted": "recipient_name"}
        if "tone_aggressive" not in learned and len(items) > 3:
            # Insert only at a sentence boundary so the planted line reads naturally.
            ends = [i + 1 for i in range(2, len(items) - 2) if re.search(r"[.!?]$", items[i]["text"])]
            items.insert(ends[0] if ends else len(items) - 1, {"text": AGGRESSIVE, "planted": "tone_aggressive"})
    return {"chunks": items, "source": source}


def _offline_rewrite(request: str, chunk: str, category: str) -> str:
    greeting = _GREETING.match(chunk)
    if category == "recipient_name" and greeting:
        return f"{greeting.group(1)}{_recipient(request) or 'there'}{greeting.group(3)}"
    if category == "tone_aggressive":
        return "Could you let me know when someone can take a look?"
    if category == "tone_formal":
        return "Hope you're doing well."
    return chunk


def rewrite(request: str, chunks: list[str], index: int, instruction: str, category: str,
            preferences: list[dict]) -> dict:
    chunk = chunks[index]
    if _model:
        try:
            prefs = "\n".join(f"- {p['text']}" for p in preferences) or "- (none yet)"
            data = _chat_json(
                "You fix one phrase of an email. Return JSON {\"text\": \"...\"} with only the replacement "
                "phrase (3-12 words) that fits grammatically between its neighbours and ends with the same punctuation as the original. Keep the user's facts.\n"
                f"Learned preferences:\n{prefs}",
                f"Original request: {request}\nEmail chunks: {json.dumps(chunks)}\n"
                f"Replace chunk #{index}: {chunk!r}\nReason from the wearer's headset: {instruction}\n"
                f"Issue category: {category}. Rule: {PREFERENCE_TEXT.get(category, PREFERENCE_TEXT['other'])}")
            text = str(data.get("text", "")).strip()
            end = re.search(r"[.!?,]$", chunk)
            if text and end and not re.search(r"[.!?,]$", text):
                text += end.group(0)          # keep the sentence boundary the reader expects
            if text:
                return {"text": text, "source": f"openai:{_model}"}
        except Exception:
            pass
    return {"text": _offline_rewrite(request, chunk, category), "source": "offline"}


def model_name() -> str | None:
    return _model
