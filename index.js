const express = require("express");
const app = express();

app.use(express.json());

// ===== BASE DE DATOS (SQLite) =====
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("data.db");

db.run(`
CREATE TABLE IF NOT EXISTS sensores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device TEXT,
    nox INTEGER,
    o3 INTEGER,
    co INTEGER,
    co2 INTEGER,
    so2 INTEGER,
    pm25 INTEGER,
    pm10 INTEGER,
    time TEXT
)
`);

// ===== ENDPOINT SIGFOX =====
app.post("/sigfox", (req, res) => {
    console.log("Mensaje recibido:");
    console.log(req.body);

    const hex = req.body.data;

    if (!hex) {
        console.log("No hay data");
        return res.status(400).send("No data");
    }

    const decoded = decodePayload(hex);

    console.log("Decodificado:");
    console.log(decoded);

    // Guardar en BD
    db.run(`
    INSERT INTO sensores (device, nox, o3, co, co2, so2, pm25, pm10, time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        req.body.device,
        decoded.NOx,
        decoded.O3,
        decoded.CO,
        decoded.CO2,
        decoded.SO2,
        decoded.PM25,
        decoded.PM10,
        req.body.time
    ]);

    res.status(200).send("OK");
});

// ===== VER DATOS =====
app.get("/datos", (req, res) => {
    db.all("SELECT * FROM sensores", (err, rows) => {
        if (err) {
            return res.status(500).send(err);
        }
        res.json(rows);
    });
});

// ===== DECODIFICACIÓN =====
function decodePayload(hex) {
    const buffer = Buffer.from(hex, "hex");

    let value = 0n;
    for (let byte of buffer) {
        value = (value << 8n) | BigInt(byte);
    }

    return {
        NOx: Number((value >> 49n) & 0xFFn),
        O3: Number((value >> 41n) & 0xFFn),
        CO: Number((value >> 33n) & 0xFFn),
        CO2: Number((value >> 23n) & 0x3FFn),
        SO2: Number((value >> 14n) & 0x1FFn),
        PM25: Number((value >> 7n) & 0x7Fn),
        PM10: Number(value & 0x7Fn)
    };
}

// ===== PUERTO (IMPORTANTE PARA LA NUBE) =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Servidor corriendo en puerto " + PORT);
});