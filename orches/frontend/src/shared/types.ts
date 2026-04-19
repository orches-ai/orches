export interface Agent {
  id: string
  name: string
  version?: string
  description?: string
  system_prompt?: string
  tools?: string[]
  can_call?: string[]
  provider_key_id?: string
  model?: string
}

export interface ProviderKey {
  id: string
  provider: 'anthropic' | 'openai' | 'ollama'
  label: string
  key: string
  url?: string
  model?: string
}

export interface AgentEvent {
  agent_id: string
  event_type: 'started' | 'thinking' | 'tool_call' | 'delegating' | 'done' | 'error' | 'queued' | 'unqueued' | 'status' | 'result' | 'canvas_open' | 'agent_created'
  payload: Record<string, unknown>
  timestamp: string
  _time?: string
}

export interface CanvasPage {
  id: string
  title: string
  type: 'markdown' | 'code' | 'browser' | 'settings' | 'files' | 'image' | 'table' | 'chart'
  content?: string
  language?: string
  url?: string
  filePath?: string
  data?: string
  chart_type?: 'line' | 'bar' | 'area' | 'pie' | 'scatter'
}

export interface Message {
  role: 'user' | 'agent'
  text: string
  streaming?: boolean
}
