import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import {
  siGithub, siGitlab, siNotion, siLinear, siJira, siJirasoftware,
  siConfluence, siFigma, siPostgresql, siSqlite, siMysql, siMongodb,
  siRedis, siSupabase, siPuppeteer, siBrave, siGoogledrive, siGmail,
  siGooglecalendar, siDiscord, siTelegram, siX, siShopify, siStripe,
  siVercel, siAnthropic, siPerplexity, siGoogle,
} from 'simple-icons'
import type { Agent, AgentEvent } from '../../shared/types'
import characterSrc   from '../../assets/orches-character.svg'
import animated2Src   from '../../assets/orches-character-animated-2.svg'
import animated3Src   from '../../assets/orches-character-animated-3.svg'

const C = {
  bg: '#fafafa', surface: '#ffffff', border: '#e5e5e5', borderHi: '#d4d4d4',
  accent: '#000000', text: '#171717', textSec: '#525252', muted: '#a3a3a3', dim: '#d4d4d4',
  blue: '#0070f3',   blueDim:   'rgba(0,112,243,0.07)',
  purple: '#7928ca', purpleDim: 'rgba(121,40,202,0.07)',
  green: '#00a67e',  greenDim:  'rgba(0,166,126,0.07)',
  pink: '#eb367f',   pinkDim:   'rgba(235,54,127,0.07)',
  orange: '#f5a623', orangeDim: 'rgba(245,166,35,0.07)',
  cyan: '#0ea5e9',   cyanDim:   'rgba(14,165,233,0.07)',
}

const PAL = [
  { c: C.blue,   d: C.blueDim   },
  { c: C.purple, d: C.purpleDim },
  { c: C.green,  d: C.greenDim  },
  { c: C.pink,   d: C.pinkDim   },
  { c: C.orange, d: C.orangeDim },
  { c: C.cyan,   d: C.cyanDim   },
]

const TOOL_ICONS: Record<string, string> = {
  web_search: '↗', workspace_read: '▤', workspace_write: '◧',
  delegate: '⇢', memory: '◉', fetch_url: '⇲', canvas_open: '◫',
  'Web Search': '↗', 'File System': '◧',
}
const ti = (t: string) => TOOL_ICONS[t] ?? t.slice(0, 1).toUpperCase()

type Status = AgentEvent['event_type'] | 'idle'

interface Props {
  agents: Agent[]
  agentStatus: Record<string, Status>
  agentQueue: Record<string, number>
  activeEdges: Set<string>
  onAgentClick: (agent: Agent) => void
  onNewAgent: () => void
  onImportAgent: (config: Agent) => void
  onOpenSettings?: () => void
  onOpenWorkspace?: () => void
}

// Returns the point on a rect boundary (centered at cx,cy, half-size hw×hh)
// in direction (ux,uy) from the center
function rectBoundary(cx: number, cy: number, hw: number, hh: number, ux: number, uy: number) {
  if (ux === 0 && uy === 0) return [cx, cy]
  const tx = ux !== 0 ? hw / Math.abs(ux) : Infinity
  const ty = uy !== 0 ? hh / Math.abs(uy) : Infinity
  const t = Math.min(tx, ty)
  return [cx + ux * t, cy + uy * t]
}

// ── Edge ────────────────────────────────────────────────────────────────────
function Edge({ x1, y1, x2, y2, hw1, hh1, hw2, hh2, color, active }: {
  x1: number; y1: number; x2: number; y2: number
  hw1: number; hh1: number; hw2: number; hh2: number
  color: string; active: boolean
}) {
  const dx = x2-x1, dy = y2-y1, len = Math.sqrt(dx*dx+dy*dy)
  if (len === 0) return null
  const ux = dx/len, uy = dy/len
  const [sx, sy] = rectBoundary(x1, y1, hw1, hh1,  ux,  uy)
  const [ex, ey] = rectBoundary(x2, y2, hw2, hh2, -ux, -uy)
  const mx = (sx+ex)/2, my = (sy+ey)/2 - len*0.08
  const pid = `ep-${Math.round(sx)}-${Math.round(sy)}-${Math.round(ex)}-${Math.round(ey)}`
  const d = `M${sx},${sy} Q${mx},${my} ${ex},${ey}`
  return (
    <g>
      <path d={d} fill="none" stroke={active ? color : '#a3a3a3'}
        strokeWidth={active ? 2 : 1.5}
        strokeOpacity={active ? 0.75 : 0.6}
        strokeDasharray={active ? 'none' : '6 4'}
        style={{ transition: 'all 0.4s ease' }} />
      {active && <>
        <path id={pid} d={d} fill="none" stroke="none" />
        <circle r="2.5" fill={color} opacity="0.9">
          <animateMotion dur="1.8s" repeatCount="indefinite" begin="0s">
            <mpath xlinkHref={`#${pid}`} />
          </animateMotion>
        </circle>
        <circle r="1.8" fill={color} opacity="0.5">
          <animateMotion dur="1.8s" repeatCount="indefinite" begin="0.9s">
            <mpath xlinkHref={`#${pid}`} />
          </animateMotion>
        </circle>
      </>}
    </g>
  )
}

