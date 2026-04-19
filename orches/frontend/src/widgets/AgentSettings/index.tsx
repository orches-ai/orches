import { useState, useEffect } from 'react'
import type { Agent } from '../../shared/types'

const API = 'http://localhost:8000'

interface ToolMeta { name: string; description: string }

interface Props {
  agent: Agent | null
  agents: Agent[]
  onClose: () => void
  onSave: (updated: Agent) => void
  onDelete?: (id: string) => void
  depth?: number  // 0 = top (default), 1+ = behind
}

const BLANK_AGENT: Agent = {
  id: '', name: '', description: '', system_prompt: 'You are a helpful assistant.',
  tools: [], can_call: [],
}

function toYaml(cfg: Agent): string {
  const lines: string[] = []
  lines.push(`id: ${cfg.id || '(empty)'}`)
  lines.push(`name: ${cfg.name || '(empty)'}`)
  if (cfg.system_prompt) {
    const rows = cfg.system_prompt.split('\n')
    if (rows.length === 1) {
      lines.push(`system_prompt: ${cfg.system_prompt}`)
    } else {
      lines.push('system_prompt: |-')
      rows.forEach(r => lines.push(`  ${r}`))
    }
  } else {
    lines.push('system_prompt: ""')
  }
  if (cfg.tools?.length) {
    lines.push('tools:')
    cfg.tools.forEach(t => lines.push(`  - ${t}`))
  } else {
    lines.push('tools: []')
  }
  if (cfg.can_call?.length) {
    lines.push('can_call:')
    cfg.can_call.forEach(t => lines.push(`  - ${t}`))
  } else {
    lines.push('can_call: []')
  }
  return lines.join('\n')
}

function ToggleGroup({
  label, items, selected, onToggle, color = '#0ea5e9',
}: {
  label: string
  items: { value: string; hint?: string }[]
  selected: string[]
  onToggle: (v: string) => void
  color?: string
}) {
  if (items.length === 0)
    return (
      <>
        <div style={s.label}>{label}</div>
        <div style={s.empty}>none available</div>
      </>
    )
  return (
    <>
      <div style={s.label}>{label}</div>
      <div style={s.chips}>
        {items.map(item => {
          const active = selected.includes(item.value)
          return (
            <button
              key={item.value}
              title={item.hint}
              onClick={() => onToggle(item.value)}
              style={{
                ...s.chip,
                borderColor: active ? color : '#e5e5e5',
                color: active ? color : '#a3a3a3',
                background: active ? `${color}18` : 'transparent',
              }}
            >
              {item.value}
            </button>
          )
        })}
      </div>
    </>
  )
}

