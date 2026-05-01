const express = require("express");
const app = express();

app.use(express.json());

app.post("/sigfox", (req, res) => {
    console.log("Mensaje recibido:");
    console.log(req.body);

    const hex = req.body.data;

    // Validación básica
    if (!hex) {
        console.log("No hay data");
        return res.status(400).send("No data");
    }

    const decoded = decodePayload(hex);

    console.log("Decodificado:");
    console.log(decoded);

    res.status(200).send("OK");
});

function decodePayload(hex) {
    const buffer = Buffer.from(hex, "hex");

    // Convertir a número grande
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

app.listen(3000, () => {
    console.log("Servidor corriendo en http://localhost:3000");
});