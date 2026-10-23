#!/usr/bin/env bash
# Devuelve parcero_load al estado sembrado (borra lo que crearon las pruebas; no toca otras BD).
docker exec -i hackatonbogota-db-1 psql -U parcero -d parcero_load -q <<'SQL'
DELETE FROM posts WHERE user_id IN (SELECT id FROM users WHERE is_demo = false);
DELETE FROM cases WHERE user_id IN (SELECT id FROM users WHERE is_demo = false);
DELETE FROM credit_ledger WHERE reason <> 'seed';
UPDATE credit_accounts a SET balance = CASE WHEN u.phone LIKE '5739%' THEN 10 ELSE 100000 END FROM users u WHERE u.id = a.user_id AND u.is_demo = false AND a.balance <> CASE WHEN u.phone LIKE '5739%' THEN 10 ELSE 100000 END;
TRUNCATE rate_limits;
VACUUM ANALYZE;
SQL
