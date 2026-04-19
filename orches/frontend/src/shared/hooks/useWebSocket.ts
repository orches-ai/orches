import { useEffect, useRef, useCallback } from 'react'
import type { AgentEvent } from '../types'

export function useWebSocket(url: string, onMessage: (e: AgentEvent) => void) {
  const ws = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return

    ws.current = new WebSocket(url)

    ws.current.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type !== 'ping') onMessageRef.current(data)
      } catch {}
    }

    ws.current.onclose = () => {
      setTimeout(connect, 2000)
    }
  }, [url])

  useEffect(() => {
    connect()
    return () => ws.current?.close()
  }, [connect])
}
