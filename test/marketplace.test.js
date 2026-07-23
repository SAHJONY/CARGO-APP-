const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateTripEconomics, rankLoads, canAssignLoad } = require("../src/marketplace");
const { createMemoryStore } = require("../src/workflow");
const { createSession, verifySession } = require("../src/auth");

test("calculates transparent trip economics", () => {
  const result = calculateTripEconomics({
    distanceKm: 1000, deadheadKm: 100, rate: 3000,
    fuelPricePerLiter: 1.2, fuelKmPerLiter: 2.5,
    tolls: 100, driverCost: 500, otherCosts: 100
  });
  assert.equal(result.fuelCost, 528);
  assert.equal(result.netProfit, 1772);
  assert.equal(result.profitMargin, 59.07);
});

test("ranks only verified and profitable loads", () => {
  const ranked = rankLoads([
    { id: "low", verified: true, economics: { netProfit: 100 } },
    { id: "high", verified: true, economics: { netProfit: 500 } },
    { id: "unsafe", verified: false, economics: { netProfit: 900 } }
  ]);
  assert.deepEqual(ranked.map(load => load.id), ["high", "low"]);
});

test("fails closed when a compliance gate is missing", () => {
  assert.equal(canAssignLoad({ identityVerified: true, authorityVerified: true, insuranceValid: false, sanctionsClear: true }), false);
  assert.equal(canAssignLoad({ identityVerified: true, authorityVerified: true, insuranceValid: true, sanctionsClear: true }), true);
});

test("supports direct shipper-to-carrier bidding", () => {
  const store = createMemoryStore();
  const shipper = store.onboardCompany({ legalName: "Global Foods", countryCode: "US", role: "shipper" });
  const carrier = store.onboardCompany({ legalName: "Road One", countryCode: "CA", role: "carrier" });
  const load = store.postLoad({
    origin: "Chicago, US", destination: "Toronto, CA", distanceKm: 837,
    rate: 2450, currency: "USD", equipment: "Dry Van", pickupAt: "2026-08-01T10:00:00Z"
  }, shipper.id);
  const bid = store.submitBid(load.id, { amount: 2325, currency: "USD", message: "Direct capacity available." }, carrier.id);
  assert.equal(bid.status, "submitted");
  assert.equal(store.listLoads()[0].bids.length, 1);
});

test("requires verified carrier and explicit approval before award", () => {
  const store = createMemoryStore();
  const shipper = store.onboardCompany({ legalName: "Global Foods", countryCode: "US", role: "shipper" });
  const carrier = store.onboardCompany({ legalName: "Road One", countryCode: "CA", role: "carrier" });
  const load = store.postLoad({
    origin: "Chicago, US", destination: "Toronto, CA", distanceKm: 837,
    rate: 2450, currency: "USD", equipment: "Dry Van", pickupAt: "2026-08-01T10:00:00Z"
  }, shipper.id);
  const bid = store.submitBid(load.id, { amount: 2300, currency: "USD" }, carrier.id);
  assert.throws(() => store.acceptBid(load.id, bid.id, shipper.id, "APPROVE"), /verification is incomplete/);
  carrier.verification = { identity: "verified", authority: "verified", insurance: "verified", sanctions: "clear" };
  assert.throws(() => store.acceptBid(load.id, bid.id, shipper.id), /human approval/);
  assert.equal(store.acceptBid(load.id, bid.id, shipper.id, "APPROVE").status, "awarded");
});

test("rejects unauthorized load posting", () => {
  const store = createMemoryStore();
  const carrier = store.onboardCompany({ legalName: "Road One", countryCode: "CA", role: "carrier" });
  assert.throws(() => store.postLoad({ rate: -1 }, carrier.id), /Only an onboarded shipper/);
});

function awardedShipment() {
  const store = createMemoryStore();
  const shipper = store.onboardCompany({ legalName: "Global Foods", countryCode: "US", role: "shipper" });
  const carrier = store.onboardCompany({ legalName: "Road One", countryCode: "CA", role: "carrier" });
  carrier.verification = { identity: "verified", authority: "verified", insurance: "verified", sanctions: "clear" };
  const load = store.postLoad({
    origin: "Chicago, US", destination: "Toronto, CA", distanceKm: 837,
    rate: 2450, currency: "USD", equipment: "Dry Van", pickupAt: "2026-08-01T10:00:00Z"
  }, shipper.id);
  const bid = store.submitBid(load.id, { amount: 2300, currency: "USD" }, carrier.id);
  store.acceptBid(load.id, bid.id, shipper.id, "APPROVE");
  return { store, shipper, carrier, shipment: store.listShipments()[0] };
}

test("signs and verifies expiring actor sessions", () => {
  const secret = "a-secure-test-secret-with-32-characters";
  const token = createSession("ORG-123", secret);
  assert.equal(verifySession(token, secret).sub, "ORG-123");
  assert.throws(() => verifySession(`${token}x`, secret), /Invalid session/);
});

test("enforces shipment parties and ordered transitions", () => {
  const { store, shipper, carrier, shipment } = awardedShipment();
  assert.throws(() => store.transitionShipment(shipment.id, "delivered", carrier.id), /Invalid shipment transition/);
  store.transitionShipment(shipment.id, "dispatched", carrier.id);
  store.transitionShipment(shipment.id, "picked_up", carrier.id);
  store.transitionShipment(shipment.id, "in_transit", carrier.id);
  store.transitionShipment(shipment.id, "delivered", carrier.id);
  assert.throws(() => store.transitionShipment(shipment.id, "pod_approved", shipper.id, "APPROVE"), /Proof of delivery/);
});

test("records tamper-evident POD metadata before shipper approval", () => {
  const { store, shipper, carrier, shipment } = awardedShipment();
  for (const status of ["dispatched", "picked_up", "in_transit", "delivered"]) {
    store.transitionShipment(shipment.id, status, carrier.id);
  }
  store.addDocument(shipment.id, {
    type: "proof_of_delivery",
    fileName: "pod.pdf",
    sha256: "a".repeat(64)
  }, carrier.id);
  assert.equal(store.transitionShipment(shipment.id, "pod_approved", shipper.id, "APPROVE").status, "pod_approved");
});

test("accepts carrier tracking and rejects invalid coordinates", () => {
  const { store, shipper, carrier, shipment } = awardedShipment();
  assert.throws(() => store.addTrackingEvent(shipment.id, { latitude: 91, longitude: 1 }, carrier.id), /latitude/);
  assert.throws(() => store.addTrackingEvent(shipment.id, { latitude: 41, longitude: -87 }, shipper.id), /assigned carrier/);
  assert.equal(store.addTrackingEvent(shipment.id, { latitude: 41.88, longitude: -87.63 }, carrier.id).source, "carrier_device");
});
