"""LLM provider adapter (ADR-0006).

- `fake`: deterministic rule policy over the same structured context. For tests/demo without credentials.
  Every run it touches is labelled mode=fake; its numbers say nothing about model quality.
- `anthropic`: Claude via the official SDK, JSON-schema structured output validated with pydantic.
Fallback to a second model is OFF unless DRC_LLM_FALLBACK_MODEL is set; when used it is recorded per call.
"""

import json
import os
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from pydantic import BaseModel

from drc import obs

PROMPT_VERSION = "inv-v0.1"

# USD per 1M tokens (input, output, cache_read). Source: Claude API skill model table, cached 2026-10-06
# (list prices; billing may differ). Unknown model -> cost_status "unknown", cost None — never 0.
PRICES = {
    "claude-opus-5-5": (4.00, 20.00, 0.20),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, None),
}


@dataclass
class LLMResult:
    parsed: BaseModel
    provider: str
    model: str | None
    usage: dict[str, Any] = field(default_factory=dict)


class LLM(Protocol):
    provider: str
    model: str | None

    def complete(
        self, task: str, system: str, user: str, schema: type[BaseModel], context: dict
    ) -> LLMResult: ...


def strict_schema(model: type[BaseModel]) -> dict:
    """Pydantic JSON schema -> structured-output schema: refs inlined, closed objects, all props required."""
    raw = model.model_json_schema()
    defs = raw.pop("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                return walk(defs[node["$ref"].split("/")[-1]])
            node = {k: walk(v) for k, v in node.items() if k not in ("default", "title")}
            if node.get("type") == "object" and "properties" in node:
                node["additionalProperties"] = False
                node["required"] = list(node["properties"])
            return node
        if isinstance(node, list):
            return [walk(x) for x in node]
        return node

    return walk(raw)


def cost(model: str | None, usage: dict) -> tuple[float | None, str]:
    p = PRICES.get(model or "")
    if not p or usage.get("input_tokens") is None:
        return None, "unknown"
    cache_read = usage.get("cache_read_input_tokens") or 0
    if cache_read and p[2] is None:
        return None, "unknown"
    usd = (
        usage["input_tokens"] * p[0]
        + usage.get("output_tokens", 0) * p[1]
        + cache_read * (p[2] or 0)
        + (usage.get("cache_creation_input_tokens") or 0) * p[0] * 1.25
    ) / 1e6
    return round(usd, 6), "estimated"  # list price x measured tokens; not a billing figure


class AnthropicLLM:
    provider: str = "anthropic"

    def __init__(self, model: str, effort: str = "medium", timeout_s: float = 90.0):
        import anthropic

        self.model: str | None = model
        self.effort = effort
        self.fallback_model = os.environ.get("DRC_LLM_FALLBACK_MODEL")
        self.client = anthropic.Anthropic(timeout=timeout_s, max_retries=2)

    def complete(
        self, task: str, system: str, user: str, schema: type[BaseModel], context: dict
    ) -> LLMResult:
        import anthropic

        try:
            return self._call(self.model or "claude-opus-5-5", system, user, schema)
        except (anthropic.APIStatusError, anthropic.APIConnectionError, RefusalError) as e:
            if not self.fallback_model:
                raise
            obs.log(
                "llm.fallback", from_model=self.model, to_model=self.fallback_model, reason=type(e).__name__
            )
            res = self._call(self.fallback_model, system, user, schema)
            res.usage["fallback_from"] = self.model
            res.usage["fallback_reason"] = type(e).__name__
            return res

    def _call(self, model: str, system: str, user: str, schema: type[BaseModel]) -> LLMResult:
        from anthropic.types import MessageParam

        t0 = time.monotonic()
        with obs.tracer.start_as_current_span("llm.call", attributes={"llm.model": model}) as span:
            resp = self.client.messages.create(  # type: ignore[call-overload]  # output_config passed as plain dict
                model=model,
                max_tokens=16000,
                system=system,
                messages=[MessageParam(role="user", content=user)],
                output_config={
                    "effort": self.effort,
                    "format": {"type": "json_schema", "schema": strict_schema(schema)},
                },
            )
            if resp.stop_reason == "refusal":
                raise RefusalError(str(getattr(resp, "stop_details", None)))
            if resp.stop_reason == "max_tokens":
                raise ValueError("LLM output truncated (max_tokens)")
            text = next(b.text for b in resp.content if b.type == "text")
            u = resp.usage
            usage = {
                "input_tokens": u.input_tokens,
                "output_tokens": u.output_tokens,
                "cache_read_input_tokens": u.cache_read_input_tokens,
                "cache_creation_input_tokens": u.cache_creation_input_tokens,
                "latency_ms": int((time.monotonic() - t0) * 1000),
                "request_id": resp._request_id,
                "served_model": resp.model,
            }
            usage["cost_usd"], usage["cost_status"] = cost(model, usage)
            span.set_attributes({k: v for k, v in usage.items() if isinstance(v, int | float | str)})
        return LLMResult(schema.model_validate(json.loads(text)), self.provider, model, usage)


class RefusalError(Exception):
    pass


def get_llm(provider: str, model: str | None) -> LLM:
    if provider == "fake":
        from drc.fake_llm import FakeLLM

        return FakeLLM()
    if provider == "anthropic":
        return AnthropicLLM(model or "claude-opus-5-5")
    raise ValueError(f"unknown LLM provider {provider!r}")
