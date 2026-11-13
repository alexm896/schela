-- SSH, 80/tcp and 443/tcp are base rules now: schela-apply always holds them
-- and the firewall page lists them read-only. Drop the rows seeded for them on
-- first boot (and copies added by hand), so no switch or delete in the panel
-- pretends to control them. SSH stays open on the port from the settings and
-- on every port sshd uses.
delete from firewall_rules
where direction = 'in'
  and action = 'allow'
  and protocol = 'tcp'
  and source = 'any'
  and port in ('22', '80', '443');
