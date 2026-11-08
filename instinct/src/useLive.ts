import { useEffect, useState } from 'react'
import { socket, type ServerEvent, type Status } from './api'

/** Live status + per-channel activity/quality from the local service. */
export function useLive() {
  const [status, setStatus] = useState<Status | null>(null)
  const [activity, setActivity] = useState<Record<string, number>>({})
  const [quality, setQuality] = useState<Record<string, string>>({})
  const [online, setOnline] = useState(false)
  useEffect(() => {
    socket.connect()
    let last = 0
    return socket.subscribe((event: ServerEvent) => {
      if (event.type === 'status') { setStatus(event.status); setOnline(true) }
      if (event.type === 'signals') {
        setOnline(true)
        const now = performance.now()
        if (now - last > 90) { last = now; setActivity(event.activity); setQuality(event.quality) }
      }
      if (event.type === 'error' && event.message.includes('disconnected')) setOnline(false)
    })
  }, [])
  return { status, setStatus, activity, quality, online }
}
