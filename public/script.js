const fallbackStations = {
  "encb-principal": {
    id: "encb-principal",
    deviceId: "3DFF9D",
    name: "Estación Principal ENCB",
    description:
      "Monitorea partículas suspendidas y condiciones ambientales del área exterior norte.",
    location: "Exterior norte ENCB",
    update: "Datos demo",
    health: "Sin conexión al backend",
    status: "Activa",
    level: "good",
    aqi: 42,
    pm25: 12,
    pm10: 28,
    co2: 520,
    temp: 23,
  },
  "encb-secundaria": {
    id: "encb-secundaria",
    deviceId: "429246",
    name: "Estación Secundaria ENCB",
    description:
      "Da seguimiento al flujo de aire cerca del acceso peatonal y zonas abiertas.",
    location: "Acceso peatonal ENCB",
    update: "Datos demo",
    health: "Sin conexión al backend",
    status: "Activa",
    level: "good",
    aqi: 48,
    pm25: 15,
    pm10: 31,
    co2: 548,
    temp: 24,
  },
  "encb-interior": {
    id: "encb-interior",
    deviceId: "3DEB72",
    name: "Estación Interior ENCB",
    description:
      "Revisa condiciones interiores en laboratorios para apoyar decisiones de ventilación.",
    location: "Laboratorios ENCB",
    update: "Datos demo",
    health: "Sin conexión al backend",
    status: "Activa",
    level: "good",
    aqi: 36,
    pm25: 9,
    pm10: 19,
    co2: 610,
    temp: 22,
  },
  "esime-central": {
    id: "esime-central",
    deviceId: "DEMO004",
    name: "Estación Central ESIME",
    description:
      "Concentra lecturas representativas de la plaza principal y rutas de mayor tránsito.",
    location: "Plaza principal ESIME",
    update: "Datos demo",
    health: "Sin conexión al backend",
    status: "Activa",
    level: "good",
    aqi: 44,
    pm25: 13,
    pm10: 27,
    co2: 535,
    temp: 23,
  },
  "esime-secundaria": {
    id: "esime-secundaria",
    deviceId: "DEMO005",
    name: "Estación Secundaria ESIME",
    description:
      "Supervisa zona de talleres, donde puede subir la concentración de partículas.",
    location: "Zona de talleres ESIME",
    update: "Datos demo",
    health: "Sin conexión al backend",
    status: "Atención",
    level: "warning",
    aqi: 76,
    pm25: 26,
    pm10: 54,
    co2: 690,
    temp: 25,
  },
};

const apiBase =
  window.ESIME_API_BASE ||
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8080"
    : "");

let stations = { ...fallbackStations };
let selectedStationId = "encb-principal";

const nav = document.querySelector(".site-nav");
const menuButton = document.querySelector(".menu-button");
const dropdown = document.querySelector(".nav-dropdown");
const dropdownButton = document.querySelector(".nav-dropdown-button");
const stationButtons = document.querySelectorAll(".station-option");
const refreshButton = document.getElementById("refresh-data");
const syncStatus = document.getElementById("sync-status");
const chartStatus = document.getElementById("chart-status");
const downloadStation = document.getElementById("download-station");
const downloadAll = document.getElementById("download-all");
const chartCanvases = {
  pm25: document.getElementById("chart-pm25"),
  pm10: document.getElementById("chart-pm10"),
  co2: document.getElementById("chart-co2"),
  temp: document.getElementById("chart-temp"),
};

function setText(id, value) {
  document.getElementById(id).textContent = value ?? "Sin dato";
}

function formatUpdate(value) {
  if (!value) return "Sin lectura reciente";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function calculateLevel(station) {
  if (station.level) return station.level;
  if (Number(station.aqi) >= 75 || Number(station.pm25) >= 25 || Number(station.pm10) >= 50) {
    return "warning";
  }
  return "good";
}

function normalizeStation(station) {
  const fallback = fallbackStations[station.id] || {};
  const latest = station.latest || station;
  const level = calculateLevel({ ...station, ...latest });

  return {
    ...fallback,
    ...station,
    ...latest,
    id: station.id || fallback.id,
    deviceId: station.deviceId || fallback.deviceId,
    name: station.name || fallback.name,
    description: station.description || fallback.description,
    location: station.location || fallback.location,
    update: formatUpdate(latest.receivedAt || latest.timestamp || station.update),
    health: station.health || (latest.receivedAt ? "Operativo" : fallback.health),
    status: level === "warning" ? "Atención" : station.status || fallback.status || "Activa",
    level,
  };
}

function setSyncStatus(message, state) {
  syncStatus.textContent = message;
  syncStatus.className = `sync-status ${state}`;
}

function setChartStatus(message, state) {
  chartStatus.textContent = message;
  chartStatus.className = `sync-status ${state}`;
}

function renderStation(stationId) {
  const station = normalizeStation(stations[stationId]);
  if (!station) return;
  selectedStationId = stationId;

  stationButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.station === stationId);
  });

  setText("station-name", station.name);
  setText("station-description", station.description);
  setText("station-location", station.location);
  setText("station-update", station.update);
  setText("station-health", station.health);
  setText("station-state", station.status);
  setText("aqi-value", station.aqi);
  setText("pm25-value", station.pm25);
  setText("pm10-value", station.pm10);
  setText("co2-value", station.co2);
  setText("temp-value", station.temp);

  const stationStatus = document.getElementById("station-state");
  const aqiStatus = document.getElementById("aqi-status");
  stationStatus.className = `status ${station.level}`;
  aqiStatus.className = `status ${station.level}`;

  if (station.level === "warning") {
    aqiStatus.textContent = "Moderada";
    setText(
      "aqi-copy",
      "Conviene revisar ventilación y observar posibles fuentes de partículas."
    );
  } else {
    aqiStatus.textContent = "Buena";
    setText(
      "aqi-copy",
      "Condiciones adecuadas para actividades normales dentro del campus."
    );
  }

  updateDownloadLinks();
}

