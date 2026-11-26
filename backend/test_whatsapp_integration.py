"""Unit and integration tests covering all 10 WhatsApp notification checklist scenarios."""

from datetime import datetime, timedelta
import hashlib
import hmac
import io
import json
import logging
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

from bson import ObjectId
import pytz

# Prevent live MongoDB network attempts or daemon startup during unit tests
os.environ["MONGO_URI"] = ""
os.environ["WHATSAPP_SCHEDULER_ENABLED"] = "false"
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-only")

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import app as backend_app  # noqa: E402
from services.reminder_scheduler import (  # noqa: E402
    IST,
    process_due_reminders,
    recover_stuck_processing_reminders,
)
from services.whatsapp_service import WhatsAppService, normalize_phone_number  # noqa: E402


class FakeInsertResult:
    def __init__(self, inserted_id):
        self.inserted_id = inserted_id


class FakeUpdateResult:
    def __init__(self, matched_count, modified_count):
        self.matched_count = matched_count
        self.modified_count = modified_count


class FakeDeleteResult:
    def __init__(self, deleted_count):
        self.deleted_count = deleted_count


class FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, key_or_list, direction=None):
        if isinstance(key_or_list, list) and key_or_list:
            field, order = key_or_list[0]
        else:
            field, order = key_or_list, direction or 1

        def sort_key(doc):
            val = doc.get(field)
            return (val is None, str(val) if val is not None else "")

        self._docs.sort(key=sort_key, reverse=(order == -1))
        return self

    def skip(self, n):
        self._docs = self._docs[n:]
        return self

    def limit(self, n):
        self._docs = self._docs[:n]
        return self

    def __iter__(self):
        return iter(self._docs)


def _match_value(doc_val, cond):
    if isinstance(cond, dict):
        for op, expected in cond.items():
            if op == "$in":
                if doc_val not in expected:
                    return False
            elif op == "$ne":
                if doc_val == expected:
                    return False
            elif op == "$gte":
                if doc_val is None or doc_val < expected:
                    return False
            elif op == "$lte":
                if doc_val is None or doc_val > expected:
                    return False
            elif op == "$lt":
                if doc_val is None or doc_val >= expected:
                    return False
            elif op == "$regex":
                import re

                flags = re.IGNORECASE if cond.get("$options") == "i" else 0
                if not re.search(expected, str(doc_val or ""), flags):
                    return False
            elif op == "$options":
                continue
        return True
    return doc_val == cond


def _matches_query(doc, query):
    if not query:
        return True
    for key, cond in query.items():
        if key == "$or":
            if not any(_matches_query(doc, sub) for sub in cond):
                return False
        else:
            if not _match_value(doc.get(key), cond):
                return False
    return True


class FakeCollection:
    def __init__(self):
        self.docs = []

    def insert_one(self, doc):
        copy_doc = dict(doc)
        if "_id" not in copy_doc:
            copy_doc["_id"] = ObjectId()
        self.docs.append(copy_doc)
        return FakeInsertResult(copy_doc["_id"])

    def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if _matches_query(doc, query or {}):
                return dict(doc)
        return None

    def find(self, query=None, projection=None):
        matched = [dict(d) for d in self.docs if _matches_query(d, query or {})]
        return FakeCursor(matched)

    def count_documents(self, query=None):
        return sum(1 for d in self.docs if _matches_query(d, query or {}))

    def update_one(self, query, update):
        for doc in self.docs:
            if _matches_query(doc, query):
                if "$set" in update:
                    doc.update(update["$set"])
                return FakeUpdateResult(1, 1)
        return FakeUpdateResult(0, 0)

    def update_many(self, query, update):
        matched = 0
        for doc in self.docs:
            if _matches_query(doc, query):
                matched += 1
                if "$set" in update:
                    doc.update(update["$set"])
        return FakeUpdateResult(matched, matched)

    def find_one_and_update(self, query, update):
        for doc in self.docs:
            if _matches_query(doc, query):
                before = dict(doc)
                if "$set" in update:
                    doc.update(update["$set"])
                return before
        return None

    def delete_one(self, query):
        for idx, doc in enumerate(self.docs):
            if _matches_query(doc, query):
                del self.docs[idx]
                return FakeDeleteResult(1)
        return FakeDeleteResult(0)

    def delete_many(self, query):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not _matches_query(d, query)]
        return FakeDeleteResult(before - len(self.docs))

    def find_one_and_delete(self, query):
        for idx, doc in enumerate(self.docs):
            if _matches_query(doc, query):
                return dict(self.docs.pop(idx))
        return None


