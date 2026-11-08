"""ANT Neuro eego 24-channel montage and the channel groups each detector uses."""

CHANNELS = (
    "Fp1", "Fp2", "F9", "F7", "F3", "Fz", "F4", "F8", "F10", "T9", "T7", "C3",
    "C4", "T8", "T10", "P9", "P7", "P3", "Pz", "P4", "P8", "P10", "O1", "O2",
)
# Error-related potential: fronto-central/parietal midline (the cap has no Cz/FCz).
ERRP = ("Fz", "F3", "F4", "C3", "C4", "Pz")
# Corrugator/frontalis (frown) muscle activity reaches the forehead electrodes.
FROWN = ("Fp1", "Fp2", "F9", "F10")
# Head-motion axes used by the nod/shake detector.
VERTICAL_TOP = ("Fp1", "Fp2")
VERTICAL_BACK = ("O1", "O2")
HORIZONTAL_LEFT = ("F7", "T7", "F9", "T9")
HORIZONTAL_RIGHT = ("F8", "T8", "F10", "T10")

INDEX = {name: i for i, name in enumerate(CHANNELS)}


def indices(names, available=CHANNELS):
    lookup = {name: i for i, name in enumerate(available)}
    missing = [name for name in names if name not in lookup]
    if missing:
        raise ValueError(f"Stream is missing channels: {missing}")
    return [lookup[name] for name in names]
