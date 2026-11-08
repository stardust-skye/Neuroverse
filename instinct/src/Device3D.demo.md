`<Device3D signal={{ C3: 0.9, C4: 0.4, Fz: 0.2, Pz: 0.6, T7: 0.1, T8: 0.7 }} height={320} autoRotate />`
- `signal`: per-channel activity 0..1 keyed C3, C4, Fz, Pz, T7, T8 (Cz pad = mean of C3/C4); missing keys idle-pulse teal, high values glow amber.
- `height`: canvas height in px (default 320); `autoRotate`: slow spin (default true). Transparent background, zoom/pan disabled, fully offline.
