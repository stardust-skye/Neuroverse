// Floating live EEG panel. Framework-free: just `import './eegPanel';` once in your entry file.
// Toggle with Ctrl+Shift+E. Needs ml/live/lsl_ws_bridge.py running.
import { EegStream, RollingBuffer, type EegStatus } from './eegStream';

const WINDOW_SEC = 5;
const MAX_CH = 8; // show first 8 channels so the panel stays readable

const root = document.createElement('div');
root.style.cssText =
  'position:fixed;right:12px;bottom:12px;width:420px;z-index:99999;background:#0b0f14ee;color:#cfe;' +
  'font:12px ui-monospace,Consolas,monospace;border:1px solid #2a3a4a;border-radius:8px;padding:8px;display:none';
root.innerHTML = `
  <div style="display:flex;justify-content:space-between;margin-bottom:6px">
    <b>LIVE EEG</b><span id="eeg-status">disconnected</span>
  </div>
  <div id="eeg-info" style="opacity:.8;margin-bottom:6px">waiting for bridge on ws://localhost:8765</div>
  <canvas id="eeg-canvas" width="400" height="240" style="width:100%;background:#05080c"></canvas>
  <div style="opacity:.6;margin-top:4px">Ctrl+Shift+E to hide. Values are raw device units.</div>`;
document.body.appendChild(root);

const statusEl = root.querySelector('#eeg-status') as HTMLElement;
const infoEl = root.querySelector('#eeg-info') as HTMLElement;
const canvas = root.querySelector('#eeg-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

let buf: RollingBuffer | null = null;
let labels: string[] = [];
let simulated = false;
let status: EegStatus = 'disconnected';

const eeg = new EegStream('ws://localhost:8765', {
  onMeta: (m) => {
    labels = m.channels.slice(0, MAX_CH);
    simulated = m.name === 'SIMULATED';
    buf = new RollingBuffer(labels.length, Math.max(1, Math.round(m.srate * WINDOW_SEC)));
    infoEl.innerHTML = simulated
      ? '<span style="color:#fb4">SIMULATED DATA - not a real EEG signal</span>'
      : `${m.name} | ${m.channels.length} ch @ ${m.srate} Hz`;
  },
  onSamples: (rows) => buf?.push(rows.map((r) => r.slice(0, labels.length))),
  onStatus: (s) => {
    status = s;
    statusEl.textContent = s;
    statusEl.style.color = s === 'streaming' ? '#4f8' : '#f84';
  },
});
eeg.connect();

function draw() {
  requestAnimationFrame(draw);
  if (root.style.display === 'none') return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  if (!buf || status !== 'streaming') {
    ctx.fillStyle = '#789';
    ctx.fillText('no stream', 10, 20);
    return;
  }
  const rowH = h / labels.length;
  labels.forEach((name, c) => {
    const d = buf!.channel(c);
    if (!d.length) return;
    let mean = 0;
    for (const v of d) mean += v;
    mean /= d.length;
    let peak = 1e-6;
    for (const v of d) peak = Math.max(peak, Math.abs(v - mean));
    const mid = rowH * c + rowH / 2;
    ctx.strokeStyle = '#4fd1c5';
    ctx.beginPath();
    for (let i = 0; i < d.length; i++) {
      const x = (i / buf!.size) * w;
      const y = mid - ((d[i] - mean) / peak) * (rowH * 0.45); // auto-scaled per channel
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#9ab';
    ctx.fillText(`${name} (±${peak.toFixed(1)})`, 4, rowH * c + 12);
  });
}
requestAnimationFrame(draw);

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e') {
    root.style.display = root.style.display === 'none' ? 'block' : 'none';
  }
});
