#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

function usage() {
  console.log("Usage: node scripts/provision-device.js --mission <path> --device <id> --role <SOS|DRIVER|DISPATCH|RELAY> --public <base64>");
  process.exit(1);
}

const args = process.argv.slice(2);
const get = (flag) => {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx + 1 >= args.length) return null;
  return args[idx + 1];
};

const mission = get("--mission");
const device = get("--device");
const role = get("--role") || "DRIVER";
const pub = get("--public");

if (!mission || !device || !pub) usage();

if (!fs.existsSync(mission)) {
  console.error(`Mission file not found: ${mission}`);
  process.exit(2);
}

const json = JSON.parse(fs.readFileSync(mission, "utf8"));
json.trustedDevices = Array.isArray(json.trustedDevices) ? json.trustedDevices : [];

const existing = json.trustedDevices.find((d) => d.deviceId === device);
if (existing) {
  existing.role = role;
  existing.publicKeyBase64 = pub;
} else {
  json.trustedDevices.push({
    deviceId: device,
    role,
    publicKeyBase64: pub
  });
}

fs.writeFileSync(mission, JSON.stringify(json, null, 2));
console.log(`Provisioned device ${device} in ${path.resolve(mission)}`);