"use strict";

function assertNumber(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a non-negative number`);
}

function calculateTripEconomics(input) {
  const fields = ["distanceKm", "deadheadKm", "rate", "fuelPricePerLiter", "fuelKmPerLiter", "tolls", "driverCost", "otherCosts"];
  fields.forEach(field => assertNumber(input[field], field));
  if (input.fuelKmPerLiter === 0) throw new RangeError("fuelKmPerLiter must be greater than zero");
  const totalKm = input.distanceKm + input.deadheadKm;
  const fuelCost = (totalKm / input.fuelKmPerLiter) * input.fuelPricePerLiter;
  const totalCost = fuelCost + input.tolls + input.driverCost + input.otherCosts;
  const netProfit = input.rate - totalCost;
  return {
    totalKm: round(totalKm),
    fuelCost: round(fuelCost),
    totalCost: round(totalCost),
    netProfit: round(netProfit),
    profitMargin: input.rate ? round((netProfit / input.rate) * 100) : 0,
    ratePerLoadedKm: input.distanceKm ? round(input.rate / input.distanceKm) : 0
  };
}

function rankLoads(loads) {
  return [...loads]
    .filter(load => load.verified && load.economics.netProfit > 0)
    .sort((a, b) => b.economics.netProfit - a.economics.netProfit);
}

function canAssignLoad({ identityVerified, authorityVerified, insuranceValid, sanctionsClear }) {
  return [identityVerified, authorityVerified, insuranceValid, sanctionsClear].every(Boolean);
}

function round(number) {
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

module.exports = { calculateTripEconomics, rankLoads, canAssignLoad };
