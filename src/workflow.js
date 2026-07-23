"use strict";

const crypto = require("node:crypto");
const ROLES = new Set(["shipper", "carrier", "owner_operator", "dispatcher", "driver"]);
const EQUIPMENT = new Set(["Dry Van", "Reefer", "Flatbed", "Container", "Tanker"]);

function requiredString(value, field, max = 160) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim().slice(0, max);
}

function positiveNumber(value, field) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${field} must be greater than zero`);
  return value;
}

function createMemoryStore(seedLoads = []) {
  const state = {
    companies: new Map(),
    loads: new Map(seedLoads.map(load => [load.id, { ...load, bids: [], status: "open" }])),
    audit: []
  };

  function record(action, actorId, targetId, detail = {}) {
    const event = { id: crypto.randomUUID(), action, actorId, targetId, detail, at: new Date().toISOString() };
    state.audit.push(event);
    return event;
  }

  function onboardCompany(input) {
    const role = requiredString(input.role, "role");
    if (!ROLES.has(role)) throw new TypeError("role is not supported");
    const company = {
      id: `ORG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      legalName: requiredString(input.legalName, "legalName"),
      countryCode: requiredString(input.countryCode, "countryCode", 2).toUpperCase(),
      role,
      verification: {
        identity: "pending",
        authority: role === "shipper" ? "not_applicable" : "pending",
        insurance: role === "shipper" ? "not_applicable" : "pending",
        sanctions: "pending"
      },
      createdAt: new Date().toISOString()
    };
    state.companies.set(company.id, company);
    record("company.onboarded", company.id, company.id);
    return company;
  }

  function postLoad(input, actorId) {
    const actor = state.companies.get(actorId);
    if (!actor || actor.role !== "shipper") throw new Error("Only an onboarded shipper can post a load");
    const equipment = requiredString(input.equipment, "equipment");
    if (!EQUIPMENT.has(equipment)) throw new TypeError("equipment is not supported");
    const load = {
      id: `CTA-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      shipperId: actorId,
      origin: requiredString(input.origin, "origin"),
      destination: requiredString(input.destination, "destination"),
      distanceKm: positiveNumber(input.distanceKm, "distanceKm"),
      rate: positiveNumber(input.rate, "rate"),
      currency: requiredString(input.currency, "currency", 3).toUpperCase(),
      equipment,
      pickupAt: requiredString(input.pickupAt, "pickupAt"),
      status: "open",
      bids: [],
      assignment: null,
      createdAt: new Date().toISOString()
    };
    state.loads.set(load.id, load);
    record("load.posted", actorId, load.id);
    return load;
  }

  function submitBid(loadId, input, actorId) {
    const actor = state.companies.get(actorId);
    if (!actor || !["carrier", "owner_operator"].includes(actor.role)) {
      throw new Error("Only an onboarded carrier or owner-operator can bid");
    }
    const load = state.loads.get(loadId);
    if (!load || load.status !== "open") throw new Error("Load is not open for bidding");
    const bid = {
      id: `BID-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      bidderId: actorId,
      amount: positiveNumber(input.amount, "amount"),
      currency: requiredString(input.currency, "currency", 3).toUpperCase(),
      message: typeof input.message === "string" ? input.message.trim().slice(0, 500) : "",
      status: "submitted",
      createdAt: new Date().toISOString()
    };
    load.bids.push(bid);
    record("bid.submitted", actorId, loadId, { bidId: bid.id });
    return bid;
  }

  function acceptBid(loadId, bidId, actorId, approval) {
    const load = state.loads.get(loadId);
    if (!load || load.status !== "open") throw new Error("Load is not open");
    if (load.shipperId !== actorId) throw new Error("Only the posting shipper can accept a bid");
    if (approval !== "APPROVE") throw new Error("Explicit human approval is required");
    const bid = load.bids.find(item => item.id === bidId);
    if (!bid) throw new Error("Bid not found");
    const checks = state.companies.get(bid.bidderId)?.verification || {};
    const verified = checks.identity === "verified" && checks.authority === "verified" &&
      checks.insurance === "verified" && checks.sanctions === "clear";
    if (!verified) throw new Error("Carrier verification is incomplete");
    bid.status = "accepted";
    load.status = "awarded";
    load.assignment = { bidId, carrierId: bid.bidderId, approvedBy: actorId, approvedAt: new Date().toISOString() };
    record("bid.accepted", actorId, loadId, { bidId, carrierId: bid.bidderId });
    return load;
  }

  return {
    state, onboardCompany, postLoad, submitBid, acceptBid,
    listLoads: () => [...state.loads.values()],
    listAudit: () => [...state.audit]
  };
}

module.exports = { createMemoryStore, ROLES, EQUIPMENT };
