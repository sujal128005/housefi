-- Housefi reference schema (PostgreSQL 16 + PostGIS). A starting point for Prisma models / migrations.
-- Money is stored in PAISE (bigint); the API speaks whole rupees. Timestamps are timestamptz; the API sends epoch ms.
-- Columns ending in _enc hold AES-256-GCM ciphertext (envelope-encrypted with KMS); _hash columns hold HMAC-SHA256.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- enums (mirror src/domain/types.ts) ----------
CREATE TYPE user_role        AS ENUM ('CUSTOMER', 'TECHNICIAN', 'COORDINATOR', 'ADMIN');
CREATE TYPE user_status      AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');
CREATE TYPE locale           AS ENUM ('en', 'te');
CREATE TYPE category_id      AS ENUM ('PLUMBING', 'ELECTRICAL', 'AC', 'APPLIANCE', 'CLEANING', 'CARPENTRY');
CREATE TYPE address_label    AS ENUM ('HOME', 'WORK', 'OTHER');
CREATE TYPE booking_mode     AS ENUM ('INSTANT', 'SCHEDULED');
CREATE TYPE booking_status   AS ENUM ('AWAITING_PAYMENT', 'PAYMENT_PENDING', 'MATCHING', 'MATCHING_DELAYED', 'UNFULFILLED', 'ASSIGNED',
  'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'EXTRA_WORK', 'PAYMENT_DUE', 'COMPLETED', 'CLOSED_NO_REPAIR', 'CANCELLED');
CREATE TYPE cancel_reason    AS ENUM ('PLANS_CHANGED', 'FIXED', 'TOO_LONG', 'MISTAKE', 'OTHER', 'UNPAID_EXPIRED', 'UNFULFILLED_EXPIRED');
CREATE TYPE close_reason     AS ENUM ('CUSTOMER_DECLINED', 'CUSTOMER_UNAVAILABLE', 'CANNOT_COMPLETE');
CREATE TYPE gender           AS ENUM ('M', 'F');
CREATE TYPE verification     AS ENUM ('PENDING', 'APPROVED', 'NEEDS_CORRECTION');
CREATE TYPE phone_type       AS ENUM ('SMARTPHONE', 'KEYPAD', 'NONE');
CREATE TYPE offer_state      AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN');
CREATE TYPE offer_channel    AS ENUM ('APP', 'SMS', 'IVR', 'COORDINATOR');
CREATE TYPE offer_reject     AS ENUM ('TOO_FAR', 'BUSY', 'NOT_MY_SKILL', 'OTHER');
CREATE TYPE quote_which      AS ENUM ('MAIN', 'EXTRA');
CREATE TYPE quote_line_kind  AS ENUM ('LABOUR', 'MATERIAL');
CREATE TYPE quote_review     AS ENUM ('CHECKING', 'FAIR', 'UNDER_REVIEW', 'CLEARED');
CREATE TYPE quote_decision   AS ENUM ('PENDING', 'APPROVED', 'REVISION_REQUESTED', 'REJECTED');
CREATE TYPE payment_kind     AS ENUM ('VISIT', 'FINAL');
CREATE TYPE payment_method   AS ENUM ('UPI', 'CARD', 'NETBANKING', 'CASH');
CREATE TYPE payment_state    AS ENUM ('DUE', 'PROCESSING', 'PENDING', 'PAID', 'FAILED', 'REFUNDED');
CREATE TYPE ledger_type      AS ENUM ('VISIT_SHARE', 'LABOUR_SHARE', 'MATERIAL_REIMBURSE', 'CASH_COLLECTED', 'ADJUSTMENT', 'PAYOUT');
CREATE TYPE payout_state     AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED');
CREATE TYPE tech_issue       AS ENUM ('CUSTOMER_UNAVAILABLE', 'WRONG_ADDRESS', 'UNSAFE', 'CANNOT_COMPLETE', 'PAYMENT_PROBLEM', 'OTHER');
CREATE TYPE actor_type       AS ENUM ('CUSTOMER', 'TECHNICIAN', 'COORDINATOR', 'ADMIN', 'SYSTEM');

-- ---------- identity ----------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role          user_role NOT NULL,
  phone_enc     bytea NOT NULL,
  phone_hash    bytea NOT NULL,                 -- HMAC(phone) for lookup
  name_enc      bytea,
  locale        locale NOT NULL DEFAULT 'en',
  status        user_status NOT NULL DEFAULT 'ACTIVE',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (role, phone_hash)                     -- one customer + one technician account per phone
);

