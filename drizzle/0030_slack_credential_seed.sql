INSERT INTO `orbit_slack_credentials` (`token_hash`, `owner_id`, `workspace_id`, `requester_id`, `scope`, `expires_at`, `revoked`)
SELECT '21651554c968011d5bff50896fd28f3f7720c9d0d2e0ff08e0022dc7b240e6ae', `owner_id`, 'T0B2WRN9MHA', 'U0B2R5WL206', 'directives:write', 1861919999000, 0
FROM `orbit_workspaces`
WHERE NOT EXISTS (SELECT 1 FROM `orbit_slack_credentials` WHERE `token_hash` = '21651554c968011d5bff50896fd28f3f7720c9d0d2e0ff08e0022dc7b240e6ae')
ORDER BY `updated_at` DESC
LIMIT 1;
