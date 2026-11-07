"""Conservative workload smoothing and gradual experience adaptation."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class AdaptationState:
    difficulty_level: int = 1
    difficulty: str = "balanced"
    last_adaptation: str = "No adaptation yet"
    hint_available: bool = False
    time_pressure: str = "unchanged"
    accepted_class: str | None = None
    consistent_predictions: int = 0

    def as_dict(self) -> dict:
        return asdict(self)


class AdaptiveEngine:
    """Require repeated confident predictions and cooldown before changing pace."""

    def __init__(
        self,
        *,
        min_confidence: float = 0.65,
        consistent_count: int = 3,
        cooldown_seconds: float = 30.0,
    ):
        if not 0 <= min_confidence <= 1:
            raise ValueError("min_confidence must be between 0 and 1.")
        if consistent_count < 1 or cooldown_seconds < 0:
            raise ValueError("consistent_count must be positive and cooldown non-negative.")
        self.min_confidence = min_confidence
        self.consistent_count = consistent_count
        self.cooldown_seconds = cooldown_seconds
        self._candidate: str | None = None
        self._streak = 0
        self._last_change_at = float("-inf")
        self.state = AdaptationState()

    def update(self, workload_class: str, confidence: float, timestamp: float) -> AdaptationState:
        if workload_class not in {"low", "moderate", "high"}:
            raise ValueError(f"Unsupported workload class: {workload_class}")
        if not 0 <= confidence <= 1:
            raise ValueError("confidence must be between 0 and 1.")
        if confidence < self.min_confidence:
            self._candidate = None
            self._streak = 0
            self.state = AdaptationState(
                **{
                    **self.state.as_dict(),
                    "consistent_predictions": 0,
                }
            )
            return self.state
        if workload_class == self._candidate:
            self._streak += 1
        else:
            self._candidate = workload_class
            self._streak = 1
        self.state = AdaptationState(
            **{
                **self.state.as_dict(),
                "consistent_predictions": self._streak,
            }
        )
        if self._streak < self.consistent_count:
            return self.state
        if workload_class == self.state.accepted_class:
            return self.state
        if timestamp - self._last_change_at < self.cooldown_seconds:
            return self.state

        level = self.state.difficulty_level
        hint = False
        pressure = "unchanged"
        if workload_class == "low":
            level = min(2, level + 1)
            action = "Gradually increased optional challenge"
        elif workload_class == "high":
            level = max(0, level - 1)
            hint = True
            pressure = "reduced"
            action = "Reduced pace and made guidance available"
        else:
            action = "Maintained the current experience pace"
        labels = {0: "supportive", 1: "balanced", 2: "challenging"}
        self._last_change_at = timestamp
        self.state = AdaptationState(
            difficulty_level=level,
            difficulty=labels[level],
            last_adaptation=action,
            hint_available=hint,
            time_pressure=pressure,
            accepted_class=workload_class,
            consistent_predictions=self._streak,
        )
        return self.state
