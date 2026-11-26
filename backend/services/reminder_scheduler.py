"""MongoDB-persisted 5-hour appointment reminder scheduler (Asia/Kolkata)."""

from datetime import datetime, timedelta
import logging
import math
import os
import re
import threading
from typing import Any, Callable, Dict, Optional, Tuple

import pytz

from services.whatsapp_service import WhatsAppService

logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

IST = pytz.timezone("Asia/Kolkata")
REMINDERS_COLLECTION = "appointment_reminders"
REMINDER_LEAD_HOURS = 5


def format_date_readable(date_str: Optional[str]) -> str:
    """Convert YYYY-MM-DD date string to readable DD MMM YYYY format."""
    try:
        if not date_str:
            return "N/A"
        dt = datetime.strptime(str(date_str).strip(), "%Y-%m-%d")
        return dt.strftime("%d %b %Y")
    except Exception:
        return str(date_str)


def format_time_12h(time_str: Optional[str]) -> str:
    """Convert 24h time string (HH:MM) to 12h format (hh:mm AM/PM)."""
    try:
        if not time_str:
            return "N/A"
        dt = datetime.strptime(str(time_str).strip(), "%H:%M")
        return dt.strftime("%I:%M %p")
    except Exception:
        return str(time_str)


def compute_ist_appointment_times(
    date_str: str, time_str: str
) -> Tuple[datetime, datetime]:
    """Parse Asia/Kolkata date+time and return naive UTC (appointment_at, remind_at)."""
    naive_local = datetime.strptime(f"{date_str.strip()} {time_str.strip()}", "%Y-%m-%d %H:%M")
    localized = IST.localize(naive_local)
    appt_utc = localized.astimezone(pytz.UTC).replace(tzinfo=None)
    remind_at_utc = appt_utc - timedelta(hours=REMINDER_LEAD_HOURS)
    return appt_utc, remind_at_utc


def _clean_str(val: Any) -> str:
    """Safely convert MongoDB/CSV field values (including int/Int64/float) to string."""
    if val is None:
        return ""
    if isinstance(val, float):
        if math.isnan(val):
            return ""
        if val.is_integer():
            return str(int(val))
    return str(val).strip()


def _find_patient_for_regno(db: Any, regno: str) -> Optional[Dict[str, Any]]:
    if db is None or not regno:
        return None
    patients_col = db["patients"]
    clean = _clean_str(regno)
    patient = patients_col.find_one(
        {"$or": [{"regno": clean}, {"Reg No": clean}]}
    )
    if patient:
        return patient
    return patients_col.find_one(
        {
            "$or": [
                {"regno": {"$regex": f"^{re.escape(clean)}$", "$options": "i"}},
                {"Reg No": {"$regex": f"^{re.escape(clean)}$", "$options": "i"}},
            ]
        }
    )


def schedule_or_update_reminder(
    db: Any,
    *,
    appointment_id: str,
    regno: str,
    patient_name: str,
    patient_phone: Optional[str],
    date_str: str,
    time_str: str,
    doctor_name: Optional[str] = None,
    now_utc: Optional[datetime] = None,
) -> Optional[Dict[str, Any]]:
    """Persist or reschedule a 5-hour reminder job in MongoDB."""
    if db is None:
        return None

    now = now_utc or datetime.utcnow()
    appt_utc, remind_at_utc = compute_ist_appointment_times(date_str, time_str)
    status = "expired" if appt_utc <= now else "pending"
    resolved_doctor = (
        (doctor_name or "").strip()
        or (os.getenv("WHATSAPP_DEFAULT_DOCTOR_NAME") or "Dr. Kuzhivelil").strip()
    )

    reminders_col = db[REMINDERS_COLLECTION]
    existing = reminders_col.find_one({"appointment_id": str(appointment_id)})

    doc_fields = {
        "appointment_id": str(appointment_id),
        "regno": _clean_str(regno),
        "patient_name": _clean_str(patient_name) or "Patient",
        "patient_phone": _clean_str(patient_phone),
        "appointment_date": date_str.strip(),
        "appointment_time": time_str.strip(),
        "doctor_name": resolved_doctor,
        "timezone": "Asia/Kolkata",
        "appointment_at": appt_utc,
        "remind_at": remind_at_utc,
        "status": status,
        "attempts": 0,
        "max_attempts": 3,
        "next_retry_at": None,
        "last_error": None,
        "message_id": None,
        "sent_at": None,
        "cancelled_at": None,
        "updated_at": now,
    }

    if existing:
        reminders_col.update_one(
            {"appointment_id": str(appointment_id)},
            {"$set": doc_fields},
        )
    else:
        doc_fields["created_at"] = now
        reminders_col.insert_one(doc_fields)

    return doc_fields


