const express = require("express");
const sqlite3 = require("sqlite3").verbose();

const app = express();

app.use(express.json());
app.use(express.static("public"));

// ===============================
// BASE DE DATOS
// ===============================

const db = new sqlite3.Database("data.db");

db.run(`
CREATE TABLE IF NOT EXISTS sensores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device TEXT,
    nox INTEGER,
    ozono INTEGER,
    co2 INTEGER,
    co INTEGER,
    so2 INTEGER,
    pm25 INTEGER,
    pm10 INTEGER,
    temperatura REAL,
    time TEXT
)
`);

// ===============================
// DECODIFICAR PAYLOAD
// ===============================

function decodePayload(hex) {

    const payload = Buffer.from(hex, "hex");

    const NOx = payload[0];

    const Ozono = payload[1];

    const CO2 = (payload[2] << 2) | (payload[3] >> 6);

    const CO = payload[3] & 0x3F;

    const SO2 = payload[4];

    const PM25 = payload[5];

    const PM10 = payload[6];

    const Temperatura = payload[7] + (payload[8] / 100.0);

    return {
        NOx,
        Ozono,
        CO2,
        CO,
        SO2,
        PM25,
        PM10,
        Temperatura
    };
}

// ===============================
// ENDPOINT SIGFOX
// ===============================

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

    // GUARDAR EN BASE DE DATOS

    db.run(`
    INSERT INTO sensores (
        device,
        nox,
        ozono,
        co2,
        co,
        so2,
        pm25,
        pm10,
        temperatura,
        time
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        req.body.device,
        decoded.NOx,
        decoded.Ozono,
        decoded.CO2,
        decoded.CO,
        decoded.SO2,
        decoded.PM25,
        decoded.PM10,
        decoded.Temperatura,
        req.body.time
    ]);

    res.status(200).send("OK");
});

// ===============================
// VER DATOS
// ===============================

app.get("/datos", (req, res) => {

    db.all("SELECT * FROM sensores", (err, rows) => {

        if (err) {
            console.log(err);
            return res.status(500).send(err);
        }

        res.json(rows);

    });

});

// ===============================
// PAGINA PRINCIPAL
// ===============================

app.get("/", (req, res) => {
    res.send("Servidor Sigfox funcionando");
});

// ===============================
// INICIAR SERVIDOR
// ===============================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Servidor corriendo en puerto " + PORT);
});