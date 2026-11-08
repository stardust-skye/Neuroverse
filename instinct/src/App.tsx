import { useState } from 'react'
import { BRAND } from './brand'
import { useLive } from './useLive'
import Login from './Login'
import Profile from './Profile'
import Session from './Session'
import Settings from './Settings'

type Tab = 'profile' | 'session' | 'settings'
const USER_KEY = 'instinct.user'

function storedUser(): string | null {
  try { return localStorage.getItem(USER_KEY) } catch { return null }
}

export default function App() {
  const [user, setUser] = useState<string | null>(storedUser)
  const [tab, setTab] = useState<Tab>('profile')
  const live = useLive()

  if (!user) {
    return <Login onLogin={(email) => {
      try { localStorage.setItem(USER_KEY, email) } catch { /* storage unavailable */ }
      setUser(email)
    }} />
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span className="logo" />{BRAND}</div>
        <nav className="tabs">
          {(['profile', 'session', 'settings'] as Tab[]).map((name) => (
            <button key={name} className={tab === name ? 'tab active' : 'tab'} onClick={() => setTab(name)}>
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </nav>
        <div className="who">
          <span className={live.online ? 'dot ok' : 'dot bad'} title={live.online ? 'Local service connected' : 'Local service offline'} />
          {live.status?.source === 'mock' && <span className="badge warn">mock signal</span>}
          {live.status?.source === 'lsl' && <span className="badge ok">live EEG</span>}
          {live.status?.source === 'replay' && <span className="badge">replay</span>}
          <span className="muted">{user}</span>
          <button className="link" onClick={() => {
            try { localStorage.removeItem(USER_KEY) } catch { /* storage unavailable */ }
            setUser(null)
          }}>Sign out</button>
        </div>
      </header>
      <main className="content">
        {tab === 'profile' && <Profile live={live} />}
        {tab === 'session' && <Session live={live} />}
        {tab === 'settings' && <Settings live={live} />}
      </main>
    </div>
  )
}
