import asyncio
import hashlib
import hmac
import os
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from bson import ObjectId
from request_identity import current_user, mongo_user_id, register_identity, request_mode
import mongo_loader
import mongo_state

class IdentityTests(unittest.TestCase):
    def test_live_and_demo_are_isolated_without_auth(self):
        app = Mock()
        handlers = []
        app.middleware.side_effect = lambda _: lambda handler: handlers.append(handler)
        register_identity(app)
        async def check():
            async def next_handler(request):
                return current_user.get(), request_mode.get()
            with patch.dict(os.environ, {"BUDDY_MONGODB_USER_ID": "shared-planner"}):
                live = await handlers[0](SimpleNamespace(headers={"x-buddy-mode": "live"}), next_handler)
                demo = await handlers[0](SimpleNamespace(headers={"x-buddy-mode": "demo"}), next_handler)
                self.assertEqual(live, ("shared-planner", "live"))
                self.assertEqual(demo, (None, "demo"))
                self.assertIsNone(current_user.get())
        asyncio.run(check())

    def test_demo_never_reads_or_writes_mongo(self):
        token = request_mode.set("demo")
        try:
            with patch.object(mongo_state, "get_db", side_effect=AssertionError("Demo touched Mongo")):
                self.assertIsNone(mongo_state.load_plan_cache())
                self.assertEqual(mongo_state.load_preferences().list_active(), [])
                mongo_state.save_plan_cache({})
                mongo_state.save_preferences(mongo_state.PreferenceStore())
        finally:
            request_mode.reset(token)

    def test_live_queries_use_account_and_enrollments_without_seed_data(self):
        user = ObjectId()
        course = ObjectId()
        db = Mock()
        db.tasks.find.return_value = []
        db.enrollments.find.return_value = [{"course_id": course}]
        db.courses.find.return_value = [{"_id": course, "name": "My class", "meeting_times": []}]
        with patch.object(mongo_loader, "get_db", return_value=db):
            data = mongo_loader.load_data(user)
        db.tasks.find.assert_called_once_with({"user_id": user})
        db.courses.find.assert_called_once_with({"_id": {"$in": [course]}})
        self.assertEqual(data.tasks, [])
        self.assertEqual(list(data.courses), [str(course)])

    def test_live_cache_is_scoped_and_context_is_reset(self):
        user = ObjectId()
        db = Mock()
        db.plan_cache.find_one.return_value = None
        token = current_user.set(str(user))
        try:
            with patch.object(mongo_state, "get_db", return_value=db):
                mongo_state.load_plan_cache()
            db.plan_cache.find_one.assert_called_once_with({"user_id": user})
        finally:
            current_user.reset(token)
        self.assertIsNone(mongo_user_id())

if __name__ == "__main__":
    unittest.main()
