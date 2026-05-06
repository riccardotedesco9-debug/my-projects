# Smoke-test the MeetSync /internal/alert relay.
# Pulls INTERNAL_ALERT_SECRET from 1Password (vault: AI-Stack), POSTs a
# test alert; expect a Telegram ping seconds later.

$secret = op read "op://AI-Stack/internal-alert/secret"
$url = "https://meetsync-worker.riccardotedesco9.workers.dev/internal/alert"
$body = '{"label":"smoke-test","message":"hi from terminal"}'

Invoke-RestMethod -Method POST -Uri $url `
  -Headers @{Authorization = "Bearer $secret"} `
  -ContentType "application/json" `
  -Body $body