// ── Orchestrator card ────────────────────────────────────────────────────────
function orchIcon(status: string): string {
  if (status === 'done' || status === 'error') return animated3Src
  if (status !== 'idle') return animated2Src
  return characterSrc
}

function versioned(src: string, v: number) {
  return src !== characterSrc ? `${src}?v=${v}` : src
}

function OrchIcon({ status, selected }: { status: string; selected: boolean }) {
  const vRef    = useRef(0)
  const prevRef = useRef(status)
  const [src, setSrc] = useState(() => versioned(orchIcon(status), 0))

  useEffect(() => {
    if (status === prevRef.current) return
    prevRef.current = status
    vRef.current++
    setSrc(versioned(orchIcon(status), vRef.current))
  }, [status])

  return (
    <img
      key={src}
      src={src}
      draggable={false}
      style={{
        height: 120, width: 'auto', pointerEvents: 'none', display: 'block',
        filter: selected ? 'brightness(0) invert(1)' : 'none',
        marginTop: -15,
      }}
    />
  )
}

function OrchCard({ x, y, selected, active, status, onSelect, onDrag }: {
  x: number; y: number; selected: boolean; active: boolean; status: string
  onSelect: () => void; onDrag: (e: React.MouseEvent) => void
}) {
  const w = 170, h = 152
  return (
    <foreignObject x={x-w/2} y={y-h/2} width={w} height={h}
      style={{ overflow: 'visible', cursor: 'grab' }}
      onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onDrag(e) }}
      onClick={e => { e.stopPropagation(); onSelect() }}>
      <div draggable={false} style={{
        width: w, height: h,
        background: selected ? C.accent : C.surface,
        border: `1px solid ${selected ? C.accent : C.border}`,
        borderRadius: 14,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 2,
        boxShadow: selected
          ? '0 0 0 3px rgba(0,0,0,0.08), 0 12px 40px rgba(0,0,0,0.1)'
          : active
            ? '0 0 0 2px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06)'
            : '0 1px 3px rgba(0,0,0,0.04)',
        transition: 'all 0.2s ease', userSelect: 'none', overflow: 'hidden',
      }}>
        <OrchIcon status={status} selected={selected} />
        <span style={{ fontSize: 12, fontWeight: 600, color: selected ? '#fff' : C.text,
          letterSpacing: '-0.3px', lineHeight: 1, marginTop: -10 }}>
          Orches
        </span>
      </div>
    </foreignObject>
  )
}

// Maps MCP server name keywords → simple-icons icon object
const MCP_ICON_MAP: { match: string; icon: { path: string } }[] = [
  { match: 'github',     icon: siGithub       },
  { match: 'gitlab',     icon: siGitlab       },
  { match: 'notion',     icon: siNotion       },
  { match: 'linear',     icon: siLinear       },
  { match: 'jira',       icon: siJirasoftware },
  { match: 'confluence', icon: siConfluence   },
  { match: 'figma',      icon: siFigma        },
  { match: 'postgres',   icon: siPostgresql   },
  { match: 'sqlite',     icon: siSqlite       },
  { match: 'mysql',      icon: siMysql        },
  { match: 'mongo',      icon: siMongodb      },
  { match: 'redis',      icon: siRedis        },
  { match: 'supabase',   icon: siSupabase     },
  { match: 'puppeteer',  icon: siPuppeteer    },
  { match: 'brave',      icon: siBrave        },
  { match: 'gdrive',     icon: siGoogledrive  },
  { match: 'gmail',      icon: siGmail        },
  { match: 'calendar',   icon: siGooglecalendar },
  { match: 'discord',    icon: siDiscord      },
  { match: 'telegram',   icon: siTelegram     },
  { match: 'twitter',    icon: siX            },
  { match: 'shopify',    icon: siShopify      },
  { match: 'stripe',     icon: siStripe       },
  { match: 'vercel',     icon: siVercel       },
  { match: 'anthropic',  icon: siAnthropic    },
  { match: 'perplexity', icon: siPerplexity   },
  { match: 'google',     icon: siGoogle       },
]

