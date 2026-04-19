"""
Routes a delegation request: checks that the calling agent
is allowed to call the target agent (via can_call list).
"""


def can_delegate(caller_config: dict, target_id: str) -> bool:
    allowed = caller_config.get("can_call", [])
    return target_id in allowed
