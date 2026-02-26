/* global maplibregl */

const incidentListEl = document.getElementById("incident-list");
const responderListEl = document.getElementById("responder-list");
const missionFileEl = document.getElementById("mission-file");
const recenterBtn = document.getElementById("recenter-btn");
const pingLocationBtn = document.getElementById("ping-location-btn");
const statusLineEl = document.getElementById("status-line");

let snapshotState = null;
let map = null;
const incidentMarkers = new Map();
const responderMarkers = new Map();
const originMarkers = new Map();
const cityLabelMarkers = new Map();
const ASSIGNMENT_SOURCE_ID = "assignment-links";
const PH_BOUNDS = [112.1661, 4.382696, 127.0742, 21.53021];
const PH_CENTER = [121.774, 12.8797];
const DEFAULT_ZOOM = 5.4;
const MIN_ZOOM = 4.3;
const OFFLINE_STYLE_KEY = "__offline-ph-fallback__";
const ORIGIN_STORAGE_KEY = "emergance.dispatch.desktop.origin.id";
let assignmentSourceReady = false;
let currentStyleUrl = null;
let recenterPending = true;
let cameraKey = "";

const REFERENCE_CITY_LABELS = [
  { id: "manila", name: "Manila", lng: 120.9842, lat: 14.5995 },
  { id: "baguio", name: "Baguio", lng: 120.596, lat: 16.4023 },
  { id: "tuguegarao", name: "Tuguegarao", lng: 121.7332, lat: 17.6131 },
  { id: "legazpi", name: "Legazpi", lng: 123.7438, lat: 13.1391 },
  { id: "puerto-princesa", name: "Puerto Princesa", lng: 118.7384, lat: 9.7392 },
  { id: "iloilo", name: "Iloilo", lng: 122.5621, lat: 10.7202 },
  { id: "cebu", name: "Cebu", lng: 123.8854, lat: 10.3157 },
  { id: "tacloban", name: "Tacloban", lng: 125.0, lat: 11.2442 },
  { id: "cdo", name: "Cagayan de Oro", lng: 124.6319, lat: 8.4542 },
  { id: "davao", name: "Davao", lng: 125.4553, lat: 7.1907 },
  { id: "gensan", name: "General Santos", lng: 125.1716, lat: 6.1164 },
  { id: "zamboanga", name: "Zamboanga", lng: 122.079, lat: 6.9214 }
];

function formatTs(ts) {
  if (!ts) {
    return "-";
  }
  return new Date(ts).toLocaleString();
}

function buildOfflineFallbackStyle() {
  return {
    version: 8,
    name: "Emergance Philippines Offline Fallback",
    center: PH_CENTER,
    zoom: DEFAULT_ZOOM,
    sources: {
      landmass: {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { id: "luzon" },
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [120.0, 18.0],
                    [122.4, 16.8],
                    [123.0, 15.0],
                    [121.8, 13.0],
                    [119.5, 14.3],
                    [120.0, 18.0]
                  ]
                ]
              }
            },
            {
              type: "Feature",
              properties: { id: "visayas" },
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [122.2, 12.2],
                    [124.4, 11.4],
                    [123.9, 10.2],
                    [122.1, 10.1],
                    [121.6, 11.2],
                    [122.2, 12.2]
                  ]
                ]
              }
            },
            {
              type: "Feature",
              properties: { id: "mindanao" },
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [124.0, 9.8],
                    [126.6, 8.5],
                    [126.5, 6.2],
                    [123.8, 5.3],
                    [122.5, 7.1],
                    [123.0, 8.9],
                    [124.0, 9.8]
                  ]
                ]
              }
            },
            {
              type: "Feature",
              properties: { id: "palawan" },
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [118.2, 11.8],
                    [119.1, 10.4],
                    [119.0, 8.7],
                    [117.6, 9.3],
                    [118.2, 11.8]
                  ]
                ]
              }
            }
          ]
        }
      }
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": "#dcefff"
        }
      },
      {
        id: "landmass-fill",
        type: "fill",
        source: "landmass",
        paint: {
          "fill-color": "#dce8d0",
          "fill-opacity": 0.92
        }
      },
      {
        id: "landmass-outline",
        type: "line",
        source: "landmass",
        paint: {
          "line-color": "#6e7f66",
          "line-width": 1.2
        }
      }
    ]
  };
}