def cancel_reminder(
    db: Any, appointment_id: str, now_utc: Optional[datetime] = None
) -> int:
    """Mark any scheduled/pending/failed reminder for an appointment as cancelled."""
    if db is None:
        return 0
    now = now_utc or datetime.utcnow()
    res = db[REMINDERS_COLLECTION].update_many(
        {
            "appointment_id": str(appointment_id),
            "status": {"$in": ["pending", "processing", "failed"]},
        },
        {
            "$set": {
                "status": "cancelled",
                "cancelled_at": now,
                "next_retry_at": None,
                "updated_at": now,
            }
        },
    )
    return getattr(res, "modified_count", 0)


def recover_stuck_processing_reminders(
    db: Any, stale_minutes: int = 5, now_utc: Optional[datetime] = None
) -> int:
    """Recover reminders left in 'processing' after an unexpected server restart."""
    if db is None:
        return 0
    now = now_utc or datetime.utcnow()
    cutoff = now - timedelta(minutes=stale_minutes)
    res = db[REMINDERS_COLLECTION].update_many(
        {"status": "processing", "updated_at": {"$lt": cutoff}},
        {"$set": {"status": "pending", "updated_at": now}},
    )
    return getattr(res, "modified_count", 0)


def _claim_reminder(db: Any, reminder: Dict[str, Any], now: datetime) -> bool:
    reminders_col = db[REMINDERS_COLLECTION]
    claim_query = {
        "appointment_id": reminder["appointment_id"],
        "status": reminder["status"],
        "updated_at": reminder.get("updated_at"),
    }
    claim_update = {"$set": {"status": "processing", "updated_at": now}}

    if hasattr(reminders_col, "find_one_and_update"):
        claimed = reminders_col.find_one_and_update(claim_query, claim_update)
        return claimed is not None

    res = reminders_col.update_one(claim_query, claim_update)
    return getattr(res, "modified_count", 0) > 0


