"""Settings from environment. Local defaults match docker-compose.yml + infra/local/init.sql (local-only secrets)."""

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Settings:
    pg_host: str = field(default_factory=lambda: _env("DRC_PG_HOST", "localhost"))
    pg_port: int = field(default_factory=lambda: int(_env("DRC_PG_PORT", "55432")))
    admin_password: str = field(default_factory=lambda: _env("DRC_ADMIN_PASSWORD", "local-admin-only"))
    dbt_prod_password: str = field(default_factory=lambda: _env("DRC_DBT_PROD_PASSWORD", "dbt-local-only"))
    reader_password: str = field(default_factory=lambda: _env("DRC_READER_PASSWORD", "reader-local-only"))
    app_password: str = field(default_factory=lambda: _env("DRC_APP_PASSWORD", "app-local-only"))
    sandbox_password: str = field(default_factory=lambda: _env("DRC_SANDBOX_PASSWORD", "sandbox-local-only"))
    var_dir: Path = field(default_factory=lambda: Path(_env("DRC_VAR_DIR", str(ROOT / "var"))))
    dbt_dir: Path = ROOT / "dbt"
    marquez_url: str | None = field(default_factory=lambda: os.environ.get("DRC_MARQUEZ_URL"))
    llm_provider: str = field(default_factory=lambda: _env("DRC_LLM_PROVIDER", "fake"))
    llm_model: str = field(default_factory=lambda: _env("DRC_LLM_MODEL", "claude-opus-5-5"))

    def dsn(self, user: str, password: str, db: str) -> str:
        return f"host={self.pg_host} port={self.pg_port} user={user} password={password} dbname={db}"

    @property
    def admin_dsn(self) -> str:
        return self.dsn("drc_admin", self.admin_password, "postgres")

    @property
    def warehouse_rw_dsn(self) -> str:
        return self.dsn("dbt_prod", self.dbt_prod_password, "warehouse")

    @property
    def warehouse_ro_dsn(self) -> str:
        return self.dsn("copilot_reader", self.reader_password, "warehouse")

    @property
    def app_dsn(self) -> str:
        return self.dsn("app", self.app_password, "app")

    def sandbox_dsn(self, db: str) -> str:
        return self.dsn("sandbox_rw", self.sandbox_password, db)


settings = Settings()
