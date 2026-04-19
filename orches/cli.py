"""
orches terminal client
Connect to the running server, pick an agent, and chat in real time.
"""
import asyncio
import json
import sys
import httpx
import websockets
from datetime import datetime

BASE_URL = "http://localhost:8000"
WS_URL  = "ws://localhost:8000/ws/events"

# ANSI colors
RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
CYAN   = "\033[36m"
GREEN  = "\033[32m"
YELLOW = "\033[33m"
RED    = "\033[31m"
BLUE   = "\033[34m"
MAGENTA = "\033[35m"

EVENT_COLORS = {
    "started":    GREEN,
    "thinking":   CYAN,
    "tool_call":  YELLOW,
    "delegating": MAGENTA,
    "done":       GREEN + BOLD,
    "error":      RED,
}


def ts():
    return datetime.now().strftime("%H:%M:%S")


def print_event(event: dict):
    etype = event.get("event_type", "")
    agent = event.get("agent_id", "")
    payload = event.get("payload", {})
    color = EVENT_COLORS.get(etype, RESET)

    if etype == "started":
        print(f"  {DIM}[{ts()}]{RESET} {color}{agent}{RESET} {DIM}→{RESET} started")
    elif etype == "thinking":
        print(f"  {DIM}[{ts()}]{RESET} {color}{agent}{RESET} {DIM}→{RESET} thinking...")
    elif etype == "tool_call":
        tool = payload.get("tool", "?")
        inp  = payload.get("input", {})
        args = ", ".join(f"{k}={repr(v)}" for k, v in inp.items())
        print(f"  {DIM}[{ts()}]{RESET} {color}{agent}{RESET} {DIM}→{RESET} {YELLOW}tool:{RESET} {tool}({args})")
    elif etype == "delegating":
        to   = payload.get("to", "?")
        task = payload.get("task", "")[:60]
        print(f"  {DIM}[{ts()}]{RESET} {color}{agent}{RESET} {DIM}→{RESET} delegating to {MAGENTA}{to}{RESET}: {task}")
    elif etype == "done":
        result = payload.get("result", "")[:120]
        print(f"  {DIM}[{ts()}]{RESET} {color}{agent} done{RESET}: {result}{'...' if len(payload.get('result','')) > 120 else ''}")
    elif etype == "error":
        print(f"  {DIM}[{ts()}]{RESET} {RED}{agent} error{RESET}: {payload}")


async def fetch_agents() -> list[dict]:
    async with httpx.AsyncClient(follow_redirects=True) as client:
        r = await client.get(f"{BASE_URL}/agents")
        r.raise_for_status()
        return r.json()


async def run_agent(agent_id: str, user_input: str) -> str:
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        r = await client.post(
            f"{BASE_URL}/agents/{agent_id}/run",
            json={"input": user_input},
        )
        r.raise_for_status()
        return r.json().get("result", "")


# Shared flag: is a request in flight?
_running = False


async def ws_listener():
    """Background task: print events as they arrive."""
    global _running
    while True:
        try:
            async with websockets.connect(WS_URL) as ws:
                async for raw in ws:
                    try:
                        event = json.loads(raw)
                    except Exception:
                        continue
                    if event.get("type") == "ping":
                        continue
                    if _running:
                        print_event(event)
        except Exception:
            await asyncio.sleep(2)  # reconnect on disconnect


async def main():
    global _running

    print(f"\n{BOLD}{CYAN}agent-squad{RESET} terminal client\n")

    # Wait for server
    for _ in range(20):
        try:
            async with httpx.AsyncClient() as c:
                await c.get(BASE_URL)
            break
        except Exception:
            print("  waiting for server...", end="\r")
            await asyncio.sleep(0.5)
    else:
        print(f"{RED}Could not connect to server at {BASE_URL}{RESET}")
        sys.exit(1)

    # Fetch agents
    agents = await fetch_agents()
    if not agents:
        print(f"{RED}No agents loaded. Check registry/agents/{RESET}")
        sys.exit(1)

    print(f"{BOLD}Available agents:{RESET}")
    for i, a in enumerate(agents):
        print(f"  {CYAN}{i+1}.{RESET} {a['id']:<15} {DIM}{a.get('name','')}{RESET}")

    print()
    default_id = agents[0]["id"]
    choice = input(f"Pick agent (name or number) [{default_id}]: ").strip()

    if not choice:
        agent_id = default_id
    elif choice.isdigit():
        idx = int(choice) - 1
        if 0 <= idx < len(agents):
            agent_id = agents[idx]["id"]
        else:
            print(f"{RED}Invalid number: {choice}{RESET}")
            sys.exit(1)
    else:
        agent_id = choice

    if agent_id not in [a["id"] for a in agents]:
        print(f"{RED}Unknown agent: {agent_id}{RESET}")
        sys.exit(1)

    print(f"\n{DIM}Chatting with {CYAN}{agent_id}{RESET}. Type {BOLD}exit{RESET} to quit.\n")

    # Start WS listener in background
    ws_task = asyncio.create_task(ws_listener())

    loop = asyncio.get_event_loop()

    while True:
        try:
            user_input = await loop.run_in_executor(None, lambda: input(f"{BOLD}you:{RESET} ").strip())
        except (EOFError, KeyboardInterrupt):
            break

        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit"):
            break

        print()
        _running = True
        try:
            result = await run_agent(agent_id, user_input)
        except Exception as e:
            print(f"{RED}Error: {e}{RESET}")
            _running = False
            continue
        _running = False

        print(f"\n{GREEN}{BOLD}agent:{RESET} {result}\n")

    ws_task.cancel()
    print(f"\n{DIM}Bye.{RESET}\n")


if __name__ == "__main__":
    asyncio.run(main())
