const KHARTOUM = [15.5007, 32.5599];
const SUDAN_BOUNDS = { south: 3, west: 21, north: 23, east: 39 };
const PROVIDERS = {
  1: { name: 'زين', color: '#2f7459' },
  2: { name: 'MTN', color: '#d3a33f' },
  7: { name: 'سوداني', color: '#dc6149' },
};
const TECHNOLOGIES = {
  GSM: { generation: '2G', label: 'GSM', color: '#d3a33f' },
  UMTS: { generation: '3G', label: 'UMTS', color: '#477a9d' },
  LTE: { generation: '4G', label: 'LTE', color: '#2f7459' },
  NR: { generation: '5G', label: 'NR', color: '#dc6149' },
  NBIOT: { generation: '4G', label: 'NB-IoT', color: '#2f7459' },
};
const MANUAL_CELLS = [{
  mcc: 634,
  mnc: 7,
  lac: 15,
  radio: 'UMTS',
  lat: 15.266189575195,
  lon: 32.922592163086,
  range: 1000,
  samples: 1,
}, {
  mcc: 634,
  mnc: 7,
  lac: 24,
  radio: 'UMTS',
  lat: 15.26481628418,
  lon: 32.923965454102,
  range: 1000,
  samples: 1,
}];

const map = L.map('map', { zoomControl: false, minZoom: 6, maxZoom: 16 }).setView(KHARTOUM, 6);
L.control.zoom({ position: 'bottomleft' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const cellsLayer = L.layerGroup().addTo(map);
const locationLayer = L.layerGroup().addTo(map);
const stateDot = document.getElementById('map-state-dot');
const stateText = document.getElementById('map-state-text');
const locationState = document.getElementById('location-state');
const cellCount = document.getElementById('cell-count');
const refreshMeta = document.getElementById('refresh-meta');
const refreshButton = document.getElementById('refresh-button');
let cells = [...MANUAL_CELLS];
let requestController = null;
let debounceTimer = null;

function hasValue(value) {
  return value !== null && value !== undefined
    && !(typeof value === 'string' && value.trim() === '');
}

function radioValue(cell) {
  return String(cell.radio || '').toUpperCase();
}

function networkValue(cell) {
  const rawValue = cell.mnc ?? cell.net;
  if (!hasValue(rawValue)) return 'other';
  const value = Number(rawValue);
  return Number.isFinite(value) ? String(value) : 'other';
}

function activeValues(name) {
  return new Set([...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value));
}

function isInSudan(latitude, longitude) {
  return latitude >= SUDAN_BOUNDS.south && latitude <= SUDAN_BOUNDS.north
    && longitude >= SUDAN_BOUNDS.west && longitude <= SUDAN_BOUNDS.east;
}

function providerFor(cell) {
  const code = networkValue(cell);
  return PROVIDERS[code] || { name: 'شبكة أخرى', color: '#8b8e88' };
}

function visibleCells() {
  const networks = activeValues('network');
  const generations = activeValues('generation');
  const bounds = map.getBounds();
  return cells.filter((cell) => {
    const tech = TECHNOLOGIES[radioValue(cell)];
    if (!tech || !generations.has(tech.generation)) return false;
    const latitude = Number(cell.lat);
    const longitude = Number(cell.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || !bounds.contains([latitude, longitude])) return false;
    const network = networkValue(cell);
    return networks.has(PROVIDERS[network] ? network : 'other');
  });
}

function popupLine(text) {
  const line = document.createElement('div');
  line.textContent = text;
  return line;
}

function popupFor(cell, provider, tech) {
  const popup = document.createElement('div');
  const title = popupLine(provider.name);
  title.className = 'popup-title';
  popup.append(title);

  const meta = document.createElement('div');
  meta.className = 'popup-meta';
  const technology = document.createElement('span');
  technology.className = 'popup-tech';
  technology.textContent = `${tech.generation} · ${tech.label}`;
  meta.append(technology, popupLine(`رمز الشبكة: ${networkValue(cell)}`));

  const areaCode = hasValue(cell.lac) ? cell.lac : cell.tac;
  const details = [
    hasValue(cell.mcc) ? `MCC: ${cell.mcc}` : '',
    hasValue(cell.mnc) ? `MNC: ${cell.mnc}` : '',
    hasValue(areaCode) ? `LAC / TAC: ${areaCode}` : '',
    hasValue(cell.range) && Number.isFinite(Number(cell.range)) ? `النطاق: ${Number(cell.range)} م` : '',
  ];
  for (const detail of details) {
    if (detail) meta.append(popupLine(detail));
  }

  const rawSignal = cell.averageSignalStrength ?? cell.averageSignal;
  if (hasValue(rawSignal)) {
    const signal = Number(rawSignal);
    if (Number.isFinite(signal)) meta.append(popupLine(`متوسط الإشارة المسجل: ${signal} dBm`));
  }
  const samples = Number(cell.samples);
  meta.append(popupLine(`عدد القياسات: ${Number.isFinite(samples) && samples > 0 ? samples : 'غير متاح'}`));
  popup.append(meta);
  return popup;
}

function renderCells() {
  cellsLayer.clearLayers();
  const filtered = visibleCells();
  let renderedCount = 0;
  for (const cell of filtered) {
    const latitude = Number(cell.lat);
    const longitude = Number(cell.lon);
    const tech = TECHNOLOGIES[radioValue(cell)];
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !tech) continue;

    const provider = providerFor(cell);
    const marker = L.circleMarker([latitude, longitude], {
      radius: tech.generation === '5G' ? 6 : 5,
      color: provider.color,
      weight: 2,
      fillColor: tech.color,
      fillOpacity: 0.9,
    });
    marker.bindPopup(popupFor(cell, provider, tech));
    marker.addTo(cellsLayer);
    renderedCount += 1;
  }
  cellCount.textContent = renderedCount.toLocaleString('ar');
}

function setMapState(state, message) {
  stateDot.className = `map-state-dot${state ? ` ${state}` : ''}`;
  stateText.textContent = message;
}

function bboxAround(center) {
  const latDelta = 0.008;
  const lonDelta = latDelta / Math.max(Math.cos(center[0] * Math.PI / 180), 0.5);
  const south = Math.max(SUDAN_BOUNDS.south, center[0] - latDelta);
  const north = Math.min(SUDAN_BOUNDS.north, center[0] + latDelta);
  const west = Math.max(SUDAN_BOUNDS.west, center[1] - lonDelta);
  const east = Math.min(SUDAN_BOUNDS.east, center[1] + lonDelta);
  return [south, west, north, east].map((value) => value.toFixed(5)).join(',');
}

async function loadCells() {
  if (requestController) requestController.abort();
  requestController = null;
  const center = map.getCenter();
  if (!isInSudan(center.lat, center.lng)) {
    cells = [...MANUAL_CELLS];
    renderCells();
    setMapState('error', 'الخريطة متاحة داخل السودان');
    refreshMeta.textContent = 'الموقع خارج نطاق السودان';
    refreshButton.disabled = false;
    return;
  }

  const controller = new AbortController();
  requestController = controller;
  setMapState('loading', 'جارٍ تحديث بيانات المنطقة');
  refreshButton.disabled = true;
  refreshMeta.textContent = 'جاري جلب الخلايا المرصودة';

  try {
    const response = await fetch(`/api/cells?bbox=${encodeURIComponent(bboxAround([center.lat, center.lng]))}`, {
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'تعذر تحميل بيانات الخلايا.');

    cells = [...MANUAL_CELLS, ...payload.cells];
    renderCells();
    setMapState('', 'بيانات الخلايا المرصودة');
    refreshMeta.textContent = `آخر تحديث ${new Date().toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    if (error.name === 'AbortError') return;
    renderCells();
    setMapState('error', cells.length ? 'تعذر التحديث؛ تعرض آخر بيانات متاحة' : 'بيانات الخلايا غير متاحة');
    refreshMeta.textContent = error.message;
  } finally {
    if (requestController === controller) {
      requestController = null;
      refreshButton.disabled = false;
    }
  }
}

function scheduleLoad() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadCells, 650);
}

function locateUser() {
  if (!navigator.geolocation) {
    locationState.textContent = 'تحديد الموقع غير متاح؛ نعرض الخرطوم.';
    map.setView(KHARTOUM, 10);
    return;
  }

  locationState.textContent = 'جارٍ طلب موقعك من المتصفح…';
  navigator.geolocation.getCurrentPosition((position) => {
    const { latitude, longitude } = position.coords;
    if (!isInSudan(latitude, longitude)) {
      locationState.textContent = 'موقعك خارج السودان؛ نعرض الخرطوم.';
      map.setView(KHARTOUM, 10);
      return;
    }

    const userLocation = [latitude, longitude];
    locationLayer.clearLayers();
    L.circleMarker(userLocation, {
      radius: 7,
      color: '#fbfaf6',
      weight: 2,
      fillColor: '#202c27',
      fillOpacity: 1,
    }).bindTooltip('موقعك').addTo(locationLayer);
    map.setView(userLocation, 11);
    locationState.textContent = 'الخريطة حول موقعك الحالي.';
  }, () => {
    locationState.textContent = 'تعذر تحديد موقعك؛ نعرض الخرطوم ويمكنك تحريك الخريطة.';
    map.setView(KHARTOUM, 10);
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

document.querySelectorAll('input[name="network"], input[name="generation"]').forEach((input) => {
  input.addEventListener('change', renderCells);
});

document.getElementById('all-networks').addEventListener('click', () => {
  document.querySelectorAll('input[name="network"]').forEach((input) => { input.checked = true; });
  renderCells();
});

document.getElementById('locate-button').addEventListener('click', locateUser);
refreshButton.addEventListener('click', loadCells);
map.on('moveend', scheduleLoad);

if (navigator.geolocation) locateUser();
else {
  locationState.textContent = 'تحديد الموقع غير متاح؛ نعرض الخرطوم.';
  map.setView(KHARTOUM, 10);
}