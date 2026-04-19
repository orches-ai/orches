import { useState, useEffect, useCallback } from 'react'
import { useRef } from 'react'
import EventLog from '../widgets/EventLog'
import AgentGraph from '../widgets/AgentGraph'
import Chat, { type ChatTab } from '../widgets/Chat'
import AgentSettings from '../widgets/AgentSettings'
import Canvas from '../widgets/Canvas'
import Divider from '../shared/ui/Divider'
import { useWebSocket } from '../shared/hooks/useWebSocket'
import { API, WS, MAIN } from '../shared/config'
import type { Agent, AgentEvent, Message, CanvasPage } from '../shared/types'

type Status = AgentEvent['event_type'] | 'idle'

export default function App() {
  const [agents, setAgents]               = useState<Agent[]>([])
  const [events, setEvents]               = useState<AgentEvent[]>([])
  const [agentStatus, setAgentStatus]     = useState<Record<string, Status>>({})
  const [agentQueue,  setAgentQueue]      = useState<Record<string, number>>({})
  const [agentStatusText, setAgentStatusText] = useState<Record<string, string>>({})
  const [loadingAgents, setLoadingAgents] = useState<Set<string>>(new Set())
  const [loadingStart, setLoadingStart]   = useState<Record<string, number>>({})
  const [elapsed, setElapsed]             = useState<Record<string, number>>({})
  const [activeEdges, setActiveEdges]     = useState<Set<string>>(new Set())

  // Multi-tab chat
  const [chatTabs, setChatTabs]   = useState<ChatTab[]>([{ agentId: MAIN, messages: [] }])
  const [activeTab, setActiveTab] = useState(MAIN)

  // Canvas overlay
  const [canvasPages,     setCanvasPages]     = useState<CanvasPage[]>([])
  const [canvasActiveId,  setCanvasActiveId]  = useState<string | null>(null)
  const [canvasMinimized, setCanvasMinimized] = useState(false)

  function openCanvasPage(page: CanvasPage) {
    setCanvasPages(prev => {
      const existing = prev.findIndex(p => p.id === page.id)
      return existing >= 0
        ? prev.map(p => p.id === page.id ? page : p)
        : [...prev, page]
    })
    setCanvasActiveId(page.id)
    setCanvasMinimized(false)
  }

  function closeCanvasPage(id: string) {
    setCanvasPages(prev => {
      const next = prev.filter(p => p.id !== id)
      if (canvasActiveId === id)
        setCanvasActiveId(next[next.length - 1]?.id ?? null)
      return next
    })
  }

  // Modal stack: null = new agent form, Agent = edit existing
  const [settingsStack, setSettingsStack] = useState<Array<{ key: number; agent: Agent | null }>>([])
  const stackKeyRef = useRef(0)

  function pushSettings(agent: Agent | null) {
    const key = ++stackKeyRef.current
    setSettingsStack(prev => {
      const filtered = agent
        ? prev.filter(s => s.agent?.id !== agent.id)
        : prev.filter(s => s.agent !== null)
      return [...filtered, { key, agent }].slice(-5)
    })
  }
  function popSettings() {
    setSettingsStack(prev => prev.slice(0, -1))
  }

  // Panel widths
  const [eventW, setEventW] = useState(280)
  const [chatW,  setChatW]  = useState(360)
  const resizingRef = useRef<'event' | 'chat' | null>(null)
  const startXRef   = useRef(0)
  const startWRef   = useRef(0)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      const dx = e.clientX - startXRef.current
      if (resizingRef.current === 'event') {
        setEventW(Math.max(160, Math.min(520, startWRef.current + dx)))
      } else {
        setChatW(Math.max(240, Math.min(800, startWRef.current - dx)))
      }
    }
    const onUp = () => { resizingRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  useEffect(() => {
    fetch(`${API}/agents/`)
      .then(r => r.json())
      .then((data: Agent[]) => setAgents(data))
      .catch(() => {})
    fetch(`${API}/agents/${MAIN}/history`)
      .then(r => r.json())
      .then((history: Message[]) => {
        if (history.length > 0)
          setChatTabs(prev => prev.map(t => t.agentId === MAIN ? { ...t, messages: history } : t))
      })
      .catch(() => {})

    // Restore busy agent states after page refresh
    fetch(`${API}/agents/status`)
      .then(r => r.json())
      .then((statuses: Array<{ agent_id: string; state: string }>) => {
        const busyIds = statuses.filter(s => s.state === 'busy').map(s => s.agent_id)
        if (busyIds.length === 0) return

        setLoadingAgents(new Set(busyIds))
        setLoadingStart(Object.fromEntries(busyIds.map(id => [id, Date.now()])))
        setAgentStatusText(prev => ({ ...prev, ...Object.fromEntries(busyIds.map(id => [id, 'thinking...'])) }))
        setAgentStatus(prev => ({ ...prev, ...Object.fromEntries(busyIds.map(id => [id, 'thinking' as Status])) }))

        // Add streaming placeholder for each busy agent
        setChatTabs(prev => {
          let tabs = prev
          for (const agentId of busyIds) {
            const tab = tabs.find(t => t.agentId === agentId)
            const lastMsg = tab?.messages[tab.messages.length - 1]
            if (!lastMsg || lastMsg.role !== 'agent' || !lastMsg.streaming) {
              tabs = tabs.map(t =>
                t.agentId === agentId
                  ? { ...t, messages: [...t.messages, { role: 'agent', text: '', streaming: true } as Message] }
                  : t
              )
              if (!tab) tabs = [...tabs, { agentId, messages: [{ role: 'agent', text: '', streaming: true } as Message] }]
            }
          }
          return tabs
        })

        // Poll each busy agent until done — catches done events that fired before WS connected
        for (const agentId of busyIds) {
          const poll = async () => {
            while (true) {
              await new Promise(r => setTimeout(r, 2000))
              try {
                const res = await fetch(`${API}/agents/${agentId}/status`)
                const s: { state: string } = await res.json()
                if (s.state === 'idle') {
                  const hRes = await fetch(`${API}/agents/${agentId}/history`)
                  const history: Message[] = await hRes.json()
                  if (history.length > 0)
                    setChatTabs(p => p.map(t => t.agentId === agentId ? { ...t, messages: history } : t))
                  setLoadingAgents(p => { const s = new Set(p); s.delete(agentId); return s })
                  setElapsed(p => { const n = { ...p }; delete n[agentId]; return n })
                  setAgentStatus(p => ({ ...p, [agentId]: 'idle' }))
                  break
                }
              } catch { break }
            }
          }
          poll()
        }
      })
      .catch(() => {})
  }, [])

  const handleEvent = useCallback((event: AgentEvent) => {
    const time = new Date().toLocaleTimeString('en', { hour12: false })
    setEvents(prev => [...prev.slice(-200), { ...event, _time: time }])

    if (event.event_type === 'canvas_open') {
      const p = event.payload as { type: CanvasPage['type']; title: string; content?: string; language?: string; url?: string; data?: string; chart_type?: CanvasPage['chart_type'] }
      openCanvasPage({ id: `${event.agent_id}:${p.title}`, title: p.title, type: p.type, content: p.content, language: p.language, url: p.url, data: p.data, chart_type: p.chart_type })
      return
    }

    if (event.event_type === 'agent_created') {
      const p = event.payload as { agent: Agent }
      setAgents(prev => {
        const exists = prev.some(a => a.id === p.agent.id)
        return exists ? prev.map(a => a.id === p.agent.id ? p.agent : a) : [...prev, p.agent]
      })
      return
    }

    if (event.event_type === 'queued') {
      setAgentQueue(prev => ({ ...prev, [event.agent_id]: (event.payload as any).queue_depth ?? 1 }))
      setAgentStatusText(prev => ({ ...prev, [event.agent_id]: 'в очереди...' }))
      return
    }
    if (event.event_type === 'unqueued' || event.event_type === 'status') {
      setAgentQueue(prev => ({ ...prev, [event.agent_id]: (event.payload as any).queue_depth ?? 0 }))
      if (event.event_type === 'status') return
    }

    const p = event.payload as any
    let statusText = ''
    switch (event.event_type) {
      case 'started':
      case 'thinking':   statusText = 'thinking...'; break
      case 'tool_call':  statusText = `using ${p.tool ?? 'tool'}...`; break
      case 'delegating': statusText = `delegating to ${p.to ?? 'agent'}...`; break
      case 'queued':     statusText = 'queued...'; break
      case 'done':
      case 'error':      statusText = ''; break
    }
    if (statusText) setAgentStatusText(prev => ({ ...prev, [event.agent_id]: statusText }))

    if (event.event_type === 'delegating' && p.to) {
      const key = `${event.agent_id}->${p.to}`
      setActiveEdges(prev => new Set([...prev, key]))
    }

    setAgentStatus(prev => ({ ...prev, [event.agent_id]: event.event_type }))
    if (event.event_type === 'done' || event.event_type === 'error') {
      const finishedId = event.agent_id
      setTimeout(() => {
        setAgentStatus(prev => ({ ...prev, [finishedId]: 'idle' }))
        setActiveEdges(prev => {
          const next = new Set(prev)
          next.forEach(k => { if (k.endsWith(`->${finishedId}`)) next.delete(k) })
          return next
        })
      }, 3500)

      // If agent was restored after refresh (loadingAgents but no active SSE), fetch history
      setLoadingAgents(prev => {
        if (!prev.has(event.agent_id)) return prev
        const agentId = event.agent_id
        fetch(`${API}/agents/${agentId}/history`)
          .then(r => r.json())
          .then((history: Message[]) => {
            if (history.length > 0) {
              setChatTabs(p => p.map(t => t.agentId === agentId ? { ...t, messages: history } : t))
            }
            setLoadingAgents(p => { const s = new Set(p); s.delete(agentId); return s })
            setElapsed(p => { const n = { ...p }; delete n[agentId]; return n })
          })
          .catch(() => {
            setLoadingAgents(p => { const s = new Set(p); s.delete(agentId); return s })
          })
        return prev
      })
    }
  }, [])

  useWebSocket(WS, handleEvent)

  useEffect(() => {
    if (loadingAgents.size === 0) return
    const id = setInterval(() => {
      const now = Date.now()
      setElapsed(prev => {
        const next = { ...prev }
        loadingAgents.forEach(agentId => {
          const start = loadingStart[agentId]
          if (start) next[agentId] = Math.floor((now - start) / 1000)
        })
        return next
      })
    }, 1000)
    return () => clearInterval(id)
  }, [loadingAgents, loadingStart])

  async function handleSend(agentId: string, text: string) {
    setAgentStatusText(prev => ({ ...prev, [agentId]: 'thinking...' }))
    setLoadingStart(prev => ({ ...prev, [agentId]: Date.now() }))
    setElapsed(prev => ({ ...prev, [agentId]: 0 }))

    const userMsg: Message = { role: 'user', text }
    setChatTabs(prev => prev.map(t =>
      t.agentId === agentId ? { ...t, messages: [...t.messages, userMsg] } : t
    ))
    setLoadingAgents(prev => new Set(prev).add(agentId))

    // Add an empty streaming placeholder message
    setChatTabs(prev => prev.map(t =>
      t.agentId === agentId
        ? { ...t, messages: [...t.messages, { role: 'agent', text: '', streaming: true } as Message] }
        : t
    ))

    try {
      const res = await fetch(`${API}/agents/${agentId}/run/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text }),
      })

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let parsed: { type: string; text?: string; result?: string }
          try { parsed = JSON.parse(line.slice(6)) } catch { continue }

          if (parsed.type === 'chunk' && parsed.text) {
            setChatTabs(prev => prev.map(t => {
              if (t.agentId !== agentId) return t
              const msgs = [...t.messages]
              const last = msgs[msgs.length - 1]
              if (last?.role === 'agent') msgs[msgs.length - 1] = { ...last, text: last.text + parsed.text }
              return { ...t, messages: msgs }
            }))
          } else if (parsed.type === 'done') {
            setChatTabs(prev => prev.map(t => {
              if (t.agentId !== agentId) return t
              const msgs = [...t.messages]
              const last = msgs[msgs.length - 1]
              if (last?.role === 'agent') msgs[msgs.length - 1] = { role: 'agent', text: parsed.result ?? last.text }
              return { ...t, messages: msgs }
            }))
          }
        }
      }
    } catch (err) {
      setChatTabs(prev => prev.map(t => {
        if (t.agentId !== agentId) return t
        const msgs = [...t.messages]
        const last = msgs[msgs.length - 1]
        if (last?.role === 'agent') msgs[msgs.length - 1] = { role: 'agent', text: `Error: ${String(err)}` }
        return { ...t, messages: msgs }
      }))
    } finally {
      setLoadingAgents(prev => { const s = new Set(prev); s.delete(agentId); return s })
      setElapsed(prev => { const n = { ...prev }; delete n[agentId]; return n })
    }
  }

  async function handleTabAdd(agentId: string) {
    setChatTabs(prev => {
      if (prev.find(t => t.agentId === agentId)) return prev
      return [...prev, { agentId, messages: [] }]
    })
    setActiveTab(agentId)
    try {
      const res = await fetch(`${API}/agents/${agentId}/history`)
      const history: Message[] = await res.json()
      if (history.length > 0) {
        setChatTabs(prev => prev.map(t => t.agentId === agentId ? { ...t, messages: history } : t))
      }
    } catch {}
  }

  async function handleFileUpload(files: FileList): Promise<string[]> {
    const paths: string[] = []
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      try {
        const res = await fetch(`${API}/workspace/upload`, { method: 'POST', body: fd })
        if (res.ok) {
          const data = await res.json()
          paths.push(data.path)
        }
      } catch {}
    }
    return paths
  }

  async function handleStop(agentId: string) {
    await fetch(`${API}/agents/${agentId}/stop`, { method: 'POST' })
  }

  async function handleOpenFile(path: string) {
    try {
      const res = await fetch(`${API}/workspace/file?path=${encodeURIComponent(path)}`)
      if (!res.ok) return
      const content = await res.text()
      const name = path.split('/').pop() ?? path
      const ext  = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
      const isCode = ['py','js','ts','tsx','jsx','json','yaml','yml','sh','toml','css','html'].includes(ext)
      openCanvasPage({
        id: `file:${path}`,
        title: name,
        type: isCode ? 'code' : 'markdown',
        content,
        language: isCode ? ext : undefined,
      })
    } catch {}
  }

  async function handleClearHistory(agentId: string) {
    await fetch(`${API}/agents/${agentId}/history`, { method: 'DELETE' })
    setChatTabs(prev => prev.map(t => t.agentId === agentId ? { ...t, messages: [] } : t))
  }

  function handleTabClose(agentId: string) {
    setChatTabs(prev => {
      const next = prev.filter(t => t.agentId !== agentId)
      return next.length > 0 ? next : prev
    })
    setActiveTab(prev => {
      if (prev !== agentId) return prev
      const remaining = chatTabs.filter(t => t.agentId !== agentId)
      return remaining[remaining.length - 1]?.agentId ?? MAIN
    })
  }

  function handleSaveAgent(updated: Agent) {
    setAgents(prev => {
      const exists = prev.find(a => a.id === updated.id)
      return exists ? prev.map(a => a.id === updated.id ? updated : a) : [...prev, updated]
    })
    popSettings()
  }

  function handleDeleteAgent(id: string) {
    setAgents(prev => prev.filter(a => a.id !== id))
    popSettings()
  }

  async function handleImportAgent(config: Agent) {
    try {
      await fetch(`${API}/agents/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      setAgents(prev => {
        const exists = prev.find(a => a.id === config.id)
        return exists ? prev.map(a => a.id === config.id ? config : a) : [...prev, config]
      })
    } catch (e) {
      alert(`Import failed: ${e}`)
    }
  }

  function startResize(side: 'event' | 'chat', e: React.MouseEvent) {
    resizingRef.current = side
    startXRef.current   = e.clientX
    startWRef.current   = side === 'event' ? eventW : chatW
    e.preventDefault()
  }

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden', background: '#fafafa' }}>

      <div style={{ width: eventW, flexShrink: 0, overflow: 'hidden' }}>
        <EventLog events={events} />
      </div>

      <Divider onMouseDown={e => startResize('event', e)} />

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <AgentGraph
          agents={agents}
          agentStatus={agentStatus}
          agentQueue={agentQueue}
          activeEdges={activeEdges}
          onAgentClick={a => pushSettings(a)}
          onNewAgent={() => pushSettings(null)}
          onImportAgent={handleImportAgent}
          onOpenSettings={() => openCanvasPage({ id: 'settings', title: 'Settings', type: 'settings' })}
          onOpenWorkspace={() => openCanvasPage({ id: 'workspace', title: 'Workspace', type: 'files', filePath: '' })}
        />

        <Canvas
          pages={canvasPages}
          activeId={canvasActiveId}
          minimized={canvasMinimized}
          onMinimize={() => setCanvasMinimized(true)}
          onRestore={id => { setCanvasActiveId(id); setCanvasMinimized(false) }}
          onClose={() => { setCanvasPages([]); setCanvasActiveId(null) }}
          onClosePage={closeCanvasPage}
          onSelect={setCanvasActiveId}
          onOpenPage={openCanvasPage}
        />
      </div>

      <Divider onMouseDown={e => startResize('chat', e)} />

      <div style={{ width: chatW, flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
        <Chat
          tabs={chatTabs}
          activeTabId={activeTab}
          agents={agents}
          agentStatus={agentStatus}
          agentStatusText={agentStatusText}
          agentElapsed={elapsed}
          loadingAgents={loadingAgents}
          onSend={handleSend}
          onTabAdd={handleTabAdd}
          onTabClose={handleTabClose}
          onTabSelect={setActiveTab}
          onClearHistory={handleClearHistory}
          onStop={handleStop}
          onFileUpload={handleFileUpload}
          onOpenFile={handleOpenFile}
        />

        {settingsStack.map(({ key, agent }, i) => {
          const depth = settingsStack.length - 1 - i
          return (
            <AgentSettings
              key={key}
              agent={agent}
              agents={agents}
              onClose={popSettings}
              onSave={handleSaveAgent}
              onDelete={handleDeleteAgent}
              depth={depth}
            />
          )
        })}
      </div>

    </div>
  )
}
