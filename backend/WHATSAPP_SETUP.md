# Meta WhatsApp Cloud API Setup & Deployment Guide

## 1. Architecture & Hosting Overview

- **Frontend**: React + Vite hosted on **Vercel** (`https://kuzhivelil-dental-care.vercel.app`)
- **Backend**: Python Flask (`backend/app.py`) hosted on **Render** (`https://kuzhivelil-dental-care-1.onrender.com`, configured in `frontend/.env.production` via `VITE_API_URL`, running with `gunicorn`)
  - Note: `backend/vercel.json` exists in the repository from an earlier configuration, but active production traffic from the Vercel frontend routes to Render. All `WHATSAPP_*` environment variables must be set in the **Flask backend host (Render)**, **not** in the Vercel frontend environment.

## 2. Backend Environment Variables

Configure these environment variables in `backend/.env` for local development and in your **Render Dashboard -> Service -> Environment** for production:

| Variable | Example / Value | Description |
| --- | --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | *(secret token)* | Meta permanent System User access token (never commit or expose to frontend) |
| `WHATSAPP_PHONE_NUMBER_ID` | `1492317537289190` | Registered Meta WhatsApp Phone Number ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | `2187192222184438` | Meta WhatsApp Business Account ID |
| `WHATSAPP_API_VERSION` | `v23.0` | Meta Graph API version |
| `WHATSAPP_RECIPIENT_NUMBER` | *(optional)* | Optional override number; by default notifications go to the patient's phone number |
| `WHATSAPP_ENABLED` | `true` | Enable (`true`) or disable (`false`) WhatsApp notifications |
| `WHATSAPP_TEMPLATE_NEW_PATIENT` | `new_patient_notification` | Template name for new patient registration |
| `WHATSAPP_TEMPLATE_NEW_APPOINTMENT` | `new_appointment_notification` | Template name for new appointment booking |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `en` | Approved template language code (e.g. `en` or `en_US`) |
| `WHATSAPP_DEFAULT_COUNTRY_CODE` | `91` | Country code prepended to 10-digit local numbers |
| `WHATSAPP_TIMEOUT_SECONDS` | `15` | HTTP timeout in seconds for Meta Graph API requests |

## 3. Creating & Approving Templates in Meta WhatsApp Manager

Business-initiated messages outside the 24-hour customer-service window **require pre-approved Meta templates**. Templates are **not** automatically approved.

1. Open **Meta Business Suite / WhatsApp Manager** -> **Account Tools** -> **Message Templates**.
2. Select the **Kuzhivelil Dental Care** WhatsApp Business Account (`2187192222184438`).
3. Click **Create Template** -> Category: **Utility** -> Language: **English (`en`)** (must match `WHATSAPP_TEMPLATE_LANGUAGE`).

### Template 1: `new_patient_notification`

- **Name**: `new_patient_notification`
- **Category**: `Utility`
- **Language**: `en` (or match `WHATSAPP_TEMPLATE_LANGUAGE`)
- **Body**:

```text
NEW PATIENT REGISTERED

Kuzhivelil Dental Care

A new patient has been registered in the clinic system.

Patient Name: {{1}}
Registration Number: {{2}}
Phone Number: {{3}}

Please check the clinic dashboard for patient details.
```

- **Sample Values for Meta Review**:
  - `{{1}}`: `Rahul Menon`
  - `{{2}}`: `KDC-1042`
  - `{{3}}`: `9876543210`

### Template 2: `new_appointment_notification`

- **Name**: `new_appointment_notification`
- **Category**: `Utility`
- **Language**: `en` (or match `WHATSAPP_TEMPLATE_LANGUAGE`)
- **Body**:

```text
NEW APPOINTMENT BOOKED

Kuzhivelil Dental Care

A new appointment has been booked.

Patient Name: {{1}}
Registration Number: {{2}}
Appointment Date: {{3}}
Appointment Time: {{4}}
Patient Phone: {{5}}

Please check the clinic dashboard for further details.
```

- **Sample Values for Meta Review**:
  - `{{1}}`: `Rahul Menon`
  - `{{2}}`: `KDC-1042`
  - `{{3}}`: `26 Nov 2026`
  - `{{4}}`: `10:30 AM`
  - `{{5}}`: `9876543210`

4. Submit both templates and wait until their status is **Active - Quality Pending / Approved** before expecting live delivery.

## 4. Security & Token Best Practices

- Never store `WHATSAPP_ACCESS_TOKEN` in `frontend/`, git commits, or source code.
- Use a **permanent System User token** from Meta Business Settings (temporary 24-hour tokens will expire in production).
- Notification attempts (without secrets) are recorded in MongoDB collection `whatsapp_notifications` for audit and duplicate-prevention.
