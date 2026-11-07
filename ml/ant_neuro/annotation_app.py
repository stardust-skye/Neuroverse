"""Local Streamlit interface for reviewing ANT Neuro EEG event candidates."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from ml.ant_neuro.annotation_storage import (
    ANNOTATION_COLUMNS,
    load_review_state,
    save_annotations,
)
from ml.ant_neuro.signals import (
    ANNOTATION_LABELS,
    REPOSITORY_ROOT,
    detect_candidates,
    filtered_data,
    read_ant_recording,
    recording_paths,
)

ANNOTATION_DIR = REPOSITORY_ROOT / "ml" / "ant_neuro" / "annotations"
ANNOTATION_FILE = ANNOTATION_DIR / "gesture_annotations.csv"
REVIEW_FILE = ANNOTATION_DIR / "candidate_reviews.json"
SESSION_HINTS = {
    "15-25": "normal blink session",
    "15-36": "left and right wink session",
    "15-38": "jaw clench session",
}

st.set_page_config(page_title="ANT Neuro EEG Annotation", layout="wide")
st.title("ANT Neuro gesture annotation")
st.caption(
    "Signal excursions are review candidates, not gesture labels. "
    "No model is trained by this tool."
)


@st.cache_resource
def load_recording(path: str):
    return read_ant_recording(Path(path))


def review_events(state: dict, filename: str, candidates: list[dict]) -> list[dict]:
    recordings = state["recordings"]
    previous = recordings.get(filename, [])
    previous_by_id = {event["event_id"]: event for event in previous}
    events = []
    for candidate in candidates:
        saved = previous_by_id.get(candidate["event_id"], {})
        events.append({
            **candidate,
            "status": saved.get("status", "pending"),
            "label": saved.get("label", "UNKNOWN"),
            "review_start_seconds": saved.get(
                "review_start_seconds", candidate["start_seconds"]
            ),
            "review_end_seconds": saved.get(
                "review_end_seconds", candidate["end_seconds"]
            ),
        })
    for event in previous:
        if event["event_id"].startswith("manual-") and event["event_id"] not in {
            candidate["event_id"] for candidate in candidates
        }:
            events.append(event)
    recordings[filename] = events
    return events


def stacked_signal_figure(
    raw,
    filtered: np.ndarray,
    selected_channels: list[str],
    visible_range: tuple[float, float],
    events: list[dict],
) -> go.Figure:
    sampling_hz = float(raw.info["sfreq"])
    start_index = max(0, int(visible_range[0] * sampling_hz))
    end_index = min(raw.n_times, int(visible_range[1] * sampling_hz))
    times = np.arange(start_index, end_index) / sampling_hz
    names = {name: index for index, name in enumerate(raw.ch_names)}
    channel_data = filtered[[names[name] for name in selected_channels], start_index:end_index] * 1e6
    scale = float(np.quantile(np.abs(channel_data), 0.95)) if channel_data.size else 1.0
    spacing = max(10.0, scale * 4.0)

    figure = go.Figure()
    for channel_index, (name, signal) in enumerate(zip(selected_channels, channel_data)):
        figure.add_trace(go.Scattergl(
            x=times,
            y=signal + (len(selected_channels) - channel_index - 1) * spacing,
            name=name,
            mode="lines",
            line={"width": 0.7},
            hovertemplate=f"{name}<br>%{{x:.3f}} s<br>%{{y:.1f}} uV + offset<extra></extra>",
        ))
    for event in events:
        status_color = "#9c77ec" if event["event_id"].startswith("manual-") else "#e2a95b"
        figure.add_vrect(
            x0=event["start_seconds"],
            x1=event["end_seconds"],
            fillcolor=status_color,
            opacity=0.12,
            line_width=0,
        )
    for annotation in raw.annotations:
        onset = float(annotation["onset"])
        if visible_range[0] <= onset <= visible_range[1]:
            figure.add_vline(
                x=onset,
                line_dash="dash",
                line_color="#e7799c",
                annotation_text=f"marker {annotation['description']}",
                annotation_position="top",
            )
    selected_id = st.session_state.get("selected_event_id")
    selected_event = next((e for e in events if e["event_id"] == selected_id), None)
    if selected_event:
        figure.add_vrect(
            x0=selected_event["review_start_seconds"],
            x1=selected_event["review_end_seconds"],
            fillcolor="#74d2bb",
            opacity=0.22,
            line={"color": "#74d2bb", "width": 1},
        )

    tick_values = [
        (len(selected_channels) - index - 1) * spacing
        for index in range(len(selected_channels))
    ]
    figure.update_layout(
        height=max(440, min(900, 26 * len(selected_channels))),
        margin={"l": 8, "r": 12, "t": 28, "b": 35},
        xaxis_title="Time from recording start (seconds)",
        yaxis={
            "tickmode": "array",
            "tickvals": tick_values,
            "ticktext": selected_channels,
            "title": "Filtered EEG (uV; traces vertically offset)",
            "showgrid": True,
            "gridcolor": "rgba(140,140,160,0.15)",
        },
        xaxis={"gridcolor": "rgba(140,140,160,0.15)", "rangeslider": {"visible": True}},
        legend={"orientation": "h", "y": 1.02, "x": 0},
        template="plotly_dark",
    )
    return figure


paths = recording_paths()
if not paths:
    st.error(f"No CNT recordings found at the repository root: {REPOSITORY_ROOT}")
    st.stop()

path_by_name = {path.name: path for path in paths}
filename = st.selectbox("Recording", list(path_by_name))
path = path_by_name[filename]
session_hint = next((hint for key, hint in SESSION_HINTS.items() if key in filename), "activity not specified")
st.caption(f"Session description: {session_hint}. This is context only; it does not label samples.")

raw = load_recording(str(path))
filtered = filtered_data(raw.get_data(), float(raw.info["sfreq"]))
candidates = [candidate.to_dict() for candidate in detect_candidates(raw)]
try:
    state = load_review_state(REVIEW_FILE)
except (OSError, json.JSONDecodeError, ValueError) as error:
    st.error(f"Could not load saved review state: {error}")
    st.stop()
events = review_events(state, filename, candidates)

duration = raw.n_times / float(raw.info["sfreq"])
st.caption(
    f"ANT Neuro CNT · {len(raw.ch_names)} EEG channels · "
    f"{raw.info['sfreq']:.0f} Hz · {duration:.3f} s · "
    f"{len(raw.annotations)} reader annotation(s). "
    "Marker codes have no assumed gesture meaning."
)

left, right = st.columns([1.25, 1])
with left:
    channel_group = st.selectbox(
        "Channels to display",
        ["Frontal (blink/wink review)", "Temporal (jaw artifact review)", "All EEG channels"],
    )
    if channel_group.startswith("Frontal"):
        channel_names = ["Fp1", "Fp2", "F9", "F7", "F3", "Fz", "F4", "F8", "F10"]
    elif channel_group.startswith("Temporal"):
        channel_names = ["T9", "T7", "T8", "T10"]
    else:
        channel_names = list(raw.ch_names)
    channel_names = [name for name in channel_names if name in raw.ch_names]
    visible_range = st.slider(
        "Time range (seconds; use the chart to zoom/pan)",
        min_value=0.0,
        max_value=float(round(duration, 3)),
        value=(0.0, float(round(duration, 3))),
        step=0.1,
        key=f"time_range_{filename}",
    )
    st.plotly_chart(
        stacked_signal_figure(raw, filtered, channel_names, visible_range, events),
        width="stretch",
        config={"scrollZoom": True, "displaylogo": False},
    )

with right:
    st.subheader("Candidate events")
    st.caption(
        "Amber regions are algorithmic candidates; purple is a manually added interval. "
        "Green shows the current review bounds."
    )
    if events:
        rows = [{
            "event": event["event_id"],
            "start": event["start_seconds"],
            "end": event["end_seconds"],
            "signal evidence": ", ".join(event.get("detectors", [])) or "manual",
            "peak / threshold": event.get("peak_score", 0.0),
            "review": event["status"],
            "label": event["label"],
        } for event in events]
        st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
        event_ids = [event["event_id"] for event in events]
        selected_id = st.selectbox(
            "Select a candidate to review",
            event_ids,
            format_func=lambda event_id: next(
                f"{event_id} · {next(e for e in events if e['event_id'] == event_id)['start_seconds']:.3f}–"
                f"{next(e for e in events if e['event_id'] == event_id)['end_seconds']:.3f} s"
                for e in events if e["event_id"] == event_id
            ),
            key="selected_event_id",
        )
        selected = next(event for event in events if event["event_id"] == selected_id)
        if selected.get("features"):
            st.caption("Signal feature measurements (not confidence estimates)")
            st.json(selected["features"], expanded=False)
        with st.form("review_event"):
            start_value = st.number_input(
                "Start (seconds)", min_value=0.0, max_value=float(duration),
                value=float(selected.get("review_start_seconds", selected["start_seconds"])),
                step=0.01, format="%.3f",
            )
            end_value = st.number_input(
                "End (seconds)", min_value=0.0, max_value=float(duration),
                value=float(selected.get("review_end_seconds", selected["end_seconds"])),
                step=0.01, format="%.3f",
            )
            label = st.selectbox(
                "Assign label", ANNOTATION_LABELS,
                index=ANNOTATION_LABELS.index(selected.get("label", "UNKNOWN")),
            )
            confirm = st.form_submit_button("Confirm annotation")
            reject = st.form_submit_button("Reject candidate")
            if confirm or reject:
                if end_value <= start_value:
                    st.error("End time must be after start time.")
                else:
                    selected["review_start_seconds"] = round(start_value, 3)
                    selected["review_end_seconds"] = round(end_value, 3)
                    selected["label"] = label
                    selected["status"] = "confirmed" if confirm else "rejected"
                    save_annotations(state, REVIEW_FILE, ANNOTATION_FILE)
                    st.rerun()
    else:
        st.info("No automatic candidates met the current signal thresholds. You can add an interval manually.")

    with st.expander("Add a manually selected interval"):
        with st.form("manual_event"):
            manual_start = st.number_input(
                "Manual start (seconds)", min_value=0.0, max_value=float(duration), value=0.0, step=0.01
            )
            manual_end = st.number_input(
                "Manual end (seconds)", min_value=0.0, max_value=float(duration), value=0.5, step=0.01
            )
            manual_label = st.selectbox("Manual label", ANNOTATION_LABELS, key="manual_label")
            add_manual = st.form_submit_button("Add interval for review")
            if add_manual:
                if manual_end <= manual_start:
                    st.error("End time must be after start time.")
                else:
                    manual_id = f"manual-{len([e for e in events if e['event_id'].startswith('manual-')]) + 1:03d}"
                    events.append({
                        "event_id": manual_id,
                        "start_seconds": round(manual_start, 3),
                        "end_seconds": round(manual_end, 3),
                        "detectors": [],
                        "peak_score": 0.0,
                        "review_start_seconds": round(manual_start, 3),
                        "review_end_seconds": round(manual_end, 3),
                        "status": "pending",
                        "label": manual_label,
                    })
                    state["recordings"][filename] = events
                    save_annotations(state, REVIEW_FILE, ANNOTATION_FILE)
                    st.rerun()

st.info(
    "EEG channels can contain eye and jaw muscle artifacts, but this dataset has no dedicated EOG/EMG channels. "
    "A candidate or lateralized pattern does not establish a gesture or wink side; confirm each interval manually."
)

ANNOTATION_DIR.mkdir(parents=True, exist_ok=True)
if not ANNOTATION_FILE.exists():
    pd.DataFrame(columns=ANNOTATION_COLUMNS).to_csv(ANNOTATION_FILE, index=False)
annotation_bytes = ANNOTATION_FILE.read_bytes()
st.download_button(
    "Download confirmed annotations CSV",
    data=annotation_bytes,
    file_name=ANNOTATION_FILE.name,
    mime="text/csv",
)
st.caption(f"Confirmed annotations are saved locally to `{ANNOTATION_FILE.relative_to(REPOSITORY_ROOT)}`.")