CREATE TABLE otp_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash    bytea NOT NULL,
  role          user_role NOT NULL,
  code_hash     bytea NOT NULL,
  attempts      int NOT NULL DEFAULT 0,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON otp_challenges (phone_hash, created_at DESC);

CREATE TABLE refresh_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  family_id     uuid NOT NULL,                  -- rotation family; reuse of a used token revokes the family
  token_hash    bytea NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  revoked_at    timestamptz,
  device        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  push_token    text NOT NULL,
  platform      text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, push_token)
);

-- ---------- catalog (seeded from the app's src/data/catalog.ts) ----------
CREATE TABLE categories (
  id            category_id PRIMARY KEY,
  name_en text NOT NULL, name_te text NOT NULL,
  tagline_en text NOT NULL, tagline_te text NOT NULL,
  art           text NOT NULL,
  sort          int NOT NULL
);

CREATE TABLE services (
  id            text PRIMARY KEY,               -- 'plumb-tap'
  category_id   category_id NOT NULL REFERENCES categories(id),
  name_en text NOT NULL, name_te text NOT NULL,
  description_en text NOT NULL, description_te text NOT NULL,
  visit_fee_paise bigint NOT NULL DEFAULT 4900,
  repair_from_paise bigint NOT NULL,            -- typical minimum (price check)
  repair_typical_max_paise bigint NOT NULL,     -- typical maximum (price check)
  duration_min int NOT NULL, duration_max int NOT NULL,
  keywords      text[] NOT NULL DEFAULT '{}',
  popular       boolean NOT NULL DEFAULT false,
  active        boolean NOT NULL DEFAULT true
);

CREATE TABLE service_issues (
  id            text PRIMARY KEY,               -- 'tap-leak'
  service_id    text NOT NULL REFERENCES services(id),
  name_en text NOT NULL, name_te text NOT NULL
);

-- ---------- customers ----------
CREATE TABLE addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  label         address_label NOT NULL,
  house_enc     bytea NOT NULL,
  street_enc    bytea NOT NULL,
  landmark_enc  bytea,
  locality      text,                           -- coarse area shown in offers (not encrypted)
  city          text NOT NULL,
  pincode       char(6) NOT NULL,
  location      geography(Point, 4326),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX ON addresses (user_id) WHERE deleted_at IS NULL;

-- ---------- technicians ----------
CREATE TABLE technicians (
  user_id          uuid PRIMARY KEY REFERENCES users(id),
  gender           gender NOT NULL,
  experience_years int NOT NULL CHECK (experience_years BETWEEN 0 AND 50),
  city             text NOT NULL,
  pincode          char(6) NOT NULL,
  areas            text NOT NULL,
  vehicle          text NOT NULL DEFAULT '',
  phone_type       phone_type NOT NULL DEFAULT 'SMARTPHONE',
  coordinator_id   uuid REFERENCES users(id),
  verification     verification,                -- NULL = profile not submitted
  correction_note_en text, correction_note_te text,
  online           boolean NOT NULL DEFAULT false,
  missed_offers_in_row int NOT NULL DEFAULT 0,
  rating_avg       numeric(3,2),
  rating_count     int NOT NULL DEFAULT 0,
  women_rated      boolean NOT NULL DEFAULT false,
  jobs_done        int NOT NULL DEFAULT 0,
  last_location    geography(Point, 4326),
  last_location_at timestamptz,
  submitted_at     timestamptz,
  verified_at      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON technicians (pincode) WHERE online AND verification = 'APPROVED';
CREATE INDEX ON technicians USING gist (last_location);

CREATE TABLE technician_skills (
  technician_id uuid NOT NULL REFERENCES technicians(user_id),
  category_id   category_id NOT NULL,
  PRIMARY KEY (technician_id, category_id)
);

CREATE TABLE service_area_pincodes (            -- which PINs neighbour which (dispatch v1)
  pincode       char(6) NOT NULL,
  near_pincode  char(6) NOT NULL,
  PRIMARY KEY (pincode, near_pincode)
);

-- ---------- bookings ----------
CREATE TABLE bookings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,         -- 'HF-12345'
  customer_id      uuid NOT NULL REFERENCES users(id),
  service_id       text NOT NULL REFERENCES services(id),
  category_id      category_id NOT NULL,
  address_snapshot_enc bytea NOT NULL,          -- full address at booking time (encrypted JSON)
  locality         text NOT NULL,               -- shown to offered technicians
  city             text NOT NULL,
  pincode          char(6) NOT NULL,
  location         geography(Point, 4326),
  issue_ids        text[] NOT NULL DEFAULT '{}',
  notes            text NOT NULL DEFAULT '',
  voice_transcript text,
  voice_object_key text,
  voice_duration_sec int,
  time_mode        booking_mode NOT NULL,
  window_date      date,
  window_start_hour smallint,
  window_end_hour  smallint,
  prefer_women_rated boolean NOT NULL DEFAULT false,
  status           booking_status NOT NULL,
  technician_id    uuid REFERENCES technicians(user_id),
  arrival_code_enc bytea NOT NULL,              -- 4 digits; customer sees it, technician types it
  start_code_attempts int NOT NULL DEFAULT 0,
  eta_min          int,
  work_started     boolean NOT NULL DEFAULT false,
  cancel_reason    cancel_reason,
  close_reason     close_reason,
  idempotency_key  text,
  version          int NOT NULL DEFAULT 0,      -- optimistic locking
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((time_mode = 'INSTANT' AND window_date IS NULL) OR (time_mode = 'SCHEDULED' AND window_date IS NOT NULL)),
  UNIQUE (customer_id, idempotency_key)
);
CREATE INDEX ON bookings (customer_id, created_at DESC);
CREATE INDEX ON bookings (technician_id, status);
CREATE INDEX ON bookings (status, window_date);

CREATE TABLE booking_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid REFERENCES bookings(id),   -- NULL until attached to a booking
  owner_id      uuid NOT NULL REFERENCES users(id),
  object_key    text NOT NULL,
  content_type  text NOT NULL,
  bytes         int NOT NULL,
  stage         text NOT NULL DEFAULT 'PROBLEM' CHECK (stage IN ('PROBLEM', 'INSPECTION', 'COMPLETION')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE booking_events (                   -- timeline + audit of every status change
  id            bigserial PRIMARY KEY,
  booking_id    uuid NOT NULL REFERENCES bookings(id),
  status        booking_status NOT NULL,
  actor_type    actor_type NOT NULL,
  actor_id      uuid,
  meta          jsonb NOT NULL DEFAULT '{}',
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON booking_events (booking_id, at);

CREATE TABLE job_offers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id),
  technician_id uuid NOT NULL REFERENCES technicians(user_id),
  state         offer_state NOT NULL DEFAULT 'OPEN',
  channel       offer_channel NOT NULL DEFAULT 'APP',
  reject_reason offer_reject,
  distance_m    int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  responded_at  timestamptz
);
CREATE UNIQUE INDEX one_open_offer_per_booking ON job_offers (booking_id) WHERE state = 'OPEN';
CREATE UNIQUE INDEX one_open_offer_per_tech ON job_offers (technician_id) WHERE state = 'OPEN';

-- ---------- quotes ----------
CREATE TABLE quotes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id),
  which         quote_which NOT NULL,
  version       int NOT NULL,
  diagnosis     text NOT NULL,
  labour_paise  bigint NOT NULL,
  material_paise bigint NOT NULL,
  total_paise   bigint NOT NULL CHECK (total_paise >= 10000),   -- minimum ₹100
  review        quote_review NOT NULL DEFAULT 'CHECKING',
  typical_min_paise bigint NOT NULL,
  typical_max_paise bigint NOT NULL,
  decision      quote_decision NOT NULL DEFAULT 'PENDING',
  created_by    uuid NOT NULL REFERENCES users(id),
  reviewed_by   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  superseded    boolean NOT NULL DEFAULT false,
  UNIQUE (booking_id, which, version)
);

