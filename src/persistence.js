"use strict";

const fs = require("node:fs");
const path = require("node:path");

function createJsonPersistence(filePath) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return snapshot => {
    const temporary = `${resolved}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, resolved);
  };
}

module.exports = { createJsonPersistence };
