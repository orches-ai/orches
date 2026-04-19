"""
Token cost table (USD per 1M tokens).
Sources: official pricing pages as of April 2026.
"""

# (input_per_1m, output_per_1m)
_PRICES: dict[str, tuple[float, float]] = {
    # Anthropic
    "claude-opus-4-7":          (15.00, 75.00),
    "claude-sonnet-4-6":         (3.00, 15.00),
    "claude-haiku-4-5":          (0.80,  4.00),
    "claude-3-5-sonnet-20241022":(3.00, 15.00),
    "claude-3-5-haiku-20241022": (0.80,  4.00),
    "claude-3-opus-20240229":   (15.00, 75.00),
    # OpenAI
    "gpt-4o":                    (2.50, 10.00),
    "gpt-4o-mini":               (0.15,  0.60),
    "gpt-4-turbo":              (10.00, 30.00),
    "o1":                       (15.00, 60.00),
    "o1-mini":                   (3.00, 12.00),
}


def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Return estimated cost in USD. Returns 0.0 for unknown/Ollama models."""
    prices = _PRICES.get(model)
    if not prices:
        return 0.0
    inp_price, out_price = prices
    return (input_tokens * inp_price + output_tokens * out_price) / 1_000_000
