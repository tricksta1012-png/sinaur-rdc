from fastapi import Header, HTTPException
from ..config import settings


async def require_internal_key(x_internal_api_key: str = Header(default="")):
    if settings.internal_api_key and x_internal_api_key != settings.internal_api_key:
        raise HTTPException(status_code=403, detail="Invalid internal API key")
