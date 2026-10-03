-- A browser OAuth callback proposes a connection; only the initiating signed-in
-- native account may finalize it using the separate returned completion code.
alter table native_auth_codes add column pending_google_connection jsonb;
alter table native_auth_codes add constraint native_auth_codes_pending_google_object
  check (pending_google_connection is null or jsonb_typeof(pending_google_connection) = 'object');
