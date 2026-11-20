#!/bin/sh
set -eu

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=identity_password="$IDENTITY_DB_PASSWORD" \
  --set=catalog_password="$CATALOG_DB_PASSWORD" \
  --set=media_password="$MEDIA_DB_PASSWORD" \
  --set=distribution_password="$DISTRIBUTION_DB_PASSWORD" \
  --set=finance_password="$FINANCE_DB_PASSWORD" \
  --set=notification_password="$NOTIFICATION_DB_PASSWORD" \
  --set=analytics_password="$ANALYTICS_DB_PASSWORD" \
  --set=audit_password="$AUDIT_DB_PASSWORD" <<'SQL'
\set ON_ERROR_STOP on

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'identity_service') THEN
    CREATE ROLE identity_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 30;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_service') THEN
    CREATE ROLE catalog_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 30;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'media_service') THEN
    CREATE ROLE media_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 30;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'distribution_service') THEN
    CREATE ROLE distribution_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 30;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_service') THEN
    CREATE ROLE finance_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 30;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_service') THEN
    CREATE ROLE notification_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 30;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_service') THEN
    CREATE ROLE analytics_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 30;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_service') THEN
    CREATE ROLE audit_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 30;
  END IF;
END
$roles$;

ALTER ROLE identity_service PASSWORD :'identity_password';
ALTER ROLE catalog_service PASSWORD :'catalog_password';
ALTER ROLE media_service PASSWORD :'media_password';
ALTER ROLE distribution_service PASSWORD :'distribution_password';
ALTER ROLE finance_service PASSWORD :'finance_password';
ALTER ROLE notification_service PASSWORD :'notification_password';
ALTER ROLE analytics_service PASSWORD :'analytics_password';
ALTER ROLE audit_service PASSWORD :'audit_password';

SELECT 'CREATE DATABASE bealpha_identity OWNER identity_service CONNECTION LIMIT 40'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'bealpha_identity')\gexec
SELECT 'CREATE DATABASE bealpha_catalog OWNER catalog_service CONNECTION LIMIT 40'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'bealpha_catalog')\gexec
SELECT 'CREATE DATABASE bealpha_media OWNER media_service CONNECTION LIMIT 40'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'bealpha_media')\gexec
SELECT 'CREATE DATABASE bealpha_distribution OWNER distribution_service CONNECTION LIMIT 40'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'bealpha_distribution')\gexec
SELECT 'CREATE DATABASE bealpha_finance OWNER finance_service CONNECTION LIMIT 40'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'bealpha_finance')\gexec
SELECT 'CREATE DATABASE bealpha_notifications OWNER notification_service CONNECTION LIMIT 40'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'bealpha_notifications')\gexec
SELECT 'CREATE DATABASE bealpha_analytics OWNER analytics_service CONNECTION LIMIT 40'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'bealpha_analytics')\gexec
SELECT 'CREATE DATABASE bealpha_audit OWNER audit_service CONNECTION LIMIT 40'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'bealpha_audit')\gexec

REVOKE CONNECT ON DATABASE bealpha_identity FROM PUBLIC;
REVOKE CONNECT ON DATABASE bealpha_catalog FROM PUBLIC;
REVOKE CONNECT ON DATABASE bealpha_media FROM PUBLIC;
REVOKE CONNECT ON DATABASE bealpha_distribution FROM PUBLIC;
REVOKE CONNECT ON DATABASE bealpha_finance FROM PUBLIC;
REVOKE CONNECT ON DATABASE bealpha_notifications FROM PUBLIC;
REVOKE CONNECT ON DATABASE bealpha_analytics FROM PUBLIC;
REVOKE CONNECT ON DATABASE bealpha_audit FROM PUBLIC;

GRANT CONNECT ON DATABASE bealpha_identity TO identity_service;
GRANT CONNECT ON DATABASE bealpha_catalog TO catalog_service;
GRANT CONNECT ON DATABASE bealpha_media TO media_service;
GRANT CONNECT ON DATABASE bealpha_distribution TO distribution_service;
GRANT CONNECT ON DATABASE bealpha_finance TO finance_service;
GRANT CONNECT ON DATABASE bealpha_notifications TO notification_service;
GRANT CONNECT ON DATABASE bealpha_analytics TO analytics_service;
GRANT CONNECT ON DATABASE bealpha_audit TO audit_service;
SQL
