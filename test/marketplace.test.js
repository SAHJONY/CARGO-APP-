const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateTripEconomics, rankLoads, canAssignLoad } = require("../src/marketplace");
const { createMemoryStore } = require("../src/workflow");

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
