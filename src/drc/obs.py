"""Observability: OpenTelemetry tracing + structured JSON logs.

Spans always go to var/traces/spans.jsonl; also to OTLP/HTTP when OTEL_EXPORTER_OTLP_ENDPOINT is set
(e.g. Jaeger from the `obs` compose profile).
"""

import json
import logging
import os
import sys
from datetime import UTC, datetime
from typing import Any

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor

from drc.config import settings

_configured = False


def setup(service: str = "drc") -> None:
    global _configured
    if _configured:
        return
    provider = TracerProvider(resource=Resource.create({"service.name": service}))
    path = settings.var_dir / "traces" / "spans.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    out = path.open("a")
    provider.add_span_processor(
        SimpleSpanProcessor(ConsoleSpanExporter(out=out, formatter=lambda s: s.to_json(indent=None) + "\n"))
    )
    if os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%(message)s")
    _configured = True


tracer = trace.get_tracer("drc")


def current_trace_id() -> str | None:
    ctx = trace.get_current_span().get_span_context()
    return f"{ctx.trace_id:032x}" if ctx.is_valid else None


def log(event: str, **fields: Any) -> None:
    """One JSON line per event, correlated with the active trace."""
    rec = {"ts": datetime.now(UTC).isoformat(), "event": event, "trace_id": current_trace_id(), **fields}
    logging.getLogger("drc").info(json.dumps(rec, default=str))
