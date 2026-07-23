const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { calculateTripEconomics, rankLoads } = require("./src/marketplace");
const { createMemoryStore } = require("./src/workflow");
const { actorFromRequest, createSession } = require("./src/auth");
const { createJsonPersistence } = require("./src/persistence");

const publicDir = path.join(__dirname, "public");
const demoLoads = [
  { id: "CTA-1042", origin: "Chicago, US", destination: "Toronto, CA", distanceKm: 837, rate: 2450, currency: "USD", equipment: "Dry Van", deadheadKm: 34, verified: true },
  { id: "CTA-1043", origin: "Monterrey, MX", destination: "Laredo, US", distanceKm: 230, rate: 980, currency: "USD", equipment: "Reefer", deadheadKm: 18, verified: true },
  { id: "CTA-1044", origin: "Rotterdam, NL", destination: "Düsseldorf, DE", distanceKm: 226, rate: 760, currency: "EUR", equipment: "Container", deadheadKm: 11, verified: true }
];
const persistence = process.env.DATA_FILE ? createJsonPersistence(process.env.DATA_FILE) : undefined;
const store = createMemoryStore(demoLoads, { persist: persistence });
const sessionSecret = process.env.SESSION_SECRET || "development-only-secret-change-me-123";

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("Request body too large");
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new TypeError("Invalid JSON"); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.url === "/api/health") return json(res, 200, { status: "ok", product: "CARGO TRUCK APP" });
  if (req.url === "/api/config") return json(res, 200, {
    mapsEnabled: process.env.MAPS_ENABLED === "true" && Boolean(process.env.GOOGLE_MAPS_API_KEY),
    mapId: process.env.GOOGLE_MAPS_MAP_ID || null,
    regions: ["North America", "Latin America", "Europe", "Africa & Middle East", "Asia-Pacific"]
  });
  if (url.pathname === "/api/loads" && req.method === "GET") {
    const loads = rankLoads(store.listLoads().filter(load => load.verified).map(load => ({
      ...load,
      economics: calculateTripEconomics({ ...load, fuelPricePerLiter: 1.18, fuelKmPerLiter: 2.7, tolls: 80, driverCost: 390, otherCosts: 95 })
    })));
    return json(res, 200, { loads });
  }
  try {
    if (url.pathname === "/api/companies" && req.method === "POST") {
      return json(res, 201, { company: store.onboardCompany(await readJson(req)) });
    }
    if (url.pathname === "/api/sessions" && req.method === "POST") {
      if (process.env.NODE_ENV === "production") throw new Error("Development sessions are disabled in production");
      const body = await readJson(req);
      if (!store.state.companies.has(body.actorId)) throw new Error("Company not found");
      return json(res, 201, { token: createSession(body.actorId, sessionSecret) });
    }
    const actorId = url.pathname.startsWith("/api/") ? actorFromRequest(req, sessionSecret) : null;
    if (url.pathname === "/api/loads" && req.method === "POST") {
      return json(res, 201, { load: store.postLoad(await readJson(req), actorId) });
    }
    const bidRoute = url.pathname.match(/^\/api\/loads\/([^/]+)\/bids$/);
    if (bidRoute && req.method === "POST") {
      return json(res, 201, { bid: store.submitBid(bidRoute[1], await readJson(req), actorId) });
    }
    const acceptRoute = url.pathname.match(/^\/api\/loads\/([^/]+)\/bids\/([^/]+)\/accept$/);
    if (acceptRoute && req.method === "POST") {
      const body = await readJson(req);
      return json(res, 200, { load: store.acceptBid(acceptRoute[1], acceptRoute[2], actorId, body.approval) });
    }
    if (url.pathname === "/api/audit" && req.method === "GET") {
      return json(res, 200, { events: store.listAudit() });
    }
    if (url.pathname === "/api/shipments" && req.method === "GET") {
      return json(res, 200, { shipments: store.listShipments().filter(item => [item.shipperId, item.carrierId].includes(actorId)) });
    }
    const transitionRoute = url.pathname.match(/^\/api\/shipments\/([^/]+)\/transition$/);
    if (transitionRoute && req.method === "POST") {
      const body = await readJson(req);
      return json(res, 200, { shipment: store.transitionShipment(transitionRoute[1], body.status, actorId, body.approval) });
    }
    const documentRoute = url.pathname.match(/^\/api\/shipments\/([^/]+)\/documents$/);
    if (documentRoute && req.method === "POST") {
      return json(res, 201, { document: store.addDocument(documentRoute[1], await readJson(req), actorId) });
    }
    const trackingRoute = url.pathname.match(/^\/api\/shipments\/([^/]+)\/tracking$/);
    if (trackingRoute && req.method === "POST") {
      return json(res, 201, { event: store.addTrackingEvent(trackingRoute[1], await readJson(req), actorId) });
    }
  } catch (error) {
    const status = error instanceof TypeError ? 400 : /authentication|session/i.test(error.message) ? 401 :
      /authorized|only the/i.test(error.message) ? 403 : /not found/i.test(error.message) ? 404 : 409;
    return json(res, status, { error: error.message });
  }

  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return json(res, 403, { error: "Forbidden" });
  fs.readFile(filePath, (error, data) => {
    if (error) return json(res, 404, { error: "Not found" });
    const ext = path.extname(filePath);
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
    res.writeHead(200, { "content-type": `${types[ext] || "application/octet-stream"}; charset=utf-8` });
    res.end(data);
  });
});

if (require.main === module) {
  server.listen(Number(process.env.PORT || 3000), () => console.log("CARGO TRUCK APP running on http://localhost:3000"));
}

module.exports = server;
