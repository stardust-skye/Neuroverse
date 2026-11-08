import { Fragment, useState } from 'react'
import { api, settings, type Status } from './api'
import Calibration from './Calibration'
import ScalpMap from './ScalpMap'
import type { useLive } from './useLive'

export default function Settings({ live }: { live: ReturnType<typeof useLive> }) {
  const status = live.status
  const [mode, setMode] = useState<'mock' | 'lsl' | 'replay'>(status?.source ?? 'mock')
  const [streamName, setStreamName] = useState('')
  const [message, setMessage] = useState('')
  const [chatgpt, setChatgpt] = useState<{ connected: boolean; model?: string; reason?: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [plant, setPlant] = useState(settings.plant)
  const [calibrating, setCalibrating] = useState(false)

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label); setMessage('')
    try { await action() } catch (e) { setMessage((e as Error).message) } finally { setBusy('') }
  }
  const channelsGood = Object.values(live.quality).filter((q) => q === 'good').length
  const signedIn = chatgpt?.connected ?? status?.chatgpt.connected

  return (
    <div className="grid settings">
      <section className="card">
        <h2>Device</h2>
        <div className="segmented">
          {(['lsl', 'mock', 'replay'] as const).map((m) => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              {m === 'lsl' ? 'Live headset (LSL)' : m === 'mock' ? 'Mock signal' : 'Replay .cnt'}
            </button>
          ))}
        </div>
        {mode === 'lsl' && <input placeholder="LSL stream name (optional; default: first EEG stream)" value={streamName} onChange={(e) => setStreamName(e.target.value)} />}
        <button className="primary" disabled={!!busy} onClick={() => run('device', async () => {
          live.setStatus(await api<Status>('/device', { mode, name: streamName || null }))
        })}>{busy === 'device' ? 'Connecting…' : 'Connect'}</button>
        {status && (
          <dl className="facts">
            <dt>Source</dt><dd>{status.source}{status.stream_name ? ` · ${status.stream_name}` : ''}</dd>
            <dt>Signal</dt><dd>{status.channels.length} ch · {status.sfreq} Hz · {channelsGood}/{status.channels.length} good</dd>
            <dt>Baseline</dt><dd>{status.baseline}</dd>
            <dt>Reaction model</dt><dd>{status.reaction_model}</dd>
            <dt>Gesture model</dt><dd>{status.gesture_model}</dd>
          </dl>
        )}
        <ScalpMap activity={live.activity} quality={live.quality} size={200} />
      </section>

      <section className="card">
        <h2>Calibration</h2>
        <p className="muted small">About 3 minutes, once per headset fitting: rest, watch a cursor that sometimes goes the wrong way, then cued frowns, nods and shakes.</p>
        <button className="primary" onClick={() => setCalibrating(true)}>Calibrate</button>
        {status?.calibration_metrics && Object.keys(status.calibration_metrics).length > 0 && (
          <dl className="facts">
            {Object.entries(status.calibration_metrics).map(([k, v]) => <Fragment key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{String(v)}</dd></Fragment>)}
          </dl>
        )}
      </section>

      <section className="card">
        <h2>ChatGPT</h2>
        <button className="chatgpt" disabled={!!busy} onClick={() => run('chatgpt', async () => {
          setChatgpt(await api('/auth/chatgpt', {}))
        })}>
          <span className="openai-mark" />{signedIn ? 'Signed in with ChatGPT' : busy === 'chatgpt' ? 'Signing in…' : 'Sign in with ChatGPT'}
        </button>
        {signedIn && <p className="ok-text">Connected · {chatgpt?.model ?? status?.chatgpt.model}</p>}
        {chatgpt && !chatgpt.connected && <p className="error">{chatgpt.reason}</p>}
        <p className="muted small">Uses the OpenAI API key on the local service. Only text is sent, never EEG.</p>
        <h2>On-device model</h2>
        <p>{status?.slm.available ? <span className="ok-text">{status.slm.model} running locally (Ollama)</span> : <span className="warn-text">Ollama model {status?.slm.model} not running: rule-based fallback</span>}</p>
      </section>

      <section className="card">
        <h2>Demo</h2>
        <label className="toggle">
          <input type="checkbox" checked={plant} onChange={(e) => { setPlant(e.target.checked); settings.plant = e.target.checked }} />
          Plant known errors in drafts (wrong name, confrontational line)
        </label>
        <p className="muted small">Planted errors start a chunk, so the reaction is time-locked. Categories you've already taught are not planted again. In mock mode the mock signal reacts to planted chunks.</p>
        <div className="row">
          <button disabled={!!busy} onClick={() => run('rec', async () => {
            const r = await api<{ recording: boolean; saved?: string | null }>(status?.recording ? '/record/stop' : '/record/start', {})
            setMessage(r.saved ? `Saved ${r.saved}` : r.recording ? 'Recording raw stream + markers…' : 'Nothing recorded.')
            live.setStatus(await api<Status>('/status'))
          })}>{status?.recording ? 'Stop recording' : 'Record raw session'}</button>
          <button disabled={!!busy} onClick={() => run('reset', async () => { await api('/reset', {}); setMessage('Learned preferences and dataset cleared.') })}>Reset learned data</button>
        </div>
        {message && <p className="muted small">{message}</p>}
      </section>

      {calibrating && <Calibration onClose={async () => {
        setCalibrating(false)
        live.setStatus(await api<Status>('/status'))
      }} />}
    </div>
  )
}
