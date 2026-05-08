const express = require("express");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const db = new sqlite3.Database("data.db");

const PORT = process.env.PORT || 3000;
const CALLBACK_TOKEN = process.env.SIGFOX_CALLBACK_TOKEN || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);

const stations = [
  {
    id: "encb-principal",
    deviceId: process.env.DEVICE_ENCB_PRINCIPAL || "3DFF9D",
    name: "Estación Principal ENCB",
    description:
      "Monitorea partículas suspendidas y condiciones ambientales del área exterior norte.",
    location: "Exterior norte ENCB",
  },
  {
    id: "encb-secundaria",
    deviceId: process.env.DEVICE_ENCB_SECUNDARIA || "429246",
    name: "Estación Secundaria ENCB",
    description:
      "Da seguimiento al flujo de aire cerca del acceso peatonal y zonas abiertas.",
    location: "Acceso peatonal ENCB",
  },
  {
    id: "encb-interior",
    deviceId: process.env.DEVICE_ENCB_INTERIOR || "3DEB72",
    name: "Estación Interior ENCB",
    description:
      "Revisa condiciones interiores en laboratorios para apoyar decisiones de ventilación.",
    location: "Laboratorios ENCB",
  },
  {
    id: "esime-central",
    deviceId: process.env.DEVICE_ESIME_CENTRAL || "SIGFOX_DEVICE_ID_4",
    name: "Estación Central ESIME",
    description:
      "Concentra lecturas representativas de la plaza principal y rutas de mayor tránsito.",
    location: "Plaza principal ESIME",
  },
  {
    id: "esime-secundaria",
    deviceId: process.env.DEVICE_ESIME_SECUNDARIA || "SIGFOX_DEVICE_ID_5",
    name: "Estación Secundaria ESIME",
    description:
      "Supervisa zona de talleres, donde puede subir la concentración de partículas.",
    location: "Zona de talleres ESIME",
  },
];

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});
app.use(express.static("public"));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS sensores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stationId TEXT,
      device TEXT,
      nox REAL,
      ozono REAL,
      co2 REAL,
      co REAL,
      so2 REAL,
      pm25 REAL,
      pm10 REAL,
      temperatura REAL,
      aqi REAL,
      rawData TEXT,
      seqNumber TEXT,
      duplicate INTEGER DEFAULT 0,
      time TEXT,
      receivedAt TEXT
    )
  `);

  db.all("PRAGMA table_info(sensores)", (err, columns) => {
    if (err) return;

    const existingColumns = new Set(columns.map((column) => column.name));
    const migrations = {
      stationId: "ALTER TABLE sensores ADD COLUMN stationId TEXT",
      aqi: "ALTER TABLE sensores ADD COLUMN aqi REAL",
      rawData: "ALTER TABLE sensores ADD COLUMN rawData TEXT",
      seqNumber: "ALTER TABLE sensores ADD COLUMN seqNumber TEXT",
      duplicate: "ALTER TABLE sensores ADD COLUMN duplicate INTEGER DEFAULT 0",
      receivedAt: "ALTER TABLE sensores ADD COLUMN receivedAt TEXT",
    };

    Object.entries(migrations).forEach(([column, sql]) => {
      if (!existingColumns.has(column)) {
        db.run(sql);
      }
    });
  });
});

function normalizeNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readUnsignedTenths(payload, offset) {
  return Number((payload.readUInt16BE(offset) / 10).toFixed(1));
}

function readSignedTenths(payload, offset) {
  return Number((payload.readInt16BE(offset) / 10).toFixed(1));
}

function calculateAqi(reading) {
  const thresholds = {
    pm25: 25,
    pm10: 50,
    co2: 1000,
    nox: 100,
    ozono: 100,
    co: 9,
    so2: 75,
  };

  const scores = Object.entries(thresholds).map(([field, limit]) => {
    const value = Number(reading[field] || 0);
    return limit > 0 ? (value / limit) * 100 : 0;
  });

  return Math.round(Math.max(0, ...scores));
}

function decodeLegacyPayload(hex) {
  const payload = Buffer.from(hex, "hex");

  return {
    nox: payload[0],
    ozono: payload[1],
    co2: (payload[2] << 2) | (payload[3] >> 6),
    co: payload[3] & 0x3f,
    so2: payload[4],
    pm25: payload[5],
    pm10: payload[6],
    temperatura: payload[7] + payload[8] / 100,
  };
}

function decodeWidePayload(hex) {
  const payload = Buffer.from(hex, "hex");
  if (payload.length < 12) return decodeLegacyPayload(hex);

  const reading = {
    pm25: readUnsignedTenths(payload, 0),
    pm10: readUnsignedTenths(payload, 2),
    co2: payload.readUInt16BE(4),
    nox: readUnsignedTenths(payload, 6),
    ozono: readUnsignedTenths(payload, 8),
    temperatura: readSignedTenths(payload, 10),
  };

  return reading;
}

function decodePayload(body) {
  const directReading = {
    nox: normalizeNumber(body.nox ?? body.no2),
    ozono: normalizeNumber(body.ozono ?? body.o3),
    co2: normalizeNumber(body.co2),
    co: normalizeNumber(body.co),
    so2: normalizeNumber(body.so2),
    pm25: normalizeNumber(body.pm25 ?? body.pm2_5),
    pm10: normalizeNumber(body.pm10),
    temperatura: normalizeNumber(body.temperatura ?? body.temperature ?? body.temp),
  };

  const hasDirectValues = Object.values(directReading).some((value) => value !== null);
  if (hasDirectValues) {
    return {
      ...directReading,
      aqi: normalizeNumber(body.aqi) ?? calculateAqi(directReading),
    };
  }

  if (!body.data) {
    throw new Error("No data");
  }

  const reading = decodeWidePayload(body.data);
  return {
    ...reading,
    aqi: calculateAqi(reading),
  };
}

function normalizeSigfoxTime(value) {
  if (!value) return new Date().toISOString();

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    return new Date(milliseconds).toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function findStation(deviceId) {
  return stations.find(
    (station) => station.deviceId.toLowerCase() === String(deviceId).toLowerCase()
  );
}

function purgeOldReadings() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.run("DELETE FROM sensores WHERE COALESCE(receivedAt, time) < ?", [cutoff]);
}

function insertReading(station, deviceId, body, reading, res) {
  const receivedAt = new Date().toISOString();
  const time = normalizeSigfoxTime(body.time || body.timestamp);

  db.run(
    `
      INSERT INTO sensores (
        stationId,
        device,
        nox,
        ozono,
        co2,
        co,
        so2,
        pm25,
        pm10,
        temperatura,
        aqi,
        rawData,
        seqNumber,
        duplicate,
        time,
        receivedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      station.id,
      deviceId,
      reading.nox,
      reading.ozono,
      reading.co2,
      reading.co,
      reading.so2,
      reading.pm25,
      reading.pm10,
      reading.temperatura,
      reading.aqi,
      body.data || null,
      body.seqNumber || body.seq || null,
      body.duplicate === true || body.duplicate === "true" ? 1 : 0,
      time,
      receivedAt,
    ],
    function onInsert(err) {
      if (err) {
        res.status(500).json({ ok: false, error: err.message });
        return;
      }

      res.status(201).json({
        ok: true,
        id: this.lastID,
        stationId: station.id,
        reading: {
          ...reading,
          stationId: station.id,
          deviceId,
          timestamp: time,
          receivedAt,
        },
      });

      purgeOldReadings();
    }
  );
}