class FakeDB:
    def __init__(self):
        self.collections = {
            "patients": FakeCollection(),
            "appointments": FakeCollection(),
            "admins": FakeCollection(),
            "whatsapp_notifications": FakeCollection(),
            "appointment_reminders": FakeCollection(),
            "clinic_announcements": FakeCollection(),
        }

    def __getitem__(self, name):
        if name not in self.collections:
            self.collections[name] = FakeCollection()
        return self.collections[name]


class WhatsAppIntegrationTestCase(unittest.TestCase):
    def setUp(self):
        self.fake_db = FakeDB()
        self.orig_db = backend_app.db
        self.orig_patients = backend_app.patients_collection
        self.orig_admins = backend_app.admins_collection
        self.orig_check_db = backend_app.check_db_connection
        self.orig_service = backend_app.whatsapp_service

        backend_app.db = self.fake_db
        backend_app.patients_collection = self.fake_db["patients"]
        backend_app.admins_collection = self.fake_db["admins"]
        backend_app.check_db_connection = lambda: True

        self.test_service = WhatsAppService(db_getter=lambda: self.fake_db)
        backend_app.whatsapp_service = self.test_service

        self.client = backend_app.app.test_client()
        self.token = backend_app.generate_token(ObjectId(), "receptionist")
        self.auth_headers = {"Authorization": f"Bearer {self.token}"}

        self.env_patcher = patch.dict(
            os.environ,
            {
                "WHATSAPP_ACCESS_TOKEN": "test_secret_meta_token_12345",
                "WHATSAPP_PHONE_NUMBER_ID": "1492317537289190",
                "WHATSAPP_BUSINESS_ACCOUNT_ID": "2187192222184438",
                "WHATSAPP_ADMIN_PHONE": "+91 88483 17301",
                "WHATSAPP_API_VERSION": "v23.0",
                "WHATSAPP_ENABLED": "true",
                "WHATSAPP_TEMPLATE_LANGUAGE": "en",
                "WHATSAPP_PATIENT_TEMPLATE": "new_patient_notification",
                "WHATSAPP_APPOINTMENT_TEMPLATE": "new_appointment_notification",
                "WHATSAPP_ANNOUNCEMENT_TEMPLATE": "clinic_announcement",
                "WHATSAPP_REMINDER_TEMPLATE": "appointment_reminder_5hrs",
                "WHATSAPP_CANCELLATION_TEMPLATE": "appointment_cancellation",
                "WHATSAPP_DEFAULT_DOCTOR_NAME": "Dr. Kuzhivelil",
                "WHATSAPP_WEBHOOK_VERIFY_TOKEN": "verify_secret_123",
                "WHATSAPP_APP_SECRET": "app_secret_abc",
            },
        )
        self.env_patcher.start()

    def tearDown(self):
        self.env_patcher.stop()
        backend_app.db = self.orig_db
        backend_app.patients_collection = self.orig_patients
        backend_app.admins_collection = self.orig_admins
        backend_app.check_db_connection = self.orig_check_db
        backend_app.whatsapp_service = self.orig_service

    def _mock_meta_success(self, msg_id="wamid.HBgMOTE4ODQ4MzE3MzAx"):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "messaging_product": "whatsapp",
            "contacts": [{"input": "918848317301", "wa_id": "918848317301"}],
            "messages": [{"id": msg_id}],
        }
        return resp

    def test_phone_normalization(self):
        self.assertEqual(normalize_phone_number("+91 88483 17301"), ("918848317301", None))
        self.assertEqual(normalize_phone_number("9876543210"), ("919876543210", None))
        self.assertEqual(normalize_phone_number("09876543210"), ("919876543210", None))
        phone, err = normalize_phone_number("12345")
        self.assertIsNone(phone)
        self.assertIsNotNone(err)

    @patch("services.whatsapp_service.requests.post")
    def test_01_new_patient_registration_notifies_patient_phone(self, mock_post):
        mock_post.return_value = self._mock_meta_success("wamid.patient.1")

        res = self.client.post(
            "/api/patients",
            headers=self.auth_headers,
            json={
                "regno": "KDC-101",
                "name": "Ananya Nair",
                "phone": "9876543210",
                "age": 29,
                "address": "Kochi",
            },
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(self.fake_db["patients"].count_documents({"regno": "KDC-101"}), 1)

        mock_post.assert_called_once()
        payload = mock_post.call_args.kwargs["json"]
        # New patient notification goes to the registered patient's phone number
        self.assertEqual(payload["to"], "919876543210")
        self.assertEqual(payload["template"]["name"], "new_patient_notification")
        params = [p["text"] for p in payload["template"]["components"][0]["parameters"]]
        self.assertEqual(params, ["Ananya Nair", "KDC-101", "9876543210"])

    @patch("services.whatsapp_service.requests.post")
    def test_02_new_appointment_booking_notifies_patient_and_schedules_reminder(self, mock_post):
        self.fake_db["patients"].insert_one(
            {
                "regno": "KDC-202",
                "name": "Rahul Menon",
                "phone": "9123456789",
                "age": 34,
                "whatsapp_opt_in": True,
                "created_at": datetime.now(),
            }
        )
        mock_post.return_value = self._mock_meta_success("wamid.appt.1")

        res = self.client.post(
            "/api/appointments",
            headers=self.auth_headers,
            json={
                "regno": "KDC-202",
                "date": "2099-12-10",
                "time": "14:30",
                "doctor_name": "Dr. George",
            },
        )
        self.assertEqual(res.status_code, 200)

        mock_post.assert_called_once()
        payload = mock_post.call_args.kwargs["json"]
        # Appointment notification goes to the booked patient's phone
        self.assertEqual(payload["to"], "919123456789")
        self.assertEqual(payload["template"]["name"], "new_appointment_notification")
        params = [p["text"] for p in payload["template"]["components"][0]["parameters"]]
        self.assertEqual(
            params,
            ["Rahul Menon", "KDC-202", "10 Dec 2099", "02:30 PM", "9123456789"],
        )

        # Reminder persisted in MongoDB for 5 hours prior in Asia/Kolkata
        reminder = self.fake_db["appointment_reminders"].find_one({"regno": "KDC-202"})
        self.assertIsNotNone(reminder)
        self.assertEqual(reminder["status"], "pending")
        self.assertEqual(reminder["doctor_name"], "Dr. George")
        self.assertEqual(
            reminder["appointment_at"] - reminder["remind_at"],
            timedelta(hours=5),
        )

    @patch("services.whatsapp_service.requests.post")
    def test_03_five_hours_before_appointment_sends_reminder_to_patient(self, mock_post):
        self.fake_db["patients"].insert_one(
            {
                "regno": "KDC-303",
                "name": "Meera Das",
                "phone": "9988776655",
                "age": 25,
                "whatsapp_opt_in": True,
            }
        )
        mock_post.return_value = self._mock_meta_success("wamid.rem.1")

        res = self.client.post(
            "/api/appointments",
            headers=self.auth_headers,
            json={"regno": "KDC-303", "date": "2099-12-15", "time": "15:00"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(mock_post.call_count, 1)  # admin booking notification

        # Before 5-hour mark (6 hours before in IST): should NOT send reminder
        appt_ist = IST.localize(datetime(2099, 12, 15, 15, 0))
        six_hrs_before_utc = (appt_ist - timedelta(hours=6)).astimezone(pytz.UTC).replace(tzinfo=None)
        summary_early = process_due_reminders(
            lambda: self.fake_db, self.test_service, now_utc=six_hrs_before_utc
        )
        self.assertEqual(summary_early["sent"], 0)
        self.assertEqual(mock_post.call_count, 1)

        # Exactly 5 hours before in IST: MUST send reminder to PATIENT phone
        five_hrs_before_utc = (appt_ist - timedelta(hours=5)).astimezone(pytz.UTC).replace(tzinfo=None)
        summary_due = process_due_reminders(
            lambda: self.fake_db, self.test_service, now_utc=five_hrs_before_utc
        )
        self.assertEqual(summary_due["sent"], 1)
        self.assertEqual(mock_post.call_count, 2)

        rem_payload = mock_post.call_args.kwargs["json"]
        self.assertEqual(rem_payload["to"], "919988776655")
        self.assertEqual(rem_payload["template"]["name"], "appointment_reminder_5hrs")
        rem_params = [p["text"] for p in rem_payload["template"]["components"][0]["parameters"]]
        self.assertEqual(rem_params, ["Meera Das", "15 Dec 2099", "03:00 PM", "Dr. Kuzhivelil"])

        # Re-running scheduler at 4 hours before must NOT send duplicate reminder
        four_hrs_before_utc = (appt_ist - timedelta(hours=4)).astimezone(pytz.UTC).replace(tzinfo=None)
        summary_again = process_due_reminders(
            lambda: self.fake_db, self.test_service, now_utc=four_hrs_before_utc
        )
        self.assertEqual(summary_again["sent"], 0)
        self.assertEqual(mock_post.call_count, 2)

    @patch("services.whatsapp_service.requests.post")
    def test_04_and_05_cancel_appointment_notifies_patient_and_cancels_reminder(self, mock_post):
        self.fake_db["patients"].insert_one(
            {
                "regno": "KDC-404",
                "name": "Sita Roy",
                "phone": "9000011111",
                "age": 31,
                "whatsapp_opt_in": True,
            }
        )
        mock_post.return_value = self._mock_meta_success("wamid.cancel.1")

        book_res = self.client.post(
            "/api/appointments",
            headers=self.auth_headers,
            json={"regno": "KDC-404", "date": "2099-12-16", "time": "11:00"},
        )
        self.assertEqual(book_res.status_code, 200)
        appt = self.fake_db["appointments"].find_one({"regno": "KDC-404"})
        appt_id = str(appt["_id"])

        # Cancel appointment -> sends appointment_cancelled to PATIENT and cancels reminder
        del_res = self.client.delete(f"/api/appointments/{appt_id}", headers=self.auth_headers)
        self.assertEqual(del_res.status_code, 200)
        self.assertEqual(mock_post.call_count, 2)

        cancel_payload = mock_post.call_args.kwargs["json"]
        self.assertEqual(cancel_payload["to"], "919000011111")
        self.assertEqual(cancel_payload["template"]["name"], "appointment_cancellation")
        cancel_params = [p["text"] for p in cancel_payload["template"]["components"][0]["parameters"]]
        self.assertEqual(cancel_params, ["Sita Roy", "16 Dec 2099", "11:00 AM"])

        # Reminder status must be cancelled; running scheduler at 5h mark sends nothing
        reminder = self.fake_db["appointment_reminders"].find_one({"appointment_id": appt_id})
        self.assertEqual(reminder["status"], "cancelled")

        appt_ist = IST.localize(datetime(2099, 12, 16, 11, 0))
        due_utc = (appt_ist - timedelta(hours=5)).astimezone(pytz.UTC).replace(tzinfo=None)
        summary = process_due_reminders(lambda: self.fake_db, self.test_service, now_utc=due_utc)
        self.assertEqual(summary["sent"], 0)
        self.assertEqual(mock_post.call_count, 2)

    @patch("services.whatsapp_service.requests.post")
    def test_06_reschedule_appointment_updates_reminder_time(self, mock_post):
        self.fake_db["patients"].insert_one(
            {
                "regno": "KDC-505",
                "name": "Arun P",
                "phone": "9888877777",
                "age": 42,
                "whatsapp_opt_in": True,
            }
        )
        mock_post.return_value = self._mock_meta_success("wamid.resched.1")

        self.client.post(
            "/api/appointments",
            headers=self.auth_headers,
            json={"regno": "KDC-505", "date": "2099-12-20", "time": "10:00"},
        )
        appt = self.fake_db["appointments"].find_one({"regno": "KDC-505"})
        appt_id = str(appt["_id"])

        put_res = self.client.put(
            f"/api/appointments/{appt_id}",
            headers=self.auth_headers,
            json={"date": "2099-12-21", "time": "16:30"},
        )
        self.assertEqual(put_res.status_code, 200)
        # Updating does NOT spam admin booking notification
        self.assertEqual(mock_post.call_count, 1)

        # Old 5-hour time must NOT fire
        old_due = (IST.localize(datetime(2099, 12, 20, 10, 0)) - timedelta(hours=5)).astimezone(pytz.UTC).replace(tzinfo=None)
        s_old = process_due_reminders(lambda: self.fake_db, self.test_service, now_utc=old_due)
        self.assertEqual(s_old["sent"], 0)

        # New 5-hour time MUST fire with updated date/time
        new_due = (IST.localize(datetime(2099, 12, 21, 16, 30)) - timedelta(hours=5)).astimezone(pytz.UTC).replace(tzinfo=None)
        s_new = process_due_reminders(lambda: self.fake_db, self.test_service, now_utc=new_due)
        self.assertEqual(s_new["sent"], 1)
        rem_params = [p["text"] for p in mock_post.call_args.kwargs["json"]["template"]["components"][0]["parameters"]]
        self.assertEqual(rem_params[:3], ["Arun P", "21 Dec 2099", "04:30 PM"])

    @patch("services.whatsapp_service.requests.post")
    def test_07_clinic_announcement_sends_only_to_selected_opted_in_patients(self, mock_post):
        self.fake_db["patients"].insert_one(
            {"regno": "KDC-701", "name": "Opted In 1", "phone": "9111111111", "whatsapp_opt_in": True}
        )
        self.fake_db["patients"].insert_one(
            {"regno": "KDC-702", "name": "Opted Out", "phone": "9222222222", "whatsapp_opt_in": False}
        )
        self.fake_db["patients"].insert_one(
            {"regno": "KDC-703", "name": "Opted In 2", "phone": "9333333333", "whatsapp_opt_in": True}
        )
        mock_post.return_value = self._mock_meta_success("wamid.ann.1")

        ann_payload = {
            "title": "Holiday Notice",
            "closure_date": "2026-12-25",
            "reason": "Christmas Holiday",
            "reopening_date": "2026-12-26",
            "target_mode": "selected",
            "regnos": ["KDC-701", "KDC-702"],  # KDC-702 opted out, must be excluded!
            "request_id": "req-ann-1",
        }
        res1 = self.client.post("/api/announcements", headers=self.auth_headers, json=ann_payload)
        self.assertEqual(res1.status_code, 201)
        data1 = res1.get_json()
        self.assertEqual(data1["broadcast"]["sent_count"], 1)
        mock_post.assert_called_once()

        sent_json = mock_post.call_args.kwargs["json"]
        self.assertEqual(sent_json["to"], "919111111111")
        self.assertEqual(sent_json["template"]["name"], "clinic_announcement")
        self.assertEqual(
            [p["text"] for p in sent_json["template"]["components"][0]["parameters"]],
            ["25 Dec 2026", "Christmas Holiday", "26 Dec 2026"],
        )

        # Duplicate broadcast prevention
        res2 = self.client.post("/api/announcements", headers=self.auth_headers, json=ann_payload)
        self.assertEqual(res2.status_code, 409)
        self.assertEqual(mock_post.call_count, 1)

    @patch("services.whatsapp_service.requests.post")
    def test_08_duplicate_events_prevent_duplicate_notifications(self, mock_post):
        mock_post.return_value = self._mock_meta_success("wamid.dup.1")

        p1 = self.client.post(
            "/api/patients",
            headers=self.auth_headers,
            json={"regno": "KDC-808", "name": "Arjun K", "phone": "9898989898", "age": 22},
        )
        p2 = self.client.post(
            "/api/patients",
            headers=self.auth_headers,
            json={"regno": "KDC-808", "name": "Arjun K", "phone": "9898989898", "age": 22},
        )
        self.assertEqual(p1.status_code, 201)
        self.assertEqual(p2.status_code, 400)
        self.assertEqual(mock_post.call_count, 1)

        # Duplicate event assertions continue below
        self.assertEqual(
            self.fake_db["whatsapp_notifications"].find_one({"regno": "KDC-808"})["recipient_phone"],
            "919898989898",
        )

        a1 = self.client.post(
            "/api/appointments",
            headers=self.auth_headers,
            json={"regno": "KDC-808", "date": "2099-12-20", "time": "16:00"},
        )
        a2 = self.client.post(
            "/api/appointments",
            headers=self.auth_headers,
            json={"regno": "KDC-808", "date": "2099-12-20", "time": "16:00"},
        )
        self.assertEqual(a1.status_code, 200)
        self.assertEqual(a2.status_code, 409)
        self.assertEqual(mock_post.call_count, 2)

        # Service-level duplicate suppression
        dup_cancel = self.test_service.send_appointment_cancelled_notification(
            patient_name="Arjun K",
            regno="KDC-808",
            patient_phone="9898989898",
            appointment_date="20 Dec 2099",
            appointment_time="04:00 PM",
            appointment_id="appt-xyz",
        )
        self.assertTrue(dup_cancel["success"])
        dup_cancel2 = self.test_service.send_appointment_cancelled_notification(
            patient_name="Arjun K",
            regno="KDC-808",
            patient_phone="9898989898",
            appointment_date="20 Dec 2099",
            appointment_time="04:00 PM",
            appointment_id="appt-xyz",
        )
        self.assertEqual(dup_cancel2["status"], "duplicate_suppressed")
        self.assertEqual(mock_post.call_count, 3)

    @patch("services.whatsapp_service.requests.post")
    def test_09_api_failure_recorded_and_temporary_reminder_retried_safely(self, mock_post):
        self.fake_db["patients"].insert_one(
            {"regno": "KDC-909", "name": "Retry User", "phone": "9777766666", "whatsapp_opt_in": True}
        )
        # First: booking succeeds even if admin notification fails with 500
        err_resp = MagicMock()
        err_resp.status_code = 500
        err_resp.json.return_value = {"error": {"message": "Meta temporary error", "code": 2}}
        mock_post.return_value = err_resp

        res_a = self.client.post(
            "/api/appointments",
            headers=self.auth_headers,
            json={"regno": "KDC-909", "date": "2099-12-22", "time": "14:00"},
        )
        self.assertEqual(res_a.status_code, 200)

        # Reminder attempt fails temporarily with Timeout -> scheduled for retry
        mock_post.side_effect = __import__("requests").exceptions.Timeout("timed out")
        appt_ist = IST.localize(datetime(2099, 12, 22, 14, 0))
        t_due = (appt_ist - timedelta(hours=5)).astimezone(pytz.UTC).replace(tzinfo=None)
        s1 = process_due_reminders(lambda: self.fake_db, self.test_service, now_utc=t_due)
        self.assertEqual(s1["failed"], 1)
        rem = self.fake_db["appointment_reminders"].find_one({"regno": "KDC-909"})
        self.assertEqual(rem["status"], "failed")
        self.assertEqual(rem["attempts"], 1)
        self.assertIsNotNone(rem["next_retry_at"])

        # Retry after backoff succeeds
        mock_post.side_effect = None
        mock_post.return_value = self._mock_meta_success("wamid.retry.ok")
        t_retry = rem["next_retry_at"] + timedelta(seconds=1)
        s2 = process_due_reminders(lambda: self.fake_db, self.test_service, now_utc=t_retry)
        self.assertEqual(s2["sent"], 1)
        rem_after = self.fake_db["appointment_reminders"].find_one({"regno": "KDC-909"})
        self.assertEqual(rem_after["status"], "sent")

    @patch("services.whatsapp_service.requests.post")
    def test_10_restart_recovery_and_webhook_status_tracking(self, mock_post):
        self.fake_db["patients"].insert_one(
            {"regno": "KDC-1010", "name": "Restart Patient", "phone": "9666655555", "whatsapp_opt_in": True}
        )
        mock_post.return_value = self._mock_meta_success("wamid.webhook.1")

        # Simulate reminder stuck in 'processing' from server restart > 5 mins ago
        appt_ist = IST.localize(datetime(2099, 12, 25, 12, 0))
        appt_utc = appt_ist.astimezone(pytz.UTC).replace(tzinfo=None)
        remind_utc = appt_utc - timedelta(hours=5)
        appt_id = self.fake_db["appointments"].insert_one(
            {"regno": "KDC-1010", "date": "2099-12-25", "time": "12:00", "datetime": appt_utc}
        ).inserted_id
        self.fake_db["appointment_reminders"].insert_one(
            {
                "appointment_id": str(appt_id),
                "regno": "KDC-1010",
                "patient_name": "Restart Patient",
                "patient_phone": "9666655555",
                "appointment_date": "2099-12-25",
                "appointment_time": "12:00",
                "doctor_name": "Dr. Kuzhivelil",
                "appointment_at": appt_utc,
                "remind_at": remind_utc,
                "status": "processing",
                "attempts": 0,
                "max_attempts": 3,
                "updated_at": remind_utc - timedelta(minutes=10),
            }
        )

        recovered = recover_stuck_processing_reminders(self.fake_db, now_utc=remind_utc)
        self.assertEqual(recovered, 1)
        summary = process_due_reminders(lambda: self.fake_db, self.test_service, now_utc=remind_utc)
        self.assertEqual(summary["sent"], 1)

        # Verify Meta webhook GET challenge
        wh_get = self.client.get(
            "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify_secret_123&hub.challenge=98765"
        )
        self.assertEqual(wh_get.status_code, 200)
        self.assertEqual(wh_get.data.decode("utf-8"), "98765")

        # Verify Meta webhook POST updates delivery_status -> delivered
        webhook_body = json.dumps(
            {
                "entry": [
                    {
                        "changes": [
                            {
                                "value": {
                                    "statuses": [
                                        {"id": "wamid.webhook.1", "status": "delivered"}
                                    ]
                                }
                            }
                        ]
                    }
                ]
            }
        ).encode("utf-8")
        sig = "sha256=" + hmac.new(b"app_secret_abc", webhook_body, hashlib.sha256).hexdigest()
        wh_post = self.client.post(
            "/api/webhooks/whatsapp",
            data=webhook_body,
            content_type="application/json",
            headers={"X-Hub-Signature-256": sig},
        )
        self.assertEqual(wh_post.status_code, 200)
        self.assertEqual(wh_post.get_json()["updated"], 1)

        notif = self.fake_db["whatsapp_notifications"].find_one({"message_id": "wamid.webhook.1"})
        self.assertEqual(notif["delivery_status"], "delivered")
        self.assertEqual(notif["status"], "delivered")

    @patch("services.whatsapp_service.requests.post")
    def test_security_token_not_logged_and_missing_credentials_safe(self, mock_post):
        mock_post.return_value = self._mock_meta_success()
        log_stream = io.StringIO()
        service_logger = logging.getLogger("services.whatsapp_service")
        mem_handler = logging.StreamHandler(log_stream)
        service_logger.addHandler(mem_handler)
        try:
            self.test_service.send_new_patient_notification(
                patient_name="Secret Check",
                regno="KDC-SEC",
                phone_number="9876543210",
            )
        finally:
            service_logger.removeHandler(mem_handler)

        self.assertNotIn("test_secret_meta_token_12345", log_stream.getvalue())

        with patch.dict(os.environ, {"WHATSAPP_ACCESS_TOKEN": "", "WHATSAPP_ADMIN_PHONE": ""}):
            res = self.client.post(
                "/api/patients",
                headers=self.auth_headers,
                json={"regno": "KDC-SAFE", "name": "Safe User", "phone": "9876543210", "age": 20},
            )
            self.assertEqual(res.status_code, 201)

    @patch("services.whatsapp_service.requests.post")
    def test_csv_patient_schema_with_int_phone_appointment_lifecycle(self, mock_post):
        mock_post.return_value = self._mock_meta_success("wamid.csv.1")
        self.fake_db["patients"].insert_one(
            {
                "Reg No": "A/001/25",
                "Name": "SAJU AV",
                "Phone": 919847584950,
                "OP No": 1,
            }
        )

        # Book appointment for CSV-schema patient
        book_res = self.client.post(
            "/api/appointments",
            headers=self.auth_headers,
            json={"regno": "A/001/25", "date": "2099-12-28", "time": "10:30"},
        )
        self.assertEqual(book_res.status_code, 200)
        book_json = book_res.get_json()
        self.assertTrue(book_json["success"])
        appt_id = book_json["appointment_id"]

        # GET appointments (and search) must resolve patient Name & int Phone cleanly
        get_res = self.client.get("/api/appointments?search=SAJU", headers=self.auth_headers)
        self.assertEqual(get_res.status_code, 200)
        appts = get_res.get_json()["data"]
        self.assertEqual(len(appts), 1)
        self.assertEqual(appts[0]["patient_name"], "SAJU AV")
        self.assertEqual(appts[0]["patient_phone"], "919847584950")

        # Reminder scheduled cleanly with stringified phone
        rem = self.fake_db["appointment_reminders"].find_one({"appointment_id": appt_id})
        self.assertEqual(rem["status"], "pending")
        self.assertEqual(rem["patient_phone"], "919847584950")

        # Cancel appointment notifies patient's int phone cleanly
        del_res = self.client.delete(f"/api/appointments/{appt_id}", headers=self.auth_headers)
        self.assertEqual(del_res.status_code, 200)
        self.assertEqual(mock_post.call_count, 2)
        self.assertEqual(mock_post.call_args.kwargs["json"]["to"], "919847584950")

    def test_dashboard_stats_returns_7_day_activity_and_next_appointments(self):
        self.fake_db["patients"].insert_one(
            {
                "regno": "KDC-STAT",
                "name": "Stats Patient",
                "phone": "9876543210",
                "age": 28,
                "created_at": datetime.now(),
            }
        )
        self.fake_db["appointments"].insert_one(
            {
                "regno": "KDC-STAT",
                "date": "2099-12-30",
                "time": "11:30",
                "datetime": datetime(2099, 12, 30, 11, 30),
                "doctor_name": "Dr. Kuzhivelil",
                "created_at": datetime.now(),
            }
        )

        res = self.client.get("/api/dashboard/stats", headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(len(data["last_7_days"]), 7)
        self.assertEqual(data["upcoming_appointments_count"], 1)
        self.assertEqual(len(data["next_appointments"]), 1)
        self.assertEqual(data["next_appointments"][0]["patient_name"], "Stats Patient")


if __name__ == "__main__":
    unittest.main(verbosity=2)
