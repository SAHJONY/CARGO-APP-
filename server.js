const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { calculateTripEconomics, rankLoads } = require("./src/marketplace");

const publicDir = path.join(__dirname, "public");
const demoLoads = [
  { id: "CTA-1042", origin: "Chicago, US", destination: "Toronto, CA", distanceKm: 837, rate: 2450, currency: "USD", equipment: "Dry Van", deadheadKm: 34, verified: true },
  { id: "CTA-1043", origin: "Monterrey, MX", destination: "Laredo, US", distanceKm: 230, rate: 980, currency: "USD", equipment: "Reefer", deadheadKm: 18, verified: true },
  { id: "CTA-1044", origin: "Rotterdam, NL", destination: "Düsseldorf, DE", distanceKm: 226, rate: 760, currency: "EUR", equipment: "Container", deadheadKm: 11, verified: true }
];

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/health") return json(res, 200, { status: "ok", product: "CARGO TRUCK APP" });
  if (req.url === "/api/config") return json(res, 200, {
    mapsEnabled: process.env.MAPS_ENABLED === "true" && Boolean(process.env.GOOGLE_MAPS_API_KEY),
    mapId: process.env.GOOGLE_MAPS_MAP_ID || null,
    regions: ["North America", "Latin America", "Europe", "Africa & Middle East", "Asia-Pacific"]
  });
  if (req.url === "/api/loads") {
    const loads = rankLoads(demoLoads.map(load => ({
      ...load,
      economics: calculateTripEconomics({ ...load, fuelPricePerLiter: 1.18, fuelKmPerLiter: 2.7, tolls: 80, driverCost: 390, otherCosts: 95 })
    })));
    return json(res, 200, { loads });
  }

  const requested = req.url === "/" ? "index.html" : req.url.slice(1);
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
