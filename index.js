const express = require("express");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const db = new sqlite3.Database("data.db");

const PORT = process.env.PORT || 3000;
const CALLBACK_TOKEN = process.env.SIGFOX_CALLBACK_TOKEN || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const stations = [
  {
    id: "encb-principal",
    deviceId: process.env.DEVICE_ENCB_PRINCIPAL || "SIGFOX_DEVICE_ID_1",
    name: "Estación Principal ENCB",
    description:
      "Monitorea partículas suspendidas y condiciones ambientales del área exterior norte.",
    location: "Exterior norte ENCB",
  },
  {
    id: "encb-secundaria",
    deviceId: process.env.DEVICE_ENCB_SECUNDARIA || "SIGFOX_DEVICE_ID_2",
    name: "Estación Secundaria ENCB",
    description:
      "Da seguimiento al flujo de aire cerca del acceso peatonal y zonas abiertas.",
    location: "Acceso peatonal ENCB",
  },
  {
    id: "encb-interior",
    deviceId: process.env.DEVICE_ENCB_INTERIOR || "SIGFOX_DEVICE_ID_3",
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
      humedad REAL,
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
      humedad: "ALTER TABLE sensores ADD COLUMN humedad REAL",
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
  const pm25Score = Number(reading.pm25 || 0) * 3;
  const pm10Score = Number(reading.pm10 || 0) * 1.5;
  const gasScore = Math.max(Number(reading.nox || 0), Number(reading.ozono || 0));
  return Math.round(Math.max(pm25Score, pm10Score, gasScore));
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

  if (payload.length >= 14) {
    reading.humedad = readUnsignedTenths(payload, 12);
  }

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
    humedad: normalizeNumber(body.humedad ?? body.humidity),
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
        humedad,
        aqi,
        rawData,
        seqNumber,
        duplicate,
        time,
        receivedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      reading.humedad,
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
    }
  );
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
  const limit = Math.min(Number(req.query.limit || 100), 500);

  db.all(
    "SELECT * FROM sensores WHERE stationId = ? ORDER BY id DESC LIMIT ?",
    [req.params.stationId, limit],
    (err, rows) => {
      if (err) {
        res.status(500).json({ ok: false, error: err.message });
        return;
      }

      res.json({ stationId: req.params.stationId, readings: rows });
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
