const stationDefinitions = {
  "encb-principal": {
    id: "encb-principal",
    deviceId: "3DFF9D",
    name: "Estación Principal ENCB",
    description:
      "Monitorea partículas suspendidas y condiciones ambientales del área exterior norte.",
    location: "Exterior norte ENCB",
  },
  "encb-secundaria": {
    id: "encb-secundaria",
    deviceId: "429246",
    name: "Estación Secundaria ENCB",
    description:
      "Da seguimiento al flujo de aire cerca del acceso peatonal y zonas abiertas.",
    location: "Acceso peatonal ENCB",
  },
  "encb-interior": {
    id: "encb-interior",
    deviceId: "3DEB72",
    name: "Estación Interior ENCB",
    description:
      "Revisa condiciones interiores en laboratorios para apoyar decisiones de ventilación.",
    location: "Laboratorios ENCB",
  },
  "esime-central": {
    id: "esime-central",
    deviceId: "",
    name: "Estación Central ESIME",
    description: "Estación pendiente de asignar a un dispositivo Sigfox.",
    location: "Plaza principal ESIME",
  },
  "esime-secundaria": {
    id: "esime-secundaria",
    deviceId: "",
    name: "Estación Secundaria ESIME",
    description: "Estación pendiente de asignar a un dispositivo Sigfox.",
    location: "Zona de talleres ESIME",
  },
};

const configuredApiBase = window.ESIME_API_BASE;
const apiBase =
  typeof configuredApiBase === "string"
    ? configuredApiBase.replace(/\/$/, "")
    : window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:8080"
      : "";

const metrics = [
  { field: "pm25", label: "PM2.5", unit: "ug/m3", color: "#0f7b52", element: "pm25-value" },
  { field: "pm10", label: "PM10", unit: "ug/m3", color: "#2978a0", element: "pm10-value" },
  { field: "co2", label: "CO2", unit: "ppm", color: "#805100", element: "co2-value" },
  { field: "nox", label: "NOx", unit: "ppb", color: "#7a4bc2", element: "nox-value" },
  { field: "ozono", label: "Ozono", unit: "ppb", color: "#2d8f8a", element: "ozono-value" },
  { field: "co", label: "CO", unit: "ppm", color: "#b84d2a", element: "co-value" },
  { field: "so2", label: "SO2", unit: "ppb", color: "#64748b", element: "so2-value" },
  { field: "temperatura", label: "Temperatura", unit: "C", color: "#d97706", element: "temp-value" },
];

const thresholds = {
  pm25: 25,
  pm10: 50,
  co2: 1000,
  nox: 100,
  ozono: 100,
  co: 9,
  so2: 75,
};

let stations = { ...stationDefinitions };
let selectedStationId = "encb-principal";
const chartStates = new WeakMap();

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
const dailyReportLink = document.getElementById("daily-report-link");
const monthlyReportLink = document.getElementById("monthly-report-link");
const alertsReportLink = document.getElementById("alerts-report-link");

