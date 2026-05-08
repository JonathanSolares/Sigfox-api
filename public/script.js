const fallbackStations = {
  "encb-principal": {
    id: "encb-principal",
    deviceId: "DEMO001",
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
    deviceId: "DEMO002",
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
    deviceId: "DEMO003",
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
    nav.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
  });
});

stationButtons.forEach((button) => {
  button.addEventListener("click", () => renderStation(button.dataset.station));
});

refreshButton.addEventListener("click", loadStations);

loadStations();
