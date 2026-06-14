#!/bin/bash
set -e

cd /opt/sms-backend

mkdir -p data

cat > config/gateways.json << 'EOF'
{
  "GP": { "trustedSenders": ["01714054239", "+8801714054239"] },
  "ROBI": { "trustedSenders": ["01833122144", "+8801833122144"] },
  "BANGLALINK": { "trustedSenders": ["01924400990", "+8801924400990"] }
}
EOF

cat > config/auth.json << 'EOF'
{
  "adminApiKey": "@Alpha4$88_poL#",
  "requireGatewayAuth": false,
  "denyUnknownRequesters": false
}
EOF

cat > config/telegram.json << 'EOF'
{
  "botToken": "8897548815:AAHHVs-0c4-UkJ6J9t3WHacPziWwfx3ff0U",
  "groupChatId": -1004316326579,
  "backendUrl": "http://localhost:3000",
  "adminApiKey": "@Alpha4$88_poL#",
  "pollPostIntervalMs": 3000,
  "autoApprove": true,
  "ackOnIntake": true,
  "replyToUnauthorized": true,
  "testDestination": "",
  "authorizedUsers": {}
}
EOF

# Start backend with PM2
pm2 start src/server.js --name sms-backend
pm2 start telegram-bridge/start.js --name sms-bridge

# Save PM2 config so it restarts on reboot
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash

echo ""
echo "============================="
echo " Deployment complete!"
echo " Backend:  http://45.77.240.195:3000"
echo "============================="
