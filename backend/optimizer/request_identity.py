"""Request-local data selection for the public planner and static demo."""
from contextvars import ContextVar
import os

current_user = ContextVar("buddy_user", default=None)
request_mode = ContextVar("buddy_mode", default=None)

def mongo_user_id():
    from bson import ObjectId
    value = current_user.get()
    return ObjectId(value) if value and ObjectId.is_valid(value) else value

def register_identity(app):
    @app.middleware("http")
    async def identity(request, call_next):
        mode = "live" if request.headers.get("x-buddy-mode") == "live" else "demo"
        token = current_user.set(os.environ.get("BUDDY_MONGODB_USER_ID", "demo-carlos") if mode == "live" else None)
        mode_token = request_mode.set(mode)
        try:
            return await call_next(request)
        finally:
            current_user.reset(token)
            request_mode.reset(mode_token)