function getMcpSvgPath(name: string): string | null {
  const lname = name.toLowerCase()
  return MCP_ICON_MAP.find(({ match }) => lname.includes(match))?.icon.path ?? null
}

function McpCircle({ name, color }: { name: string; color: string }) {
  const svgPath = useMemo(() => getMcpSvgPath(name), [name])

  return (
    <div title={name} style={{
      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
      background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {svgPath ? (
        <svg viewBox="0 0 24 24" width={13} height={13} fill="#fff">
          <path d={svgPath} />
        </svg>
      ) : (
        <span style={{ fontSize: 8, fontWeight: 700, color: '#fff', letterSpacing: 0 }}>
          {name.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  )
}

// Estimates half-height of an AgentCard based on its content
function agentCardHH(agent: Agent): number {
  let h = 46  // padding (24) + header row (~20) + border (2)
  if (agent.description) h += 38  // 2 lines × lineHeight + gap
  return Math.round(h / 2)
}

// ── Agent card ───────────────────────────────────────────────────────────────
function AgentCard({ agent, x, y, selected, active, pal, status, queueDepth, mcpServers, onSelect, onDrag }: {
  agent: Agent; x: number; y: number; selected: boolean; active: boolean
  pal: { c: string; d: string }; status: string; queueDepth: number
  mcpServers: { name: string }[]
  onSelect: () => void; onDrag: (e: React.MouseEvent) => void
}) {
  const [taskCount, setTaskCount] = useState(0)

  useEffect(() => {
    fetch(`http://localhost:8000/agents/${agent.id}/tasks`)
      .then(r => r.json())
      .then((data: unknown[]) => setTaskCount(Array.isArray(data) ? data.filter((t: any) => t.status === 'pending' || t.status === 'running').length : 0))
      .catch(() => {})
  }, [agent.id])

  const agentMcpServers = mcpServers.filter(srv =>
    (agent.tools ?? []).some(t => t === srv.name || t.startsWith(srv.name + '__'))
  )

  const w = 210
  const statusLabel: Record<string, string> = {
    thinking: 'thinking…', tool_call: 'working', delegating: 'delegating',
    started: 'starting', done: 'done', error: 'error',
  }

  const MCP_COLORS = ['#7928ca', '#0070f3', '#00a67e', '#f5a623', '#eb367f', '#0ea5e9']

  const hh = agentCardHH(agent)
  return (
    <foreignObject x={x-w/2} y={y-hh} width={w} height={hh*2}
      style={{ overflow: 'visible', pointerEvents: 'none' }}>
      <div draggable={false}
        onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onDrag(e) }}
        onClick={e => { e.stopPropagation(); onSelect() }}
        style={{ pointerEvents: 'auto', cursor: 'grab', width: w, background: C.surface,
        border: `1px solid ${selected ? pal.c : active ? pal.c : C.border}`,
        borderRadius: 12, padding: '12px 14px',
        boxShadow: selected
          ? `0 0 0 3px ${pal.d}, 0 8px 30px rgba(0,0,0,0.07)`
          : active
            ? `0 0 0 2px ${pal.d}, 0 4px 16px rgba(0,0,0,0.05)`
            : '0 1px 3px rgba(0,0,0,0.04)',
        transition: 'all 0.2s ease', userSelect: 'none',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: active ? pal.c : C.dim,
            boxShadow: active ? `0 0 0 3px ${pal.d}` : 'none', transition: 'all 0.3s' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text, letterSpacing: '-0.3px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {agent.name ?? agent.id}
          </span>
          {queueDepth > 0 && (
            <span style={{ fontSize: 10, color: C.orange, fontFamily: 'var(--mono)', background: C.orangeDim, borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
              ⏳{queueDepth}
            </span>
          )}
          {active && statusLabel[status] && (
            <span style={{ fontSize: 10, color: pal.c, fontFamily: 'var(--mono)', background: pal.d, borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
              {statusLabel[status]}
            </span>
          )}
        </div>

        {/* Description */}
        {agent.description && (
          <div style={{ fontSize: 11, color: C.textSec, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {agent.description}
          </div>
        )}

        {/* Footer: MCP icons + task count */}
        {(agentMcpServers.length > 0 || taskCount > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            {agentMcpServers.map((srv, i) => (
              <McpCircle key={srv.name} name={srv.name} color={MCP_COLORS[i % MCP_COLORS.length]} />
            ))}
            {taskCount > 0 && (
              <span style={{ marginLeft: agentMcpServers.length > 0 ? 4 : 0, fontSize: 10, color: C.textSec, display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ fontSize: 11 }}>📅</span>{taskCount} task{taskCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
      </div>
    </foreignObject>
  )
}

const LAYOUT_KEY = 'orches_graph_layout'

function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as { pos: Record<string, { x: number; y: number }>; pan: { x: number; y: number }; zm: number }
  } catch { return null }
}

// ── Main component ───────────────────────────────────────────────────────────
export default function AgentGraph({ agents, agentStatus, agentQueue, activeEdges, onAgentClick, onNewAgent, onImportAgent, onOpenSettings, onOpenWorkspace }: Props) {
  const saved = useMemo(() => loadLayout(), [])
  const [pos, setPos]       = useState<Record<string, { x: number; y: number }>>(saved?.pos ?? {})
  const [pan, setPan]       = useState(saved?.pan ?? { x: 0, y: 0 })
  const [zm, setZm]         = useState(saved?.zm ?? 1)
  const [dims, setDims]     = useState({ w: 900, h: 600 })
  const [sel, setSel]       = useState<string | null>(null)
  const [animating, setAnimating] = useState(false)
  const [mcpServers, setMcpServers] = useState<{ name: string }[]>([])

  // Persist layout to localStorage (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ pos, pan, zm }))
    }, 600)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [pos, pan, zm])

  useEffect(() => {
    fetch('http://localhost:8000/registry/mcp')
      .then(r => r.json())
      .then((data: unknown) => setMcpServers(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])
  const svgRef   = useRef<SVGSVGElement>(null)
  const boxRef   = useRef<HTMLDivElement>(null)
  const dragRef  = useRef<{ id: string; ox: number; oy: number } | null>(null)
  const panRef   = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const didDragRef = useRef(false)

  useEffect(() => {
    const upd = () => { if (boxRef.current) setDims({ w: boxRef.current.offsetWidth, h: boxRef.current.offsetHeight }) }
    upd()
    window.addEventListener('resize', upd)
    return () => window.removeEventListener('resize', upd)
  }, [])

  // Default positions
  const getPos = useCallback((id: string) => {
    if (pos[id]) return pos[id]
    if (id === 'main') return { x: dims.w / 2, y: 120 }
    const subAgents = agents.filter(a => a.id !== 'main')
    const idx = subAgents.findIndex(a => a.id === id)
    const n = subAgents.length
    const spread = Math.min(dims.w - 260, n * 220)
    const startX = (dims.w - spread) / 2 + 100
    const gap = n > 1 ? spread / (n - 1) : 0
    return { x: n === 1 ? dims.w / 2 : startX + idx * gap, y: 320 }
  }, [agents, pos, dims])

  // Determine which agent is "main" (orchestrator)
  const mainAgent = agents.find(a => a.id === 'main')
  const subAgents = agents.filter(a => a.id !== 'main')

  // Active flows — any non-idle agent
  const activeAgents = Object.entries(agentStatus)
    .filter(([, s]) => s !== 'idle')
    .map(([id]) => id)

  // Drag
  const onDragStart = useCallback((id: string, e: React.MouseEvent) => {
    if (!svgRef.current) return
    const r = svgRef.current.getBoundingClientRect()
    const p = getPos(id)
    didDragRef.current = false
    dragRef.current = { id, ox: (e.clientX - r.left) / zm - pan.x - p.x, oy: (e.clientY - r.top) / zm - pan.y - p.y }
  }, [getPos, pan, zm])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current
    if (drag && svgRef.current) {
      const r = svgRef.current.getBoundingClientRect()
      const x = (e.clientX - r.left) / zm - pan.x - drag.ox
      const y = (e.clientY - r.top)  / zm - pan.y - drag.oy
      didDragRef.current = true
      setPos(p => ({ ...p, [drag.id]: { x, y } }))
    } else if (panRef.current) {
      const dx = e.clientX - panRef.current.sx
      const dy = e.clientY - panRef.current.sy
      setPan({ x: panRef.current.px + dx / zm, y: panRef.current.py + dy / zm })
    }
  }, [pan, zm])

  const fitView = useCallback(() => {
    const allNodes = agents.length > 0 ? agents : []
    if (allNodes.length === 0) return
    const positions = allNodes.map(a => getPos(a.id))
    const PAD = 60, TOP_BAR = 52, CW = 110, CH = 52
    const minX = Math.min(...positions.map(p => p.x)) - CW
    const maxX = Math.max(...positions.map(p => p.x)) + CW
    const minY = Math.min(...positions.map(p => p.y)) - CH
    const maxY = Math.max(...positions.map(p => p.y)) + CH
    const bw = maxX - minX + PAD * 2
    const bh = maxY - minY + PAD * 2
    const availW = dims.w
    const availH = dims.h - TOP_BAR
    const newZm = Math.min(availW / bw, availH / bh, 1.5)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const newPan = {
      x: availW  / (2 * newZm) - cx,
      y: (availH / (2 * newZm) - cy) + TOP_BAR / (2 * newZm),
    }
    setAnimating(true)
    setZm(newZm)
    setPan(newPan)
    setTimeout(() => setAnimating(false), 500)
  }, [agents, getPos, dims])

  const onMouseUp = useCallback(() => { dragRef.current = null; panRef.current = null }, [])

  const onBgDown = useCallback((e: React.MouseEvent) => {
    const t = e.target as Element
    if (t === svgRef.current || t.tagName === 'rect') {
      panRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }
      setSel(null)
    }
  }, [pan])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZm(z => Math.max(0.3, Math.min(2.5, z - e.deltaY * 0.001)))
  }, [])

  const orchPos = getPos('main')
  const liveCount = activeAgents.length

  return (
    <div ref={boxRef} style={{ flex: 1, position: 'relative', background: C.bg, overflow: 'hidden', minWidth: 0 }}>
      {/* Dot grid */}
      <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.4 }} width="100%" height="100%">
        <defs>
          <pattern id="dg" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.5" fill={C.dim} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dg)" />
      </svg>

      {/* Top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 48, zIndex: 100,
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 14,
        background: 'rgba(250,250,250,0.88)', backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${C.border}`,
      }}>
        
        <span style={{ fontSize: 12, color: C.muted }}>{agents.length} agent{agents.length !== 1 ? 's' : ''}</span>

        {liveCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px',
            background: 'rgba(0,166,126,0.07)', borderRadius: 20 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00a67e', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 11, color: '#00a67e', fontWeight: 500 }}>Live</span>
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {onOpenWorkspace && (
            <button onClick={onOpenWorkspace} title="Workspace" style={{
              padding: '6px 14px', background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 8, color: C.textSec, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            }}>Workspace</button>
          )}
          {onOpenSettings && (
            <button onClick={onOpenSettings} title="Settings" style={{
              padding: '6px 10px', background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 8, color: C.textSec, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
            }}>⚙</button>
          )}
          <label style={{
            padding: '6px 14px', background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 8, color: C.textSec, fontSize: 12, fontWeight: 500, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>
            Import .agent
            <input type="file" accept=".agent,.json" style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = ev => {
                  try { onImportAgent(JSON.parse(ev.target?.result as string)) }
                  catch { alert('Invalid .agent file') }
                }
                reader.readAsText(file)
                e.target.value = ''
              }} />
          </label>
          <button onClick={onNewAgent} style={{
            padding: '6px 16px', background: C.accent, border: 'none', borderRadius: 8,
            color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            letterSpacing: '-0.2px',
          }}>+ New Agent</button>
        </div>
      </div>

      {/* Canvas */}
      <svg ref={svgRef} width="100%" height="100%"
        onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onMouseDown={onBgDown} onWheel={onWheel}
        style={{ cursor: panRef.current ? 'grabbing' : 'default' }}>
        <g transform={`scale(${zm}) translate(${pan.x},${pan.y})`}
          style={{ transition: animating ? 'transform 0.45s cubic-bezier(0.32,0.72,0,1)' : 'none' }}>
          {/* Edges — only where can_call relationship exists */}
          {agents.flatMap(src => {
            const srcPos = getPos(src.id)
            const srcIsOrch = src.id === 'main'
            const srcHW = srcIsOrch ? 85 : 100
            const srcHH = srcIsOrch ? 76 : agentCardHH(src)
            return (src.can_call ?? []).map(targetId => {
              const tgt = agents.find(a => a.id === targetId)
              if (!tgt) return null
              const tgtPos = getPos(targetId)
              const tgtIsOrch = targetId === 'main'
              const tgtHW = tgtIsOrch ? 85 : 100
              const tgtHH = tgtIsOrch ? 76 : agentCardHH(tgt)
              const tgtIdx = subAgents.findIndex(a => a.id === targetId)
              const color = PAL[Math.max(tgtIdx, 0) % PAL.length].c
              const active = activeEdges.has(`${src.id}->${targetId}`)
              return (
                <Edge key={`${src.id}->${targetId}`}
                  x1={srcPos.x} y1={srcPos.y}
                  x2={tgtPos.x} y2={tgtPos.y}
                  hw1={srcHW} hh1={srcHH}
                  hw2={tgtHW} hh2={tgtHH}
                  color={color}
                  active={active} />
              )
            })
          })}

          {/* Orchestrator */}
          {mainAgent && (
            <OrchCard
              x={orchPos.x} y={orchPos.y}
              selected={sel === 'main'}
              active={activeAgents.includes('main')}
              status={agentStatus['main'] ?? 'idle'}
              onSelect={() => { if (!didDragRef.current) { setSel('main'); onAgentClick(mainAgent) } }}
              onDrag={e => onDragStart('main', e)} />
          )}

          {/* Sub-agents */}
          {subAgents.map((a, i) => {
            const p = getPos(a.id)
            return (
              <AgentCard key={a.id} agent={a} x={p.x} y={p.y}
                selected={sel === a.id}
                active={activeAgents.includes(a.id)}
                pal={PAL[i % PAL.length]}
                status={agentStatus[a.id] ?? 'idle'}
                queueDepth={agentQueue[a.id] ?? 0}
                mcpServers={mcpServers}
                onSelect={() => { if (!didDragRef.current) { setSel(a.id); onAgentClick(a) } }}
                onDrag={e => onDragStart(a.id, e)} />
            )
          })}
        </g>
      </svg>

      {/* Data flow status */}
      {activeAgents.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 20, left: 20, zIndex: 100,
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: '12px 16px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)', minWidth: 180,
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.muted,
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Data Flow
          </div>
          {activeAgents.map(id => {
            const a = agents.find(x => x.id === id)
            const i = subAgents.findIndex(x => x.id === id)
            const pal = PAL[Math.max(i, 0) % PAL.length]
            return (
              <div key={id} style={{ fontSize: 12, color: C.text,
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ color: C.textSec }}>main</span>
                <span style={{ color: C.dim }}>→</span>
                <span style={{ color: id === 'main' ? C.accent : pal.c, fontWeight: 500 }}>
                  {a?.name ?? id}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Zoom indicator + fit button */}
      <div style={{
        position: 'absolute', bottom: 20, right: 20,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <button
          onClick={fitView}
          title="Fit all nodes in view"
          style={{
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 8, color: C.textSec, fontSize: 12,
            padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Fit
        </button>
        <div style={{
          fontSize: 11, color: C.muted,
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: '5px 10px',
          fontFamily: 'var(--mono)',
        }}>
          {Math.round(zm * 100)}%
        </div>
      </div>
    </div>
  )
}
