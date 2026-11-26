"""Official Meta WhatsApp Cloud API notification service for Kuzhivelil Dental Care."""

from datetime import datetime
import hashlib
import hmac
import logging
import os
import re
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


DEFAULT_API_VERSION = "v23.0"
DEFAULT_TIMEOUT_SECONDS = 15
DEFAULT_LANGUAGE_CODE = "en"
DEFAULT_PATIENT_TEMPLATE = "new_patient_notification"
DEFAULT_APPOINTMENT_TEMPLATE = "new_appointment_notification"
DEFAULT_ANNOUNCEMENT_TEMPLATE = "clinic_announcement"
DEFAULT_REMINDER_TEMPLATE = "appointment_reminder_5hrs"
DEFAULT_CANCELLATION_TEMPLATE = "appointment_cancellation"
DEFAULT_DOCTOR_NAME = "Dr. Kuzhivelil"
DEFAULT_COUNTRY_CODE = "91"
NOTIFICATIONS_COLLECTION = "whatsapp_notifications"

RETRYABLE_META_ERROR_CODES = {1, 2, 4, 17, 130429, 131016, 131048}


def _parse_bool(value: Optional[str], default: bool = True) -> bool:
    if value is None or str(value).strip() == "":
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _normalize_api_version(version: Optional[str]) -> str:
    cleaned = (version or "").strip()
    if not cleaned:
        return DEFAULT_API_VERSION
    if not cleaned.startswith("v"):
        cleaned = f"v{cleaned}"
    return cleaned


def _mask_phone(phone: Optional[str]) -> str:
    if not phone:
        return "unknown"
    digits = "".join(ch for ch in str(phone) if ch.isdigit())
    if len(digits) <= 4:
        return "****"
    return f"{'*' * (len(digits) - 4)}{digits[-4:]}"


def _sanitize_template_param(value: Any) -> str:
    """Sanitize parameter text to satisfy Meta WhatsApp Cloud API template rules."""
    if value is None:
        return "N/A"
    text = str(value).replace("\r", " ").replace("\n", " ").replace("\t", " ")
    # Meta rejects >4 consecutive spaces in template parameters.
    text = re.sub(r" {2,}", " ", text).strip()
    if not text:
        return "N/A"
    return text[:1024]


def normalize_phone_number(
    raw_phone: Optional[str],
    default_country_code: str = DEFAULT_COUNTRY_CODE,
) -> Tuple[Optional[str], Optional[str]]:
    """Validate and normalize a phone number to E.164 digits (without leading '+')."""
    if raw_phone is None or not str(raw_phone).strip():
        return None, "Recipient phone number is empty"

    raw_str = str(raw_phone).strip()
    if not re.fullmatch(r"[\d\s+\-().]+", raw_str):
        return None, "Recipient phone number contains invalid characters"

    digits = "".join(ch for ch in raw_str if ch.isdigit())
    if not digits:
        return None, "Recipient phone number contains no digits"

    # Handle common local Indian format with leading 0 (e.g., 08848317301 -> 8848317301).
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]

    if len(digits) == 10 and default_country_code:
        country_digits = "".join(ch for ch in str(default_country_code) if ch.isdigit())
        digits = f"{country_digits}{digits}"

    if len(digits) < 10 or len(digits) > 15:
        return None, "Recipient phone number must be between 10 and 15 digits"

    return digits, None


