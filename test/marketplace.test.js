const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateTripEconomics, rankLoads, canAssignLoad } = require("../src/marketplace");

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
