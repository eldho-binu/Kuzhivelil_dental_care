"""Official Meta WhatsApp Cloud API notification service."""

from datetime import datetime
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
DEFAULT_NEW_PATIENT_TEMPLATE = "new_patient_notification"
DEFAULT_NEW_APPOINTMENT_TEMPLATE = "new_appointment_notification"
DEFAULT_COUNTRY_CODE = "91"
NOTIFICATIONS_COLLECTION = "whatsapp_notifications"


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
    # Reject letters or unexpected symbols before stripping formatting characters.
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

        return {
            "enabled": _parse_bool(os.getenv("WHATSAPP_ENABLED"), default=True),
            "access_token": (os.getenv("WHATSAPP_ACCESS_TOKEN") or "").strip(),
            "phone_number_id": (os.getenv("WHATSAPP_PHONE_NUMBER_ID") or "").strip(),
            "business_account_id": (os.getenv("WHATSAPP_BUSINESS_ACCOUNT_ID") or "").strip(),
            "api_version": _normalize_api_version(os.getenv("WHATSAPP_API_VERSION")),
            "recipient_number": (os.getenv("WHATSAPP_RECIPIENT_NUMBER") or "").strip(),
            "template_new_patient": (
                os.getenv("WHATSAPP_TEMPLATE_NEW_PATIENT") or DEFAULT_NEW_PATIENT_TEMPLATE
            ).strip(),
            "template_new_appointment": (
                os.getenv("WHATSAPP_TEMPLATE_NEW_APPOINTMENT")
                or DEFAULT_NEW_APPOINTMENT_TEMPLATE
            ).strip(),
            "template_language": (
                os.getenv("WHATSAPP_TEMPLATE_LANGUAGE") or DEFAULT_LANGUAGE_CODE
            ).strip(),
            "default_country_code": (
                os.getenv("WHATSAPP_DEFAULT_COUNTRY_CODE") or DEFAULT_COUNTRY_CODE
            ).strip(),
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
                        "status": "sent",
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
        """Clear an active deduplication entry (e.g., when an appointment is deleted)."""
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
        status: str,
        dedupe_key: Optional[str] = None,
        entity_id: Optional[str] = None,
        http_status: Optional[int] = None,
        message_id: Optional[str] = None,
        error: Optional[str] = None,
        error_code: Optional[Any] = None,
    ) -> None:
        collection = self._get_notifications_collection()
        if collection is None:
            return
        try:
            doc = {
                "event_type": event_type,
                "template_name": template_name,
                "language_code": language_code,
                "recipient": recipient_masked,
                "dedupe_key": dedupe_key,
                "entity_id": entity_id,
                "status": status,
                "http_status": http_status,
                "message_id": message_id,
                "error": error,
                "error_code": error_code,
                "active": True,
                "created_at": datetime.utcnow(),
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
        entity_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send a Meta WhatsApp Cloud API approved template message."""
        config = self._get_config()
        resolved_language = (language_code or config["template_language"] or DEFAULT_LANGUAGE_CODE).strip()
        recipient_masked = _mask_phone(to_phone)

        if not config["enabled"]:
            reason = "WhatsApp notifications are disabled via WHATSAPP_ENABLED"
            logger.info("Skipping WhatsApp notification (%s): %s", template_name, reason)
            self._record_notification_log(
                event_type=event_type,
                template_name=template_name,
                language_code=resolved_language,
                recipient_masked=recipient_masked,
                status="skipped",
                dedupe_key=dedupe_key,
                entity_id=entity_id,
                error=reason,
            )
            return {
                "success": False,
                "skipped": True,
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
                status="skipped",
                dedupe_key=dedupe_key,
                entity_id=entity_id,
                error=reason,
            )
            return {
                "success": False,
                "skipped": True,
                "status": "skipped",
                "template_name": template_name,
                "recipient": recipient_masked,
                "reason": reason,
                "error": None,
            }

        if not to_phone or not str(to_phone).strip() or str(to_phone).strip().upper() == "N/A":
            reason = "Recipient phone number not provided"
            logger.warning("Skipping WhatsApp notification (%s): %s", template_name, reason)
            self._record_notification_log(
                event_type=event_type,
                template_name=template_name,
                language_code=resolved_language,
                recipient_masked=recipient_masked,
                status="skipped",
                dedupe_key=dedupe_key,
                entity_id=entity_id,
                error=reason,
            )
            return {
                "success": False,
                "skipped": True,
                "status": "skipped",
                "template_name": template_name,
                "recipient": recipient_masked,
                "reason": reason,
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
                status="failed",
                dedupe_key=dedupe_key,
                entity_id=entity_id,
                error=phone_error,
            )
            return {
                "success": False,
                "skipped": False,
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
        if parameters:
            template_obj["components"] = [
                {
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": _sanitize_template_param(param)}
                        for param in parameters
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
                status="failed",
                dedupe_key=dedupe_key,
                entity_id=entity_id,
                error=error_msg,
            )
            return {
                "success": False,
                "skipped": False,
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
                status="failed",
                dedupe_key=dedupe_key,
                entity_id=entity_id,
                error=error_msg,
            )
            return {
                "success": False,
                "skipped": False,
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
                status="sent",
                dedupe_key=dedupe_key,
                entity_id=entity_id,
                http_status=response.status_code,
                message_id=message_id,
            )
            return {
                "success": True,
                "skipped": False,
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
            status="failed",
            dedupe_key=dedupe_key,
            entity_id=entity_id,
            http_status=response.status_code,
            error=error_msg,
            error_code=error_code,
        )
        return {
            "success": False,
            "skipped": False,
            "status": "failed",
            "http_status": response.status_code,
            "template_name": template_name,
            "recipient": recipient_masked,
            "error": error_msg,
            "error_code": error_code,
        }

    def send_new_patient_notification(
        self,
        *,
        patient_name: str,
        regno: str,
        phone_number: Optional[str],
        recipient_phone: Optional[str] = None,
        dedupe_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Notify the newly registered patient's WhatsApp number."""
        config = self._get_config()
        target_phone = recipient_phone if (recipient_phone and str(recipient_phone).strip()) else phone_number
        resolved_dedupe = dedupe_key or f"new_patient:{str(regno).strip().lower()}"
        return self.send_template_message(
            to_phone=target_phone,
            template_name=config["template_new_patient"],
            parameters=[
                patient_name,
                regno,
                phone_number if (phone_number and str(phone_number).strip()) else "N/A",
            ],
            language_code=config["template_language"],
            event_type="new_patient",
            dedupe_key=resolved_dedupe,
            entity_id=str(regno).strip(),
        )

    def send_new_appointment_notification(
        self,
        *,
        patient_name: str,
        regno: str,
        appointment_date: str,
        appointment_time: str,
        patient_phone: Optional[str],
        recipient_phone: Optional[str] = None,
        appointment_id: Optional[str] = None,
        dedupe_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Notify the patient's WhatsApp number when a new appointment is booked."""
        config = self._get_config()
        target_phone = recipient_phone if (recipient_phone and str(recipient_phone).strip()) else patient_phone
        resolved_dedupe = (
            dedupe_key
            or f"new_appointment:{str(regno).strip().lower()}:{str(appointment_date).strip()}:{str(appointment_time).strip()}"
        )
        return self.send_template_message(
            to_phone=target_phone,
            template_name=config["template_new_appointment"],
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
            entity_id=appointment_id or f"{str(regno).strip()}:{appointment_date}:{appointment_time}",
        )


whatsapp_service = WhatsAppService()
