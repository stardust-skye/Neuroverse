import { useState, type FormEvent } from 'react'
import { BRAND, TAGLINE } from './brand'

// Demo-only credentials, hard-coded on purpose. There is no real account system.
const DEMO_EMAIL = 'user@gmail.com'
const DEMO_PASSWORD = 'yo'

export default function Login({ onLogin }: { onLogin: (email: string) => void }) {
  const [email, setEmail] = useState(DEMO_EMAIL)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (email.trim().toLowerCase() === DEMO_EMAIL && password === DEMO_PASSWORD) onLogin(DEMO_EMAIL)
    else setError('Wrong email or password.')
  }
  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand big"><span className="logo" />{BRAND}</div>
        <p className="muted">{TAGLINE}</p>
        <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus /></label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">Sign in</button>
      </form>
    </div>
  )
}