CREATE TABLE quote_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id      uuid NOT NULL REFERENCES quotes(id),
  kind          quote_line_kind NOT NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  qty           int NOT NULL CHECK (qty BETWEEN 1 AND 99),
  unit_paise    bigint NOT NULL CHECK (unit_paise > 0),
  sort          int NOT NULL
);

-- ---------- payments ----------
CREATE TABLE payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id),
  kind          payment_kind NOT NULL,
  amount_paise  bigint NOT NULL,
  state         payment_state NOT NULL DEFAULT 'DUE',
  method        payment_method,
  provider      text,                           -- 'RAZORPAY' | 'CASH'
  provider_order_id   text UNIQUE,
  provider_payment_id text UNIQUE,
  provider_refund_id  text,
  idempotency_key text,
  failure_code  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON payments (booking_id, kind);

CREATE TABLE payment_webhook_events (           -- store raw events once (dedupe by provider event id)
  provider_event_id text PRIMARY KEY,
  payload       jsonb NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz
);

-- ---------- ratings ----------
CREATE TABLE ratings (
  booking_id    uuid PRIMARY KEY REFERENCES bookings(id),
  customer_id   uuid NOT NULL REFERENCES users(id),
  technician_id uuid REFERENCES technicians(user_id),
  satisfied     boolean NOT NULL,
  stars         smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags          text[] NOT NULL DEFAULT '{}',
  comment       text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- earnings ----------
CREATE TABLE payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id uuid NOT NULL REFERENCES technicians(user_id),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  amount_paise  bigint NOT NULL,
  state         payout_state NOT NULL DEFAULT 'PENDING',
  provider_ref  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE earnings_ledger (                  -- append-only; credits positive, debits negative
  id            bigserial PRIMARY KEY,
  technician_id uuid NOT NULL REFERENCES technicians(user_id),
  booking_id    uuid REFERENCES bookings(id),
  type          ledger_type NOT NULL,
  amount_paise  bigint NOT NULL,
  payout_id     uuid REFERENCES payouts(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON earnings_ledger (technician_id, created_at DESC);

-- ---------- notifications, support, audit ----------
CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  kind          text NOT NULL,                  -- NotificationKind
  booking_id    uuid REFERENCES bookings(id),
  params        jsonb NOT NULL DEFAULT '{}',
  read_at       timestamptz,
  pushed_at     timestamptz,
  sms_at        timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notifications (user_id, created_at DESC);

CREATE TABLE support_tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid REFERENCES bookings(id),
  raised_by     uuid NOT NULL REFERENCES users(id),
  kind          text NOT NULL,                  -- tech_issue values, 'UNSAFE', 'CALLBACK', 'PAYMENT_PROBLEM'
  note          text NOT NULL DEFAULT '',
  state         text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  priority      text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'HIGH', 'URGENT')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  actor_type    actor_type NOT NULL,
  actor_id      uuid,
  action        text NOT NULL,                  -- 'booking.cancel', 'tech.verify', 'coordinator.assign', ...
  entity        text NOT NULL,
  entity_id     text NOT NULL,
  before        jsonb,
  after         jsonb,
  ip            inet,
  request_id    text,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (entity, entity_id, at);

CREATE TABLE ai_chat_messages (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id),
  conversation_id uuid NOT NULL,
  role          text NOT NULL CHECK (role IN ('user', 'assistant')),
  text          text NOT NULL,
  offer_human   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
