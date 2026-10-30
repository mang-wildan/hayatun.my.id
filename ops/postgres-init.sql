-- Dijalankan sekali oleh superuser PostgreSQL (lokal, CI, dan server).
-- hayatun_migrate memiliki tabel dan menjalankan migrasi; hayatun_app dipakai aplikasi dengan hak terbatas.
-- Ganti kata sandi 'hayatun' di server produksi.
CREATE ROLE hayatun_migrate LOGIN PASSWORD 'hayatun';
CREATE ROLE hayatun_app LOGIN PASSWORD 'hayatun';
CREATE DATABASE hayatun OWNER hayatun_migrate;
CREATE DATABASE hayatun_test OWNER hayatun_migrate;
-- Dua database tambahan hanya untuk tes cadangan dan pulih (ops/backup.test.ts): sumber dan tujuan pemulihan.
CREATE DATABASE hayatun_backup_test OWNER hayatun_migrate;
CREATE DATABASE hayatun_restore_test OWNER hayatun_migrate;