def process_due_reminders(
    db_getter: Callable[[], Any],
    whatsapp_svc: WhatsAppService,
    now_utc: Optional[datetime] = None,
) -> Dict[str, int]:
    """Evaluate and send all due 5-hour appointment reminders stored in MongoDB."""
    summary = {
        "processed": 0,
        "sent": 0,
        "failed": 0,
        "skipped": 0,
        "expired": 0,
        "cancelled": 0,
    }

    db = db_getter() if db_getter else None
    if db is None:
        return summary

    now = now_utc or datetime.utcnow()
    recover_stuck_processing_reminders(db, now_utc=now)

    reminders_col = db[REMINDERS_COLLECTION]
    due_query = {
        "$or": [
            {"status": "pending", "remind_at": {"$lte": now}},
            {"status": "failed", "next_retry_at": {"$lte": now}},
        ]
    }
    candidates = list(reminders_col.find(due_query))

    for reminder in candidates:
        attempts = int(reminder.get("attempts") or 0)
        max_attempts = int(reminder.get("max_attempts") or 3)
        if reminder.get("status") == "failed" and (
            attempts >= max_attempts or reminder.get("next_retry_at") is None
        ):
            continue

        if not _claim_reminder(db, reminder, now):
            continue

        summary["processed"] += 1
        appt_id = str(reminder["appointment_id"])

        # Confirm the appointment still exists and is not cancelled
        appt_doc = None
        try:
            from bson import ObjectId

            if ObjectId.is_valid(appt_id):
                appt_doc = db["appointments"].find_one({"_id": ObjectId(appt_id)})
        except Exception:
            appt_doc = None

        if appt_doc is None:
            # Also check string _id fallback if any
            appt_doc = db["appointments"].find_one({"_id": appt_id})

        if appt_doc is None:
            reminders_col.update_one(
                {"appointment_id": appt_id},
                {
                    "$set": {
                        "status": "cancelled",
                        "cancelled_at": now,
                        "next_retry_at": None,
                        "updated_at": now,
                    }
                },
            )
            summary["cancelled"] += 1
            continue

        appt_at = reminder.get("appointment_at")
        if appt_at and appt_at <= now:
            reminders_col.update_one(
                {"appointment_id": appt_id},
                {
                    "$set": {
                        "status": "expired",
                        "last_error": "Appointment time already passed",
                        "next_retry_at": None,
                        "updated_at": now,
                    }
                },
            )
            summary["expired"] += 1
            continue

        regno = str(reminder.get("regno") or "").strip()
        patient = _find_patient_for_regno(db, regno)
        if patient and patient.get("whatsapp_opt_in") is False:
            reminders_col.update_one(
                {"appointment_id": appt_id},
                {
                    "$set": {
                        "status": "skipped",
                        "last_error": "Patient opted out of WhatsApp notifications",
                        "next_retry_at": None,
                        "updated_at": now,
                    }
                },
            )
            summary["skipped"] += 1
            continue

        patient_name = _clean_str(
            (patient.get("name") or patient.get("Name"))
            if patient
            else reminder.get("patient_name")
        ) or "Patient"
        patient_phone = _clean_str(
            (patient.get("phone") if patient and patient.get("phone") is not None else (patient.get("Phone") if patient else None))
            if patient
            else reminder.get("patient_phone")
        )
        appt_date = reminder.get("appointment_date")
        appt_time = reminder.get("appointment_time")
        doctor_name = appt_doc.get("doctor_name") or reminder.get("doctor_name")

        dedupe_key = f"appointment_reminder_5hrs:{appt_id}:{appt_date}:{appt_time}"
        result = whatsapp_svc.send_appointment_reminder(
            patient_name=patient_name,
            regno=regno,
            patient_phone=patient_phone,
            appointment_date=format_date_readable(appt_date),
            appointment_time=format_time_12h(appt_time),
            doctor_name=doctor_name,
            appointment_id=appt_id,
            dedupe_key=dedupe_key,
        )

        if result.get("success"):
            reminders_col.update_one(
                {"appointment_id": appt_id},
                {
                    "$set": {
                        "status": "sent",
                        "message_id": result.get("message_id"),
                        "sent_at": now,
                        "last_error": None,
                        "next_retry_at": None,
                        "updated_at": now,
                    }
                },
            )
            summary["sent"] += 1
        elif result.get("skipped"):
            reminders_col.update_one(
                {"appointment_id": appt_id},
                {
                    "$set": {
                        "status": "skipped",
                        "last_error": result.get("reason") or "Skipped",
                        "next_retry_at": None,
                        "updated_at": now,
                    }
                },
            )
            summary["skipped"] += 1
        else:
            new_attempts = attempts + 1
            retryable = bool(result.get("retryable"))
            can_retry = retryable and new_attempts < max_attempts and (
                not appt_at or appt_at > now
            )
            next_retry = (
                now + timedelta(minutes=2 * new_attempts) if can_retry else None
            )
            reminders_col.update_one(
                {"appointment_id": appt_id},
                {
                    "$set": {
                        "status": "failed",
                        "attempts": new_attempts,
                        "next_retry_at": next_retry,
                        "last_error": result.get("error") or "Unknown error",
                        "updated_at": now,
                    }
                },
            )
            summary["failed"] += 1

    return summary


class ReminderScheduler:
    """Background daemon polling MongoDB for due 5-hour appointment reminders."""

    def __init__(
        self,
        db_getter: Callable[[], Any],
        whatsapp_svc: WhatsAppService,
    ) -> None:
        self._db_getter = db_getter
        self._whatsapp_svc = whatsapp_svc
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

    def start(self) -> bool:
        enabled = (os.getenv("WHATSAPP_SCHEDULER_ENABLED", "true") or "true").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        if not enabled:
            logger.info("Reminder scheduler disabled via WHATSAPP_SCHEDULER_ENABLED")
            return False

        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return False

            self._stop_event.clear()
            self._thread = threading.Thread(
                target=self._run_loop,
                name="whatsapp-reminder-scheduler",
                daemon=True,
            )
            self._thread.start()
            logger.info("Started 5-hour WhatsApp reminder background scheduler (Asia/Kolkata)")
            return True

    def stop(self) -> None:
        self._stop_event.set()

    def _run_loop(self) -> None:
        raw_interval = (os.getenv("WHATSAPP_SCHEDULER_INTERVAL_SECONDS") or "60").strip()
        try:
            interval = max(10, int(raw_interval))
        except ValueError:
            interval = 60

        while not self._stop_event.is_set():
            try:
                process_due_reminders(self._db_getter, self._whatsapp_svc)
            except Exception as exc:
                logger.error("Reminder scheduler tick failed: %s", exc)
            self._stop_event.wait(interval)
