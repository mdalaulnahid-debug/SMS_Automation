'use strict';

const os = require('node:os');

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const results = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) continue;
    if (/loopback/i.test(name)) continue;

    for (const entry of entries) {
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      if (entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      if (/nord|tailscale|openvpn|vpn|wsl|hyper-v/i.test(name)) continue;

      results.push({
        address: entry.address,
        interface: name,
        preferred: /wi-?fi|wlan|ethernet/i.test(name) && entry.address.startsWith('192.168.')
      });
    }
  }

  results.sort((a, b) => Number(b.preferred) - Number(a.preferred));
  return results;
}

function getPreferredLanIp() {
  const addresses = getLanAddresses();
  return addresses[0]?.address || null;
}

function getBackendUrls(port = 3000) {
  const addresses = getLanAddresses();
  const unique = [...new Set(addresses.map((entry) => entry.address))];
  return unique.map((address) => `http://${address}:${port}`);
}

module.exports = {
  getLanAddresses,
  getPreferredLanIp,
  getBackendUrls
};
