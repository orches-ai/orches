# Orches

**Open-source AI agent orchestration platform.** Build teams of AI agents that collaborate, delegate tasks, use tools, and produce results — all from a visual interface.

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT%20with%20Attribution-black?style=flat)

![Orches workspace](docs/gallery/workspace.png)

![Orches agent research](docs/gallery/agent-research.png)

---

## What is Orches?

Orches lets you create and manage AI agents that work together. Each agent has a name, a system prompt, a set of tools, and can delegate tasks to other agents. You interact with them through a chat interface; they collaborate behind the scenes.

**Key features:**
- Multi-agent orchestration with delegation chains
- Visual agent graph with live status
- Built-in workspace (read/write files, canvas, browser)
- Support for 10+ AI providers (Anthropic, OpenAI, Google, Groq, Mistral, DeepSeek, Ollama, and more)
- MCP (Model Context Protocol) server integration
- Scheduled tasks, memory, structured output
- Self-assembly: agents can create other agents

---

## Quick Start

### Option 1 — Docker (recommended)

Requires [Docker](https://docs.docker.com/get-docker/) and Docker Compose.

```bash
git clone https://github.com/orches-ai/orches.git
cd orches
docker compose up --build
```

Open **http://localhost:8000** in your browser.

Add your API key in **Settings → API Keys** and you're ready.

---

### Option 2 — Local (start.sh)

Requires Python 3.11+ and Node.js 18+.

```bash
git clone https://github.com/orches-ai/orches.git
cd orches
./start.sh
```

The script will:
- Create a Python virtual environment and install dependencies
- Install frontend dependencies
- Start the backend on `:8000` and open the UI on `:5173`

Open **http://localhost:5173** in your browser.

To stop:
```bash
./stop.sh
```

---

## Configuration

All API keys and runtime settings are managed in the UI under **Settings**. No manual `.env` editing required.

The `.env` file is created automatically on first run. The only value you may want to change is:

```env
# Default provider when an agent has no API key assigned via UI
PROVIDER=anthropic
```

**SQLite is used by default** — no database setup needed. Data is stored in `orches/data/agents.db`.

To use PostgreSQL instead, add to `.env`:
```env
DATABASE_URL=postgresql+psycopg2://user:password@localhost/orches
```
And install: `pip install -r orches/requirements-postgres.txt`

---

## Updating

Your agents, workspace files, API keys, and settings are stored in:
```
orches/data/            ← database, provider keys, app settings
orches/workspace/       ← agent workspace files
orches/registry/agents/ ← agent configs
```

These are excluded from git, so `git pull` never overwrites your data.

**With Docker:**
```bash
git pull
docker compose up --build
```

**With start.sh:**
```bash
git pull
./start.sh
```

---

## Project Structure

```
orches/
├── core/           ← engine, events, status, database
├── api/            ← FastAPI routes (agents, settings, workspace, ws)
├── providers/      ← Anthropic, OpenAI, Ollama adapters
├── registry/
│   ├── agents/     ← agent .agent config files
│   └── tools/      ← builtin + custom tools
├── data/           ← SQLite DB, provider keys, app settings (gitignored)
├── workspace/      ← agent file workspace (gitignored)
└── frontend/       ← React + Vite UI
```

---

## Adding a Custom Tool

Create `orches/registry/tools/builtin/my_tool.py`:

```python
TOOL_META = {
    "name": "my_tool",
    "description": "Does something useful",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Input query"}
        },
        "required": ["query"]
    }
}

async def execute(query: str) -> str:
    return f"Result for: {query}"
```

Restart the server — the tool is auto-discovered.

---

## Supported Providers

| Provider | Models |
|----------|--------|
| Anthropic | Claude Sonnet 4.6, Opus 4.7, Haiku 4.5 |
| OpenAI | GPT-4o, GPT-4o mini |
| Google | Gemini 2.0 Flash, Gemini 1.5 Pro |
| Groq | Llama 3.3 70B (very fast) |
| Mistral | Mistral Large |
| DeepSeek | DeepSeek Chat |
| Together AI | Open-source models |
| xAI | Grok |
| Perplexity | Sonar Pro (live web) |
| Ollama | Any local model, no API key needed |

---

## License

MIT
