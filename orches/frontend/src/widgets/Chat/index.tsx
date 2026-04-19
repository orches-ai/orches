import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Agent, Message } from '../../shared/types'

const C = {
  bg: '#fafafa', surface: '#ffffff', border: '#e5e5e5',
  accent: '#000000', text: '#171717', textSec: '#525252',
  muted: '#a3a3a3', dim: '#d4d4d4', blue: '#0070f3',
}

export interface ChatTab {
  agentId: string
  messages: Message[]
}

interface Props {
  tabs: ChatTab[]
  activeTabId: string
  agents: Agent[]
  agentStatus: Record<string, string>
  agentStatusText: Record<string, string>
  agentElapsed: Record<string, number>
  loadingAgents: Set<string>
  onSend: (agentId: string, text: string) => void
  onTabAdd: (agentId: string) => void
  onTabClose: (agentId: string) => void
  onTabSelect: (agentId: string) => void
  onClearHistory: (agentId: string) => void
  onStop?: (agentId: string) => void
  onFileUpload?: (files: FileList) => Promise<string[]>
  onOpenFile?: (path: string) => void
}

function parseUserMessage(text: string): { files: string[]; plainText: string } {
  const files: string[] = []
  const plain = text.replace(/\[file:\s*([^\]]+)\]/g, (_, path) => {
    files.push(path.trim())
    return ''
  }).trim()
  return { files, plainText: plain }
}

function FileBadge({ path, onClick }: { path: string; onClick?: () => void }) {
  const name = path.split('/').pop() ?? path
  const ext  = name.includes('.') ? name.split('.').pop()!.toUpperCase() : 'FILE'
  return (
    <span
      onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px 3px 8px', background: '#f5f5f5', border: '1px solid #e5e5e5', borderRadius: 20, fontSize: 12, color: '#171717', cursor: onClick ? 'pointer' : 'default' }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)', color: '#737373' }}>{ext}</span>
      <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    </span>
  )
}

