"""Unit and integration tests for Meta WhatsApp Cloud API notifications."""

from datetime import datetime
import io
import logging
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

from bson import ObjectId

# Prevent live MongoDB network connection attempts during unit tests
os.environ["MONGO_URI"] = ""
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-only")

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import app as backend_app  # noqa: E402
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
                "WHATSAPP_API_VERSION": "v23.0",
                "WHATSAPP_RECIPIENT_NUMBER": "+91 88483 17301",
                "WHATSAPP_ENABLED": "true",
                "WHATSAPP_TEMPLATE_NEW_PATIENT": "new_patient_notification",
                "WHATSAPP_TEMPLATE_NEW_APPOINTMENT": "new_appointment_notification",
                "WHATSAPP_TEMPLATE_LANGUAGE": "en",
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
        phone2, err2 = normalize_phone_number("abc1234567")
        self.assertIsNone(phone2)
        self.assertIsNotNone(err2)

    @patch("services.whatsapp_service.requests.post")
    def test_1_new_patient_registration_sends_admin_template(self, mock_post):
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
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertNotIn("test_secret_meta_token_12345", str(data))

        # Verify saved in MongoDB
        self.assertEqual(self.fake_db["patients"].count_documents({"regno": "KDC-101"}), 1)

        # Verify Meta Cloud API was called once with patient's normalized phone and template
        mock_post.assert_called_once()
        call_args = mock_post.call_args
        self.assertEqual(
            call_args.args[0],
            "https://graph.facebook.com/v23.0/1492317537289190/messages",
        )
        payload = call_args.kwargs["json"]
        self.assertEqual(payload["to"], "919876543210")
        self.assertEqual(payload["type"], "template")
        self.assertEqual(payload["template"]["name"], "new_patient_notification")
        self.assertEqual(payload["template"]["language"]["code"], "en")
        params = [p["text"] for p in payload["template"]["components"][0]["parameters"]]
        self.assertEqual(params, ["Ananya Nair", "KDC-101", "9876543210"])

        # Verify notification log stored in MongoDB without secrets
        logs = list(self.fake_db["whatsapp_notifications"].find({}))
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["status"], "sent")
        self.assertEqual(logs[0]["message_id"], "wamid.patient.1")
        self.assertNotIn("test_secret_meta_token_12345", str(logs[0]))

    @patch("services.whatsapp_service.requests.post")
    def test_2_new_appointment_booking_sends_admin_template(self, mock_post):
        self.fake_db["patients"].insert_one(
            {
                "regno": "KDC-202",
                "name": "Rahul Menon",
                "phone": "9123456789",
                "age": 34,
                "created_at": datetime.now(),
            }
        )
        mock_post.return_value = self._mock_meta_success("wamid.appt.1")

        res = self.client.post(
            "/api/appointments",
            headers=self.auth_headers,
            json={"regno": "KDC-202", "date": "2026-12-10", "time": "14:30"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["message"], "Appointment scheduled")

        # Verify saved in MongoDB
        self.assertEqual(
            self.fake_db["appointments"].count_documents({"regno": "KDC-202"}), 1
        )

        # Verify Meta Cloud API call goes to the booked patient's phone
        mock_post.assert_called_once()
        payload = mock_post.call_args.kwargs["json"]
        self.assertEqual(payload["to"], "919123456789")
        self.assertEqual(payload["template"]["name"], "new_appointment_notification")
        params = [p["text"] for p in payload["template"]["components"][0]["parameters"]]
        self.assertEqual(
            params,
            ["Rahul Menon", "KDC-202", "10 Dec 2026", "02:30 PM", "9123456789"],
        )

    @patch("services.whatsapp_service.requests.post")
    def test_3_meta_api_error_does_not_rollback_patient_or_appointment(self, mock_post):
        error_resp = MagicMock()
        error_resp.status_code = 400
        error_resp.json.return_value = {
            "error": {"message": "Template not approved", "code": 132001}
        }
        mock_post.return_value = error_resp

        # Patient registration must still succeed
        res_p = self.client.post(
            "/api/patients",
            headers=self.auth_headers,
            json={"regno": "KDC-303", "name": "Meera Das", "phone": "9988776655", "age": 25},
        )
        self.assertEqual(res_p.status_code, 201)
        self.assertEqual(self.fake_db["patients"].count_documents({"regno": "KDC-303"}), 1)

        # Appointment booking must still succeed even on timeout
        mock_post.side_effect = __import__("requests").exceptions.Timeout("timed out")
        res_a = self.client.post(
            "/api/appointments",
            headers=self.auth_headers,
            json={"regno": "KDC-303", "date": "2026-12-11", "time": "10:00"},
        )
        self.assertEqual(res_a.status_code, 200)
        self.assertEqual(
            self.fake_db["appointments"].count_documents({"regno": "KDC-303"}), 1
        )

        # Failures logged in MongoDB
        logs = list(self.fake_db["whatsapp_notifications"].find({}))
        self.assertEqual(len(logs), 2)
        self.assertEqual(logs[0]["status"], "failed")
        self.assertEqual(logs[0]["error_code"], 132001)
        self.assertEqual(logs[1]["status"], "failed")
        self.assertIn("timed out", logs[1]["error"])

    @patch("services.whatsapp_service.requests.post")
    def test_4_missing_whatsapp_credentials_keeps_clinic_working(self, mock_post):
        with patch.dict(
            os.environ,
            {
                "WHATSAPP_ACCESS_TOKEN": "",
                "WHATSAPP_PHONE_NUMBER_ID": "",
                "WHATSAPP_RECIPIENT_NUMBER": "",
            },
        ):
            res_p = self.client.post(
                "/api/patients",
                headers=self.auth_headers,
                json={"regno": "KDC-404", "name": "John Doe", "phone": "9876501234", "age": 40},
            )
            self.assertEqual(res_p.status_code, 201)

            res_a = self.client.post(
                "/api/appointments",
                headers=self.auth_headers,
                json={"regno": "KDC-404", "date": "2026-12-12", "time": "11:15"},
            )
            self.assertEqual(res_a.status_code, 200)

        mock_post.assert_not_called()
        logs = list(self.fake_db["whatsapp_notifications"].find({}))
        self.assertEqual(len(logs), 2)
        self.assertTrue(all(log["status"] == "skipped" for log in logs))

    @patch("services.whatsapp_service.requests.post")
    def test_5_get_and_put_appointments_do_not_send_notifications(self, mock_post):
        appt_id = ObjectId()
        self.fake_db["patients"].insert_one(
            {"regno": "KDC-505", "name": "Sita Roy", "phone": "9000011111", "age": 31}
        )
        self.fake_db["appointments"].insert_one(
            {
                "_id": appt_id,
                "regno": "KDC-505",
                "date": "2099-01-15",
                "time": "09:30",
                "datetime": datetime(2099, 1, 15, 9, 30),
                "created_at": datetime.now(),
            }
        )

        get_res = self.client.get("/api/appointments", headers=self.auth_headers)
        self.assertEqual(get_res.status_code, 200)
        self.assertEqual(len(get_res.get_json()["data"]), 1)

        put_res = self.client.put(
            f"/api/appointments/{str(appt_id)}",
            headers=self.auth_headers,
            json={"date": "2099-01-16", "time": "11:00"},
        )
        self.assertEqual(put_res.status_code, 200)

        mock_post.assert_not_called()

    @patch("services.whatsapp_service.requests.post")
    def test_6_duplicate_registration_and_booking_prevent_duplicate_notifications(self, mock_post):
        mock_post.return_value = self._mock_meta_success("wamid.dup.1")

        # Duplicate registration
        p1 = self.client.post(
            "/api/patients",
            headers=self.auth_headers,
            json={"regno": "KDC-606", "name": "Arjun K", "phone": "9898989898", "age": 22},
        )
        p2 = self.client.post(
            "/api/patients",
            headers=self.auth_headers,
            json={"regno": "KDC-606", "name": "Arjun K", "phone": "9898989898", "age": 22},
        )
        self.assertEqual(p1.status_code, 201)
        self.assertEqual(p2.status_code, 400)
        self.assertEqual(mock_post.call_count, 1)

        # Duplicate booking retry for same regno, date, time
        a1 = self.client.post(
            "/api/appointments",
            headers=self.auth_headers,
            json={"regno": "KDC-606", "date": "2026-12-20", "time": "16:00"},
        )
        a2 = self.client.post(
            "/api/appointments",
            headers=self.auth_headers,
            json={"regno": "KDC-606", "date": "2026-12-20", "time": "16:00"},
        )
        self.assertEqual(a1.status_code, 200)
        self.assertEqual(a2.status_code, 409)
        self.assertEqual(mock_post.call_count, 2)

        # Service-level idempotency check also blocks duplicate sends with same dedupe_key
        dup_result = self.test_service.send_new_patient_notification(
            patient_name="Arjun K",
            regno="KDC-606",
            phone_number="9898989898",
        )
        self.assertEqual(dup_result["status"], "duplicate_suppressed")
        self.assertEqual(mock_post.call_count, 2)

        # Deleting patient clears dedupe lock so re-registering sends again
        del_res = self.client.delete("/api/patients/KDC-606", headers=self.auth_headers)
        self.assertEqual(del_res.status_code, 200)
        p3 = self.client.post(
            "/api/patients",
            headers=self.auth_headers,
            json={"regno": "KDC-606", "name": "Arjun K", "phone": "9898989898", "age": 22},
        )
        self.assertEqual(p3.status_code, 201)
        self.assertEqual(mock_post.call_count, 3)

    @patch("services.whatsapp_service.requests.post")
    def test_7_unauthenticated_and_validation_failures_never_notify(self, mock_post):
        unauth_p = self.client.post(
            "/api/patients",
            json={"regno": "KDC-707", "name": "No Auth", "phone": "9876543210", "age": 20},
        )
        unauth_a = self.client.post(
            "/api/appointments",
            json={"regno": "KDC-707", "date": "2026-12-21", "time": "10:00"},
        )
        invalid_p = self.client.post(
            "/api/patients",
            headers=self.auth_headers,
            json={"regno": "", "name": "", "age": "abc"},
        )
        self.assertEqual(unauth_p.status_code, 401)
        self.assertEqual(unauth_a.status_code, 401)
        self.assertEqual(invalid_p.status_code, 400)
        mock_post.assert_not_called()

    @patch("services.whatsapp_service.requests.post")
    def test_8_access_token_never_logged(self, mock_post):
        mock_post.return_value = self._mock_meta_success()
        log_stream = io.StringIO()
        service_logger = logging.getLogger("services.whatsapp_service")
        mem_handler = logging.StreamHandler(log_stream)
        service_logger.addHandler(mem_handler)
        try:
            self.test_service.send_new_patient_notification(
                patient_name="Secret Check",
                regno="KDC-808",
                phone_number="9876543210",
            )
        finally:
            service_logger.removeHandler(mem_handler)

        logs_text = log_stream.getvalue()
        self.assertIn("WhatsApp notification sent", logs_text)
        self.assertNotIn("test_secret_meta_token_12345", logs_text)

    @patch("services.whatsapp_service.requests.post")
    def test_9_missing_patient_phone_skips_cleanly(self, mock_post):
        res = self.client.post(
            "/api/patients",
            headers=self.auth_headers,
            json={"regno": "KDC-909", "name": "No Phone Patient", "phone": "", "age": 30},
        )
        self.assertEqual(res.status_code, 201)
        mock_post.assert_not_called()
        logs = list(self.fake_db["whatsapp_notifications"].find({"entity_id": "KDC-909"}))
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["status"], "skipped")
        self.assertIn("Recipient phone number not provided", logs[0]["error"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
