"""Request-local data selection for the public planner and static demo."""
from contextvars import ContextVar
import os

current_user = ContextVar("buddy_user", default=None)
request_mode = ContextVar("buddy_mode", default=None)

# Stopgap until "live" mode has real per-account Mongo user ids (a signed-in
# Google account resolved to its own user document) -- NOT the same value as
# mongo_loader.DEMO_USER_ID ("demo-carlos") on purpose. Every "live" request
# writes real preferences (mongo_state.save_preferences isn't gated the way
# demo-mode writes are), so if this constant ever matched DEMO_USER_ID, any
# visitor who finished the "Get started" onboarding wizard would silently
# overwrite the shared demo baseline (seed_mongo.py's seeded meal windows,
# gym commitment, work hours...) down to whatever their one onboarding
# answer produced -- confirmed live: walking through onboarding as a "live"
# user replaced demo-carlos's 8 seeded preferences with a single
# set_preferred_work_hours entry, which then made every subsequent demo
# session (a fresh visitor who never touched onboarding at all) see none of
# the seeded defaults either, since both modes were reading/writing the
# identical Mongo document. This constant existing at all is still only a
# placeholder -- every "live" request shares ONE bucket until real
# per-account ids exist, so two different live users can still collide with
# EACH OTHER's preferences -- but it can no longer collide with demo mode's.
_LIVE_FALLBACK_USER_ID = "live-fallback-user"

def mongo_user_id():
    from bson import ObjectId
    value = current_user.get()
    return ObjectId(value) if value and ObjectId.is_valid(value) else value

def register_identity(app):
    @app.middleware("http")
    async def identity(request, call_next):
        mode = "live" if request.headers.get("x-buddy-mode") == "live" else "demo"
        token = current_user.set(os.environ.get("BUDDY_MONGODB_USER_ID", _LIVE_FALLBACK_USER_ID) if mode == "live" else None)
        mode_token = request_mode.set(mode)
        try:
            return await call_next(request)
        finally:
            current_user.reset(token)
            request_mode.reset(mode_token)
