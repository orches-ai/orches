import { useEffect, useRef, useState } from 'react'
import type { AgentEvent } from '../../shared/types'

// ── Colors ────────────────────────────────────────────────────────────────────

const PAL = ['#0070f3', '#7928ca', '#00a67e', '#eb367f', '#f5a623', '#0ea5e9']
const _colorMap: Record<string, string> = {}
let _idx = 0
function agentColor(id: string): string {
  if (!_colorMap[id]) _colorMap[id] = PAL[_idx++ % PAL.length]
  return _colorMap[id]
}

const TYPE_ICON: Record<string, string> = {
  started: '▶', thinking: '◌', tool_call: '⚙',
  delegating: '→', done: '✓', error: '✗', heartbeat: '♥',
}
const TYPE_COLOR: Record<string, string> = {
  started: '#00a67e', thinking: '#a3a3a3', tool_call: '#f5a623',
  delegating: '#7928ca', done: '#00a67e', error: '#e00020', heartbeat: '#d4d4d4',
}

// ── Grouping ──────────────────────────────────────────────────────────────────

interface EventGroup {
  id: string
  agent_id: string
  status: 'running' | 'done' | 'error'
  task: string
  steps: AgentEvent[]
  startTime: string
}

function groupEvents(events: AgentEvent[]): EventGroup[] {
  const groups: EventGroup[] = []
  const current: Record<string, number> = {}

  for (const e of events) {
    if (e.event_type === 'started') {
      const g: EventGroup = {
        id: String(e.payload?.run_id ?? `${e.agent_id}-${groups.length}`),
        agent_id: e.agent_id,
        status: 'running',
        task: String(e.payload?.task ?? '').slice(0, 80),
        steps: [e],
        startTime: e._time ?? '',
      }
      current[e.agent_id] = groups.length
      groups.push(g)
    } else if (e.event_type !== 'status' && e.event_type !== 'queued' && e.event_type !== 'unqueued') {
      const idx = current[e.agent_id]
      if (idx !== undefined) {
        groups[idx].steps.push(e)
        if (e.event_type === 'done')  groups[idx].status = 'done'
        if (e.event_type === 'error') groups[idx].status = 'error'
      }
    }
  }

  return groups
}

function stepLabel(e: AgentEvent): string {
  const p = e.payload as any
  switch (e.event_type) {
    case 'tool_call':  return `${p.tool}(${Object.entries(p.input ?? {}).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join(', ')})`
    case 'delegating': return `→ ${p.to}: ${String(p.task ?? '').slice(0, 60)}`
    case 'done':       return String(p.result ?? '').slice(0, 80)
    case 'started':    return String(p.task ?? '').slice(0, 60)
    case 'heartbeat':  return `still running (${p.elapsed}s)`
    default: return ''
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { events: AgentEvent[] }

export default function EventLog({ events }: Props) {
  const groups = groupEvents(events)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const bottomRef = useRef<HTMLDivElement>(null)

  // Collapse done/error groups after a delay (only if they were explicitly opened)
  useEffect(() => {
    const last = groups[groups.length - 1]
    if (!last) return
    if ((last.status === 'done' || last.status === 'error') && expanded[last.id]) {
      const t = setTimeout(() => setExpanded(p => ({ ...p, [last.id]: false })), 2000)
      return () => clearTimeout(t)
    }
  }, [groups[groups.length - 1]?.status])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [groups.length])

  function toggle(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <span style={s.title}>Events</span>
        {groups.length > 0 && (
          <span style={s.count}>{groups.length}</span>
        )}
      </div>

      <div style={s.list}>
        {groups.length === 0 && <div style={s.empty}>waiting for events…</div>}

        {groups.map(g => {
          const isOpen = expanded[g.id] ?? false
          const color  = agentColor(g.agent_id)
          const isRunning = g.status === 'running'

          return (
            <div key={g.id} style={{ ...s.group, borderLeft: `2px solid ${isRunning ? color : '#e5e5e5'}` }}>

              {/* Group header */}
              <div style={s.groupHeader} onClick={() => toggle(g.id)}>
                <span style={{ ...s.statusDot, background: isRunning ? color : g.status === 'done' ? '#00a67e' : '#e00020' }} />
                <span style={{ ...s.agentName, color }}>{g.agent_id}</span>
                {(() => {
                  const last = g.steps[g.steps.length - 1]
                  const t = last?.event_type ?? 'started'
                  return (
                    <span style={{ fontSize: 11, color: TYPE_COLOR[t] ?? '#a3a3a3', flexShrink: 0 }}>
                      {TYPE_ICON[t] ?? '·'} {t}
                    </span>
                  )
                })()}
                <span style={{ flex: 1 }} />
                <span style={s.stepCount}>{g.steps.length}</span>
                <span style={s.chevron}>{isOpen ? '▾' : '▸'}</span>
              </div>

              {/* Steps */}
              {isOpen && (
                <div style={s.steps}>
                  {g.steps.map((e, i) => (
                    <div key={i} style={s.step}>
                      <span style={{ ...s.stepIcon, color: TYPE_COLOR[e.event_type] ?? '#a3a3a3' }}>
                        {TYPE_ICON[e.event_type] ?? '·'}
                      </span>
                      <span style={{ ...s.stepType, color: TYPE_COLOR[e.event_type] ?? '#a3a3a3' }}>
                        {e.event_type}
                      </span>
                      <span style={s.stepLabel}>{stepLabel(e)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  panel:       { width: '100%', height: '100%', background: '#ffffff', display: 'flex', flexDirection: 'column' },
  header:      { height: 48, padding: '4px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  title:       { fontSize: 12, fontWeight: 600, color: '#171717', letterSpacing: '-0.2px' },
  count:       { fontSize: 11, color: '#a3a3a3', background: '#f5f5f5', border: '1px solid #e5e5e5', borderRadius: 6, padding: '1px 7px', fontFamily: 'var(--mono)' },
  list:        { flex: 1, overflowY: 'auto', padding: '6px 0' },
  empty:       { padding: '20px 16px', color: '#a3a3a3', fontSize: 12, fontStyle: 'italic' },

  group:       { margin: '4px 8px', borderRadius: 6, overflow: 'hidden', background: '#fafafa', marginBottom: 4 },
  groupHeader: { display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', cursor: 'pointer', userSelect: 'none' },
  statusDot:   { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  agentName:   { fontWeight: 600, fontSize: 11, flexShrink: 0 },
  taskPreview: { fontSize: 11, color: '#525252', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  stepCount:   { fontSize: 10, color: '#a3a3a3', background: '#efefef', borderRadius: 4, padding: '0 5px', fontFamily: 'var(--mono)', flexShrink: 0 },
  chevron:     { fontSize: 10, color: '#a3a3a3', flexShrink: 0 },

  steps:       { padding: '0 10px 8px 22px', display: 'flex', flexDirection: 'column', gap: 3 },
  step:        { display: 'flex', gap: 5, alignItems: 'baseline' },
  stepIcon:    { fontSize: 10, flexShrink: 0, width: 12 },
  stepType:    { fontSize: 10, fontWeight: 600, flexShrink: 0 },
  stepLabel:   { fontSize: 10, color: '#a3a3a3', wordBreak: 'break-all' },
}