class WhatsAppService:
    """Reusable Meta WhatsApp Cloud API template notification client."""

    def __init__(self, db_getter: Optional[Callable[[], Any]] = None) -> None:
        self._db_getter = db_getter
        self._lock = threading.Lock()
        self._sent_keys: set[str] = set()

    def set_db_getter(self, db_getter: Callable[[], Any]) -> None:
        self._db_getter = db_getter

    def _get_config(self) -> Dict[str, Any]:
        timeout_raw = os.getenv("WHATSAPP_TIMEOUT_SECONDS", "").strip()
        try:
            timeout = float(timeout_raw) if timeout_raw else DEFAULT_TIMEOUT_SECONDS
            if timeout <= 0:
                timeout = DEFAULT_TIMEOUT_SECONDS
        except ValueError:
            timeout = DEFAULT_TIMEOUT_SECONDS

        admin_phone = (
            os.getenv("WHATSAPP_ADMIN_PHONE")
            or os.getenv("WHATSAPP_RECIPIENT_NUMBER")
            or ""
        ).strip()

        patient_tpl = (
            os.getenv("WHATSAPP_PATIENT_TEMPLATE")
            or os.getenv("WHATSAPP_TEMPLATE_NEW_PATIENT")
            or DEFAULT_PATIENT_TEMPLATE
        ).strip()

        appointment_tpl = (
            os.getenv("WHATSAPP_APPOINTMENT_TEMPLATE")
            or os.getenv("WHATSAPP_TEMPLATE_NEW_APPOINTMENT")
            or DEFAULT_APPOINTMENT_TEMPLATE
        ).strip()

        announcement_tpl = (
            os.getenv("WHATSAPP_ANNOUNCEMENT_TEMPLATE")
            or DEFAULT_ANNOUNCEMENT_TEMPLATE
        ).strip()

        reminder_tpl = (
            os.getenv("WHATSAPP_REMINDER_TEMPLATE")
            or DEFAULT_REMINDER_TEMPLATE
        ).strip()

        cancellation_tpl = (
            os.getenv("WHATSAPP_CANCELLATION_TEMPLATE")
            or DEFAULT_CANCELLATION_TEMPLATE
        ).strip()

        return {
            "enabled": _parse_bool(os.getenv("WHATSAPP_ENABLED"), default=True),
            "access_token": (os.getenv("WHATSAPP_ACCESS_TOKEN") or "").strip(),
            "phone_number_id": (os.getenv("WHATSAPP_PHONE_NUMBER_ID") or "").strip(),
            "business_account_id": (os.getenv("WHATSAPP_BUSINESS_ACCOUNT_ID") or "").strip(),
            "api_version": _normalize_api_version(os.getenv("WHATSAPP_API_VERSION")),
            "admin_phone": admin_phone,
            "template_patient": patient_tpl,
            "template_appointment": appointment_tpl,
            "template_announcement": announcement_tpl,
            "template_reminder": reminder_tpl,
            "template_cancellation": cancellation_tpl,
            "template_language": (
                os.getenv("WHATSAPP_TEMPLATE_LANGUAGE") or DEFAULT_LANGUAGE_CODE
            ).strip(),
            "default_doctor_name": (
                os.getenv("WHATSAPP_DEFAULT_DOCTOR_NAME") or DEFAULT_DOCTOR_NAME
            ).strip(),
            "default_country_code": (
                os.getenv("WHATSAPP_DEFAULT_COUNTRY_CODE") or DEFAULT_COUNTRY_CODE
            ).strip(),
            "webhook_verify_token": (os.getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN") or "").strip(),
            "app_secret": (os.getenv("WHATSAPP_APP_SECRET") or "").strip(),
            "timeout": timeout,
        }

    def _get_notifications_collection(self):
        if self._db_getter is None:
            return None
        try:
            db = self._db_getter()
            if db is None:
                return None
            return db[NOTIFICATIONS_COLLECTION]
        except Exception as exc:
            logger.warning("Could not access notifications collection: %s", exc)
            return None

    def _is_duplicate_notification(self, dedupe_key: Optional[str]) -> bool:
        if not dedupe_key:
            return False

        with self._lock:
            if dedupe_key in self._sent_keys:
                return True

        collection = self._get_notifications_collection()
        if collection is not None:
            try:
                existing = collection.find_one(
                    {
                        "dedupe_key": dedupe_key,
                        "status": {"$in": ["sent", "delivered", "read"]},
                        "active": {"$ne": False},
                    }
                )
                if existing is not None:
                    with self._lock:
                        self._sent_keys.add(dedupe_key)
                    return True
            except Exception as exc:
                logger.warning("Notification deduplication lookup failed: %s", exc)

        return False

    def _mark_sent_in_memory(self, dedupe_key: Optional[str]) -> None:
        if not dedupe_key:
            return
        with self._lock:
            self._sent_keys.add(dedupe_key)

    def invalidate_dedupe_key(self, dedupe_key: Optional[str]) -> None:
        """Clear an active deduplication entry (e.g., when a record is deleted/rescheduled)."""
        if not dedupe_key:
            return
        with self._lock:
            self._sent_keys.discard(dedupe_key)

        collection = self._get_notifications_collection()
        if collection is not None:
            try:
                collection.update_many(
                    {"dedupe_key": dedupe_key, "active": {"$ne": False}},
                    {"$set": {"active": False, "invalidated_at": datetime.utcnow()}},
                )
            except Exception as exc:
                logger.warning("Failed to invalidate notification dedupe key: %s", exc)

    def _record_notification_log(
        self,
        *,
        event_type: str,
        template_name: str,
        language_code: str,
        recipient_masked: str,
        recipient_phone: Optional[str],
        parameters: Optional[List[str]],
        status: str,
        dedupe_key: Optional[str] = None,
        regno: Optional[str] = None,
        appointment_id: Optional[str] = None,
        broadcast_id: Optional[str] = None,
        entity_id: Optional[str] = None,
        http_status: Optional[int] = None,
        message_id: Optional[str] = None,
        error: Optional[str] = None,
        error_code: Optional[Any] = None,
        sent_at: Optional[datetime] = None,
    ) -> None:
        collection = self._get_notifications_collection()
        if collection is None:
            return
        try:
            doc = {
                "regno": regno,
                "appointment_id": appointment_id,
                "broadcast_id": broadcast_id,
                "recipient_phone": recipient_phone,
                "recipient": recipient_masked,
                "notification_type": event_type,
                "event_type": event_type,
                "template_name": template_name,
                "parameters": parameters or [],
                "language_code": language_code,
                "message_id": message_id,
                "status": status,
                "delivery_status": status if status in {"sent", "delivered", "read", "failed"} else None,
                "http_status": http_status,
                "error": error,
                "error_code": error_code,
                "dedupe_key": dedupe_key,
                "entity_id": entity_id,
                "active": True,
                "created_at": datetime.utcnow(),
                "sent_at": sent_at,
                "webhook_updated_at": None,
            }
            collection.insert_one(doc)
        except Exception as exc:
            logger.warning("Failed to store WhatsApp notification log in MongoDB: %s", exc)

    def send_template_message(
        self,
        *,
        to_phone: Optional[str],
        template_name: str,
        parameters: Optional[List[Any]] = None,
        language_code: Optional[str] = None,
        event_type: str = "template",
        dedupe_key: Optional[str] = None,
        regno: Optional[str] = None,
        appointment_id: Optional[str] = None,
        broadcast_id: Optional[str] = None,
        entity_id: Optional[str] = None,
        missing_recipient_reason: str = "Recipient phone number not provided",
    ) -> Dict[str, Any]:
        """Send a Meta WhatsApp Cloud API approved template message."""
        config = self._get_config()
        resolved_language = (
            language_code or config["template_language"] or DEFAULT_LANGUAGE_CODE
        ).strip()
        sanitized_params = [_sanitize_template_param(p) for p in (parameters or [])]
        recipient_masked = _mask_phone(to_phone)

        if not config["enabled"]:
            reason = "WhatsApp notifications are disabled via WHATSAPP_ENABLED"
            logger.info("Skipping WhatsApp notification (%s): %s", template_name, reason)
            self._record_notification_log(
                event_type=event_type,
                template_name=template_name,
                language_code=resolved_language,
                recipient_masked=recipient_masked,
                recipient_phone=None,
                parameters=sanitized_params,
                status="skipped",
                dedupe_key=dedupe_key,
                regno=regno,
                appointment_id=appointment_id,
                broadcast_id=broadcast_id,
                entity_id=entity_id,
                error=reason,
            )
            return {
                "success": False,
                "skipped": True,
                "retryable": False,
                "status": "skipped",
                "template_name": template_name,
                "recipient": recipient_masked,
                "reason": reason,
                "error": None,
            }

        missing = []
        if not config["access_token"]:
            missing.append("WHATSAPP_ACCESS_TOKEN")
        if not config["phone_number_id"]:
            missing.append("WHATSAPP_PHONE_NUMBER_ID")

        if missing:
            reason = f"Missing required WhatsApp configuration: {', '.join(missing)}"
            logger.warning("Skipping WhatsApp notification (%s): %s", template_name, reason)
            self._record_notification_log(
                event_type=event_type,
                template_name=template_name,
                language_code=resolved_language,
                recipient_masked=recipient_masked,
                recipient_phone=None,
                parameters=sanitized_params,
                status="skipped",
                dedupe_key=dedupe_key,
                regno=regno,
                appointment_id=appointment_id,
                broadcast_id=broadcast_id,
                entity_id=entity_id,
                error=reason,
            )
            return {
                "success": False,
                "skipped": True,
                "retryable": False,
                "status": "skipped",
                "template_name": template_name,
                "recipient": recipient_masked,
                "reason": reason,
                "error": None,
            }

        if not to_phone or not str(to_phone).strip() or str(to_phone).strip().upper() == "N/A":
            logger.warning(
                "Skipping WhatsApp notification (%s): %s",
                template_name,
                missing_recipient_reason,
            )
            self._record_notification_log(
                event_type=event_type,
                template_name=template_name,
                language_code=resolved_language,
                recipient_masked=recipient_masked,
                recipient_phone=None,
                parameters=sanitized_params,
                status="skipped",
                dedupe_key=dedupe_key,
                regno=regno,
                appointment_id=appointment_id,
                broadcast_id=broadcast_id,
                entity_id=entity_id,
                error=missing_recipient_reason,
            )
            return {
                "success": False,
                "skipped": True,
                "retryable": False,
                "status": "skipped",
                "template_name": template_name,
                "recipient": recipient_masked,
                "reason": missing_recipient_reason,
                "error": None,
            }

        normalized_phone, phone_error = normalize_phone_number(
            to_phone, default_country_code=config["default_country_code"]
        )
        if phone_error or not normalized_phone:
            logger.error(
                "WhatsApp notification (%s) failed phone validation: %s",
                template_name,
                phone_error,
            )
            self._record_notification_log(
                event_type=event_type,
                template_name=template_name,
                language_code=resolved_language,
                recipient_masked=recipient_masked,
                recipient_phone=None,
                parameters=sanitized_params,
                status="failed",
                dedupe_key=dedupe_key,
                regno=regno,
                appointment_id=appointment_id,
                broadcast_id=broadcast_id,
                entity_id=entity_id,
                error=phone_error,
            )
            return {
                "success": False,
                "skipped": False,
                "retryable": False,
                "status": "failed",
                "template_name": template_name,
                "recipient": recipient_masked,
                "error": phone_error,
            }

        recipient_masked = _mask_phone(normalized_phone)

        if self._is_duplicate_notification(dedupe_key):
            logger.info(
                "Suppressed duplicate WhatsApp notification (%s) for key=%s",
                template_name,
                dedupe_key,
            )
            return {
                "success": True,
                "skipped": True,
                "duplicate": True,
                "retryable": False,
                "status": "duplicate_suppressed",
                "template_name": template_name,
                "recipient": recipient_masked,
                "dedupe_key": dedupe_key,
                "error": None,
            }

        url = (
            f"https://graph.facebook.com/{config['api_version']}/"
            f"{config['phone_number_id']}/messages"
        )
        headers = {
            "Authorization": f"Bearer {config['access_token']}",
            "Content-Type": "application/json",
        }

        template_obj: Dict[str, Any] = {
            "name": template_name,
            "language": {"code": resolved_language},
        }
        if sanitized_params:
            template_obj["components"] = [
                {
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": param} for param in sanitized_params
                    ],
                }
            ]

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": normalized_phone,
            "type": "template",
            "template": template_obj,
        }

        try:
            response = requests.post(
                url,
                headers=headers,
                json=payload,
                timeout=config["timeout"],
            )
        except requests.exceptions.Timeout:
            error_msg = f"Meta WhatsApp API request timed out after {config['timeout']}s"
            logger.error("WhatsApp notification (%s) failed: %s", template_name, error_msg)
            self._record_notification_log(
                event_type=event_type,
                template_name=template_name,
                language_code=resolved_language,
                recipient_masked=recipient_masked,
                recipient_phone=normalized_phone,
                parameters=sanitized_params,
                status="failed",
                dedupe_key=dedupe_key,
                regno=regno,
                appointment_id=appointment_id,
                broadcast_id=broadcast_id,
                entity_id=entity_id,
                error=error_msg,
            )
            return {
                "success": False,
                "skipped": False,
                "retryable": True,
                "status": "failed",
                "template_name": template_name,
                "recipient": recipient_masked,
                "error": error_msg,
            }
        except requests.exceptions.RequestException as exc:
            error_msg = f"Meta WhatsApp API network error: {type(exc).__name__}"
            logger.error("WhatsApp notification (%s) failed: %s", template_name, error_msg)
            self._record_notification_log(
                event_type=event_type,
                template_name=template_name,
                language_code=resolved_language,
                recipient_masked=recipient_masked,
                recipient_phone=normalized_phone,
                parameters=sanitized_params,
                status="failed",
                dedupe_key=dedupe_key,
                regno=regno,
                appointment_id=appointment_id,
                broadcast_id=broadcast_id,
                entity_id=entity_id,
                error=error_msg,
            )
            return {
                "success": False,
                "skipped": False,
                "retryable": True,
                "status": "failed",
                "template_name": template_name,
                "recipient": recipient_masked,
                "error": error_msg,
            }

        response_data: Dict[str, Any] = {}
        try:
            parsed = response.json()
            if isinstance(parsed, dict):
                response_data = parsed
        except ValueError:
            response_data = {}

        if 200 <= response.status_code < 300:
            messages = response_data.get("messages") or []
            message_id = (
                messages[0].get("id")
                if messages and isinstance(messages[0], dict)
                else None
            )
            sent_ts = datetime.utcnow()
            self._mark_sent_in_memory(dedupe_key)
            logger.info(
                "WhatsApp notification sent: event=%s template=%s to=%s status=%s message_id=%s",
                event_type,
                template_name,
                recipient_masked,
                response.status_code,
                message_id,
            )
            self._record_notification_log(
                event_type=event_type,
                template_name=template_name,
                language_code=resolved_language,
                recipient_masked=recipient_masked,
                recipient_phone=normalized_phone,
                parameters=sanitized_params,
                status="sent",
                dedupe_key=dedupe_key,
                regno=regno,
                appointment_id=appointment_id,
                broadcast_id=broadcast_id,
                entity_id=entity_id,
                http_status=response.status_code,
                message_id=message_id,
                sent_at=sent_ts,
            )
            return {
                "success": True,
                "skipped": False,
                "retryable": False,
                "status": "sent",
                "http_status": response.status_code,
                "message_id": message_id,
                "template_name": template_name,
                "recipient": recipient_masked,
                "error": None,
            }

        api_error = response_data.get("error") if isinstance(response_data.get("error"), dict) else {}
        error_code = api_error.get("code")
        error_msg = api_error.get("message") or f"Meta WhatsApp API returned HTTP {response.status_code}"
        retryable = (
            response.status_code >= 500
            or response.status_code == 429
            or error_code in RETRYABLE_META_ERROR_CODES
        )
        logger.error(
            "WhatsApp notification failed: event=%s template=%s to=%s http_status=%s code=%s error=%s",
            event_type,
            template_name,
            recipient_masked,
            response.status_code,
            error_code,
            error_msg,
        )
        self._record_notification_log(
            event_type=event_type,
            template_name=template_name,
            language_code=resolved_language,
            recipient_masked=recipient_masked,
            recipient_phone=normalized_phone,
            parameters=sanitized_params,
            status="failed",
            dedupe_key=dedupe_key,
            regno=regno,
            appointment_id=appointment_id,
            broadcast_id=broadcast_id,
            entity_id=entity_id,
            http_status=response.status_code,
            error=error_msg,
            error_code=error_code,
        )
        return {
            "success": False,
            "skipped": False,
            "retryable": retryable,
            "status": "failed",
            "http_status": response.status_code,
            "template_name": template_name,
            "recipient": recipient_masked,
            "error": error_msg,
            "error_code": error_code,
        }

    # --- Feature 1: Patient Notification on New Patient Registration ---
    def send_new_patient_notification(
        self,
        *,
        patient_name: str,
        regno: str,
        phone_number: Optional[str],
        dedupe_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Notify the newly registered patient's WhatsApp phone number."""
        config = self._get_config()
        resolved_dedupe = dedupe_key or f"new_patient:{str(regno).strip().lower()}"
        return self.send_template_message(
            to_phone=phone_number,
            template_name=config["template_patient"],
            parameters=[
                patient_name,
                regno,
                phone_number if (phone_number and str(phone_number).strip()) else "N/A",
            ],
            language_code=config["template_language"],
            event_type="new_patient",
            dedupe_key=resolved_dedupe,
            regno=str(regno).strip(),
            entity_id=str(regno).strip(),
            missing_recipient_reason="Patient phone number not provided",
        )

    # --- Feature 2: Clinic/Admin Notification on New Appointment Booking ---
    def send_new_appointment_notification(
        self,
        *,
        patient_name: str,
        regno: str,
        appointment_date: str,
        appointment_time: str,
        patient_phone: Optional[str],
        appointment_id: Optional[str] = None,
        dedupe_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Notify the fixed clinic/admin WhatsApp number when an appointment is booked."""
        config = self._get_config()
        resolved_dedupe = (
            dedupe_key
            or f"new_appointment:{str(regno).strip().lower()}:{str(appointment_date).strip()}:{str(appointment_time).strip()}"
        )
        return self.send_template_message(
            to_phone=config["admin_phone"],
            template_name=config["template_appointment"],
            parameters=[
                patient_name,
                regno,
                appointment_date,
                appointment_time,
                patient_phone if (patient_phone and str(patient_phone).strip()) else "N/A",
            ],
            language_code=config["template_language"],
            event_type="new_appointment",
            dedupe_key=resolved_dedupe,
            regno=str(regno).strip(),
            appointment_id=appointment_id,
            entity_id=appointment_id or f"{str(regno).strip()}:{appointment_date}:{appointment_time}",
            missing_recipient_reason="Missing required WhatsApp configuration: WHATSAPP_ADMIN_PHONE",
        )

    # --- Feature 3: Patient Notification for General Clinic Announcements ---
    def send_clinic_announcement(
        self,
        *,
        regno: str,
        patient_phone: Optional[str],
        closure_date: str,
        reason: str,
        reopening_date: str,
        broadcast_id: str,
        dedupe_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send a clinic announcement template to an opted-in patient's phone number."""
        config = self._get_config()
        resolved_dedupe = (
            dedupe_key or f"clinic_announcement:{broadcast_id}:{str(regno).strip().lower()}"
        )
        return self.send_template_message(
            to_phone=patient_phone,
            template_name=config["template_announcement"],
            parameters=[closure_date, reason, reopening_date],
            language_code=config["template_language"],
            event_type="clinic_announcement",
            dedupe_key=resolved_dedupe,
            regno=str(regno).strip(),
            broadcast_id=broadcast_id,
            entity_id=f"{broadcast_id}:{str(regno).strip()}",
            missing_recipient_reason="Patient phone number not provided",
        )

    # --- Feature 4: Patient Notification for 5-Hour Appointment Reminder ---
    def send_appointment_reminder(
        self,
        *,
        patient_name: str,
        regno: str,
        patient_phone: Optional[str],
        appointment_date: str,
        appointment_time: str,
        doctor_name: Optional[str] = None,
        appointment_id: Optional[str] = None,
        dedupe_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send the 5-hour reminder template to the patient's registered WhatsApp number."""
        config = self._get_config()
        resolved_doctor = (
            (doctor_name or "").strip() or config["default_doctor_name"] or DEFAULT_DOCTOR_NAME
        )
        resolved_dedupe = (
            dedupe_key
            or f"appointment_reminder_5hrs:{appointment_id or regno}:{appointment_date}:{appointment_time}"
        )
        return self.send_template_message(
            to_phone=patient_phone,
            template_name=config["template_reminder"],
            parameters=[
                patient_name,
                appointment_date,
                appointment_time,
                resolved_doctor,
            ],
            language_code=config["template_language"],
            event_type="appointment_reminder_5hrs",
            dedupe_key=resolved_dedupe,
            regno=str(regno).strip(),
            appointment_id=appointment_id,
            entity_id=appointment_id or f"{str(regno).strip()}:{appointment_date}:{appointment_time}",
            missing_recipient_reason="Patient phone number not provided",
        )

    # --- Feature 5: Patient Notification on Appointment Cancellation ---
    def send_appointment_cancelled_notification(
        self,
        *,
        patient_name: str,
        regno: str,
        patient_phone: Optional[str],
        appointment_date: str,
        appointment_time: str,
        appointment_id: Optional[str] = None,
        dedupe_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Notify the patient's WhatsApp number immediately when an appointment is cancelled."""
        config = self._get_config()
        resolved_dedupe = (
            dedupe_key
            or f"appointment_cancelled:{appointment_id or f'{str(regno).strip().lower()}:{appointment_date}:{appointment_time}'}"
        )
        return self.send_template_message(
            to_phone=patient_phone,
            template_name=config["template_cancellation"],
            parameters=[patient_name, appointment_date, appointment_time],
            language_code=config["template_language"],
            event_type="appointment_cancelled",
            dedupe_key=resolved_dedupe,
            regno=str(regno).strip(),
            appointment_id=appointment_id,
            entity_id=appointment_id or f"{str(regno).strip()}:{appointment_date}:{appointment_time}",
            missing_recipient_reason="Patient phone number not provided",
        )

    # --- Webhook Verification & Delivery Status Tracking ---
    def verify_webhook_token(self, mode: Optional[str], token: Optional[str]) -> bool:
        config = self._get_config()
        expected = config["webhook_verify_token"]
        return bool(expected and mode == "subscribe" and token == expected)

    def verify_webhook_signature(self, raw_body: bytes, signature_header: Optional[str]) -> bool:
        config = self._get_config()
        app_secret = config["app_secret"]
        if not app_secret:
            return True
        if not signature_header or not signature_header.startswith("sha256="):
            return False
        expected_sig = hmac.new(
            app_secret.encode("utf-8"),
            raw_body,
            hashlib.sha256,
        ).hexdigest()
        provided_sig = signature_header.split("=", 1)[1].strip()
        return hmac.compare_digest(expected_sig, provided_sig)

    def process_webhook_payload(self, payload: Dict[str, Any]) -> Dict[str, int]:
        """Update WhatsApp delivery/read/failure status from Meta webhook callbacks."""
        updated = 0
        collection = self._get_notifications_collection()
        if not isinstance(payload, dict) or collection is None:
            return {"updated": 0}

        for entry in payload.get("entry") or []:
            for change in entry.get("changes") or []:
                value = change.get("value") or {}
                for status_event in value.get("statuses") or []:
                    msg_id = status_event.get("id")
                    delivery_status = status_event.get("status")
                    if not msg_id or not delivery_status:
                        continue

                    update_fields: Dict[str, Any] = {
                        "delivery_status": delivery_status,
                        "webhook_updated_at": datetime.utcnow(),
                    }
                    if delivery_status in {"sent", "delivered", "read", "failed"}:
                        update_fields["status"] = delivery_status

                    errors = status_event.get("errors") or []
                    if errors and isinstance(errors[0], dict):
                        update_fields["error_code"] = errors[0].get("code")
                        update_fields["error"] = (
                            errors[0].get("title")
                            or errors[0].get("message")
                            or "Webhook reported delivery failure"
                        )

                    try:
                        res = collection.update_one(
                            {"message_id": msg_id},
                            {"$set": update_fields},
                        )
                        if getattr(res, "matched_count", 0) > 0:
                            updated += 1
                    except Exception as exc:
                        logger.warning("Webhook status update failed for %s: %s", msg_id, exc)

        return {"updated": updated}


whatsapp_service = WhatsAppService()
