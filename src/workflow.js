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

function createMemoryStore(seedLoads = [], options = {}) {
  const state = {
    companies: new Map(),
    loads: new Map(seedLoads.map(load => [load.id, { ...load, bids: [], status: "open" }])),
    shipments: new Map(),
    paymentAuthorizations: new Map(),
    idempotency: new Map(),
    audit: []
  };
  const persist = typeof options.persist === "function" ? options.persist : () => {};

  function save() {
    persist({
      companies: [...state.companies.values()],
      loads: [...state.loads.values()],
      shipments: [...state.shipments.values()],
      paymentAuthorizations: [...state.paymentAuthorizations.values()],
      audit: state.audit
    });
  }

  function idempotent(scope, actorId, key, action) {
    const normalized = requiredString(key, "idempotencyKey", 128);
    const cacheKey = `${scope}:${actorId}:${normalized}`;
    if (state.idempotency.has(cacheKey)) return state.idempotency.get(cacheKey);
    const result = action();
    state.idempotency.set(cacheKey, result);
    return result;
  }

  function record(action, actorId, targetId, detail = {}) {
    const event = { id: crypto.randomUUID(), action, actorId, targetId, detail, at: new Date().toISOString() };
    state.audit.push(event);
    save();
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
    const shipment = {
      id: `SHP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      loadId,
      shipperId: load.shipperId,
      carrierId: bid.bidderId,
      status: "awarded",
      documents: [],
      tracking: [],
      createdAt: new Date().toISOString()
    };
    state.shipments.set(shipment.id, shipment);
    load.shipmentId = shipment.id;
    record("bid.accepted", actorId, loadId, { bidId, carrierId: bid.bidderId, shipmentId: shipment.id });
    return load;
  }

  function shipmentFor(id) {
    const shipment = state.shipments.get(id);
    if (!shipment) throw new Error("Shipment not found");
    return shipment;
  }

  function requireParty(shipment, actorId) {
    const actor = state.companies.get(actorId);
    if (!actor || ![shipment.shipperId, shipment.carrierId].includes(actorId)) {
      throw new Error("Actor is not authorized for this shipment");
    }
    return actor;
  }

  function transitionShipment(id, nextStatus, actorId, approval) {
    const shipment = shipmentFor(id);
    const actor = requireParty(shipment, actorId);
    const transitions = {
      awarded: ["dispatched"],
      dispatched: ["picked_up"],
      picked_up: ["in_transit"],
      in_transit: ["delivered"],
      delivered: ["pod_approved"],
      pod_approved: ["closed"]
    };
    if (!transitions[shipment.status]?.includes(nextStatus)) throw new Error("Invalid shipment transition");
    if (["dispatched", "picked_up", "in_transit", "delivered"].includes(nextStatus) && actorId !== shipment.carrierId) {
      throw new Error("Only the assigned carrier can perform this transition");
    }
    if (["pod_approved", "closed"].includes(nextStatus) && actorId !== shipment.shipperId) {
      throw new Error("Only the shipper can approve delivery or close the shipment");
    }
    if (["pod_approved", "closed"].includes(nextStatus) && approval !== "APPROVE") {
      throw new Error("Explicit human approval is required");
    }
    if (nextStatus === "pod_approved" && !shipment.documents.some(item => item.type === "proof_of_delivery")) {
      throw new Error("Proof of delivery is required");
    }
    shipment.status = nextStatus;
    shipment.updatedAt = new Date().toISOString();
    record("shipment.transitioned", actor.id, id, { status: nextStatus });
    return shipment;
  }

  function addDocument(id, input, actorId) {
    const shipment = shipmentFor(id);
    requireParty(shipment, actorId);
    const allowed = new Set(["bill_of_lading", "commercial_invoice", "customs", "inspection", "proof_of_delivery"]);
    const type = requiredString(input.type, "type");
    if (!allowed.has(type)) throw new TypeError("document type is not supported");
    const document = {
      id: `DOC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      type,
      fileName: requiredString(input.fileName, "fileName"),
      sha256: requiredString(input.sha256, "sha256", 64).toLowerCase(),
      uploadedBy: actorId,
      status: "quarantined",
      createdAt: new Date().toISOString()
    };
    if (!/^[a-f0-9]{64}$/.test(document.sha256)) throw new TypeError("sha256 must be a 64-character hex digest");
    shipment.documents.push(document);
    record("document.recorded", actorId, id, { documentId: document.id, type });
    return document;
  }

  function recordDocumentScan(id, documentId, input, actorId) {
    const shipment = shipmentFor(id);
    requireParty(shipment, actorId);
    const actor = state.companies.get(actorId);
    if (actor.role !== "shipper") throw new Error("Only the shipper can approve a document scan result");
    const document = shipment.documents.find(item => item.id === documentId);
    if (!document) throw new Error("Document not found");
    const result = requiredString(input.result, "result");
    if (!["clean", "rejected"].includes(result)) throw new TypeError("scan result is not supported");
    if (input.approval !== "APPROVE") throw new Error("Explicit human approval is required");
    document.status = result === "clean" ? "available" : "rejected";
    document.scannedAt = new Date().toISOString();
    record("document.scan_reviewed", actorId, id, { documentId, result });
    return document;
  }

  function addTrackingEvent(id, input, actorId) {
    const shipment = shipmentFor(id);
    if (actorId !== shipment.carrierId) throw new Error("Only the assigned carrier can report location");
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new TypeError("latitude is invalid");
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new TypeError("longitude is invalid");
    const event = {
      id: `TRK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      latitude,
      longitude,
      recordedAt: input.recordedAt ? requiredString(input.recordedAt, "recordedAt") : new Date().toISOString(),
      source: "carrier_device"
    };
    const recordedAtMs = Date.parse(event.recordedAt);
    if (!Number.isFinite(recordedAtMs)) throw new TypeError("recordedAt is invalid");
    const previous = shipment.tracking.at(-1);
    if (previous) {
      const elapsedHours = (recordedAtMs - Date.parse(previous.recordedAt)) / 3_600_000;
      if (elapsedHours <= 0) throw new TypeError("tracking events must be chronological");
      const distanceKm = haversineKm(previous.latitude, previous.longitude, latitude, longitude);
      if (distanceKm / elapsedHours > 160) throw new Error("Tracking update exceeds plausible truck speed");
    }
    shipment.tracking.push(event);
    record("tracking.recorded", actorId, id, { trackingId: event.id });
    return event;
  }

  function requestPaymentAuthorization(id, input, actorId, idempotencyKey) {
    const shipment = shipmentFor(id);
    if (actorId !== shipment.shipperId) throw new Error("Only the shipper can request payment authorization");
    if (shipment.status !== "pod_approved") throw new Error("Approved proof of delivery is required before payment authorization");
    return idempotent(`payment:${id}`, actorId, idempotencyKey, () => {
      const authorization = {
        id: `PAY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        shipmentId: id,
        amount: positiveNumber(input.amount, "amount"),
        currency: requiredString(input.currency, "currency", 3).toUpperCase(),
        status: "pending_approval",
        requestedBy: actorId,
        requestedByUser: requiredString(input.requestedByUser, "requestedByUser", 128),
        createdAt: new Date().toISOString()
      };
      state.paymentAuthorizations.set(authorization.id, authorization);
      record("payment.authorization_requested", actorId, id, { paymentAuthorizationId: authorization.id });
      return authorization;
    });
  }

  function approvePaymentAuthorization(id, actorId, input) {
    const authorization = state.paymentAuthorizations.get(id);
    if (!authorization) throw new Error("Payment authorization not found");
    const shipment = shipmentFor(authorization.shipmentId);
    if (actorId !== shipment.shipperId) throw new Error("Only the shipper can approve payment authorization");
    if (input.approval !== "APPROVE") throw new Error("Explicit human approval is required");
    const approverUser = requiredString(input.approverUser, "approverUser", 128);
    if (authorization.requestedByUser === approverUser) throw new Error("A different authorized person must approve payment");
    authorization.status = "approved_for_processor";
    authorization.approvedBy = actorId;
    authorization.approvedByUser = approverUser;
    authorization.approvedAt = new Date().toISOString();
    record("payment.authorization_approved", actorId, shipment.id, { paymentAuthorizationId: id });
    return authorization;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const radians = value => value * Math.PI / 180;
    const dLat = radians(lat2 - lat1);
    const dLon = radians(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  return {
    state, onboardCompany, postLoad, submitBid, acceptBid, transitionShipment, addDocument, recordDocumentScan,
    addTrackingEvent, requestPaymentAuthorization, approvePaymentAuthorization,
    listLoads: () => [...state.loads.values()],
    listShipments: () => [...state.shipments.values()],
    listPaymentAuthorizations: () => [...state.paymentAuthorizations.values()],
    listAudit: () => [...state.audit]
  };
}

module.exports = { createMemoryStore, ROLES, EQUIPMENT };