export default function Chat({
  tabs, activeTabId, agents, agentStatus, agentStatusText, agentElapsed, loadingAgents,
  onSend, onTabAdd, onTabClose, onTabSelect, onClearHistory, onStop, onFileUpload, onOpenFile,
}: Props) {
  const [input, setInput]           = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dragOver, setDragOver]     = useState(false)
  const [attachments, setAttachments] = useState<{ path: string; name: string }[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  const activeTab = tabs.find(t => t.agentId === activeTabId) ?? tabs[0]
  const messages = activeTab?.messages ?? []
  const loading = loadingAgents.has(activeTabId)
  const status = agentStatus[activeTabId] ?? 'idle'
  const isBusy = status !== 'idle' && status !== 'done' && status !== 'error'

  const activeAgent = agents.find(a => a.id === activeTabId)
  const tabAgentIds = new Set(tabs.map(t => t.agentId))
  const availableToAdd = agents.filter(a => !tabAgentIds.has(a.id))

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if ((!text && attachments.length === 0) || loading) return
    const fileSuffix = attachments.map(a => `[file: ${a.path}]`).join('\n')
    const full = fileSuffix ? (text ? `${text}\n${fileSuffix}` : fileSuffix) : text
    onSend(activeTabId, full)
    setInput('')
    setAttachments([])
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e as unknown as React.FormEvent)
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const workspacePath = e.dataTransfer.getData('text/workspace-path')
    if (workspacePath) {
      const name = workspacePath.split('/').pop() ?? workspacePath
      setAttachments(prev => prev.find(a => a.path === workspacePath) ? prev : [...prev, { path: workspacePath, name }])
      return
    }
    if (!onFileUpload || !e.dataTransfer.files.length) return
    const paths = await onFileUpload(e.dataTransfer.files)
    setAttachments(prev => {
      const next = [...prev]
      for (const p of paths) {
        const name = p.split('/').pop() ?? p
        if (!next.find(a => a.path === p)) next.push({ path: p, name })
      }
      return next
    })
  }

  function statusDotColor(agentId: string) {
    const s = agentStatus[agentId] ?? 'idle'
    if (s === 'error') return '#ef4444'
    if (s === 'idle' || s === 'done') return '#22c55e'
    return '#f59e0b'
  }

  const disabled = loading || isBusy
  const placeholder = loading
    ? 'waiting for response…'
    : isBusy
      ? `${activeAgent?.name ?? activeTabId} is busy…`
      : `Message ${activeAgent?.name ?? activeTabId}… (Enter to send)`

  return (
    <div style={{ ...s.chat, ...(dragOver ? { outline: '2px dashed #38bdf8', outlineOffset: -2 } : {}) }}
      onDragOver={e => { e.preventDefault(); if (onFileUpload) setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Tab bar */}
      <div style={s.tabBar}>
        <div style={s.tabs}>
          {tabs.map(tab => {
            const agent = agents.find(a => a.id === tab.agentId)
            const isActive = tab.agentId === activeTabId
            const dotColor = statusDotColor(tab.agentId)
            return (
              <div
                key={tab.agentId}
                style={{
                  ...s.tab,
                  ...(isActive ? s.tabActive : s.tabInactive),
                }}
                onClick={() => onTabSelect(tab.agentId)}
              >
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                <span style={s.tabLabel}>{agent?.name ?? tab.agentId}</span>
                {tabs.length > 1 && (
                  <button
                    style={s.tabClose}
                    onClick={e => { e.stopPropagation(); onTabClose(tab.agentId) }}
                  >×</button>
                )}
              </div>
            )
          })}
        </div>

        {/* Add tab button */}
        <div style={{ position: 'relative' }} ref={pickerRef}>
          <button
            style={{ ...s.addBtn, ...(pickerOpen ? s.addBtnActive : {}) }}
            onClick={() => setPickerOpen(p => !p)}
            title="Open chat with agent"
          >+</button>

          {pickerOpen && (
            <div style={s.picker}>
              {availableToAdd.length === 0 ? (
                <div style={s.pickerEmpty}>All agents are open</div>
              ) : (
                availableToAdd.map(a => (
                  <div
                    key={a.id}
                    style={s.pickerItem}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => { onTabAdd(a.id); setPickerOpen(false) }}
                  >
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusDotColor(a.id), flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#171717' }}>{a.name}</div>
                      <div style={{ fontSize: 10, color: '#a3a3a3' }}>{a.id}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Agent header */}
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={s.agentLabel}>{activeAgent?.name ?? activeTabId}</span>
          <span style={s.subtitle}>{activeAgent?.id ?? ''}</span>
        </div>
        {messages.length > 0 && !loading && (
          <button
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontSize: 11, padding: '2px 6px', borderRadius: 4 }}
            onClick={() => onClearHistory(activeTabId)}
            title="Clear history"
          >clear</button>
        )}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.blue, animation: 'pulse 1s infinite' }} />
            <span style={{ fontSize: 11, color: C.blue }}>thinking…</span>
          </div>
        )}
        {!loading && isBusy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b', animation: 'pulse 1s infinite' }} />
            <span style={{ fontSize: 11, color: '#f59e0b' }}>busy…</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div style={s.messages}>
        {messages.length === 0 && (
          <div style={s.empty}>Start a conversation with {activeAgent?.name ?? activeTabId}</div>
        )}
        {messages.map((m, i) => {
          const parsed = m.role === 'user' ? parseUserMessage(m.text) : null
          return (
          <div key={i} style={{ ...s.msg, ...(m.role === 'user' ? s.userMsg : s.agentMsg) }}>
            <span style={{ ...s.role, color: m.role === 'user' ? C.muted : C.blue }}>
              {m.role === 'user' ? 'you' : (activeAgent?.name ?? activeTabId)}
            </span>
            {parsed && parsed.files.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end', marginBottom: 4 }}>
                {parsed.files.map((f, fi) => <FileBadge key={fi} path={f} onClick={onOpenFile ? () => onOpenFile(f) : undefined} />)}
              </div>
            )}
            <div style={{ ...s.bubble, ...(m.role === 'user' ? s.userBubble : s.agentBubble), ...(m.streaming && !m.text ? s.statusBubble : {}) }}>
              {m.role === 'agent' ? (
                <div style={s.md}>
                  {m.streaming && !m.text ? (
                    <span style={{ fontStyle: 'italic', color: '#a3a3a3', fontSize: 12 }}>
                      {agentStatusText[activeTabId] || 'thinking...'}
                      {(agentElapsed[activeTabId] ?? 0) >= 15 && (
                        <span style={{ marginLeft: 6, color: '#c4b5a0' }}>{agentElapsed[activeTabId]}s</span>
                      )}
                      <span style={{ display: 'inline-block', width: 2, height: '0.85em', background: '#a3a3a3', marginLeft: 3, verticalAlign: 'text-bottom', animation: 'blink 1s step-start infinite' }} />
                    </span>
                  ) : (
                    <>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                      {m.streaming && (
                        <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#525252', marginLeft: 1, verticalAlign: 'text-bottom', animation: 'blink 1s step-start infinite' }} />
                      )}
                    </>
                  )}
                </div>
              ) : (
                <span>{parsed?.plainText ?? m.text}</span>
              )}
            </div>
          </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} style={s.form}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {attachments.map(a => {
                const ext = a.name.includes('.') ? a.name.split('.').pop()!.toUpperCase() : 'FILE'
                return (
                  <div key={a.path} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px 3px 10px', background: '#f5f5f5', border: '1px solid #e5e5e5', borderRadius: 20, fontSize: 12, color: '#171717' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#737373', fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>{ext}</span>
                    <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                    <button onClick={() => setAttachments(prev => prev.filter(x => x.path !== a.path))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a3a3a3', fontSize: 13, lineHeight: 1, padding: '0 2px', display: 'flex', alignItems: 'center' }}>✕</button>
                  </div>
                )
              })}
            </div>
          )}
          <textarea
            style={{ ...s.input, ...(disabled ? s.inputDisabled : {}) }}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
          />
        </div>
        {(isBusy || loading) && onStop ? (
          <button type="button" onClick={() => onStop(activeTabId)} style={{
            ...s.btn,
            background: '#ef4444',
            alignSelf: 'flex-end',
            height: 38,
          }}>✕</button>
        ) : (
          <button type="submit" disabled={loading || (!input.trim() && attachments.length === 0)} style={{
            ...s.btn,
            background: (loading || (!input.trim() && attachments.length === 0)) ? C.dim : C.accent,
            alignSelf: 'flex-end',
            height: 38,
          }}>
            {loading ? '…' : '↵'}
          </button>
        )}
      </form>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  chat:        { width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
                 background: '#ffffff' },
  tabBar:      { height: 48, display: 'flex', alignItems: 'center', borderBottom: '1px solid #e5e5e5',
                 background: '#fafafa', minHeight: 36, flexShrink: 0 },
  tabs:        { height: 48, display: 'flex', flex: 1, overflowX: 'auto', alignItems: 'stretch' },
  tab:         { display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
                 cursor: 'pointer', whiteSpace: 'nowrap', borderRight: '1px solid #e5e5e5',
                 minHeight: 36, transition: 'background 0.12s', userSelect: 'none' },
  tabActive:   { background: '#ffffff', borderBottom: '2px solid #000' },
  tabInactive: { background: 'transparent' },
  tabLabel:    { fontSize: 12, fontWeight: 500, color: '#171717' },
  tabClose:    { background: 'none', border: 'none', cursor: 'pointer', color: '#a3a3a3',
                 fontSize: 14, lineHeight: 1, padding: '0 2px', borderRadius: 3,
                 display: 'flex', alignItems: 'center' },
  addBtn:      { background: 'none', border: 'none', cursor: 'pointer', color: '#525252',
                 fontSize: 18, lineHeight: 1, padding: '0 12px', height: 36,
                 display: 'flex', alignItems: 'center', transition: 'color 0.12s' },
  addBtnActive:{ color: '#000' },
  picker:      { position: 'absolute', top: '100%', right: 0, background: '#fff',
                 border: '1px solid #e5e5e5', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                 minWidth: 180, zIndex: 200, padding: 4 },
  pickerEmpty: { fontSize: 12, color: '#a3a3a3', padding: '10px 12px' },
  pickerItem:  { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                 cursor: 'pointer', borderRadius: 6, transition: 'background 0.1s' },
  header:      { height: 44, padding: '0 16px', borderBottom: '1px solid #e5e5e5',
                 display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  agentLabel:  { color: '#000', fontWeight: 700, fontSize: 13, letterSpacing: '-0.3px' },
  subtitle:    { color: '#a3a3a3', fontSize: 11 },
  messages:    { flex: 1, overflowY: 'auto', padding: '16px', display: 'flex',
                 flexDirection: 'column', gap: 14 },
  empty:       { color: '#a3a3a3', textAlign: 'center', marginTop: 40, fontSize: 12 },
  msg:         { display: 'flex', flexDirection: 'column', gap: 4, maxWidth: '92%' },
  userMsg:     { alignSelf: 'flex-end', alignItems: 'flex-end' },
  agentMsg:    { alignSelf: 'flex-start', alignItems: 'flex-start' },
  role:        { fontSize: 10, fontWeight: 500, letterSpacing: '0.02em' },
  bubble:      { borderRadius: 10, padding: '6px 10px', fontSize: 13, lineHeight: 1.65,
                 wordBreak: 'break-word' },
  userBubble:  { background: '#242424', color: '#fff' },
  agentBubble: { color: '#171717',},
  statusBubble:{ background: 'transparent', border: 'none', padding: '2px 0' },
  md:          { fontSize: 13, lineHeight: 1.65 },
  form:        { display: 'flex', gap: 8, padding: '12px', borderTop: '1px solid #e5e5e5',
                 flexShrink: 0 },
  input:       { flex: 1, background: '#fafafa', border: '1px solid #e5e5e5', borderRadius: 8,
                 color: '#171717', fontFamily: 'inherit', fontSize: 13, padding: '9px 12px',
                 resize: 'none', outline: 'none', lineHeight: 1.5 },
  inputDisabled:{ background: '#f5f5f5', color: '#a3a3a3' },
  btn:         { border: 'none', borderRadius: 8, color: '#fff', fontFamily: 'inherit',
                 fontSize: 15, padding: '0 15px', cursor: 'pointer', transition: 'background 0.15s' },
}