function getReadingValue(reading, field) {
  if (field === "temp") return Number(reading.temperatura ?? reading.temperature ?? reading.temp);
  return Number(reading[field]);
}

function getReadingTime(reading) {
  return new Date(reading.receivedAt || reading.timestamp || reading.time || Date.now());
}

function drawChart(canvas, readings, field, color) {
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 34;
  const values = readings
    .map((reading) => ({
      value: getReadingValue(reading, field),
      time: getReadingTime(reading),
    }))
    .filter((point) => Number.isFinite(point.value) && !Number.isNaN(point.time.getTime()));

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fbfff9";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#dbe7df";
  context.lineWidth = 1;

  for (let index = 0; index < 4; index += 1) {
    const y = padding + ((height - padding * 2) / 3) * index;
    context.beginPath();
    context.moveTo(padding, y);
    context.lineTo(width - padding, y);
    context.stroke();
  }

  if (values.length === 0) {
    context.fillStyle = "#5a6f67";
    context.font = "18px Titillium Web";
    context.fillText("Sin datos en las últimas 24 horas", padding, height / 2);
    return;
  }

  const minTime = Date.now() - 24 * 60 * 60 * 1000;
  const maxTime = Date.now();
  const maxValue = Math.max(...values.map((point) => point.value), 1);
  const minValue = Math.min(...values.map((point) => point.value), 0);
  const range = Math.max(maxValue - minValue, 1);

  const toX = (time) =>
    padding + ((time.getTime() - minTime) / (maxTime - minTime)) * (width - padding * 2);
  const toY = (value) =>
    height - padding - ((value - minValue) / range) * (height - padding * 2);

  context.strokeStyle = color;
  context.lineWidth = 3;
  context.beginPath();
  values.forEach((point, index) => {
    const x = toX(point.time);
    const y = toY(point.value);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();

  context.fillStyle = color;
  values.forEach((point) => {
    context.beginPath();
    context.arc(toX(point.time), toY(point.value), 4, 0, Math.PI * 2);
    context.fill();
  });

  context.fillStyle = "#5a6f67";
  context.font = "15px Titillium Web";
  context.fillText(String(Number(maxValue.toFixed(1))), 6, padding + 5);
  context.fillText(String(Number(minValue.toFixed(1))), 6, height - padding);
  context.fillText("24 h", width - padding - 24, height - 8);
}

async function loadStationHistory() {
  if (!apiBase) {
    setChartStatus("Conecta el backend para ver gráficas reales", "offline");
    Object.entries(chartCanvases).forEach(([field, canvas]) => drawChart(canvas, [], field, "#0f7b52"));
    updateDownloadLinks();
    return;
  }

  try {
    const response = await fetch(
      `${apiBase}/api/stations/${selectedStationId}/readings?days=1&limit=5000`,
      { headers: { Accept: "application/json" } }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const readings = payload.readings || [];
    drawChart(chartCanvases.pm25, readings, "pm25", "#0f7b52");
    drawChart(chartCanvases.pm10, readings, "pm10", "#2978a0");
    drawChart(chartCanvases.co2, readings, "co2", "#805100");
    drawChart(chartCanvases.temp, readings, "temp", "#b84d2a");
    setChartStatus(
      readings.length
        ? `Mostrando ${readings.length} lecturas de las últimas 24 horas`
        : "Sin lecturas en las últimas 24 horas",
      readings.length ? "online" : "offline"
    );
  } catch (error) {
    setChartStatus("No se pudo cargar el histórico", "offline");
  }
}

function updateDownloadLinks() {
  const base = apiBase || "";
  downloadStation.href = `${base}/api/stations/${selectedStationId}/export.xls?days=30`;
  downloadAll.href = `${base}/api/export.xls?days=30`;
}

function mergeStations(apiStations) {
  const nextStations = { ...fallbackStations };

  apiStations.forEach((station) => {
    if (!station.id) return;
    nextStations[station.id] = {
      ...(nextStations[station.id] || {}),
      ...station,
    };
  });

  stations = nextStations;
}

async function loadStations() {
  if (!apiBase) {
    renderStation(selectedStationId);
    return;
  }

  refreshButton.disabled = true;
  setSyncStatus("Consultando backend...", "loading");

  try {
    const response = await fetch(`${apiBase}/api/stations`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    mergeStations(payload.stations || []);
    setSyncStatus("Conectado al backend Sigfox", "online");
  } catch (error) {
    setSyncStatus("Backend no disponible, usando datos locales", "offline");
  } finally {
    refreshButton.disabled = false;
    renderStation(selectedStationId);
    loadStationHistory();
  }
}

menuButton.addEventListener("click", () => {
  const isOpen = nav.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
});

dropdownButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const isOpen = dropdown.classList.toggle("open");
  dropdownButton.setAttribute("aria-expanded", String(isOpen));
});

document.addEventListener("click", () => {
  dropdown.classList.remove("open");
  dropdownButton.setAttribute("aria-expanded", "false");
});

document.querySelectorAll("[data-station-link]").forEach((link) => {
  link.addEventListener("click", () => {
    renderStation(link.dataset.stationLink);
    loadStationHistory();
    nav.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
  });
});

stationButtons.forEach((button) => {
  button.addEventListener("click", () => {
    renderStation(button.dataset.station);
    loadStationHistory();
  });
});

refreshButton.addEventListener("click", () => {
  loadStations();
  loadStationHistory();
});

loadStations();
setInterval(loadStations, 5 * 60 * 1000);
