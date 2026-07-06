-- viota D1 — migration 0002: coarse geo columns on `accounts`.
--
-- WHY: `handleAuthQuick` (src/d1/accounts.ts) INSERTs country/region/timezone
-- (coarse, IP-derived from request.cf at signup — no GPS, no permission prompt).
-- Migration 0001 predates that feature, so a database created from 0001 ALONE
-- lacks these three columns and EVERY `/auth/quick` INSERT throws
-- ("table accounts has no column named country") -> the whole online game is
-- unplayable. This forward migration adds them.
--
-- Note: `schema/d1.sql` (the one-shot full schema) and `src/d1/schema.ts` (the
-- test/miniflare schema) already declare these columns, so fresh test and
-- one-shot-execute setups are unaffected — only the incremental migration path
-- (and the production DB provisioned by it) needed this.
--
-- ADD COLUMN is nullable with no default (existing rows read NULL); non-blocking
-- and non-destructive. Every column matches the TEXT type the code binds.

ALTER TABLE accounts ADD COLUMN country TEXT;
ALTER TABLE accounts ADD COLUMN region TEXT;
ALTER TABLE accounts ADD COLUMN timezone TEXT;