function statusBadge(status) {
  if (status === "ASSIGNED") {
    return "assigned";
  }
  if (status === "RECEIVED" || status === "UNASSIGNED_RETRY" || status === "PENDING_NETWORK") {
    return "pending";
  }
  return "critical";
}

function updateStatus(text) {
  if (statusLineEl) {
    statusLineEl.textContent = text;
  }
}

function getPhilippinesMaxBounds() {
  return [
    [PH_BOUNDS[0], PH_BOUNDS[1]],
    [PH_BOUNDS[2], PH_BOUNDS[3]]
  ];
}

function isWithinPhilippines(lat, lng) {
  return lng >= PH_BOUNDS[0] && lng <= PH_BOUNDS[2] && lat >= PH_BOUNDS[1] && lat <= PH_BOUNDS[3];
}

function clampToPhilippines(lat, lng) {
  const clampedLng = Math.min(Math.max(lng, PH_BOUNDS[0]), PH_BOUNDS[2]);
  const clampedLat = Math.min(Math.max(lat, PH_BOUNDS[1]), PH_BOUNDS[3]);
  return [clampedLng, clampedLat];
}

function renderReferenceCityLabels() {
  if (!map) {
    return;
  }

  for (const city of REFERENCE_CITY_LABELS) {
    let marker = cityLabelMarkers.get(city.id);
    if (!marker) {
      const el = document.createElement("div");
      el.className = "city-label-marker";
      el.textContent = city.name;
      marker = new maplibregl.Marker({
        element: el,
        anchor: "left",
        offset: [6, 0]
      }).setLngLat([city.lng, city.lat]);
      cityLabelMarkers.set(city.id, marker);
    }
    if (!marker.getElement().isConnected) {
      marker.addTo(map);
    }
    marker.setLngLat([city.lng, city.lat]);
  }
}

