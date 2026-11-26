# Meta WhatsApp Cloud API Setup & Deployment Guide (Kuzhivelil Dental Care)

## 1. Architecture & Hosting Overview

- **Frontend**: React + Vite hosted on **Vercel** (`https://kuzhivelil-dental-care.vercel.app`)
- **Backend**: Python Flask (`backend/app.py`) hosted on **Render** (`https://kuzhivelil-dental-care-1.onrender.com`, configured in `frontend/.env.production`, served via `gunicorn`)
  - All `WHATSAPP_*` secrets live strictly in the **Flask backend environment (Render / `backend/.env`)**, never in Vercel frontend JS.
  - **Security reminder**: If an access token was ever pasted into chat, logs, or source code, generate a fresh permanent System User token in Meta Business Settings before production deployment.

## 2. Recipient Rules

- **Patient Notifications** (patient's registered phone number):
  1. `new_patient_notification` (New patient registration)
  2. `new_appointment_notification` (New appointment booking)
  3. `clinic_announcement` (General clinic announcements to selected/all opted-in patients)
  4. `appointment_reminder_5hrs` (Automatic reminder 5 hours before appointment in `Asia/Kolkata`)
  5. `appointment_cancellation` (Immediate notification when receptionist cancels an appointment)

## 3. Required Backend Environment Variables

| Variable | Value / Example | Purpose |
| --- | --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | *(secret)* | Meta System User permanent token |
| `WHATSAPP_PHONE_NUMBER_ID` | `1492317537289190` | Registered Meta WhatsApp Phone Number ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | `2187192222184438` | Meta WABA ID |
| `WHATSAPP_ADMIN_PHONE` | `91XXXXXXXXXX` | Fixed clinic/admin WhatsApp number for Features 1 & 2 |
| `WHATSAPP_API_VERSION` | `v23.0` | Meta Graph API version |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `en` | Language code matching approved Meta templates |
| `WHATSAPP_PATIENT_TEMPLATE` | `new_patient_notification` | Feature 1 template name |
| `WHATSAPP_APPOINTMENT_TEMPLATE` | `new_appointment_notification` | Feature 2 template name |
| `WHATSAPP_ANNOUNCEMENT_TEMPLATE` | `clinic_announcement` | Feature 3 template name |
| `WHATSAPP_REMINDER_TEMPLATE` | `appointment_reminder_5hrs` | Feature 4 template name |
| `WHATSAPP_CANCELLATION_TEMPLATE` | `appointment_cancellation` | Feature 5 template name |
| `WHATSAPP_DEFAULT_DOCTOR_NAME` | `Dr. Kuzhivelil` | Default doctor name for `{{4}}` in 5-hour reminders |
| `WHATSAPP_SCHEDULER_ENABLED` | `true` | Enable in-process background reminder polling |
| `WHATSAPP_SCHEDULER_INTERVAL_SECONDS` | `60` | Poll interval in seconds |
| `WHATSAPP_CRON_SECRET` | *(optional secret)* | Protects `/api/reminders/run` for external cron triggers |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | *(secret)* | Token used by Meta webhook verification (`GET /api/webhooks/whatsapp`) |
| `WHATSAPP_APP_SECRET` | *(optional secret)* | Enables `X-Hub-Signature-256` verification on `POST /api/webhooks/whatsapp` |

## 4. Meta WhatsApp Manager Templates (Must Be Approved Before Live Use)

Create these 5 templates in **Meta Business Suite → WhatsApp Manager → Message Templates** under WABA `2187192222184438` with language `en` (or match `WHATSAPP_TEMPLATE_LANGUAGE`):

1. **`new_patient_notification`** (Category: **Utility**, 3 params -> Clinic Admin):
   - `{{1}}` Patient Name, `{{2}}` Registration Number, `{{3}}` Patient Phone Number
2. **`new_appointment_notification`** (Category: **Utility**, 5 params -> Clinic Admin):
   - `{{1}}` Patient Name, `{{2}}` Registration Number, `{{3}}` Appointment Date, `{{4}}` Appointment Time, `{{5}}` Patient Phone Number
3. **`clinic_announcement`** (Category: **Marketing**, 3 params -> Opted-in Patients):
   - `{{1}}` Closure/Effective Date, `{{2}}` Reason / Details, `{{3}}` Reopening Date
4. **`appointment_reminder_5hrs`** (Category: **Utility**, 4 params -> Patient):
   - `{{1}}` Patient Name, `{{2}}` Appointment Date, `{{3}}` Appointment Time, `{{4}}` Doctor Name
5. **`appointment_cancellation`** (Category: **Utility**, 3 params -> Patient):
   - `{{1}}` Patient Name, `{{2}}` Appointment Date, `{{3}}` Appointment Time

## 5. Background 5-Hour Reminder Scheduler & Free Hosting Note

- Reminders are persisted in MongoDB collection `appointment_reminders` in UTC derived from `Asia/Kolkata` (`appointment_at - 5 hours`), surviving server restarts.
- An in-process background daemon (`ReminderScheduler`) polls MongoDB every 60s whenever the Flask service is awake.
- **Important for Render Free Tier**: Render free web services spin down after ~15 minutes of inactivity. To guarantee 5-hour reminders fire even when no receptionist is using the dashboard, set `WHATSAPP_CRON_SECRET` and configure an external cron (e.g., Render Cron Job or cron-job.org every 5 minutes) to call:
  `GET https://kuzhivelil-dental-care-1.onrender.com/api/reminders/run?secret=<WHATSAPP_CRON_SECRET>`

## 6. Meta Webhook Setup (Delivery/Read/Failure Tracking)

- Callback URL: `https://kuzhivelil-dental-care-1.onrender.com/api/webhooks/whatsapp`
- Verify Token: match `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- Subscribe to the **`messages`** webhook field so `whatsapp_notifications` updates `delivery_status` (`sent` -> `delivered` -> `read` / `failed`).
