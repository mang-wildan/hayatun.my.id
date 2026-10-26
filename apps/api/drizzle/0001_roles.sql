-- Role aplikasi (hayatun_app) dibuat di luar migrasi, lihat ops/postgres-init.sql.
-- Tabel baru otomatis dapat hak dasar; audit_logs tidak boleh diubah, dihapus, atau dikosongkan (SPEC F15.4).
GRANT USAGE ON SCHEMA public TO hayatun_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hayatun_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO hayatun_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hayatun_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hayatun_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM hayatun_app;
