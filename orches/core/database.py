from sqlalchemy import create_engine, Column, String, Text, DateTime, Integer, JSON, Boolean
try:
    from pgvector.sqlalchemy import Vector as PgVector
    _VECTOR_SUPPORT = True
except ImportError:
    _VECTOR_SUPPORT = False
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime, timezone
import os

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{os.path.join(os.path.dirname(__file__), '../data/agents.db')}"
)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class AgentModel(Base):
    __tablename__ = "agents"
    id         = Column(String, primary_key=True)
    name       = Column(String, nullable=False)
    version    = Column(String, default="1.0.0")
    config     = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class RunModel(Base):
    __tablename__ = "runs"
    id          = Column(String, primary_key=True)
    agent_id    = Column(String, nullable=False)
    status      = Column(String, default="pending")
    input       = Column(Text)
    output      = Column(Text)
    started_at  = Column(DateTime)
    finished_at = Column(DateTime)


class LogModel(Base):
    __tablename__ = "logs"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    run_id     = Column(String, nullable=False)
    agent_id   = Column(String, nullable=False)
    event_type = Column(String, nullable=False)
    payload    = Column(Text)
    timestamp  = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class MemoryModel(Base):
    __tablename__ = "memory"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    agent_id   = Column(String, nullable=False)
    key        = Column(String, nullable=False)
    value      = Column(Text)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ChainModel(Base):
    __tablename__ = "chains"
    id         = Column(String, primary_key=True)
    name       = Column(String, nullable=False)
    config     = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ChatMessageModel(Base):
    __tablename__ = "chat_messages"
    id         = Column(String, primary_key=True)
    agent_id   = Column(String, nullable=False, index=True)
    role       = Column(String, nullable=False)
    text       = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class TaskModel(Base):
    __tablename__ = "tasks"
    task_id     = Column(String, primary_key=True)
    agent_id    = Column(String, nullable=False, index=True)
    input       = Column(Text, nullable=False)
    status      = Column(String, default="queued")  # queued | running | done | error | scheduled | cancelled
    result      = Column(Text)
    error       = Column(Text)
    schedule    = Column(Text)           # cron expr or ISO datetime
    repeat      = Column(Boolean, default=False)
    last_run_at = Column(DateTime)
    next_run_at = Column(DateTime)
    created_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    finished_at = Column(DateTime)


class AgentMemoryModel(Base):
    __tablename__ = "agent_memory"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    agent_id   = Column(String, nullable=False, index=True)
    scope      = Column(String, nullable=False, default="agent")  # agent | team | global
    key        = Column(String, nullable=False)
    value      = Column(Text, nullable=False)
    embedding  = Column(PgVector(1536), nullable=True) if _VECTOR_SUPPORT else Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class AgentRunModel(Base):
    __tablename__ = "agent_runs"
    id          = Column(String, primary_key=True)
    agent_id    = Column(String, nullable=False, index=True)
    run_id      = Column(String, nullable=False)
    status      = Column(String, default="running")  # running | success | failed | timeout
    input       = Column(Text)
    output      = Column(Text)
    steps       = Column(JSON, default=list)          # list of tool call records
    input_tokens  = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    duration_ms   = Column(Integer)
    error       = Column(Text)
    created_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    finished_at = Column(DateTime)


def _migrate_sqlite():
    """Add missing columns to existing SQLite tables (safe no-op if column exists)."""
    if not DATABASE_URL.startswith("sqlite"):
        return
    from sqlalchemy import text, inspect
    with engine.connect() as conn:
        inspector = inspect(engine)
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {col["name"] for col in inspector.get_columns(table.name)}
            for col in table.columns:
                if col.name not in existing:
                    # Build column DDL (TEXT is safe default for SQLite)
                    type_map = {
                        String: "TEXT", Text: "TEXT",
                        Integer: "INTEGER", Boolean: "INTEGER",
                        DateTime: "DATETIME", JSON: "TEXT",
                    }
                    col_type = next(
                        (v for k, v in type_map.items() if isinstance(col.type, k)),
                        "TEXT"
                    )
                    default = ""
                    if col.default is not None and hasattr(col.default, "arg") and not callable(col.default.arg):
                        default = f" DEFAULT '{col.default.arg}'"
                    conn.execute(text(
                        f"ALTER TABLE {table.name} ADD COLUMN {col.name} {col_type}{default}"
                    ))
        conn.commit()


def init_db():
    Base.metadata.create_all(bind=engine)
    _migrate_sqlite()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
