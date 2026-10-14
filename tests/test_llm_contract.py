"""Contract test for the LIVE adapter: real Anthropic SDK, recorded-shape HTTP responses, zero spend.

The SDK serialises the request and parses the response exactly as in production; only the socket is replaced.
This proves the wire shape (structured output, refusal, overload -> fallback), not model quality.
"""

import json

import anthropic
import httpx2 as httpx  # the SDK ships its own httpx fork and rejects plain httpx clients
import pytest
from pydantic import BaseModel

from drc import llm


class Out(BaseModel):
    cause: str
    confidence: float


def _message(model: str, text: str = "", stop_reason: str = "end_turn") -> dict:
    return {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [{"type": "text", "text": text}] if text else [],
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 1200, "output_tokens": 300, "cache_read_input_tokens": 0},
    }


def _llm(monkeypatch, responses: dict[str, httpx.Response], fallback: str | None = None):
    """AnthropicLLM whose HTTP calls are answered per requested model; returns (llm, captured request bodies)."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-not-a-key")
    if fallback:
        monkeypatch.setenv("DRC_LLM_FALLBACK_MODEL", fallback)
    else:
        monkeypatch.delenv("DRC_LLM_FALLBACK_MODEL", raising=False)
    sent: list[dict] = []

    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        sent.append(body)
        return responses[body["model"]]

    adapter = llm.AnthropicLLM("claude-opus-5-5")
    adapter.client = anthropic.Anthropic(
        http_client=httpx.Client(transport=httpx.MockTransport(handler)), max_retries=0
    )
    return adapter, sent


def _ok(model: str) -> httpx.Response:
    text = json.dumps({"cause": "duplicate_load", "confidence": 0.9})
    return httpx.Response(200, json=_message(model, text), headers={"request-id": "req_123"})


def test_structured_output_request_and_parse(monkeypatch):
    adapter, sent = _llm(monkeypatch, {"claude-opus-5-5": _ok("claude-opus-5-5")})
    res = adapter.complete("investigate", "sys", "user", Out, {})

    assert res.parsed == Out(cause="duplicate_load", confidence=0.9)
    body = sent[0]
    fmt = body["output_config"]["format"]
    assert fmt["type"] == "json_schema"
    assert fmt["schema"]["additionalProperties"] is False
    assert fmt["schema"]["required"] == ["cause", "confidence"]
    assert body["system"] == "sys" and body["messages"] == [{"role": "user", "content": "user"}]
    assert res.usage["request_id"] == "req_123"
    assert res.usage["cost_status"] == "estimated"
    assert res.usage["cost_usd"] == pytest.approx((1200 * 4.00 + 300 * 20.00) / 1e6)


@pytest.mark.parametrize(
    "primary, reason",
    [
        (httpx.Response(200, json=_message("claude-opus-5-5", stop_reason="refusal")), "RefusalError"),
        (
            httpx.Response(529, json={"type": "error", "error": {"type": "overloaded_error"}}),
            "OverloadedError",
        ),
    ],
)
def test_refusal_or_overload_falls_back_and_is_recorded(monkeypatch, primary, reason):
    adapter, sent = _llm(
        monkeypatch,
        {"claude-opus-5-5": primary, "claude-sonnet-5-5": _ok("claude-sonnet-5-5")},
        fallback="claude-sonnet-5-5",
    )
    res = adapter.complete("investigate", "sys", "user", Out, {})

    assert [b["model"] for b in sent] == ["claude-opus-5-5", "claude-sonnet-5-5"]
    assert res.model == "claude-sonnet-5-5"
    assert res.usage["fallback_from"] == "claude-opus-5-5"
    assert res.usage["fallback_reason"] == reason


def test_without_fallback_errors_surface(monkeypatch):
    refusal = httpx.Response(200, json=_message("claude-opus-5-5", stop_reason="refusal"))
    adapter, sent = _llm(monkeypatch, {"claude-opus-5-5": refusal})
    with pytest.raises(llm.RefusalError):
        adapter.complete("investigate", "sys", "user", Out, {})
    assert len(sent) == 1


def test_truncated_output_is_an_error_not_a_partial_parse(monkeypatch):
    truncated = httpx.Response(
        200, json=_message("claude-opus-5-5", '{"cause": "dup', stop_reason="max_tokens")
    )
    adapter, _ = _llm(monkeypatch, {"claude-opus-5-5": truncated})
    with pytest.raises(ValueError, match="max_tokens"):
        adapter.complete("investigate", "sys", "user", Out, {})
