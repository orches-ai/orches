import { useState, useEffect, useRef, useMemo } from 'react'
import {
  LineChart, BarChart, AreaChart, PieChart, ScatterChart,
  Line, Bar, Area, Pie, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { CanvasPage } from '../../shared/types'

const API = 'http://localhost:8000'

interface Props {
  pages: CanvasPage[]
  activeId: string | null
  minimized: boolean
  onMinimize: () => void
  onRestore: (id: string) => void
  onClose: () => void
  onClosePage: (id: string) => void
  onSelect: (id: string) => void
  onOpenPage: (page: CanvasPage) => void
}

const PAGE_ICONS: Record<CanvasPage['type'], string> = {
  markdown: '◎',
  code:     '⌥',
  browser:  '⊕',
  settings: '⚙',
  files:    '⊟',
  image:    '◈',
  table:    '▦',
  chart:    '◑',
}

// ── Page renderers ────────────────────────────────────────────────────────────

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, padding: '10px 24px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
      {children}
    </div>
  )
}

function ActionBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ fontSize: 12, padding: '4px 12px', background: '#f5f5f5', color: '#525252', border: '1px solid #e5e5e5', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>
      {children}
    </button>
  )
}

function MarkdownPage({ content, title }: { content: string; title: string }) {
  const [copied, setCopied] = useState(false)
  const [saved, setSaved]   = useState(false)
  function copy() { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  async function saveToWorkspace() {
    const filename = `${title.replace(/[^a-z0-9_\-\s]/gi, '').trim().replace(/\s+/g, '_') || 'report'}.md`
    const fd = new FormData()
    fd.append('file', new Blob([content], { type: 'text/markdown' }), filename)
    await fetch(`${API}/workspace/upload?path=${encodeURIComponent(filename)}`, { method: 'POST', body: fd })
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ActionBar>
        <ActionBtn onClick={copy}>{copied ? 'Copied!' : 'Copy'}</ActionBtn>
        <ActionBtn onClick={() => download(`${title}.md`, content)}>Download .md</ActionBtn>
        <ActionBtn onClick={saveToWorkspace}>{saved ? 'Saved!' : 'Save to workspace'}</ActionBtn>
      </ActionBar>
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 40px' }}>
        <div className="md" style={{ fontSize: 14, maxWidth: 820, margin: '0 auto' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

const CHART_COLORS = ['#0070f3','#7928ca','#00a67e','#f5a623','#eb367f','#0ea5e9','#f97316','#8b5cf6']

function ChartPage({ data, chart_type = 'line', title }: { data: string; chart_type?: string; title: string }) {
  const rows = useMemo(() => { try { return JSON.parse(data) } catch { return [] } }, [data])
  const keys = useMemo(() => rows.length > 0 ? Object.keys(rows[0]).filter(k => k !== 'name' && k !== 'date' && k !== 'x') : [], [rows])
  const xKey = useMemo(() => rows.length > 0 ? (Object.keys(rows[0]).find(k => ['name','date','x','label','month','year','week','day'].includes(k)) ?? Object.keys(rows[0])[0]) : 'x', [rows])

  const commonProps = { data: rows, margin: { top: 10, right: 30, left: 0, bottom: 5 } }
  const axisStyle = { fontSize: 12, fill: '#737373' }
  const gridStyle = { stroke: '#f0f0f0' }

  function renderLines(Comp: typeof Line | typeof Bar | typeof Area) {
    return keys.map((k, i) => (
      // @ts-ignore
      <Comp key={k} type="monotone" dataKey={k} stroke={CHART_COLORS[i % CHART_COLORS.length]}
        fill={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} fillOpacity={0.15} />
    ))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ActionBar>
        <span style={{ fontSize: 12, color: '#737373' }}>{rows.length} rows · {keys.length} series</span>
      </ActionBar>
      <div style={{ flex: 1, padding: '24px 32px', overflow: 'hidden' }}>
        <ResponsiveContainer width="100%" height="100%">
          {chart_type === 'pie' ? (
            <PieChart>
              <Pie data={rows} dataKey="value" nameKey="name" cx="50%" cy="50%"
                outerRadius="70%" label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}
                labelLine={false} strokeWidth={0}>
                {rows.map((_: unknown, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => v.toLocaleString()} />
              <Legend />
            </PieChart>
          ) : chart_type === 'scatter' ? (
            <ScatterChart {...commonProps}>
              <CartesianGrid {...gridStyle} />
              <XAxis dataKey="x" tick={axisStyle} />
              <YAxis dataKey="y" tick={axisStyle} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Scatter data={rows} fill={CHART_COLORS[0]} />
            </ScatterChart>
          ) : chart_type === 'bar' ? (
            <BarChart {...commonProps}>
              <CartesianGrid vertical={false} {...gridStyle} />
              <XAxis dataKey={xKey} tick={axisStyle} />
              <YAxis tick={axisStyle} />
              <Tooltip formatter={(v: number) => v.toLocaleString()} />
              <Legend />
              {renderLines(Bar)}
            </BarChart>
          ) : chart_type === 'area' ? (
            <AreaChart {...commonProps}>
              <CartesianGrid {...gridStyle} />
              <XAxis dataKey={xKey} tick={axisStyle} />
              <YAxis tick={axisStyle} />
              <Tooltip formatter={(v: number) => v.toLocaleString()} />
              <Legend />
              {renderLines(Area)}
            </AreaChart>
          ) : (
            <LineChart {...commonProps}>
              <CartesianGrid {...gridStyle} />
              <XAxis dataKey={xKey} tick={axisStyle} />
              <YAxis tick={axisStyle} />
              <Tooltip formatter={(v: number) => v.toLocaleString()} />
              <Legend />
              {renderLines(Line)}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

const LANG_EXT: Record<string, string> = {
  python: 'py', javascript: 'js', typescript: 'ts', 'typescript jsx': 'tsx',
  'javascript jsx': 'jsx', ruby: 'rb', golang: 'go', rust: 'rs', shell: 'sh',
  bash: 'sh', csharp: 'cs', cplusplus: 'cpp', 'c++': 'cpp', kotlin: 'kt',
  swift: 'swift', yaml: 'yaml', markdown: 'md',
}

function CodePage({ content, language, title }: { content: string; language?: string; title: string }) {
  const [copied, setCopied] = useState(false)
  const [saved, setSaved]   = useState(false)
  function copy() { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const ext = language ? (LANG_EXT[language.toLowerCase()] ?? language) : 'txt'
  async function saveToWorkspace() {
    const filename = `${title}.${ext}`
    const fd = new FormData()
    fd.append('file', new Blob([content], { type: 'text/plain' }), filename)
    await fetch(`${API}/workspace/upload`, { method: 'POST', body: fd })
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ActionBar>
        {language && <span style={{ fontSize: 11, color: '#a3a3a3', fontFamily: 'var(--mono)', textTransform: 'uppercase', marginRight: 4 }}>{language}</span>}
        <ActionBtn onClick={copy}>{copied ? 'Copied!' : 'Copy'}</ActionBtn>
        <ActionBtn onClick={() => download(`${title}.${ext}`, content)}>Download .{ext}</ActionBtn>
        <ActionBtn onClick={saveToWorkspace}>{saved ? 'Saved!' : 'Save to workspace'}</ActionBtn>
      </ActionBar>
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
        <pre style={{ margin: 0, padding: '16px 20px', background: '#0d0d0d', borderRadius: 10, color: '#e5e5e5', fontSize: 13, fontFamily: 'var(--mono)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {content}
        </pre>
      </div>
    </div>
  )
}

function BrowserPage({ initialUrl }: { initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl)
  const [src, setSrc] = useState(initialUrl)
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', gap: 8 }}>
        <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && setSrc(url)}
          style={{ flex: 1, padding: '6px 12px', border: '1px solid #e5e5e5', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit', background: '#fafafa', color: '#171717' }}
          placeholder="https://..." />
        <button onClick={() => setSrc(url)} style={{ padding: '6px 16px', background: '#171717', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Go</button>
        <button onClick={() => window.open(src, '_blank')} style={{ padding: '6px 14px', background: '#f5f5f5', color: '#525252', border: '1px solid #e5e5e5', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Open in tab</button>
      </div>
      <iframe src={src} style={{ flex: 1, border: 'none' }} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
    </div>
  )
}

// ── Table page ────────────────────────────────────────────────────────────────

function TablePage({ data, title }: { data: string; title: string }) {
  type Row = Record<string, unknown>
  const [sortCol, setSortCol]   = useState<string | null>(null)
  const [sortAsc, setSortAsc]   = useState(true)
  const [copied, setCopied]     = useState(false)

  let rows: Row[] = []
  let parseError  = ''
  try {
    const parsed = JSON.parse(data)
    rows = Array.isArray(parsed) ? parsed : []
    if (!Array.isArray(parsed)) parseError = 'Data must be a JSON array of objects.'
  } catch {
    parseError = 'Invalid JSON data.'
  }

  const columns = rows.length > 0 ? Object.keys(rows[0]) : []

  const sorted = sortCol
    ? [...rows].sort((a, b) => {
        const av = a[sortCol] ?? ''; const bv = b[sortCol] ?? ''
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
        return sortAsc ? cmp : -cmp
      })
    : rows

  function toggleSort(col: string) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  function copyCSV() {
    const lines = [columns.join(','), ...rows.map(r => columns.map(c => JSON.stringify(r[c] ?? '')).join(','))]
    navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  function downloadCSV() {
    const lines = [columns.join(','), ...rows.map(r => columns.map(c => JSON.stringify(r[c] ?? '')).join(','))]
    download(`${title}.csv`, lines.join('\n'))
  }

  if (parseError) return (
    <div style={{ padding: 32, color: '#ef4444', fontSize: 13 }}>{parseError}</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ActionBar>
        <span style={{ fontSize: 12, color: '#a3a3a3', marginRight: 'auto' }}>{rows.length} rows · {columns.length} columns</span>
        <ActionBtn onClick={copyCSV}>{copied ? 'Copied!' : 'Copy CSV'}</ActionBtn>
        <ActionBtn onClick={downloadCSV}>Download .csv</ActionBtn>
      </ActionBar>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb', position: 'sticky', top: 0, zIndex: 1 }}>
              {columns.map(col => (
                <th key={col} onClick={() => toggleSort(col)}
                  style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: '#525252', borderBottom: '2px solid #e5e5e5', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  {col}
                  {sortCol === col && <span style={{ marginLeft: 4, color: '#171717' }}>{sortAsc ? '↑' : '↓'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? '#ffffff' : '#fafafa' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f0f9ff')}
                onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? '#ffffff' : '#fafafa')}
              >
                {columns.map(col => (
                  <td key={col} style={{ padding: '9px 16px', borderBottom: '1px solid #f0f0f0', color: '#374151', verticalAlign: 'middle' }}>
                    {String(row[col] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: '#a3a3a3', fontSize: 13 }}>No data</div>}
      </div>
    </div>
  )
}

// ── Image page ────────────────────────────────────────────────────────────────

function ImagePage({ filePath, title }: { filePath: string; title: string }) {
  const src = `${API}/workspace/raw?path=${encodeURIComponent(filePath)}`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ActionBar>
        <ActionBtn onClick={() => { const a = document.createElement('a'); a.href = src; a.download = title; a.click() }}>Download</ActionBtn>
        <ActionBtn onClick={() => window.open(src, '_blank')}>Open in tab</ActionBtn>
      </ActionBar>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#f9fafb' }}>
        <img src={src} alt={title} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
      </div>
    </div>
  )
}

// ── Files page ────────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico'])
const CODE_EXTS  = new Set(['py', 'js', 'ts', 'tsx', 'jsx', 'json', 'yaml', 'yml', 'toml', 'sh', 'bash', 'css', 'html', 'xml', 'sql', 'go', 'rs', 'java', 'c', 'cpp', 'h'])

interface FileItem { name: string; path: string; type: 'file' | 'dir'; size: number | null }

function fileIcon(item: FileItem): string {
  if (item.type === 'dir') return '📁'
  const ext = item.name.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTS.has(ext)) return '🖼'
  if (ext === 'md') return '📝'
  if (ext === 'pdf') return '📄'
  if (CODE_EXTS.has(ext)) return '📋'
  return '📄'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function FilesPage({ initialPath, onOpenPage, onPathChange }: { initialPath?: string; onOpenPage: (page: CanvasPage) => void; onPathChange?: (path: string) => void }) {
  const [path, setPath]       = useState(initialPath ?? '')
  const [items, setItems]     = useState<FileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  function loadDir(p: string) {
    setLoading(true)
    fetch(`${API}/workspace/list?path=${encodeURIComponent(p)}`)
      .then(r => r.json())
      .then(data => { setItems(data); setPath(p); onPathChange?.(p) })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadDir(path) }, [])

  function breadcrumbs(): { label: string; path: string }[] {
    const parts = path.split('/').filter(Boolean)
    const crumbs = [{ label: 'workspace', path: '' }]
    parts.forEach((p, i) => crumbs.push({ label: p, path: parts.slice(0, i + 1).join('/') }))
    return crumbs
  }

  function openFile(item: FileItem) {
    const ext = item.name.split('.').pop()?.toLowerCase() ?? ''
    if (item.type === 'dir') { loadDir(item.path); return }
    if (IMAGE_EXTS.has(ext)) {
      onOpenPage({ id: `file:${item.path}`, title: item.name, type: 'image', filePath: item.path })
    } else if (ext === 'md') {
      fetch(`${API}/workspace/file?path=${encodeURIComponent(item.path)}`)
        .then(r => r.json()).then(d => onOpenPage({ id: `file:${item.path}`, title: item.name, type: 'markdown', content: d.content }))
    } else {
      fetch(`${API}/workspace/file?path=${encodeURIComponent(item.path)}`)
        .then(r => r.json()).then(d => onOpenPage({ id: `file:${item.path}`, title: item.name, type: 'code', content: d.content, language: ext }))
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files)
    for (const file of arr) {
      const fd = new FormData()
      fd.append('file', file)
      await fetch(`${API}/workspace/upload?path=${encodeURIComponent(path)}`, { method: 'POST', body: fd })
    }
    loadDir(path)
  }

  function requestDelete(item: FileItem, e: React.MouseEvent) {
    e.stopPropagation()
    setDeleteTarget(item)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    await fetch(`${API}/workspace/file?path=${encodeURIComponent(deleteTarget.path)}`, { method: 'DELETE' })
    setDeleteTarget(null)
    loadDir(path)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
        {/* Breadcrumb */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, flexWrap: 'wrap' }}>
          {breadcrumbs().map((crumb, i, arr) => (
            <span key={crumb.path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span onClick={() => loadDir(crumb.path)} style={{ color: i === arr.length - 1 ? '#171717' : '#737373', cursor: 'pointer', fontWeight: i === arr.length - 1 ? 600 : 400 }}
                onMouseEnter={e => { if (i < arr.length - 1) (e.target as HTMLElement).style.textDecoration = 'underline' }}
                onMouseLeave={e => { (e.target as HTMLElement).style.textDecoration = 'none' }}>
                {crumb.label}
              </span>
              {i < arr.length - 1 && <span style={{ color: '#d4d4d4' }}>/</span>}
            </span>
          ))}
        </div>
        <button onClick={() => uploadRef.current?.click()} style={sf.btn}>Upload</button>
        <input ref={uploadRef} type="file" multiple style={{ display: 'none' }} onChange={e => { if (e.target.files) { uploadFiles(e.target.files); e.target.value = '' } }} />
      </div>

      {/* File grid */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: dragOver ? '#f0f9ff' : undefined, transition: 'background 0.15s' }}
      >
        {loading ? (
          <div style={{ color: '#a3a3a3', fontSize: 13, textAlign: 'center', marginTop: 40 }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ color: '#a3a3a3', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
            {dragOver ? 'Drop files here to upload' : 'Empty folder — drag & drop files to upload'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
            {items.map(item => (
              <div key={item.path} onClick={() => openFile(item)}
                draggable={item.type === 'file'}
                onDragStart={e => { e.dataTransfer.setData('text/workspace-path', item.path); e.dataTransfer.effectAllowed = 'copy' }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '14px 10px', borderRadius: 10, border: '1px solid #f0f0f0', cursor: 'pointer', background: '#fafafa', position: 'relative', transition: 'background 0.1s', userSelect: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f0f0f0')}
                onMouseLeave={e => (e.currentTarget.style.background = '#fafafa')}
              >
                <span style={{ fontSize: 28 }}>{fileIcon(item)}</span>
                <span style={{ fontSize: 12, color: '#171717', fontWeight: 500, textAlign: 'center', wordBreak: 'break-all', lineHeight: 1.3 }}>{item.name}</span>
                {item.size !== null && <span style={{ fontSize: 10, color: '#a3a3a3' }}>{formatSize(item.size)}</span>}
                <button onClick={e => requestDelete(item, e)}
                  style={{ position: 'absolute', top: 4, right: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#d4d4d4', fontSize: 14, lineHeight: 1, padding: 2 }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#d4d4d4')}
                >✕</button>
              </div>
            ))}
          </div>
        )}
        {dragOver && items.length > 0 && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(14,165,233,0.08)', border: '2px dashed #38bdf8', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ fontSize: 14, color: '#0369a1', fontWeight: 600 }}>Drop to upload</span>
          </div>
        )}
      </div>

      {deleteTarget && (
        <>
          <div onClick={() => setDeleteTarget(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 500 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#fff', borderRadius: 14, padding: '28px 32px', width: 400, zIndex: 501, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#171717' }}>Delete "{deleteTarget.name}"?</div>
            <div style={{ fontSize: 13, color: '#525252' }}>
              {deleteTarget.type === 'dir' ? 'This folder and all its contents will be permanently deleted.' : 'This file will be permanently deleted.'}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} style={ss.ghost}>Cancel</button>
              <button onClick={confirmDelete} style={{ ...ss.btn, background: '#ef4444' }}>Delete</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Settings page ─────────────────────────────────────────────────────────────

import type { ProviderKey, Agent as AgentType } from '../../shared/types'

interface ProviderDef {
  id: string
  label: string
  color: string
  base_url?: string        // openai-compatible base url (empty = native)
  default_model?: string
  key_placeholder?: string
  url_only?: boolean       // ollama-like: url instead of api key
}

const PROVIDER_CATALOG: ProviderDef[] = [
  { id: 'anthropic',  label: 'Anthropic',   color: '#d97706', default_model: 'claude-sonnet-4-6', key_placeholder: 'sk-ant-...' },
  { id: 'openai',     label: 'OpenAI',      color: '#10a37f', base_url: 'https://api.openai.com', default_model: 'gpt-4o', key_placeholder: 'sk-...' },
  { id: 'google',     label: 'Google',      color: '#4285f4', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', default_model: 'gemini-2.0-flash', key_placeholder: 'AIza...' },
  { id: 'groq',       label: 'Groq',        color: '#f97316', base_url: 'https://api.groq.com/openai', default_model: 'llama-3.3-70b-versatile', key_placeholder: 'gsk_...' },
  { id: 'mistral',    label: 'Mistral',     color: '#ff6b35', base_url: 'https://api.mistral.ai', default_model: 'mistral-large-latest', key_placeholder: '...' },
  { id: 'deepseek',   label: 'DeepSeek',    color: '#0ea5e9', base_url: 'https://api.deepseek.com', default_model: 'deepseek-chat', key_placeholder: 'sk-...' },
  { id: 'together',   label: 'Together AI', color: '#8b5cf6', base_url: 'https://api.together.xyz', default_model: 'meta-llama/Llama-3-70b-chat-hf', key_placeholder: '...' },
  { id: 'xai',        label: 'xAI (Grok)',  color: '#000000', base_url: 'https://api.x.ai', default_model: 'grok-3', key_placeholder: 'xai-...' },
  { id: 'perplexity', label: 'Perplexity',  color: '#20b2aa', base_url: 'https://api.perplexity.ai', default_model: 'sonar-pro', key_placeholder: 'pplx-...' },
  { id: 'ollama',     label: 'Ollama',      color: '#6366f1', url_only: true, default_model: 'llama3', key_placeholder: 'http://localhost:11434' },
]

type Provider = string

function providerDef(id: string): ProviderDef {
  return PROVIDER_CATALOG.find(p => p.id === id) ?? { id, label: id, color: '#737373' }
}

// ── API Keys section ──────────────────────────────────────────────────────────

const BLANK_KEY = (): Partial<ProviderKey & { base_url: string }> => ({ provider: 'anthropic', label: '', key: '', url: '', base_url: '', model: '' })

function KeyModal({ initial, onSave, onClose }: {
  initial: Partial<ProviderKey>
  onSave: (data: Partial<ProviderKey>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm]       = useState<Record<string, string>>({
    provider: initial.provider ?? 'anthropic',
    label:    initial.label    ?? '',
    key:      initial.key      ?? '',
    url:      (initial as Record<string, string>).url      ?? '',
    base_url: (initial as Record<string, string>).base_url ?? '',
    model:    initial.model    ?? '',
  })
  const [saving, setSaving]   = useState(false)
  const [revealed, setRevealed] = useState(false)

  const def = providerDef(form.provider)

  function selectProvider(id: string) {
    const d = providerDef(id)
    setForm(f => ({
      ...f,
      provider: id,
      base_url: d.base_url ?? '',
      model:    '',
      label:    f.label || d.label,
    }))
  }

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    setSaving(true)
    await onSave(form as Partial<ProviderKey>)
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 500, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#171717' }}>{initial.id ? 'Edit API Key' : 'Add API Key'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#a3a3a3' }}>✕</button>
        </div>

        {/* Provider grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#525252', fontWeight: 500 }}>Provider</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
            {PROVIDER_CATALOG.map(pv => {
              const active = form.provider === pv.id
              return (
                <button key={pv.id} onClick={() => selectProvider(pv.id)} style={{
                  padding: '8px 4px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                  border: `1.5px solid ${active ? pv.color : '#e5e5e5'}`,
                  background: active ? pv.color : '#fff',
                  color: active ? '#fff' : '#525252',
                  transition: 'all 0.12s', textAlign: 'center', lineHeight: 1.3,
                }}>{pv.label}</button>
              )
            })}
          </div>
        </div>

        {/* Label */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: '#525252', fontWeight: 500 }}>Label</div>
          <input value={form.label} onChange={e => set('label', e.target.value)} placeholder={`e.g. ${def.label} main`} style={ss.input} />
        </div>

        {/* Key or URL */}
        {def.url_only ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#525252', fontWeight: 500 }}>Server URL</div>
            <input value={form.url} onChange={e => set('url', e.target.value)} placeholder="http://localhost:11434" style={ss.input} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#525252', fontWeight: 500 }}>API Key</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type={revealed ? 'text' : 'password'} value={form.key} onChange={e => set('key', e.target.value)}
                placeholder={def.key_placeholder ?? 'sk-...'} style={{ ...ss.input, flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
              <button onClick={() => setRevealed(v => !v)} style={{ padding: '4px 10px', fontSize: 11, background: '#f5f5f5', border: '1px solid #e5e5e5', borderRadius: 6, cursor: 'pointer', color: '#525252', whiteSpace: 'nowrap' }}>
                {revealed ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        )}

        {/* Model */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: '#525252', fontWeight: 500 }}>Default model <span style={{ color: '#a3a3a3', fontWeight: 400 }}>(optional)</span></div>
          <input value={form.model} onChange={e => set('model', e.target.value)}
            placeholder={def.default_model ?? 'leave empty for provider default'}
            style={ss.input} />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={ss.btnSecondary}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.label} style={ss.btn}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function ApiKeysSection() {
  const [keys, setKeys]         = useState<ProviderKey[]>([])
  const [modal, setModal]       = useState<Partial<ProviderKey> | null>(null)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API}/settings/providers`).then(r => r.json()).then(setKeys).catch(() => {})
  }, [])

  async function handleSave(data: Partial<ProviderKey>) {
    if (modal?.id) {
      const res = await fetch(`${API}/settings/providers/${modal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: data.label, key: data.key, url: data.url, model: data.model }),
      })
      const updated = await res.json()
      setKeys(prev => prev.map(k => k.id === modal.id ? updated : k))
    } else {
      const res = await fetch(`${API}/settings/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const created = await res.json()
      setKeys(prev => [...prev, created])
    }
    setModal(null)
  }

  async function handleDelete(id: string) {
    await fetch(`${API}/settings/providers/${id}`, { method: 'DELETE' })
    setKeys(prev => prev.filter(k => k.id !== id))
    setDelConfirm(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#171717' }}>API Keys</div>
        <button onClick={() => setModal(BLANK_KEY())} style={ss.btn}>+ Add key</button>
      </div>

      {keys.length === 0 ? (
        <div style={{ border: '1px dashed #e5e5e5', borderRadius: 12, padding: 32, textAlign: 'center', color: '#a3a3a3', fontSize: 13 }}>
          No API keys added yet. Add a key to use a specific provider.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {keys.map(k => {
            const color = providerDef(k.provider).color
            return (
              <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', border: '1px solid #e5e5e5', borderRadius: 12, background: '#fafafa' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#171717' }}>{k.label}</div>
                  <div style={{ fontSize: 11, color: '#a3a3a3', display: 'flex', gap: 8, marginTop: 2 }}>
                    <span style={{ padding: '1px 6px', background: '#f0f0f0', borderRadius: 4 }}>{providerDef(k.provider).label}</span>
                    {k.model && <span>{k.model}</span>}
                    {k.key && <span style={{ fontFamily: 'monospace' }}>{k.key}</span>}
                    {k.url && <span style={{ fontFamily: 'monospace' }}>{k.url}</span>}
                  </div>
                </div>
                <button onClick={() => setModal(k)} style={{ ...ss.btnSecondary, fontSize: 11 }}>Edit</button>
                <button onClick={() => setDelConfirm(k.id)} style={{ ...ss.btnSecondary, fontSize: 11, color: '#ef4444', borderColor: '#fecaca' }}>Delete</button>
              </div>
            )
          })}
        </div>
      )}

      {modal !== null && (
        <KeyModal initial={modal} onSave={handleSave} onClose={() => setModal(null)} />
      )}

      {delConfirm !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#171717' }}>Delete API key?</div>
            <div style={{ fontSize: 13, color: '#525252' }}>Agents using this key will fall back to the global provider.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDelConfirm(null)} style={ss.btnSecondary}>Cancel</button>
              <button onClick={() => handleDelete(delConfirm)} style={{ ...ss.btn, background: '#ef4444' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Models section ────────────────────────────────────────────────────────────

function ModelModal({ agent, keys, onSave, onClose }: {
  agent: AgentType
  keys: ProviderKey[]
  onSave: (agentId: string, keyId: string, model: string) => Promise<void>
  onClose: () => void
}) {
  const [keyId, setKeyId]   = useState(agent.provider_key_id ?? '')
  const [model, setModel]   = useState(agent.model ?? '')
  const [saving, setSaving] = useState(false)

  const selectedKey = keys.find(k => k.id === keyId)

  async function handleSave() {
    setSaving(true)
    await onSave(agent.id, keyId, model)
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 420, display: 'flex', flexDirection: 'column', gap: 18, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#171717' }}>Model for <em>{agent.name}</em></div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#a3a3a3' }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: '#525252', fontWeight: 500 }}>API Key / Provider</div>
          <select value={keyId} onChange={e => { setKeyId(e.target.value); setModel('') }}
            style={{ ...ss.input, appearance: 'auto' }}>
            <option value="">— Use global default —</option>
            {keys.map(k => (
              <option key={k.id} value={k.id}>{k.label} ({providerDef(k.provider).label})</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: '#525252', fontWeight: 500 }}>Model override <span style={{ color: '#a3a3a3', fontWeight: 400 }}>(optional)</span></div>
          <input value={model} onChange={e => setModel(e.target.value)}
            placeholder={selectedKey?.model || 'leave empty to use key default'}
            style={ss.input} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={ss.btnSecondary}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={ss.btn}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function ModelsSection() {
  const [agents, setAgents] = useState<AgentType[]>([])
  const [keys, setKeys]     = useState<ProviderKey[]>([])
  const [editAgent, setEditAgent] = useState<AgentType | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`${API}/agents/`).then(r => r.json()),
      fetch(`${API}/settings/providers`).then(r => r.json()),
    ]).then(([a, k]) => { setAgents(a); setKeys(k) }).catch(() => {})
  }, [])

  async function handleSave(agentId: string, keyId: string, model: string) {
    await fetch(`${API}/agents/${agentId}/model`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_key_id: keyId || null, model: model || null }),
    })
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, provider_key_id: keyId || undefined, model: model || undefined } : a))
    setEditAgent(null)
  }

  function keyLabel(agent: AgentType) {
    if (!agent.provider_key_id) return <span style={{ color: '#a3a3a3', fontSize: 12 }}>Global default</span>
    const k = keys.find(k => k.id === agent.provider_key_id)
    if (!k) return <span style={{ color: '#ef4444', fontSize: 12 }}>Key not found</span>
    const color = providerDef(k.provider).color
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
        {k.label}
      </span>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#171717' }}>Models</div>

      {keys.length === 0 && (
        <div style={{ padding: '12px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, fontSize: 13, color: '#92400e' }}>
          Add API keys first (in the "API Keys" section) to assign providers to agents.
        </div>
      )}

      <div style={{ border: '1px solid #e5e5e5', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', padding: '10px 18px', borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
          {['Agent', 'Provider key', 'Model', ''].map((h, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#737373', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
          ))}
        </div>
        {agents.map((a, i) => (
          <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', padding: '12px 18px', borderBottom: i < agents.length - 1 ? '1px solid #f5f5f5' : 'none', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#171717' }}>{a.name}</div>
              <div style={{ fontSize: 11, color: '#a3a3a3' }}>{a.id}</div>
            </div>
            <div>{keyLabel(a)}</div>
            <div style={{ fontSize: 12, color: '#525252' }}>{a.model || <span style={{ color: '#a3a3a3' }}>—</span>}</div>
            <button onClick={() => setEditAgent(a)} style={{ ...ss.btnSecondary, fontSize: 11 }}>Edit</button>
          </div>
        ))}
      </div>

      {editAgent && (
        <ModelModal agent={editAgent} keys={keys} onSave={handleSave} onClose={() => setEditAgent(null)} />
      )}
    </div>
  )
}


function EnvField({ label, envKey, values, masked, onChange }: { label: string; envKey: string; values: Record<string, string>; masked?: boolean; onChange: (key: string, val: string) => void }) {
  const [revealed, setRevealed] = useState(false)
  const val = values[envKey] ?? ''
  const isSecret = masked && val && !revealed
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 12, color: '#525252', fontWeight: 500 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type={isSecret ? 'password' : 'text'}
          value={val}
          onChange={e => onChange(envKey, e.target.value)}
          style={{ ...ss.input, flex: 1, fontFamily: masked ? 'var(--mono, monospace)' : 'inherit', fontSize: 12 }}
        />
        {masked && val && (
          <button onClick={() => setRevealed(v => !v)} style={{ padding: '4px 10px', fontSize: 11, background: '#f5f5f5', border: '1px solid #e5e5e5', borderRadius: 6, cursor: 'pointer', color: '#525252', whiteSpace: 'nowrap' }}>
            {revealed ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
    </div>
  )
}

function EnvironmentSection() {
  const [vals, setVals]     = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  useEffect(() => {
    fetch(`${API}/settings/env`).then(r => r.json()).then(setVals).catch(() => {})
  }, [])

  function set(key: string, val: string) {
    setVals(prev => ({ ...prev, [key]: val }))
  }

  async function save() {
    setSaving(true)
    await fetch(`${API}/settings/env`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: vals }),
    }).catch(() => {})
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#171717' }}>Environment</div>

      {/* Limits */}
      <div style={{ border: '1px solid #e5e5e5', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#171717' }}>Limits</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <EnvField label="Max concurrent agents" envKey="MAX_CONCURRENT_AGENTS" values={vals} onChange={set} />
          <EnvField label="Max delegation depth" envKey="MAX_DELEGATION_DEPTH" values={vals} onChange={set} />
          <EnvField label="Max iterations per agent" envKey="MAX_ITERATIONS" values={vals} onChange={set} />
          <EnvField label="Timeout (seconds)" envKey="TIMEOUT_SECONDS" values={vals} onChange={set} />
        </div>
      </div>

      {/* Workspace */}
      <div style={{ border: '1px solid #e5e5e5', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#171717' }}>Workspace</div>
        <EnvField label="Directory path" envKey="WORKSPACE_DIR" values={vals} onChange={set} />
        <div style={{ fontSize: 12, color: '#a3a3a3' }}>Changes take effect on next backend restart.</div>
      </div>

      <div style={{ padding: '0 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, color: '#a3a3a3' }}>API keys and limits take effect immediately on next agent call.</div>
        <button onClick={save} disabled={saving} style={ss.btn}>{saved ? 'Saved!' : saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}

interface MCPServer { name: string; command: string; tools_count: number; status: string; tools: string[] }

function MCPSection({ onOpenGuide }: { onOpenGuide?: () => void }) {
  const [servers, setServers] = useState<MCPServer[]>([])
  const [showModal, setShowModal] = useState(false)
  const [showHelp, setShowHelp]   = useState(false)
  const [name, setName]       = useState('')
  const [command, setCommand] = useState('')
  const [envRaw, setEnvRaw]   = useState('{}')
  const [error, setError]     = useState('')
  const [adding, setAdding]   = useState(false)

  function load() {
    fetch(`${API}/registry/mcp`).then(r => r.json()).then(setServers).catch(() => {})
  }
  useEffect(() => { load() }, [])

  async function handleAdd() {
    let env: Record<string, string> = {}
    try { env = JSON.parse(envRaw) } catch { setError('Env must be valid JSON'); return }
    if (!name.trim() || !command.trim()) { setError('Name and command are required'); return }
    setError(''); setAdding(true)
    try {
      const res = await fetch(`${API}/registry/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), command: command.trim(), env }),
      })
      if (!res.ok) { setError((await res.json()).detail ?? 'Error'); return }
      setName(''); setCommand(''); setEnvRaw('{}'); setShowModal(false)
      load()
    } finally { setAdding(false) }
  }

  function closeModal() { setShowModal(false); setError(''); setName(''); setCommand(''); setEnvRaw('{}') }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#171717' }}>MCP Servers</div>
            <button onClick={() => setShowHelp(true)} title="How it works" style={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid #d4d4d4', background: '#f5f5f5', color: '#737373', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, flexShrink: 0 }}>?</button>
          </div>
          <div style={{ fontSize: 13, color: '#737373', maxWidth: 480 }}>Connect external tools via Model Context Protocol. MCP tools become available to all agents.</div>
        </div>
        <button onClick={() => setShowModal(true)} style={ss.btn}>+ Add Server</button>
      </div>

      {servers.length === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: '#a3a3a3', fontSize: 13 }}>
          No MCP servers connected yet.
        </div>
      ) : servers.map(srv => (
        <div key={srv.name} style={{ border: '1px solid #e5e5e5', borderRadius: 12, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#171717' }}>{srv.name}</span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: srv.status === 'running' ? '#dcfce7' : '#fee2e2', color: srv.status === 'running' ? '#15803d' : '#dc2626' }}>
              {srv.status}
            </span>
            <button onClick={async () => { await fetch(`${API}/registry/mcp/${srv.name}`, { method: 'DELETE' }); load() }}
              style={{ fontSize: 12, padding: '4px 12px', background: 'none', color: '#ef4444', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer' }}>
              Remove
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#737373', fontFamily: 'var(--mono)' }}>{srv.command}</div>
          {srv.tools.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {srv.tools.map(t => (
                <span key={t} style={{ fontSize: 11, padding: '2px 8px', background: '#f5f5f5', borderRadius: 4, color: '#525252', fontFamily: 'var(--mono)' }}>{t}</span>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Add server modal */}
      {showModal && (
        <>
          <div onClick={closeModal} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 500 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#fff', borderRadius: 14, padding: '28px 32px', width: 480, zIndex: 501, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#171717' }}>Add MCP Server</div>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#a3a3a3', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={ss.label}>Server name</div>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. github" style={ss.input} />
              <div style={ss.label}>Command</div>
              <input value={command} onChange={e => setCommand(e.target.value)}
                placeholder="e.g. npx @modelcontextprotocol/server-github" style={ss.input} />
              <div style={ss.label}>Env variables <span style={{ color: '#a3a3a3', fontWeight: 400, textTransform: 'none' }}>(JSON)</span></div>
              <textarea value={envRaw} onChange={e => setEnvRaw(e.target.value)} rows={3}
                style={{ ...ss.input, resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12 }}
                placeholder={'{ "GITHUB_TOKEN": "${GITHUB_TOKEN}" }'} />
            </div>
            {error && (
              <div style={{ fontSize: 12 }}>
                <span style={{ color: '#ef4444' }}>{error}</span>
                {onOpenGuide && (
                  <span style={{ color: '#a3a3a3' }}> — <button onClick={() => { closeModal(); onOpenGuide() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0ea5e9', fontSize: 12, padding: 0, textDecoration: 'underline' }}>install manually</button></span>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={closeModal} style={ss.ghost}>Cancel</button>
              <button onClick={handleAdd} disabled={adding} style={ss.btn}>{adding ? 'Starting…' : 'Add Server'}</button>
            </div>
          </div>
        </>
      )}

      {/* Help modal */}
      {showHelp && (
        <>
          <div onClick={() => setShowHelp(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 500 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#fff', borderRadius: 14, padding: '28px 32px', width: 520, zIndex: 501, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#171717' }}>How MCP Servers work</div>
              <button onClick={() => setShowHelp(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#a3a3a3', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: '#525252', lineHeight: 1.65 }}>
              <p style={{ margin: 0 }}>MCP (Model Context Protocol) is Anthropic's standard for connecting external tools. Each server runs as a separate process; orches communicates with it over stdio using JSON-RPC.</p>
              <div style={{ background: '#f5f5f5', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#a3a3a3', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Node.js servers (recommended)</div>
                <div style={{ color: '#171717' }}>Downloaded and run automatically via <code style={{ background: '#e5e5e5', padding: '1px 5px', borderRadius: 4, fontFamily: 'var(--mono)' }}>npx</code>. Requires Node.js installed.</div>
                <pre style={{ margin: 0, background: '#0d0d0d', color: '#e5e5e5', borderRadius: 8, padding: '10px 14px', fontSize: 12, fontFamily: 'var(--mono)' }}>npx -y @modelcontextprotocol/server-github</pre>
              </div>
              <div style={{ background: '#f5f5f5', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#a3a3a3', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Python servers</div>
                <div style={{ color: '#171717' }}>Requires <code style={{ background: '#e5e5e5', padding: '1px 5px', borderRadius: 4, fontFamily: 'var(--mono)' }}>pip install</code> into the venv first, then use:</div>
                <pre style={{ margin: 0, background: '#0d0d0d', color: '#e5e5e5', borderRadius: 8, padding: '10px 14px', fontSize: 12, fontFamily: 'var(--mono)' }}>python -m mcp_server_fetch</pre>
              </div>
              <div style={{ background: '#f0f9ff', borderRadius: 10, padding: '12px 16px', fontSize: 12, color: '#0369a1', borderLeft: '3px solid #38bdf8' }}>
                Once added, the server's tools appear in the TOOLS list for all agents. Tool names follow the format <code style={{ fontFamily: 'var(--mono)' }}>server_name__tool_name</code>.
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowHelp(false)} style={ss.btn}>Got it</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const DEPTH_LABELS: Record<number, { label: string; desc: string }> = {
  1: { label: 'Quick',  desc: '2–3 sources, brief answers' },
  2: { label: 'Normal', desc: '5–7 sources, balanced' },
  3: { label: 'Deep',   desc: '10+ sources, thorough (slow)' },
}

function GeneralSection() {
  const [autoSummarize, setAutoSummarize] = useState(false)
  const [threshold, setThreshold]         = useState(20)
  const [noEmojis, setNoEmojis]           = useState(false)
  const [researchDepth, setResearchDepth] = useState(2)
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)

  useEffect(() => {
    fetch(`${API}/settings`).then(r => r.json()).then(d => {
      setAutoSummarize(d.auto_summarize ?? false)
      setThreshold(d.summarize_threshold ?? 20)
      setNoEmojis(d.no_emojis ?? false)
      setResearchDepth(d.research_depth ?? 2)
    }).catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    await fetch(`${API}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_summarize: autoSummarize, summarize_threshold: threshold, no_emojis: noEmojis, research_depth: researchDepth }),
    }).catch(() => {})
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#171717' }}>General</div>

      <div style={{ border: '1px solid #e5e5e5', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#171717' }}>Chat</div>
        <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: '#171717', marginBottom: 4 }}>Auto-summarize long history</div>
              <div style={{ fontSize: 12, color: '#737373', maxWidth: 420 }}>
                When conversation exceeds the threshold, older messages are compressed into a summary to save context window space.
              </div>
            </div>
            <button onClick={() => setAutoSummarize(v => !v)} style={{ width: 36, height: 20, borderRadius: 10, background: autoSummarize ? '#171717' : '#d4d4d4', border: 'none', cursor: 'pointer', flexShrink: 0, padding: 3, display: 'flex', alignItems: 'center', justifyContent: autoSummarize ? 'flex-end' : 'flex-start', transition: 'background 0.2s' }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff' }} />
            </button>
          </div>

          {autoSummarize && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 12, color: '#525252' }}>Summarize after</div>
              <input type="number" min={6} max={100} value={threshold} onChange={e => setThreshold(Number(e.target.value))}
                style={{ ...ss.input, width: 72, textAlign: 'center' }} />
              <div style={{ fontSize: 12, color: '#525252' }}>messages</div>
            </div>
          )}
        </div>
      </div>

      <div style={{ border: '1px solid #e5e5e5', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#171717' }}>Response Style</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: '#171717', marginBottom: 4 }}>Disable emojis</div>
            <div style={{ fontSize: 12, color: '#737373', maxWidth: 420 }}>
              Agent will not use emojis in any responses.
            </div>
          </div>
          <button onClick={() => setNoEmojis(v => !v)} style={{ width: 36, height: 20, borderRadius: 10, background: noEmojis ? '#171717' : '#d4d4d4', border: 'none', cursor: 'pointer', flexShrink: 0, padding: 3, display: 'flex', alignItems: 'center', justifyContent: noEmojis ? 'flex-end' : 'flex-start', transition: 'background 0.2s' }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff' }} />
          </button>
        </div>
      </div>

      <div style={{ border: '1px solid #e5e5e5', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#171717' }}>Research</div>
        <div>
          <div style={{ fontSize: 13, color: '#171717', marginBottom: 4 }}>Depth</div>
          <div style={{ fontSize: 12, color: '#737373', marginBottom: 12 }}>
            How many sources agents search before answering. Deeper = slower but more thorough.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {([1, 2, 3] as const).map(d => (
              <button key={d} onClick={() => setResearchDepth(d)} style={{
                flex: 1, padding: '10px 8px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${researchDepth === d ? '#171717' : '#e5e5e5'}`,
                background: researchDepth === d ? '#171717' : '#fff',
                color: researchDepth === d ? '#fff' : '#525252',
                transition: 'all 0.15s',
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{DEPTH_LABELS[d].label}</div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>{DEPTH_LABELS[d].desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={save} disabled={saving} style={ss.btn}>{saved ? 'Saved!' : saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}

// ── Guide ─────────────────────────────────────────────────────────────────────

const GUIDE_CONTENT = `
# How to use Orches

## Basics

**Send a message** — select an agent in the Chat tab, type in the input field and press Enter or the ↵ button.

**Attach a file** — drag a file from Workspace into the chat. It appears as a badge above your message. The agent reads its contents automatically.

**Stop an agent** — while an agent is running, the send button turns red ✕. Click it to stop execution after the current step.

**Open Canvas** — click the icon button in the top-right corner, or ask the agent to show something and it will open Canvas automatically.

---

## Agents

An **agent** is a configuration: name, system prompt, tool list, and model. It has no persistent state between requests except chat history.

**Create an agent via UI** — click + on the agent graph, fill in the name, system prompt, and select tools.

**Ask the main agent to build a team** — just say:
\`\`\`
Create an analyst agent with read_file and web_search tools
\`\`\`
The main agent will call the \`create_agent\` tool and register the new agent in the system.

**Delegation** — an agent can hand off a task to another agent via the \`delegate\` tool. The chain is limited by depth (default 3). Configurable in Environment → Max delegation depth.

---

## Models & API Keys

**Add an API key** — Settings → API Keys → Add Key. Choose a provider, enter your key and save. Keys are stored locally in \`data/provider_keys.json\` and never committed to git.

**Assign a model to an agent** — Settings → Models. For each agent, pick a key and enter a model name. If nothing is assigned, the first matching key for the agent's provider is used automatically.

**Supported providers:**
- **Anthropic** — Claude (claude-sonnet-4-6, claude-opus-4-7, claude-haiku-4-5)
- **OpenAI** — GPT-4o, GPT-4o mini
- **Google** — Gemini 2.0 Flash, Gemini 1.5 Pro
- **Groq** — Llama 3.3 70B (very fast)
- **Mistral** — Mistral Large
- **DeepSeek** — DeepSeek Chat (cost-efficient)
- **Together AI** — open-source models
- **xAI** — Grok
- **Perplexity** — Sonar Pro (live web access)
- **Ollama** — local models, no key required

---

## Workspace

The **workspace** is a server-side directory where agents read and write files. Default: \`./workspace\`.

**Built-in file tools:**
- \`read_file\` — read a text file
- \`write_file\` — create or overwrite a file
- \`list_files\` — list files in a directory
- \`delete_file\` — delete a file

**Upload a file via UI** — open Canvas → Files, click Upload or drag a file in.

**Open a file from chat** — when an agent references a file as \`[file: path]\`, click the badge to open it in Canvas.

---

## Canvas

Canvas is the built-in viewer for agent output.

**Page types:**
- **Markdown** — reports and documents. Save button writes to workspace.
- **Code** — syntax-highlighted code. Save button writes to workspace.
- **Table** — structured data, CSV.
- **Chart** — line, bar, and pie charts.
- **Browser** — embedded browser; agents can open URLs here.
- **Files** — workspace file manager.

**How agents open Canvas** — via the \`canvas_open\` tool. You can ask: *"show the result in Canvas"* or *"open a chart"*.

---

## Settings

**General:**
- *Auto-summarize* — automatically compresses long chat history to stay within the context window.
- *Summarize threshold* — number of messages before summarization kicks in.
- *No emojis* — agent replies without emoji.
- *Research depth* — how deep the agent searches when using \`web_search\`.

**Environment:**
- *Max concurrent agents* — how many agents can run at the same time.
- *Max delegation depth* — maximum depth of the delegation chain.
- *Max iterations* — how many LLM steps an agent takes per request.
- *Timeout* — maximum execution time per request in seconds.

**MCP Servers** — connect external services via the Model Context Protocol. Each server adds new tools to all agents.

---

## Installing MCP Servers

MCP servers run as local processes. If a server fails to start from the UI, install it manually first.

### Node.js (npx)

Most MCP servers are npm packages. Install globally so they're always available:

\`\`\`bash
npm install -g @notionhq/notion-mcp-server
npm install -g @modelcontextprotocol/server-github
npm install -g @modelcontextprotocol/server-filesystem
\`\`\`

Then in **Settings → MCP Servers**, use the installed binary as the command:

\`\`\`
notion-mcp-server
\`\`\`

Or continue using \`npx -y <package>\` — npx downloads and runs the package directly without global install.

### Python (uv or pip)

Python MCP servers use \`uv\` (recommended) or \`pip\`:

\`\`\`bash
# With uv (faster, isolated)
uv tool install mcp-server-fetch

# With pip
pip install mcp-server-fetch
\`\`\`

Then use the module as the command:

\`\`\`
python -m mcp_server_fetch
\`\`\`

Or with uv:

\`\`\`
uvx mcp-server-fetch
\`\`\`

### ENV Variables

Pass secrets and config in the **ENV Variables** field as JSON:

\`\`\`json
{
  "GITHUB_TOKEN": "ghp_your_token",
  "NOTION_API_KEY": "secret_your_key"
}
\`\`\`

### Troubleshooting

If the server fails to start, check the terminal where orches is running for error details. Common fixes:
- Make sure \`node\` / \`python\` / \`npx\` is in your PATH
- Install the package globally before adding it via UI
- Verify the token or API key in ENV Variables is correct
`

function GuideSection() {
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{
        fontSize: 13, lineHeight: 1.75, color: '#171717',
      }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <div style={{ fontSize: 20, fontWeight: 700, color: '#171717', marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid #e5e5e5' }}>{children}</div>,
            h2: ({ children }) => <div style={{ fontSize: 15, fontWeight: 700, color: '#171717', marginTop: 32, marginBottom: 12 }}>{children}</div>,
            p: ({ children }) => <p style={{ margin: '0 0 10px', color: '#404040' }}>{children}</p>,
            ul: ({ children }) => <ul style={{ margin: '0 0 12px', paddingLeft: 20, color: '#404040' }}>{children}</ul>,
            li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
            code: ({ children, className }) => {
              const isBlock = className?.startsWith('language-')
              return isBlock
                ? <pre style={{ background: '#f5f5f5', border: '1px solid #e5e5e5', borderRadius: 8, padding: '12px 16px', fontSize: 12, fontFamily: 'var(--mono)', overflowX: 'auto', margin: '8px 0 14px' }}><code>{children}</code></pre>
                : <code style={{ background: '#f5f5f5', borderRadius: 4, padding: '1px 6px', fontSize: 12, fontFamily: 'var(--mono)', color: '#171717' }}>{children}</code>
            },
            strong: ({ children }) => <strong style={{ fontWeight: 600, color: '#171717' }}>{children}</strong>,
            hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e5e5e5', margin: '24px 0' }} />,
          }}
        >
          {GUIDE_CONTENT}
        </ReactMarkdown>
      </div>
    </div>
  )
}

type SettingsSection = 'general' | 'api-keys' | 'models' | 'environment' | 'mcp' | 'guide'

const SETTINGS_NAV: { id: SettingsSection; label: string }[] = [
  { id: 'general',     label: 'General' },
  { id: 'api-keys',    label: 'API Keys' },
  { id: 'models',      label: 'Models' },
  { id: 'environment', label: 'Environment' },
  { id: 'mcp',         label: 'MCP Servers' },
  { id: 'guide',       label: 'Guide' },
]

function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>('general')
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Sidebar */}
      <div style={{ width: 200, borderRight: '1px solid #e5e5e5', padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: '#a3a3a3', letterSpacing: '0.07em', textTransform: 'uppercase', fontWeight: 600, padding: '0 8px', marginBottom: 6 }}>Settings</div>
        {SETTINGS_NAV.map(item => (
          <button key={item.id} onClick={() => setSection(item.id)} style={{
            padding: '8px 12px', borderRadius: 8,
            border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', fontSize: 13,
            background: section === item.id ? '#f5f5f5' : 'transparent',
            color: section === item.id ? '#171717' : '#525252',
            fontWeight: section === item.id ? 600 : 400,
          }}>
            {item.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <a
          href="https://github.com/ysz7"
          target="_blank"
          rel="noopener noreferrer"
          style={{ padding: '8px 12px', fontSize: 12, color: '#a3a3a3', textDecoration: 'none', borderRadius: 8 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#171717')}
          onMouseLeave={e => (e.currentTarget.style.color = '#a3a3a3')}
        >
          by YSZ
        </a>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 36px' }}>
        {section === 'general'     && <GeneralSection />}
        {section === 'api-keys'    && <ApiKeysSection />}
        {section === 'models'      && <ModelsSection />}
        {section === 'environment' && <EnvironmentSection />}
        {section === 'mcp'         && <MCPSection onOpenGuide={() => setSection('guide')} />}
        {section === 'guide'       && <GuideSection />}
      </div>
    </div>
  )
}

// ── Canvas ────────────────────────────────────────────────────────────────────

export default function Canvas({ pages, activeId, minimized, onMinimize, onRestore, onClose, onClosePage, onSelect, onOpenPage }: Props) {
  if (pages.length === 0) return null

  const activePage = pages.find(p => p.id === activeId) ?? pages[pages.length - 1]

  // Persist current directory per files-page so navigation survives tab switching
  const [filePaths, setFilePaths] = useState<Record<string, string>>({})
  function handleFilesPathChange(pageId: string, path: string) {
    setFilePaths(prev => ({ ...prev, [pageId]: path }))
  }

  if (minimized) {
    return (
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 40, background: '#f5f5f5', borderTop: '1px solid #e5e5e5', zIndex: 200, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 6 }}>
        {pages.map(p => (
          <div key={p.id} onClick={() => onRestore(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: p.id === activePage.id ? '#ffffff' : 'transparent', borderRadius: 6, border: p.id === activePage.id ? '1px solid #e5e5e5' : '1px solid transparent', cursor: 'pointer' }}>
            <span style={{ fontSize: 11, color: '#525252' }}>{PAGE_ICONS[p.type]}</span>
            <span style={{ fontSize: 12, color: '#171717', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
            <button onClick={e => { e.stopPropagation(); onClosePage(p.id) }} style={{ fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#a3a3a3', padding: '0 2px', lineHeight: 1 }}>✕</button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#ffffff', zIndex: 200, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ height: 48, display: 'flex', alignItems: 'center', borderBottom: '1px solid #e5e5e5', padding: '0 16px', gap: 0, flexShrink: 0, background: '#fafafa' }}>
        {/* Tabs */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2, overflowX: 'auto', minWidth: 0 }}>
          {pages.map(p => {
            const active = p.id === activePage.id
            return (
              <div key={p.id} onClick={() => onSelect(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, cursor: 'pointer', background: active ? '#ffffff' : 'transparent', border: active ? '1px solid #e5e5e5' : '1px solid transparent', flexShrink: 0, maxWidth: 200 }}>
                <span style={{ fontSize: 13, color: active ? '#525252' : '#a3a3a3' }}>{PAGE_ICONS[p.type]}</span>
                <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? '#171717' : '#737373', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                <button onClick={e => { e.stopPropagation(); onClosePage(p.id) }} style={{ fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: '#a3a3a3', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}>✕</button>
              </div>
            )
          })}
        </div>
        {/* Controls */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 12 }}>
          <button onClick={onMinimize} title="Minimize" style={sc.iconBtn}>⌄</button>
          <button onClick={onClose}    title="Close"    style={sc.iconBtn}>✕</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: (activePage.type === 'settings' || activePage.type === 'files') ? 'hidden' : 'auto' }}>
        {activePage.type === 'markdown' && <MarkdownPage content={activePage.content ?? ''} title={activePage.title} />}
        {activePage.type === 'code'     && <CodePage content={activePage.content ?? ''} language={activePage.language} title={activePage.title} />}
        {activePage.type === 'browser'  && <BrowserPage initialUrl={activePage.url ?? ''} />}
        {activePage.type === 'table'    && <TablePage data={activePage.data ?? '[]'} title={activePage.title} />}
        {activePage.type === 'chart'    && <ChartPage data={activePage.data ?? '[]'} chart_type={activePage.chart_type} title={activePage.title} />}
        {activePage.type === 'image'    && <ImagePage filePath={activePage.filePath ?? activePage.url ?? ''} title={activePage.title} />}
        {activePage.type === 'files'    && <FilesPage initialPath={filePaths[activePage.id] ?? activePage.filePath ?? ''} onOpenPage={onOpenPage} onPathChange={p => handleFilesPathChange(activePage.id, p)} />}
        {activePage.type === 'settings' && <SettingsPage />}
      </div>
    </div>
  )
}

const sc: Record<string, React.CSSProperties> = {
  iconBtn: {
    background: '#fff', border: '1px solid #e5e5e5', borderRadius: 7,
    color: '#525252', cursor: 'pointer', fontSize: 15,
    width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, flexShrink: 0,
  },
}

const sf: Record<string, React.CSSProperties> = {
  btn: { background: '#171717', border: 'none', borderRadius: 7, color: '#fff', fontFamily: 'inherit', fontSize: 12, padding: '5px 14px', cursor: 'pointer', flexShrink: 0 },
}

const ss: Record<string, React.CSSProperties> = {
  label:       { fontSize: 11, color: '#a3a3a3', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 },
  input:       { background: '#fafafa', border: '1px solid #e5e5e5', borderRadius: 8, color: '#171717', fontFamily: 'inherit', fontSize: 13, padding: '9px 12px', outline: 'none', width: '100%', boxSizing: 'border-box' },
  btn:         { background: '#171717', border: 'none', borderRadius: 8, color: '#fff', fontFamily: 'inherit', fontSize: 13, padding: '8px 18px', cursor: 'pointer' },
  btnSecondary:{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8, color: '#525252', fontFamily: 'inherit', fontSize: 13, padding: '8px 18px', cursor: 'pointer' },
  ghost:       { background: 'none', border: '1px solid #e5e5e5', borderRadius: 8, color: '#525252', fontFamily: 'inherit', fontSize: 13, padding: '8px 18px', cursor: 'pointer' },
}