function getDateRange(query) {
  const days = Math.min(Math.max(Number(query.days || 1), 1), RETENTION_DAYS);
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipFiles(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const name = Buffer.from(file.name);
    const data = Buffer.from(file.content);
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function cellReference(columnIndex, rowIndex) {
  let column = "";
  let value = columnIndex + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }
  return `${column}${rowIndex}`;
}

function buildSheetXml(columns, rows) {
  const headerCells = columns
    .map((column, index) => {
      const ref = cellReference(index, 1);
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(column)}</t></is></c>`;
    })
    .join("");

  const bodyRows = rows
    .map((row, rowIndex) => {
      const excelRow = rowIndex + 2;
      const cells = columns
        .map((column, columnIndex) => {
          const value = row[column];
          const ref = cellReference(columnIndex, excelRow);
          if (typeof value === "number" && Number.isFinite(value)) {
            return `<c r="${ref}"><v>${value}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${excelRow}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">${headerCells}</row>
    ${bodyRows}
  </sheetData>
</worksheet>`;
}

function sendExcel(res, filename, rows) {
  const columns = [
    "id",
    "stationId",
    "device",
    "nox",
    "ozono",
    "co2",
    "co",
    "so2",
    "pm25",
    "pm10",
    "temperatura",
    "aqi",
    "time",
    "receivedAt",
  ];

  const files = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Lecturas" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: buildSheetXml(columns, rows),
    },
  ];

  res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.header("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(zipFiles(files));
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post(["/sigfox", "/api/sigfox/callback"], (req, res) => {
  if (CALLBACK_TOKEN && req.query.token !== CALLBACK_TOKEN) {
    res.status(401).json({ ok: false, error: "Invalid callback token" });
    return;
  }

  const deviceId = req.body.device || req.body.deviceId || req.body.id;
  if (!deviceId) {
    res.status(400).json({ ok: false, error: "Missing device id" });
    return;
  }

  const station = findStation(deviceId);
  if (!station) {
    res.status(404).json({
      ok: false,
      error: "Device is not mapped to a station",
      deviceId,
    });
    return;
  }

  try {
    const reading = decodePayload(req.body);
    insertReading(station, deviceId, req.body, reading, res);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/stations", (req, res) => {
  const sql = `
    SELECT s1.*
    FROM sensores s1
    INNER JOIN (
      SELECT stationId, MAX(id) AS maxId
      FROM sensores
      WHERE stationId IS NOT NULL
      GROUP BY stationId
    ) latest ON latest.maxId = s1.id
  `;

  db.all(sql, (err, rows) => {
    if (err) {
      res.status(500).json({ ok: false, error: err.message });
      return;
    }

    const latestByStation = new Map(rows.map((row) => [row.stationId, row]));
    res.json({
      stations: stations.map((station) => ({
        ...station,
        latest: latestByStation.get(station.id) || null,
      })),
    });
  });
});

app.get("/api/stations/:stationId/readings", (req, res) => {
  const limit = Math.min(Number(req.query.limit || 500), 5000);
  const since = getDateRange(req.query);

  db.all(
    "SELECT * FROM sensores WHERE stationId = ? AND COALESCE(receivedAt, time) >= ? ORDER BY id ASC LIMIT ?",
    [req.params.stationId, since, limit],
    (err, rows) => {
      if (err) {
        res.status(500).json({ ok: false, error: err.message });
        return;
      }

      res.json({ stationId: req.params.stationId, readings: rows });
    }
  );
});

app.get(["/api/stations/:stationId/export.xlsx", "/api/stations/:stationId/export.xls"], (req, res) => {
  const since = getDateRange({ ...req.query, days: req.query.days || 30 });

  db.all(
    "SELECT * FROM sensores WHERE stationId = ? AND COALESCE(receivedAt, time) >= ? ORDER BY id ASC",
    [req.params.stationId, since],
    (err, rows) => {
      if (err) {
        res.status(500).json({ ok: false, error: err.message });
        return;
      }

      sendExcel(res, `${req.params.stationId}-ultimos-30-dias.xlsx`, rows);
    }
  );
});

app.get(["/api/export.xlsx", "/api/export.xls"], (req, res) => {
  const since = getDateRange({ ...req.query, days: req.query.days || 30 });

  db.all(
    "SELECT * FROM sensores WHERE COALESCE(receivedAt, time) >= ? ORDER BY stationId ASC, id ASC",
    [since],
    (err, rows) => {
      if (err) {
        res.status(500).json({ ok: false, error: err.message });
        return;
      }

      sendExcel(res, "esime-calidad-aire-ultimos-30-dias.xlsx", rows);
    }
  );
});

app.get("/datos", (req, res) => {
  db.all("SELECT * FROM sensores ORDER BY id ASC", (err, rows) => {
    if (err) {
      res.status(500).send(err);
      return;
    }

    res.json(rows);
  });
});

app.get("/datos/:device", (req, res) => {
  db.all(
    "SELECT * FROM sensores WHERE device = ? ORDER BY id ASC",
    [req.params.device],
    (err, rows) => {
      if (err) {
        res.status(500).send(err);
        return;
      }

      res.json(rows);
    }
  );
});

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});