function resolveOriginId() {
  const existing = localStorage.getItem(ORIGIN_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const generated = `desktop-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
  localStorage.setItem(ORIGIN_STORAGE_KEY, generated);
  return generated;
}

function requestCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not available on this desktop runtime"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      (error) => reject(error),
      {
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 0
      }
    );
  });
}

async function pingCurrentOrigin(reason) {
  try {
    updateStatus(`${reason}: acquiring location...`);
    const position = await requestCurrentLocation();
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const action = {
      type: "PING_ORIGIN",
      source: "DESKTOP",
      sourceId: resolveOriginId(),
      lat,
      lng,
      accuracyM: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : 0,
      pingAtMs: Date.now()
    };

    await sendAction(action);
    const scope = isWithinPhilippines(lat, lng) ? "inside Philippines" : "outside Philippines bounds";
    updateStatus(`${reason}: location pinged (${lat.toFixed(5)}, ${lng.toFixed(5)}) ${scope}.`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    updateStatus(`${reason}: location ping failed (${message}).`);
  }
}

async function sendAction(action) {
  await window.emerganceAPI.action(action);
}

function renderIncidents(incidents) {
  incidentListEl.innerHTML = "";

  for (const incident of incidents) {
    const li = document.createElement("li");
    li.className = "card";

    li.innerHTML = `
      <div class="row">
        <strong>${incident.id.slice(0, 8)}</strong>
        <span class="badge ${statusBadge(incident.status)}">${incident.status}</span>
      </div>
      <div class="row"><span>Lat/Lng</span><code>${incident.lat.toFixed(5)}, ${incident.lng.toFixed(5)}</code></div>
      <div class="row"><span>Created</span><span>${formatTs(incident.createdAtMs)}</span></div>
      <div class="row"><span>Assigned</span><span>${incident.assignedDriverId || "-"}</span></div>
      <div class="actions">
        <button data-action="reassign">Reassign</button>
        <button data-action="resolve">Resolve</button>
        <button data-action="cancel">Cancel</button>
      </div>
    `;

    li.querySelector('[data-action="reassign"]').addEventListener("click", () =>
      sendAction({ type: "REASSIGN", incidentId: incident.id })
    );
    li.querySelector('[data-action="resolve"]').addEventListener("click", () =>
      sendAction({ type: "SET_INCIDENT_STATUS", incidentId: incident.id, status: "RESOLVED" })
    );
    li.querySelector('[data-action="cancel"]').addEventListener("click", () =>
      sendAction({ type: "SET_INCIDENT_STATUS", incidentId: incident.id, status: "CANCELLED" })
    );

    incidentListEl.appendChild(li);
  }
}

function renderResponders(responders) {
  responderListEl.innerHTML = "";

  for (const responder of responders) {
    const li = document.createElement("li");
    li.className = "card";

    li.innerHTML = `
      <div class="row">
        <strong>${responder.name}</strong>
        <span class="badge ${responder.status === "AVAILABLE" ? "assigned" : "pending"}">${responder.status}</span>
      </div>
      <div class="row"><span>Lat/Lng</span><code>${responder.lastLat.toFixed(5)}, ${responder.lastLng.toFixed(5)}</code></div>
      <div class="row"><span>Battery</span><span>${responder.batteryPct}%</span></div>
      <div class="row"><span>Last fix</span><span>${formatTs(responder.lastFixAtMs)}</span></div>
      <div class="actions">
        <button data-action="available">Set Available</button>
        <button data-action="unavailable">Set Unavailable</button>
      </div>
    `;

    li.querySelector('[data-action="available"]').addEventListener("click", () =>
      sendAction({ type: "SET_RESPONDER_AVAILABILITY", deviceId: responder.deviceId, available: true })
    );
    li.querySelector('[data-action="unavailable"]').addEventListener("click", () =>
      sendAction({ type: "SET_RESPONDER_AVAILABILITY", deviceId: responder.deviceId, available: false })
    );

    responderListEl.appendChild(li);
  }
}

function ensureMap(styleUrl) {
  if (typeof maplibregl === "undefined") {
    return;
  }
  const resolvedStyle = styleUrl || buildOfflineFallbackStyle();
  const resolvedStyleKey = styleUrl || OFFLINE_STYLE_KEY;

  if (!map) {
    map = new maplibregl.Map({
      container: "map",
      style: resolvedStyle,
      center: PH_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: MIN_ZOOM,
      maxZoom: 16,
      pitchWithRotate: false,
      dragRotate: false,
      attributionControl: false
    });
    currentStyleUrl = resolvedStyleKey;

    map.on("load", () => {
      assignmentSourceReady = false;
      applyMapBoundsFromStyle();
      renderReferenceCityLabels();
      map.resize();
      if (snapshotState) {
        renderMap(snapshotState);
      } else {
        map.fitBounds(getPhilippinesMaxBounds(), { padding: 20, duration: 0, maxZoom: 6.2 });
      }
    });

    window.addEventListener("resize", () => map && map.resize());
    return;
  }

  if (currentStyleUrl !== resolvedStyleKey) {
    assignmentSourceReady = false;
    currentStyleUrl = resolvedStyleKey;
    recenterPending = true;
    cameraKey = "";
    map.setStyle(resolvedStyle);
  }
}

function applyMapBoundsFromStyle() {
  if (!map) {
    return;
  }

  const style = map.getStyle();
  const source = style && style.sources ? style.sources.offline : null;
  const bounds = source && Array.isArray(source.bounds) ? source.bounds : null;
  if (bounds && bounds.length === 4 && bounds.every((value) => Number.isFinite(value))) {
    const merged = [
      Math.max(PH_BOUNDS[0], bounds[0]),
      Math.max(PH_BOUNDS[1], bounds[1]),
      Math.min(PH_BOUNDS[2], bounds[2]),
      Math.min(PH_BOUNDS[3], bounds[3])
    ];
    if (merged[0] < merged[2] && merged[1] < merged[3]) {
      map.setMaxBounds([
        [merged[0], merged[1]],
        [merged[2], merged[3]]
      ]);
      map.setMinZoom(MIN_ZOOM);
      return;
    }
  }

  map.setMaxBounds(getPhilippinesMaxBounds());
  map.setMinZoom(MIN_ZOOM);
}

function ensureAssignmentLayer() {
  if (!map || assignmentSourceReady || !map.isStyleLoaded()) {
    return;
  }

  if (!map.getSource(ASSIGNMENT_SOURCE_ID)) {
    map.addSource(ASSIGNMENT_SOURCE_ID, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: []
      }
    });
  }

  if (!map.getLayer("assignment-lines")) {
    map.addLayer({
      id: "assignment-lines",
      type: "line",
      source: ASSIGNMENT_SOURCE_ID,
      paint: {
        "line-color": "#1368ce",
        "line-width": 4,
        "line-opacity": 0.75,
        "line-dasharray": [1.2, 1.1]
      }
    });
  }

  assignmentSourceReady = true;
}

function renderMap(snapshot) {
  ensureMap(snapshot.mapStyleUrl);
  if (!map) {
    return;
  }

  renderReferenceCityLabels();
  ensureAssignmentLayer();
  const bounds = new maplibregl.LngLatBounds();
  let hasBounds = false;
  const nextCameraKey = buildCameraKey(snapshot);

  for (const incident of snapshot.incidents) {
    let marker = incidentMarkers.get(incident.id);
    if (!marker) {
      const el = document.createElement("div");
      el.className = "incident-marker";
      marker = new maplibregl.Marker({ element: el }).setLngLat(clampToPhilippines(incident.lat, incident.lng)).addTo(map);
      incidentMarkers.set(incident.id, marker);
    }
    marker.setLngLat(clampToPhilippines(incident.lat, incident.lng));
    marker.getElement().className = `incident-marker ${incident.status === "ASSIGNED" ? "assigned" : "active"}`;
    if (isWithinPhilippines(incident.lat, incident.lng)) {
      bounds.extend([incident.lng, incident.lat]);
      hasBounds = true;
    }
  }

  for (const [incidentId, marker] of incidentMarkers.entries()) {
    if (!snapshot.incidents.find((item) => item.id === incidentId)) {
      marker.remove();
      incidentMarkers.delete(incidentId);
    }
  }

  for (const responder of snapshot.responders) {
    let marker = responderMarkers.get(responder.deviceId);
    if (!marker) {
      const el = document.createElement("div");
      el.className = "responder-marker";
      marker = new maplibregl.Marker({ element: el })
        .setLngLat(clampToPhilippines(responder.lastLat, responder.lastLng))
        .addTo(map);
      responderMarkers.set(responder.deviceId, marker);
    }
    marker.setLngLat(clampToPhilippines(responder.lastLat, responder.lastLng));
    marker.getElement().className = `responder-marker ${
      responder.status === "AVAILABLE" ? "available" : "unavailable"
    }`;
    if (isWithinPhilippines(responder.lastLat, responder.lastLng)) {
      bounds.extend([responder.lastLng, responder.lastLat]);
      hasBounds = true;
    }
  }

  for (const [deviceId, marker] of responderMarkers.entries()) {
    if (!snapshot.responders.find((item) => item.deviceId === deviceId)) {
      marker.remove();
      responderMarkers.delete(deviceId);
    }
  }

  const origins = Array.isArray(snapshot.origins) ? snapshot.origins : [];
  for (const origin of origins) {
    const markerId = `${origin.source}:${origin.sourceId}`;
    let marker = originMarkers.get(markerId);
    if (!marker) {
      const el = document.createElement("div");
      el.className = "origin-marker";
      marker = new maplibregl.Marker({ element: el })
        .setLngLat(clampToPhilippines(origin.lat, origin.lng))
        .addTo(map);
      originMarkers.set(markerId, marker);
    }

    marker.setLngLat(clampToPhilippines(origin.lat, origin.lng));
    marker.getElement().className = `origin-marker source-${String(origin.source || "unknown").toLowerCase()}`;

    if (isWithinPhilippines(origin.lat, origin.lng)) {
      bounds.extend([origin.lng, origin.lat]);
      hasBounds = true;
    }
  }

  for (const [originKey, marker] of originMarkers.entries()) {
    const stillPresent = origins.some((origin) => `${origin.source}:${origin.sourceId}` === originKey);
    if (!stillPresent) {
      marker.remove();
      originMarkers.delete(originKey);
    }
  }

  const assignmentFeatures = [];
  for (const incident of snapshot.incidents) {
    if (!incident.assignedDriverId) {
      continue;
    }
    const responder = snapshot.responders.find((item) => item.deviceId === incident.assignedDriverId);
    if (!responder) {
      continue;
    }

    assignmentFeatures.push({
      type: "Feature",
      properties: {
        incidentId: incident.id,
        driverId: responder.deviceId
      },
      geometry: {
        type: "LineString",
        coordinates: [
          clampToPhilippines(responder.lastLat, responder.lastLng),
          clampToPhilippines(incident.lat, incident.lng)
        ]
      }
    });
  }

  const assignmentSource = map.getSource(ASSIGNMENT_SOURCE_ID);
  if (assignmentSource && assignmentSource.setData) {
    assignmentSource.setData({
      type: "FeatureCollection",
      features: assignmentFeatures
    });
  }

  if (hasBounds && (recenterPending || cameraKey !== nextCameraKey)) {
    map.fitBounds(bounds, { padding: 45, maxZoom: 15, duration: 350 });
    recenterPending = false;
    cameraKey = nextCameraKey;
    return;
  }

  if (!hasBounds && recenterPending) {
    map.fitBounds(getPhilippinesMaxBounds(), { padding: 24, maxZoom: 6.2, duration: 250 });
    recenterPending = false;
    cameraKey = nextCameraKey;
  }
}

function buildCameraKey(snapshot) {
  const incidents = snapshot.incidents.map((incident) => `${incident.id}:${incident.status}`).join("|");
  const responders = snapshot.responders.map((responder) => `${responder.deviceId}:${responder.status}`).join("|");
  const origins = Array.isArray(snapshot.origins)
    ? snapshot.origins
        .map((origin) => `${origin.source}:${origin.sourceId}:${origin.lastPingAtMs}`)
        .join("|")
    : "";
  return `${incidents}#${responders}#${origins}`;
}

function render(snapshot) {
  snapshotState = snapshot;
  renderIncidents(snapshot.incidents);
  renderResponders(snapshot.responders);
  renderMap(snapshot);
  const originCount = Array.isArray(snapshot.origins) ? snapshot.origins.length : 0;
  updateStatus(`Last sync: ${formatTs(snapshot.lastUpdatedMs)} | origin pings: ${originCount}`);
}

async function boot() {
  missionFileEl.textContent = await window.emerganceAPI.missionFilePath();
  const snapshot = await window.emerganceAPI.getSnapshot();
  if (snapshot) {
    render(snapshot);
  }

  window.emerganceAPI.onState((state) => {
    render(state);
  });

  if (recenterBtn) {
    recenterBtn.addEventListener("click", () => {
      recenterPending = true;
      if (snapshotState) {
        renderMap(snapshotState);
      }
    });
  }

  if (pingLocationBtn) {
    pingLocationBtn.addEventListener("click", () => {
      void pingCurrentOrigin("Manual ping");
    });
  }

  void pingCurrentOrigin("Startup ping");
}

boot();