export default function AgentSettings({ agent, agents, onClose, onSave, onDelete, depth = 0 }: Props) {
  const isNew = agent === null
  const base  = agent ?? BLANK_AGENT

  const [id, setId]             = useState(base.id)
  const [name, setName]         = useState(base.name)
  const [description, setDesc]  = useState(base.description ?? '')
  const [prompt, setPrompt]     = useState(base.system_prompt ?? '')
  const [tools, setTools]       = useState<string[]>(base.tools ?? [])
  const [canCall, setCanCall]   = useState<string[]>(base.can_call ?? [])
  const [saving, setSaving]   = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error, setError]     = useState('')
  const [availableTools, setAvailableTools] = useState<ToolMeta[]>([])
  const [tab, setTab]         = useState<'form' | 'yaml' | 'json' | 'usage' | 'tasks'>('form')
  const [stats, setStats]     = useState<{ total_runs: number; tokens_used: number; input_tokens: number; output_tokens: number; cost_usd: number; avg_duration_ms: number } | null>(null)

  type ScheduledTask = { task_id: string; input: string; schedule: string; repeat: boolean; status: string; next_run_at: string | null; last_run_at: string | null; result: string | null; error: string | null }
  const [tasks, setTasks]         = useState<ScheduledTask[]>([])
  const [taskInput, setTaskInput]     = useState('')
  const [taskRepeat, setTaskRepeat]   = useState(false)
  const [taskError, setTaskError]     = useState('')
  const [schedMode, setSchedMode]     = useState<'once' | 'cron'>('once')
  const [schedDate, setSchedDate]     = useState('')   // YYYY-MM-DD
  const [schedTime, setSchedTime]     = useState('09:00')
  const [schedCron, setSchedCron]     = useState('0 9 * * 1-5')

  function buildSchedule(): string {
    if (schedMode === 'cron') return schedCron.trim()
    return schedDate ? `${schedDate}T${schedTime}` : ''
  }
  const [visible, setVisible] = useState(false)

  // Trigger slide-in on mount
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  useEffect(() => {
    fetch(`${API}/registry/tools`)
      .then(r => r.json())
      .then((data: ToolMeta[]) => setAvailableTools(data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!agent || isNew) return
    fetch(`${API}/agents/${agent.id}/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => {})
  }, [agent?.id])

  function loadTasks() {
    if (!agent || isNew) return
    fetch(`${API}/agents/${agent.id}/tasks`)
      .then(r => r.json())
      .then(setTasks)
      .catch(() => {})
  }

  useEffect(() => { loadTasks() }, [agent?.id])

  async function handleCreateTask() {
    const schedule = buildSchedule()
    if (!taskInput.trim() || !schedule) { setTaskError('Task and schedule are required'); return }
    setTaskError('')
    const res = await fetch(`${API}/agents/${agent!.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: taskInput.trim(), schedule, repeat: schedMode === 'cron' }),
    })
    if (!res.ok) { setTaskError((await res.json()).detail ?? 'Error'); return }
    setTaskInput('')
    setSchedDate('')
    setSchedTime('09:00')
    setSchedCron('0 9 * * 1-5')
    setSchedMode('once')
    loadTasks()
  }

  async function handleRunNow(task_id: string) {
    await fetch(`${API}/agents/${agent!.id}/tasks/${task_id}/run`, { method: 'POST' })
    setTimeout(loadTasks, 500)
  }

  async function handleCancelTask(task_id: string) {
    await fetch(`${API}/agents/${agent!.id}/tasks/${task_id}/cancel`, { method: 'POST' })
    loadTasks()
  }

  async function handleDeleteTask(task_id: string) {
    await fetch(`${API}/agents/${agent!.id}/tasks/${task_id}`, { method: 'DELETE' })
    loadTasks()
  }

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter(v => v !== value) : [...list, value]
  }

  function buildConfig(): Agent {
    return { ...base, id: id.trim(), name: name.trim(), description: description.trim(), system_prompt: prompt.trim(), tools, can_call: canCall }
  }

  async function handleSave() {
    if (!id.trim()) { setError('ID is required'); return }
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')
    const config = buildConfig()
    try {
      const method = isNew ? 'POST' : 'PUT'
      const url    = isNew ? `${API}/agents/` : `${API}/agents/${id}/`
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      if (!res.ok) throw new Error(await res.text())
      onSave(config)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!agent) return
    try { await fetch(`${API}/agents/${agent.id}`, { method: 'DELETE' }) }
    finally { onDelete?.(agent.id) }
  }

  function handleExport() {
    const config = buildConfig()
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${config.id}.agent`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const otherAgents = agents.filter(a => a.id !== id)

  return (
    <>
      {/* Backdrop — only top panel (depth 0) dims the background */}
      <div
        onClick={depth === 0 ? onClose : undefined}
        style={{
          position: 'absolute', inset: 0,
          background: (visible && depth === 0) ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0)',
          transition: 'background 0.3s ease',
          zIndex: 50 - depth * 2,
          pointerEvents: depth === 0 ? 'auto' : 'none',
        }}
      />

      {/* Slide-in panel — depth 0 = top, highest z-index */}
      <div style={{
        position: 'absolute', top: 0, right: 0, height: '100%', width: '100%',
        background: '#ffffff',
        borderLeft: '1px solid #e5e5e5',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.08)',
        display: 'flex', flexDirection: 'column',
        zIndex: 51 - depth * 2,
        transform: visible
          ? `translateX(${-depth * 14}px)`
          : 'translateX(100%)',
        transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        opacity: 1 - depth * 0.1,
        pointerEvents: depth === 0 ? 'auto' : 'none',
      }}>

        {/* Header */}
        <div style={s.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: isNew ? '#0070f3' : '#00a67e',
            }} />
            <div>
              <div style={s.title}>{isNew ? 'New Agent' : (agent.name || agent.id)}</div>
              <div style={s.subtitle}>{isNew ? 'create agent' : agent.id}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={s.tabs}>
              {(['form', 'yaml', 'json'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  ...s.tabBtn,
                  ...(tab === t ? s.tabActive : {}),
                }}>{t.toUpperCase()}</button>
              ))}
            </div>
            <button onClick={onClose} style={s.closeBtn}>✕</button>
          </div>
        </div>

        {/* Sub-nav for Usage / Tasks */}
        {!isNew && (
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e5e5', padding: '0 20px' }}>
            {(['usage', 'tasks'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                background: 'none', border: 'none', borderBottom: tab === t ? '2px solid #171717' : '2px solid transparent',
                color: tab === t ? '#171717' : '#a3a3a3', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 500, padding: '8px 14px', cursor: 'pointer',
                textTransform: 'uppercase', letterSpacing: '0.04em', transition: 'all 0.15s',
                marginBottom: -1,
              }}>{t}</button>
            ))}
          </div>
        )}

        {/* Body */}
        <div style={s.body}>
          {error && <div style={s.error}>{error}</div>}

          {tab === 'form' && <>
            <div style={s.label}>ID {isNew && <span style={s.required}>*</span>}</div>
            <input
              style={{ ...s.input, ...(isNew ? {} : s.readonly) }}
              value={id}
              onChange={e => isNew && setId(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
              readOnly={!isNew}
              placeholder="e.g. analyst"
            />

            <div style={s.label}>Display name <span style={s.required}>*</span></div>
            <input
              style={s.input}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Data Analyst"
            />

            <div style={s.label}>Description <span style={{ color: '#a3a3a3', fontWeight: 400, textTransform: 'none' }}>(shown on graph node)</span></div>
            <input
              style={s.input}
              value={description}
              onChange={e => setDesc(e.target.value)}
              placeholder="e.g. Searches the web and returns results"
              maxLength={80}
            />

            <div style={s.label}>System prompt</div>
            <textarea
              style={{ ...s.input, ...s.textarea }}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={8}
            />

            <ToggleGroup
              label="TOOLS"
              items={availableTools.map(t => ({ value: t.name, hint: t.description }))}
              selected={tools}
              onToggle={v => setTools(toggle(tools, v))}
              color="#0ea5e9"
            />

            <ToggleGroup
              label="CAN DELEGATE TO"
              items={otherAgents.map(a => ({ value: a.id, hint: a.name }))}
              selected={canCall}
              onToggle={v => setCanCall(toggle(canCall, v))}
              color="#7928ca"
            />
          </>}

          {tab === 'usage' && (
            <div style={{ padding: '8px 0' }}>
              {!stats ? (
                <div style={{ color: '#a3a3a3', fontSize: 13 }}>Loading...</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    { label: 'Total runs',      value: stats.total_runs.toLocaleString() },
                    { label: 'Input tokens',    value: stats.input_tokens.toLocaleString() },
                    { label: 'Output tokens',   value: stats.output_tokens.toLocaleString() },
                    { label: 'Tokens used',     value: stats.tokens_used.toLocaleString() },
                    { label: 'Est. cost',       value: stats.cost_usd > 0 ? `~$${stats.cost_usd.toFixed(4)}` : stats.total_runs > 0 ? 'free / unknown model' : '—' },
                    { label: 'Avg duration',    value: stats.avg_duration_ms > 0 ? `${(stats.avg_duration_ms / 1000).toFixed(1)}s` : '—' },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f5f5f5', borderRadius: 8 }}>
                      <span style={{ fontSize: 13, color: '#525252' }}>{label}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#171717', fontFamily: 'var(--mono)' }}>{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'tasks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Create form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <textarea
                  placeholder="What should the agent do?"
                  value={taskInput}
                  onChange={e => setTaskInput(e.target.value)}
                  rows={2}
                  style={{ ...s.input, ...s.textarea }}
                />

                {/* Schedule mode toggle */}
                <div style={{ display: 'flex', background: '#f5f5f5', borderRadius: 8, padding: 3, gap: 2, width: 'fit-content' }}>
                  {(['once', 'cron'] as const).map(m => (
                    <button key={m} onClick={() => setSchedMode(m)} style={{
                      ...s.tabBtn, ...(schedMode === m ? s.tabActive : {}), padding: '4px 14px',
                    }}>{m === 'once' ? 'One time' : 'Recurring'}</button>
                  ))}
                </div>

                {schedMode === 'once' ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)}
                      style={{ ...s.input, width: 'auto', flex: 1 }} />
                    <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)}
                      style={{ ...s.input, width: 'auto', flex: '0 0 120px' }} />
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input value={schedCron} onChange={e => setSchedCron(e.target.value)}
                      placeholder="cron expression" style={s.input} />
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Every 15 min',       value: '*/15 * * * *'  },
                        { label: 'Every 30 min',       value: '*/30 * * * *'  },
                        { label: 'Every hour',         value: '0 * * * *'     },
                        { label: 'Every 6h',           value: '0 */6 * * *'   },
                        { label: 'Daily 8:00',         value: '0 8 * * *'     },
                        { label: 'Daily 9:00',         value: '0 9 * * *'     },
                        { label: 'Daily 18:00',        value: '0 18 * * *'    },
                        { label: 'Daily midnight',     value: '0 0 * * *'     },
                        { label: 'Weekdays 9:00',      value: '0 9 * * 1-5'   },
                        { label: 'Weekdays 18:00',     value: '0 18 * * 1-5'  },
                        { label: 'Mon 9:00',           value: '0 9 * * 1'     },
                        { label: 'Fri 17:00',          value: '0 17 * * 5'    },
                        { label: 'Weekly Sun 0:00',    value: '0 0 * * 0'     },
                        { label: 'Monthly 1st 9:00',   value: '0 9 1 * *'     },
                        { label: 'Monthly last day',   value: '0 9 28-31 * *' },
                        { label: 'Every Jan 1st',      value: '0 9 1 1 *'     },
                      ].map(p => (
                        <button key={p.value} onClick={() => setSchedCron(p.value)} style={{
                          fontSize: 11, padding: '3px 10px', background: schedCron === p.value ? '#171717' : '#f5f5f5',
                          color: schedCron === p.value ? '#fff' : '#525252',
                          border: '1px solid #e5e5e5', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                        }}>{p.label}</button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={handleCreateTask} style={{ ...s.saveBtn, padding: '6px 16px' }}>
                    Add Task
                  </button>
                </div>
                {taskError && <div style={{ color: '#ef4444', fontSize: 12 }}>{taskError}</div>}
              </div>

              {/* Task list */}
              {tasks.length === 0 ? (
                <div style={{ color: '#a3a3a3', fontSize: 13 }}>No scheduled tasks.</div>
              ) : tasks.map(t => {
                const statusColor: Record<string, string> = { scheduled: '#0070f3', running: '#f5a623', done: '#00a67e', error: '#ef4444', cancelled: '#a3a3a3' }
                return (
                  <div key={t.task_id} style={{ background: '#f5f5f5', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 13, color: '#171717' }}>{t.input}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: statusColor[t.status] ?? '#525252', background: '#fff', borderRadius: 5, padding: '2px 8px', flexShrink: 0 }}>
                        {t.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#a3a3a3', fontFamily: 'var(--mono)' }}>
                      {t.schedule}{t.repeat ? ' · repeat' : ''}
                      {t.next_run_at ? ` · next: ${new Date(t.next_run_at).toLocaleString()}` : ''}
                    </div>
                    {t.error && <div style={{ fontSize: 11, color: '#ef4444' }}>{t.error}</div>}
                    <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                      {t.status !== 'cancelled' && t.status !== 'running' && (
                        <button onClick={() => handleRunNow(t.task_id)} style={{ fontSize: 11, padding: '3px 10px', background: '#000', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                          Run now
                        </button>
                      )}
                      {(t.status === 'scheduled' || t.status === 'running') && (
                        <button onClick={() => handleCancelTask(t.task_id)} style={{ fontSize: 11, padding: '3px 10px', background: '#fff', color: '#525252', border: '1px solid #e5e5e5', borderRadius: 6, cursor: 'pointer' }}>
                          Cancel
                        </button>
                      )}
                      {(t.status === 'done' || t.status === 'error' || t.status === 'cancelled') && (
                        <button onClick={() => handleDeleteTask(t.task_id)} style={{ fontSize: 11, padding: '3px 10px', background: '#fff', color: '#ef4444', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer' }}>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {(tab === 'yaml' || tab === 'json') && (() => {
            const cfg = buildConfig()
            const raw = tab === 'json'
              ? JSON.stringify(cfg, null, 2)
              : toYaml(cfg)
            return (
              <div style={s.codeWrap}>
                <button
                  onClick={() => navigator.clipboard.writeText(raw)}
                  style={s.copyBtn}
                  title="Copy to clipboard"
                >Copy</button>
                <pre style={s.code}>{raw}</pre>
              </div>
            )
          })()}
        </div>

        {/* Footer */}
        <div style={s.footer}>
          {!isNew && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleExport} style={s.ghostBtn}>Export .agent</button>
              {confirmDel
                ? <button onClick={handleDelete} style={s.dangerBtn}>Confirm delete</button>
                : <button onClick={() => setConfirmDel(true)} style={s.ghostBtn}>Delete</button>
              }
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button onClick={onClose} style={s.cancelBtn}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={s.saveBtn}>
              {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
            </button>
          </div>
        </div>

      </div>
    </>
  )
}

const s: Record<string, React.CSSProperties> = {
  header:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
               padding: '20px 24px', borderBottom: '1px solid #e5e5e5', flexShrink: 0 },
  title:     { color: '#171717', fontWeight: 700, fontSize: 15, letterSpacing: '-0.3px', lineHeight: 1.3 },
  subtitle:  { color: '#a3a3a3', fontSize: 11, marginTop: 1 },
  closeBtn:  { background: 'none', border: '1px solid #e5e5e5', borderRadius: 8,
               color: '#a3a3a3', cursor: 'pointer', fontSize: 14, padding: '4px 9px',
               display: 'flex', alignItems: 'center', justifyContent: 'center' },
  body:      { flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 6 },
  error:     { background: 'rgba(224,0,32,0.05)', border: '1px solid rgba(224,0,32,0.2)',
               borderRadius: 8, padding: '8px 12px', color: '#e00020', fontSize: 12 },
  label:     { fontSize: 10, color: '#a3a3a3', letterSpacing: '0.06em', textTransform: 'uppercase',
               marginTop: 12, fontWeight: 600 },
  required:  { color: '#0070f3' },
  input:     { background: '#fafafa', border: '1px solid #e5e5e5', borderRadius: 10,
               color: '#171717', fontFamily: 'inherit', fontSize: 13, padding: '10px 14px',
               outline: 'none', width: '100%', transition: 'border 0.15s', boxSizing: 'border-box' },
  readonly:  { opacity: 0.5, cursor: 'not-allowed' },
  textarea:  { resize: 'vertical', lineHeight: 1.65 },
  chips:     { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip:      { fontFamily: 'inherit', fontSize: 12, padding: '5px 13px', borderRadius: 20,
               border: '1px solid', cursor: 'pointer', transition: 'all 0.15s', background: 'transparent' },
  empty:     { fontSize: 11, color: '#a3a3a3', fontStyle: 'italic', marginTop: 4 },
  footer:    { display: 'flex', alignItems: 'center', padding: '16px 24px',
               borderTop: '1px solid #e5e5e5', flexWrap: 'wrap', gap: 8, flexShrink: 0 },
  ghostBtn:  { background: 'none', border: '1px solid #e5e5e5', borderRadius: 8,
               color: '#a3a3a3', fontFamily: 'inherit', fontSize: 12, padding: '7px 14px', cursor: 'pointer' },
  dangerBtn: { background: 'none', border: '1px solid rgba(224,0,32,0.3)', borderRadius: 8,
               color: '#e00020', fontFamily: 'inherit', fontSize: 12, padding: '7px 14px', cursor: 'pointer' },
  cancelBtn: { background: 'none', border: '1px solid #e5e5e5', borderRadius: 8,
               color: '#525252', fontFamily: 'inherit', fontSize: 13, padding: '8px 18px', cursor: 'pointer' },
  saveBtn:   { background: '#000', border: 'none', borderRadius: 8,
               color: '#fff', fontFamily: 'inherit', fontSize: 13, padding: '8px 20px', cursor: 'pointer' },
  tabs:      { display: 'flex', background: '#f5f5f5', borderRadius: 8, padding: 3, gap: 2 },
  tabBtn:    { background: 'none', border: 'none', borderRadius: 6, color: '#a3a3a3',
               fontFamily: 'inherit', fontSize: 11, fontWeight: 600, padding: '4px 10px',
               cursor: 'pointer', letterSpacing: '0.04em' },
  tabActive: { background: '#ffffff', color: '#171717', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  codeWrap:  { position: 'relative', flex: 1 },
  code:      { margin: 0, padding: '16px 18px', background: '#0d0d0d', borderRadius: 10,
               color: '#e5e5e5', fontSize: 12, fontFamily: 'var(--mono)', lineHeight: 1.75,
               overflowX: 'auto', whiteSpace: 'pre', minHeight: 400 },
  copyBtn:   { position: 'absolute', top: 10, right: 10,
               background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
               borderRadius: 6, color: '#a3a3a3', fontFamily: 'inherit', fontSize: 11,
               padding: '3px 10px', cursor: 'pointer' },
}
