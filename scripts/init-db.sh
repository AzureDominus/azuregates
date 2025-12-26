#!/bin/bash
# Initialize additional databases for AzureGates
# This script is run by Postgres on first startup

set -e

# Create the authentik database if it doesn't exist
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE authentik'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'authentik')\gexec
EOSQL

echo "Database initialization complete"
