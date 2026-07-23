"use strict";

const REQUIRED_PRODUCTION_CONTROLS = [
  ["identityProvider", "IDENTITY_PROVIDER_CONFIGURED"],
  ["postgres", "POSTGRES_CONFIGURED"],
  ["objectStorage", "OBJECT_STORAGE_CONFIGURED"],
  ["malwareScanner", "MALWARE_SCANNER_CONFIGURED"],
  ["paymentProcessor", "PAYMENT_PROCESSOR_CONFIGURED"],
  ["truckRouting", "TRUCK_ROUTING_CONFIGURED"]
];

function productionReadiness(env = process.env) {
  const controls = Object.fromEntries(REQUIRED_PRODUCTION_CONTROLS.map(([name, variable]) => [
    name,
    env[variable] === "true"
  ]));
  const missing = Object.entries(controls).filter(([, ready]) => !ready).map(([name]) => name);
  return { ready: missing.length === 0, controls, missing };
}

module.exports = { productionReadiness, REQUIRED_PRODUCTION_CONTROLS };