function setText(id, value) {
  document.getElementById(id).textContent = value ?? "0";
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  const number = numberOrZero(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function formatUpdate(value) {
  if (!value) return "Sin lectura reciente";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin lectura reciente";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function calculateReferenceIndex(reading) {
  const scores = Object.entries(thresholds).map(([field, limit]) => {
    return limit > 0 ? (numberOrZero(reading[field]) / limit) * 100 : 0;
  });
  return Math.round(Math.max(0, ...scores));
}

function hasRealReading(station) {
  return Boolean(station?.latest || station?.receivedAt || station?.time);
}

function normalizeStation(station) {
  const base = stationDefinitions[station?.id] || {};
  const latest = station?.latest || null;
  const reading = latest || {};
  const hasReading = Boolean(latest);
  const normalized = {
    ...base,
    ...station,
    latest,
    pm25: numberOrZero(reading.pm25),
    pm10: numberOrZero(reading.pm10),
    co2: numberOrZero(reading.co2),
    nox: numberOrZero(reading.nox),
    ozono: numberOrZero(reading.ozono),
    co: numberOrZero(reading.co),
    so2: numberOrZero(reading.so2),
    temperatura: numberOrZero(reading.temperatura),
    update: formatUpdate(reading.receivedAt || reading.time),
    health: hasReading ? "Con lectura recibida" : "Sin lectura recibida",
  };

  normalized.aqi = hasReading ? numberOrZero(reading.aqi) || calculateReferenceIndex(normalized) : 0;
  normalized.level = !hasReading ? "good" : normalized.aqi >= 100 ? "warning" : "good";
  normalized.status = hasReading ? (normalized.level === "warning" ? "Atención" : "Activa") : "Sin lectura";
  return normalized;
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
  const station = normalizeStation(stations[stationId] || stationDefinitions[stationId]);
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

  metrics.forEach((metric) => {
    setText(metric.element, formatNumber(station[metric.field]));
  });

  const stationStatus = document.getElementById("station-state");
  const aqiStatus = document.getElementById("aqi-status");
  stationStatus.className = `status ${station.level}`;
  aqiStatus.className = `status ${station.level}`;

  if (!hasRealReading(station)) {
    aqiStatus.textContent = "Sin lectura";
    setText("aqi-copy", "Esta estación todavía no tiene datos recibidos por Sigfox.");
  } else if (station.level === "warning") {
    aqiStatus.textContent = "Revisar";
    setText("aqi-copy", "El índice interno superó el umbral de referencia configurado.");
  } else {
    aqiStatus.textContent = "Normal";
    setText("aqi-copy", "Lectura dentro del rango de referencia interno.");
  }

  updateDownloadLinks();
}

function mergeStations(apiStations) {
  const nextStations = { ...stationDefinitions };
  apiStations.forEach((station) => {
    if (!station.id) return;
    nextStations[station.id] = {
      ...(nextStations[station.id] || {}),
      ...station,
    };
  });
  stations = nextStations;
}

function getReadingValue(reading, field) {
  return numberOrZero(reading[field]);
}

function getReadingTime(reading) {
  return new Date(reading.receivedAt || reading.time || Date.now());
}

function formatChartTime(date) {
  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function getCanvasPointer(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function findNearestPoint(points, pointer) {
  let nearest = null;
  let nearestDistance = Infinity;

  points.forEach((point) => {
    const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  });

  return nearestDistance <= 14 ? nearest : null;
}

function drawTooltip(context, canvas, point, metric) {
  const concentration = `${formatNumber(point.value)} ${metric.unit}`;
  const time = `Hora: ${formatChartTime(point.time)}`;
  const value = `${metric.label}: ${concentration}`;
  const padding = 10;
  const lineHeight = 18;
  const width = Math.max(context.measureText(time).width, context.measureText(value).width) + padding * 2;
  const height = padding * 2 + lineHeight * 2;
  const x = Math.min(canvas.width - width - 8, Math.max(8, point.x + 12));
  const y = Math.max(8, point.y - height - 14);

  context.fillStyle = "rgba(16, 35, 29, 0.94)";
  context.fillRect(x, y, width, height);
  context.fillStyle = "#ffffff";
  context.font = "700 14px Titillium Web";
  context.fillText(time, x + padding, y + padding + 13);
  context.font = "14px Titillium Web";
  context.fillText(value, x + padding, y + padding + 13 + lineHeight);
}

function renderChart(canvas, activePoint = null) {
  const state = chartStates.get(canvas);
  if (!state) return;

  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 34;
  const { values, metric } = state;

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

  const minTime = state.minTime;
  const maxTime = state.maxTime;
  const maxValue = Math.max(...values.map((point) => point.value), 1);
  const minValue = Math.min(...values.map((point) => point.value), 0);
  const range = Math.max(maxValue - minValue, 1);
  const toX = (time) =>
    padding + ((time.getTime() - minTime) / (maxTime - minTime)) * (width - padding * 2);
  const toY = (value) =>
    height - padding - ((value - minValue) / range) * (height - padding * 2);

  const plottedPoints = values.map((point) => ({
    ...point,
    x: Math.max(padding, Math.min(width - padding, toX(point.time))),
    y: toY(point.value),
  }));

  context.strokeStyle = metric.color;
  context.lineWidth = 3;
  context.beginPath();
  plottedPoints.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.stroke();

  context.fillStyle = metric.color;
  plottedPoints.forEach((point) => {
    const isActive =
      activePoint &&
      point.time.getTime() === activePoint.time.getTime() &&
      point.value === activePoint.value;
    context.beginPath();
    context.arc(point.x, point.y, isActive ? 6 : 4, 0, Math.PI * 2);
    context.fill();
  });

  if (activePoint) {
    context.strokeStyle = "#10231d";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(activePoint.x, activePoint.y, 8, 0, Math.PI * 2);
    context.stroke();
    drawTooltip(context, canvas, activePoint, metric);
  }

  context.fillStyle = "#5a6f67";
  context.font = "15px Titillium Web";
  context.fillText(formatNumber(maxValue), 6, padding + 5);
  context.fillText(formatNumber(minValue), 6, height - padding);

  state.points = plottedPoints;
}

function bindChartPointer(canvas) {
  if (canvas.dataset.tooltipBound === "true") return;

  canvas.dataset.tooltipBound = "true";
  canvas.addEventListener("mousemove", (event) => {
    const state = chartStates.get(canvas);
    const pointer = getCanvasPointer(canvas, event);
    const nearest = state?.points ? findNearestPoint(state.points, pointer) : null;
    canvas.style.cursor = nearest ? "pointer" : "default";
    renderChart(canvas, nearest);
  });
  canvas.addEventListener("mouseleave", () => {
    canvas.style.cursor = "default";
    renderChart(canvas);
  });
}

function drawChart(canvas, readings, metric) {
  const values = readings
    .map((reading) => ({
      value: getReadingValue(reading, metric.field),
      time: getReadingTime(reading),
    }))
    .filter((point) => !Number.isNaN(point.time.getTime()));

  chartStates.set(canvas, {
    metric,
    values,
    points: [],
    minTime: Date.now() - 24 * 60 * 60 * 1000,
    maxTime: Date.now(),
  });
  bindChartPointer(canvas);
  renderChart(canvas);
}

async function loadStationHistory() {
  try {
    const response = await fetch(
      `${apiBase}/api/stations/${selectedStationId}/readings?days=1&limit=5000`,
      { headers: { Accept: "application/json" } }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const readings = payload.readings || [];
    metrics.forEach((metric) => {
      const canvas = document.getElementById(`chart-${metric.field === "temperatura" ? "temp" : metric.field}`);
      if (canvas) drawChart(canvas, readings, metric);
    });
    setChartStatus(
      readings.length
        ? `Mostrando ${readings.length} lecturas de las últimas 24 horas`
        : "Sin lecturas en las últimas 24 horas",
      readings.length ? "online" : "offline"
    );
  } catch (error) {
    setChartStatus("No se pudo cargar el histórico", "offline");
    metrics.forEach((metric) => {
      const canvas = document.getElementById(`chart-${metric.field === "temperatura" ? "temp" : metric.field}`);
      if (canvas) drawChart(canvas, [], metric);
    });
  }
}

function updateDownloadLinks() {
  downloadStation.href = `${apiBase}/api/stations/${selectedStationId}/export.xlsx?days=30`;
  downloadAll.href = `${apiBase}/api/export.xlsx?period=month`;
  dailyReportLink.href = `${apiBase}/api/export.xlsx?period=day`;
  monthlyReportLink.href = `${apiBase}/api/export.xlsx?period=month`;
  alertsReportLink.href = `${apiBase}/api/export.xlsx?period=month`;
}

async function loadStations() {
  refreshButton.disabled = true;
  setSyncStatus("Consultando backend...", "loading");

  try {
    const response = await fetch(`${apiBase}/api/stations`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    mergeStations(payload.stations || []);
    setSyncStatus("Conectado al backend Sigfox", "online");
  } catch (error) {
    stations = { ...stationDefinitions };
    setSyncStatus("No se pudo conectar con el backend", "offline");
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

refreshButton.addEventListener("click", loadStations);

renderStation(selectedStationId);
loadStations();
setInterval(loadStations, 5 * 60 * 1000);
