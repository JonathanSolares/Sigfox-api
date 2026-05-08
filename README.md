# ESIME Inteligente Sigfox API

Servidor Express para recibir callbacks de Sigfox, guardar lecturas en SQLite y mostrar el panel web de calidad del aire.

## DigitalOcean

El proyecto se despliega como Node.js app. DigitalOcean debe ejecutar:

```bash
npm start
```

No configures `PORT`; DigitalOcean lo asigna automáticamente.

## Variables de entorno

Configura en DigitalOcean:

```text
SIGFOX_CALLBACK_TOKEN=un-token-secreto
CORS_ORIGIN=*
DEVICE_ENCB_PRINCIPAL=id-real-sigfox
DEVICE_ENCB_SECUNDARIA=id-real-sigfox
DEVICE_ENCB_INTERIOR=id-real-sigfox
DEVICE_ESIME_CENTRAL=id-real-sigfox
DEVICE_ESIME_SECUNDARIA=id-real-sigfox
RETENTION_DAYS=30
```

IDs reales configurados por defecto:

| Estación | ID Sigfox |
| --- | --- |
| Estación Principal ENCB | `3DFF9D` |
| Estación Secundaria ENCB | `429246` |
| Estación Interior ENCB | `3DEB72` |

## Callback de Sigfox

URL:

```text
https://lionfish-app-lqd2h.ondigitalocean.app/api/sigfox/callback?token=un-token-secreto
```

Método: `POST`

Headers:

```text
Content-Type: application/json
```

Body recomendado:

```json
{
  "device": "{device}",
  "time": "{time}",
  "data": "{data}",
  "seqNumber": "{seqNumber}"
}
```

El endpoint anterior `/sigfox` sigue funcionando para no romper la configuración previa.

Si Sigfox no permite guardar JSON, usa `application/x-www-form-urlencoded` con:

```text
device={device}&time={time}&data={data}&seqNumber={seqNumber}
```

## API para la página

```text
GET /api/stations
GET /api/stations/:stationId/readings?days=1
GET /api/stations/:stationId/export.xls?days=30
GET /api/export.xls?days=30
GET /api/health
```

La web vive en `public/`, consulta `/api/stations` para los datos actuales y
`/api/stations/:stationId/readings?days=1` para graficar las últimas 24 horas.
También ofrece descarga Excel de la estación seleccionada o de todas las
estaciones de los últimos 30 días.

Si frontend y backend están en el mismo dominio, deja `public/config.js` con:

```js
window.ESIME_API_BASE = "";
```

## Payload

El servidor acepta dos formas:

1. Valores ya decodificados: `pm25`, `pm10`, `co2`, `nox`, `ozono`, `temperatura`.
2. Payload hexadecimal en `data`.

Para payload hexadecimal largo, el orden asumido es:

| Bytes | Campo | Escala |
| --- | --- | --- |
| 0-1 | PM2.5 | entero / 10 |
| 2-3 | PM10 | entero / 10 |
| 4-5 | CO2 | ppm |
| 6-7 | NOx | entero / 10 |
| 8-9 | Ozono | entero / 10 |
| 10-11 | Temperatura | entero con signo / 10 |
| 12-13 | Humedad opcional | entero / 10 |

Si el mensaje tiene el formato anterior de 9 bytes, se usa el decodificador legado del primer intento.

## Retención de datos

El servidor limpia lecturas con más de `RETENTION_DAYS` días después de recibir
cada callback. Por defecto conserva 30 días.

## Índice interno de referencia

El índice mostrado en la página no es un ICA oficial. Es un indicador interno
para comparar rápidamente la lectura actual contra umbrales de referencia:

```text
max(
  PM2.5 / 25,
  PM10 / 50,
  CO2 / 1000,
  NOx / 100,
  Ozono / 100,
  CO / 9,
  SO2 / 75
) * 100
```

Si una estación no tiene lectura, todos sus valores y su índice se muestran en
`0`.
