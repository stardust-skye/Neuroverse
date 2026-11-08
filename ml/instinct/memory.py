"""Local store for reactions (the neural preference dataset) and learned preferences."""

from __future__ import annotations

import csv
import hashlib
import io
import re
import sqlite3
import time
from pathlib import Path

DB = Path(__file__).resolve().parent / "data" / "instinct.db"

PREFERENCE_TEXT = {
    "recipient_name": "Double-check the recipient's name; use exactly the name the user gives.",
    "tone_aggressive": "Avoid confrontational or demanding phrasing; stay warm and cooperative.",
    "tone_formal": "Avoid stiff, overly formal phrasing; keep it natural.",
    "factual": "Do not invent facts, dates, or details the user did not provide.",
    "other": "Keep wording simple and specific.",
}


class Memory:
    def __init__(self, path: Path = DB):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.executescript("""
            create table if not exists reactions (
              id integer primary key, ts real, user text, request text, chunk text,
              score real, errp real, frown real, flagged integer, decision text,
              category text, simulated integer);
            create table if not exists preferences (
              category text primary key, text text, confirmations integer, updated real);
        """)

    def add_reaction(self, user, request, chunk, reading: dict, simulated: bool) -> int:
        cur = self.db.execute(
            "insert into reactions (ts,user,request,chunk,score,errp,frown,flagged,decision,category,simulated)"
            " values (?,?,?,?,?,?,?,?,?,?,?)",
            (time.time(), user, request, chunk, reading["score"], reading["errp"], reading["frown"],
             int(reading["flagged"]), None, None, int(simulated)))
        self.db.commit()
        return int(cur.lastrowid)

    def decide(self, reaction_id: int, decision: str, category: str | None) -> None:
        self.db.execute("update reactions set decision=?, category=? where id=?", (decision, category, reaction_id))
        if decision == "accept" and category:
            self.db.execute(
                "insert into preferences values (?,?,1,?) on conflict(category) do update set"
                " confirmations=confirmations+1, updated=excluded.updated",
                (category, PREFERENCE_TEXT.get(category, PREFERENCE_TEXT["other"]), time.time()))
        self.db.commit()

    def preferences(self) -> list[dict]:
        rows = self.db.execute("select category,text,confirmations,updated from preferences order by updated desc")
        return [dict(zip(("category", "text", "confirmations", "updated"), r)) for r in rows]

    def learned_categories(self) -> set[str]:
        return {p["category"] for p in self.preferences()}

    def reactions(self, limit: int = 200) -> list[dict]:
        cols = ("id", "ts", "user", "request", "chunk", "score", "errp", "frown", "flagged",
                "decision", "category", "simulated")
        rows = self.db.execute(f"select {','.join(cols)} from reactions order by id desc limit ?", (limit,))
        return [dict(zip(cols, r)) for r in rows]

    def export_csv(self) -> str:
        """Anonymised: hashed user, capitalised names masked, no raw EEG."""
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["user_hash", "timestamp", "chunk", "reaction_score", "errp", "frown",
                         "flagged", "human_decision", "category", "simulated"])
        for r in reversed(self.reactions(10000)):
            masked = re.sub(r"\b(Dear|Hi|Hello)\s+[A-Z][a-z]+", r"\1 [NAME]", r["chunk"] or "")
            writer.writerow([hashlib.sha256((r["user"] or "").encode()).hexdigest()[:12], round(r["ts"], 1),
                             masked, r["score"], r["errp"], r["frown"], r["flagged"], r["decision"] or "",
                             r["category"] or "", r["simulated"]])
        return out.getvalue()

    def reset(self) -> None:
        self.db.executescript("delete from reactions; delete from preferences;")
        self.db.commit()
