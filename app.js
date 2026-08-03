(function () {
  'use strict';

  var D = window.RYB_DATA;
  var G = window.RYB_GUIDE;
  var RULES = window.RYB_RULES || null;
  var REGIONS = D.regions;
  var ALL_FISH = [];
  var seen = {};
  D.spots.forEach(function (s) {
    s.fish.forEach(function (f) { if (!seen[f]) { seen[f] = 1; ALL_FISH.push(f); } });
  });
  ALL_FISH.sort();
  var PRED_FISH = ['щука', 'судак', 'окунь', 'сом', 'жерех', 'налим'];

  var state = {
    origin: null,
    regions: [],
    types: [],
    fishes: [],
    radius: 0,
    mapMin: 0,
    layers: { paid: true, free: true, fav: false, fm: true },
    q: '',
    list: { fav: false, free: false, paid: false, min: 0, types: [], fishes: [], regions: [] },
    useDist: true,
    chartKeys: ['bite'],
    legendOpen: false,
    sort: 'score',
    favs: loadFavs(),
    tab: 'map',
    weather: null,
    weatherAt: 0,
    weatherLoc: null,
    weatherHourly: null,
    dayIdx: -1
  };

  var els = {};
  var map = null, clusterFree = null, clusterPaid = null, markers = {}, radiusLayer = null, dayBannerShown = false;
  var fisherCluster = null, fmItems = [], fmVisible = {};
  var FISHER = (window.RYB_FISHER && window.RYB_FISHER.spots) ? window.RYB_FISHER.spots : [];
  var origTimer = null, origItems = [];

  function $(id) { return document.getElementById(id); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function loadFavs() {
    var favsMigrated = false;
    var out = new Set();
    try {
      var arr = JSON.parse(localStorage.getItem('rb.favs') || '[]');
      var idSet = {}, nameMap = {};
      D.spots.forEach(function (s) { idSet[String(s.id)] = 1; nameMap[s.name] = s; });
      arr.forEach(function (k) {
        k = String(k);
        if (idSet[k]) { out.add(k); return; }
        var byName = nameMap[String(k).split('|')[0]] || nameMap[k];
        if (byName) { out.add(String(byName.id)); favsMigrated = true; }
      });
    } catch (e) { return new Set(); }
    if (favsMigrated) {
      try { localStorage.setItem('rb.favs', JSON.stringify(Array.from(out))); } catch (e2) {}
    }
    return out;
  }
  function saveFavs() { try { localStorage.setItem('rb.favs', JSON.stringify(Array.from(state.favs))); } catch (e) {} }

  function saveState() {
    try {
      localStorage.setItem('rb.state', JSON.stringify({
        tab: state.tab, regions: state.regions, types: state.types, fishes: state.fishes,
        radius: state.radius, sort: state.sort, q: state.q, list: state.list, useDist: state.useDist,
        mapMin: state.mapMin, layers: state.layers,
        dayIdx: state.dayIdx, chartKeys: state.chartKeys, legendOpen: state.legendOpen,
        weatherAt: state.weatherAt
      }));
    } catch (e) {}
  }

  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem('rb.state') || 'null');
      if (!s) return;
      if (s.tab) state.tab = s.tab;
      if (Array.isArray(s.regions)) state.regions = s.regions;
      if (Array.isArray(s.types)) state.types = s.types;
      if (Array.isArray(s.fishes)) state.fishes = s.fishes;
      if (s.radius) state.radius = s.radius;
      if (typeof s.mapMin === 'number') state.mapMin = s.mapMin;
      if (s.sort) state.sort = s.sort;
      if (typeof s.q === 'string') state.q = s.q;
      if (s.list) {
        state.list.fav = !!s.list.fav; state.list.free = !!s.list.free;
        state.list.min = s.list.min || 0;
        state.list.types = s.list.types || []; state.list.fishes = s.list.fishes || [];
        state.list.regions = Array.isArray(s.list.regions) ? s.list.regions : [];
      }
      if (typeof s.dayIdx === 'number') state.dayIdx = s.dayIdx;
      if (typeof s.useDist === 'boolean') state.useDist = s.useDist;
      if (Array.isArray(s.chartKeys) && s.chartKeys.length) state.chartKeys = s.chartKeys.filter(function (k) { return ['bite', 'temp', 'precip', 'wind'].indexOf(k) >= 0; });
      state.legendOpen = !!s.legendOpen;
      if (s.layers) {
        var lay = { paid: true, free: true, fav: false, fm: true };
        state.layers.paid = typeof s.layers.paid === 'boolean' ? s.layers.paid : lay.paid;
        state.layers.free = typeof s.layers.free === 'boolean' ? s.layers.free : lay.free;
        state.layers.fav = typeof s.layers.fav === 'boolean' ? s.layers.fav : lay.fav;
        state.layers.fm = typeof s.layers.fm === 'boolean' ? s.layers.fm : lay.fm;
      }
      if (typeof s.weatherAt === 'number' && s.weatherAt > 0) {
        state.weatherAt = s.weatherAt;
        if (Date.now() - state.weatherAt <= 30 * 60000) {
          try {
            var w = JSON.parse(localStorage.getItem('rb.weather') || 'null');
            if (w && w.daily && w.daily.time && w.hourly && w.loc) {
              state.weather = w.daily;
              state.weatherHourly = w.hourly;
              state.weatherLoc = w.loc;
            } else state.weatherAt = 0;
          } catch (e) { state.weatherAt = 0; }
        } else state.weatherAt = 0;
      }
    } catch (e) {}
  }

  function setPanelChecks(panel, vals, allId) {
    var all = allId ? panel.querySelector('#' + allId) : null;
    if (all) all.checked = !vals.length;
    panel.querySelectorAll('input').forEach(function (cb) {
      if (allId && cb.id === allId) return;
      cb.checked = vals.some(function (v) { return String(v) === String(cb.value); });
    });
  }
  function favKey(s) { return String(s.id); }
  function normFish(s) { return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е'); }
  function distKm(aLat, aLon, bLat, bLon) {
    var R = 6371, dLat = (bLat - aLat) * Math.PI / 180, dLon = (bLon - aLon) * Math.PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtDist(km) { return km < 1 ? Math.round(km * 1000) + ' м' : (km < 10 ? km.toFixed(1) : Math.round(km)) + ' км'; }

  function buildActivity() {
    D.spots.forEach(function (s) {
      var n = 0;
      for (var i = 0; i < FISHER.length; i++) {
        if (distKm(s.lat, s.lon, FISHER[i].lat, FISHER[i].lon) <= 5) n++;
      }
      s._act = n;
    });
  }

  function spotScore(s) {
    if (state.origin && state.useDist) {
      var d = distKm(state.origin.lat, state.origin.lon, s.lat, s.lon);
      s._d = d;
      var distS = 1 - Math.min(d, 80) / 80;
      var spS = Math.min(1, s.fish.length / 3);
      var frS = s.paid ? 0 : 1;
      return Math.round(55 * distS + 25 * spS + 20 * frS);
    }
    var divPts = s.fish.length >= 5 ? 100 : s.fish.length * 20;
    var paidPts = s.paid ? 40 : 100;
    var notePts = s.note ? 100 : 0;
    var typePts = s.t === 'река' ? 100 : s.t === 'озеро' ? 85 : s.t === 'вдхр' ? 80 : s.t === 'канал' ? 70 : s.t === 'пруд' ? 60 : 0;
    var actPts = s._act === 0 ? 0 : s._act <= 2 ? 40 : s._act <= 5 ? 60 : s._act <= 10 ? 75 : s._act <= 20 ? 90 : 100;
    var nPred = 0;
    for (var i = 0; i < PRED_FISH.length; i++) if (s.fish.indexOf(PRED_FISH[i]) >= 0) nPred++;
    var predPts = nPred === 0 ? 0 : nPred === 1 ? 50 : nPred === 2 ? 75 : nPred === 3 ? 90 : 100;
    return Math.round((20 * divPts + 20 * paidPts + 10 * notePts + 10 * typePts + 30 * actPts + 10 * predPts) / 100);
  }

  function isVisible(s) {
    if (state.types.length && state.types.indexOf(s.t) < 0) return false;
    if (state.fishes.length && !state.fishes.some(function (f) { return s.fish.some(function (sf) { return normFish(sf) === normFish(f); }); })) return false;
    if (state.q) {
      var q = state.q.toLowerCase();
      var hay = (s.name + ' ' + s.fish.join(' ') + ' ' + (s.note || '') + ' ' + REGIONS[s.r]).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    if (state.origin && state.radius > 0 && s._d > state.radius) return false;
    return true;
  }

  function isListVisible(s) {
    if (state.q) {
      var q = state.q.toLowerCase();
      var hay = (s.name + ' ' + s.fish.join(' ') + ' ' + (s.note || '') + ' ' + REGIONS[s.r]).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    if (state.list.fav && !state.favs.has(favKey(s))) return false;
    if (state.list.free && s.paid) return false;
    if (state.list.paid && !s.paid) return false;
    if (state.list.min > 0 && spotScore(s) < state.list.min) return false;
    if (state.list.types.length && state.list.types.indexOf(s.t) < 0) return false;
    if (state.list.regions.length && state.list.regions.indexOf(s.r) < 0) return false;
    if (state.list.fishes.length && !state.list.fishes.some(function (f) { return s.fish.some(function (sf) { return normFish(sf) === normFish(f); }); })) return false;
    return true;
  }

  function isLayerVisible(s) {
    if (s.paid && !state.layers.paid) return false;
    if (!s.paid && !state.layers.free) return false;
    if (state.layers.fav && !state.favs.has(favKey(s))) return false;
    return true;
  }

  function isMapVisible(s) {
    if (state.mapMin > 0 && spotScore(s) < state.mapMin) return false;
    if (state.regions.length && state.regions.indexOf(s.r) < 0) return false;
    return true;
  }

  var NOMINATIM = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=by&q=';
  function geocode(name, cb) {
    var key = 'rb.geo.' + name.toLowerCase();
    try {
      var cached = localStorage.getItem(key);
      if (cached) { cb(JSON.parse(cached)); return; }
    } catch (e) {}
    fetch(NOMINATIM + encodeURIComponent(name))
      .then(function (r) { return r.json(); })
      .then(function (a) {
        if (!a || !a.length) { cb(null); return; }
        var o = { name: name, lat: parseFloat(a[0].lat), lon: parseFloat(a[0].lon) };
        try { localStorage.setItem(key, JSON.stringify(o)); } catch (e) {}
        cb(o);
      })
      .catch(function () { cb(null); });
  }

  function setOrigin(o, silent) {
    state.origin = o;
    state.weatherAt = 0;
    try { localStorage.setItem('rb.origin', JSON.stringify(o)); } catch (e) {}
    D.spots.forEach(function (s) { s._d = state.origin ? distKm(state.origin.lat, state.origin.lon, s.lat, s.lon) : null; });
    FISHER.forEach(function (f) { f._d = state.origin ? distKm(state.origin.lat, state.origin.lon, f.lat, f.lon) : null; });
    D.spots.forEach(function (s) { s._score = spotScore(s); });
    if (state.origin && state.radius > 0) updateRadius();
    refreshMarkers();
    renderCards();
    renderList();
    if (!silent && state.tab === 'weather') loadWeather();
  }

  var mapOpts = {
    preferCanvas: true,
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: true,
    inertia: true,
    zoomSnap: 1,
    zoomDelta: 1,
    minZoom: 6,
    maxZoom: 18,
    attributionControl: true
  };

  function makeCluster(col) {
    return L.markerClusterGroup({
      maxClusterRadius: 40,
      disableClusteringAtZoom: 14,
      chunkedLoading: true,
      chunkInterval: 120,
      spiderfyOnMaxZoom: false,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      animate: true,
      iconCreateFunction: function (c) {
        var n = c.getChildCount();
        return L.divIcon({
          html: '<div style="width:26px;height:26px;border-radius:50%;background:rgba(19,28,43,.94);border:1px solid ' + col + ';color:' + col + ';font-weight:700;font-size:11px;display:flex;align-items:center;justify-content:center">' + n + '</div>',
          className: '', iconSize: [26, 26], iconAnchor: [13, 13]
        });
      }
    });
  }

  function initMap() {
    map = L.map('map', mapOpts).setView([53.7, 27.6], 7);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 2
    }).addTo(map);
    clusterFree = makeCluster('#3ecf8e');
    clusterPaid = makeCluster('#ffb454');
    map.addLayer(clusterFree);
    map.addLayer(clusterPaid);
    var mw = document.getElementById('mapwrap');
    if (mw && window.ResizeObserver) {
      new ResizeObserver(function () {
        if (els.viewMap.classList.contains('hide')) return;
        requestAnimationFrame(function () { map.invalidateSize(); });
      }).observe(mw);
    }
  }

  function iconColor(s) { return s.paid ? '#ffb454' : '#3ecf8e'; }

  function buildMarkers() {
    markers = {};
    var maxW = Math.min(320, (window.innerWidth || 320) - 48);
    D.spots.forEach(function (s) {
      var m = L.marker([s.lat, s.lon], {
        icon: L.divIcon({
          html: '<div style="width:22px;height:22px;border-radius:50%;background:' + iconColor(s) + ';border:2px solid #0d1420"></div>',
          className: '',
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        })
      });
      m.bindPopup('', { closeButton: true, maxWidth: maxW });
      m.on('popupopen', function () {
        m.setPopupContent(popupHtml(m._spot));
        bindPopupEvents(m, m._spot);
      });
      m._spot = s;
      markers[favKey(s)] = m;
    });
  }

  function fmPopupHtml(f) {
    var fm = 'https://by.fishermap.org/location/' + f.id + '/';
    var ym = 'https://yandex.by/maps/?pt=' + f.lon + ',' + f.lat + '&z=14&l=map';
    var h = '';
    if (f.date) h += '<b>Отчёт от ' + esc(f.date) + '</b>';
    if (f.fish) h += (h ? '<br>' : '') + 'Рыба: <i>' + esc(f.fish) + '</i>';
    h += '<br><a href="' + fm + '" target="_blank" rel="noopener">Отчёт на fishermap.org</a> · ' +
      '<a href="' + ym + '" target="_blank" rel="noopener">Яндекс.Карты</a>';
    return h;
  }

  var REGION_BOXES = null;
  function regionBoxes() {
    if (REGION_BOXES) return REGION_BOXES;
    var boxes = [];
    for (var r = 0; r < REGIONS.length; r++) {
      var minLat = 99, maxLat = -99, minLon = 99, maxLon = -99;
      var cx = 0, cy = 0, n = 0;
      D.spots.forEach(function (s) {
        if (s.r !== r) return;
        if (s.lat < minLat) minLat = s.lat; if (s.lat > maxLat) maxLat = s.lat;
        if (s.lon < minLon) minLon = s.lon; if (s.lon > maxLon) maxLon = s.lon;
        cx += s.lat; cy += s.lon; n++;
      });
      boxes.push({ r: r, minLat: minLat - 0.3, maxLat: maxLat + 0.3, minLon: minLon - 0.3, maxLon: maxLon + 0.3, cx: cx / n, cy: cy / n });
    }
    REGION_BOXES = boxes;
    return boxes;
  }

  function regionOf(lat, lon) {
    var boxes = regionBoxes();
    var hit = [];
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon) hit.push(b);
    }
    if (hit.length === 1) return hit[0].r;
    var best = 0, bd = 1e9;
    for (var j = 0; j < D.spots.length; j++) {
      var d = distKm(lat, lon, D.spots[j].lat, D.spots[j].lon);
      if (d < bd) { bd = d; best = D.spots[j].r; }
    }
    return best;
  }

  function buildFisherMarkers() {
    if (!window.RYB_FISHER) return;
    fisherCluster = L.markerClusterGroup({
      maxClusterRadius: 45,
      disableClusteringAtZoom: 14,
      animate: true,
      zoomToBoundsOnClick: true,
      spiderfyOnMaxZoom: true,
      chunkedLoading: true,
      chunkInterval: 120,
      iconCreateFunction: function (c) {
        var n = c.getChildCount();
        return L.divIcon({
          html: '<div style="width:26px;height:26px;border-radius:50%;background:rgba(13,20,32,.94);border:1px solid #ffb454;color:#ffb454;font-weight:700;font-size:11px;display:flex;align-items:center;justify-content:center">' + n + '</div>',
          className: '', iconSize: [26, 26], iconAnchor: [13, 13]
        });
      }
    });
    fmItems = [];
    FISHER.forEach(function (f) {
      var m = L.marker([f.lat, f.lon], {
        icon: L.divIcon({
          html: '<div style="width:22px;height:22px;border-radius:50%;background:#0d1420;border:1px solid #ffb454;color:#ffb454;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center">F</div>',
          className: '', iconSize: [22, 22], iconAnchor: [11, 11]
        })
      });
      m.bindPopup(fmPopupHtml(f));
      fmItems.push({ f: f, m: m, r: regionOf(f.lat, f.lon) });
    });
  }

  function fisherVisible(f, r) {
    if (state.regions.length && state.regions.indexOf(r) < 0) return false;
    if (state.origin && state.radius > 0) {
      var d = f._d != null ? f._d : distKm(state.origin.lat, state.origin.lon, f.lat, f.lon);
      if (d > state.radius) return false;
    }
    if (state.fishes.length) {
      if (!f.fish) return false;
      var s = normFish(String(f.fish));
      var ok = false;
      for (var i = 0; i < state.fishes.length; i++) { if (s.indexOf(normFish(state.fishes[i])) >= 0) { ok = true; break; } }
      if (!ok) return false;
    }
    return true;
  }

  function refreshFmLayer() {
    if (!map || !fisherCluster) return;
    if (!state.layers.fm) { if (map.hasLayer(fisherCluster)) map.removeLayer(fisherCluster); fmVisible = {}; return; }
    if (!map.hasLayer(fisherCluster)) map.addLayer(fisherCluster);
    var add = [], remove = [], keep = {}, visCount = 0;
    for (var i = 0; i < fmItems.length; i++) {
      var it = fmItems[i];
      var vis = fisherVisible(it.f, it.r);
      if (vis) { visCount++; keep[it.f.id] = 1; if (!fmVisible[it.f.id]) add.push(it.m); }
      else if (fmVisible[it.f.id]) remove.push(it.m);
    }
    if (visCount === 0) { fisherCluster.clearLayers(); fmVisible = {}; return; }
    if (visCount === fmItems.length) {
      var all = new Array(fmItems.length);
      for (var j = 0; j < fmItems.length; j++) all[j] = fmItems[j].m;
      fisherCluster.clearLayers();
      fisherCluster.addLayers(all);
      fmVisible = keep;
      return;
    }
    if (remove.length) fisherCluster.removeLayers(remove);
    if (add.length) fisherCluster.addLayers(add);
    fmVisible = keep;
  }

  function popupHtml(s) {
    var o = state.origin;
    var d = o ? ' · ' + fmtDist(s._d) + ' от ' + esc(o.name) : '';
    var route = o
      ? '<a href="https://yandex.by/maps/?rtext=' + o.lat.toFixed(5) + ',' + o.lon.toFixed(5) + '~' + s.lat.toFixed(5) + ',' + s.lon.toFixed(5) + '&rtt=auto" target="_blank" rel="noopener">Маршрут</a> · '
      : '';
    var ym = 'https://yandex.by/maps/?pt=' + s.lon.toFixed(5) + ',' + s.lat.toFixed(5) + '&z=15&l=map';
    var fm = 'https://by.fishermap.org/fish-map/';
    var fav = state.favs.has(favKey(s));
    var bansNow = RULES ? activeBans(s.r, new Date()) : [];
    return '<b>' + esc(s.name) + '</b>' + d + '<br>' +
      '<span style="color:#8fa1b8">' + s.fish.map(esc).join(' · ') + '</span>' +
      (s.paid ? '<br><span style="color:#ffb454">платная рыбалка · ' + esc(s.paid_price || 'уточняйте') + '</span>' +
        (s.site ? ' <a href="' + esc(s.site) + '" target="_blank" rel="noopener">Сайт</a>' : '') : '') +
      (!s.paid && s.note ? '<br><span style="color:#5b6c84">' + esc(s.note) + '</span>' : '') +
      (bansNow.length ? '<br><span style="color:#ffb454">⚠ запрет: ' + esc(bansNow[0].title.split(' (')[0]) + ' — до ' + fmtRDM(bansNow[0].to) + '</span>' : '') +
      '<br>' +
      '<a href="' + ym + '" target="_blank" rel="noopener">Яндекс.Карты</a> · ' +
      route +
      '<a href="' + fm + '" target="_blank" rel="noopener">fishermap</a>';
  }

  function bindPopupEvents(m, s) {
    if (!m || !m.getPopup()) return;
    var el = m.getPopup().getElement();
    if (!el) return;
    var wrap = el.querySelector('.leaflet-popup-content-wrapper');
    if (wrap && !wrap.querySelector('.popup-fav-star')) {
      var star = document.createElement('button');
      star.className = 'popup-fav-star';
      star.innerHTML = state.favs.has(favKey(s)) ? '★' : '☆';
      star.title = state.favs.has(favKey(s)) ? 'Убрать из избранного' : 'В избранное';
      star.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleFav(s);
        star.innerHTML = state.favs.has(favKey(s)) ? '★' : '☆';
        star.title = state.favs.has(favKey(s)) ? 'Убрать из избранного' : 'В избранное';
      });
      wrap.appendChild(star);
    }
  }

  function refreshPopupFav(m) {
    if (!m || !m.isPopupOpen()) return;
    var s = m._spot;
    m.setPopupContent(popupHtml(s));
    bindPopupEvents(m, s);
  }

  function openPopup(m, s) {
    if (!m) return;
    m.openPopup();
  }

  function toggleFav(s) {
    var k = favKey(s);
    if (state.favs.has(k)) state.favs.delete(k); else state.favs.add(k);
    saveFavs();
    renderCards();
    renderList();
    if (state.layers.fav) refreshMarkers(); else updateStats();
    refreshPopupFav(markers[k]);
  }

  function updateRadius() {
    if (radiusLayer) { map.removeLayer(radiusLayer); radiusLayer = null; }
    if (state.origin && state.radius > 0) {
      radiusLayer = L.circle([state.origin.lat, state.origin.lon], {
        radius: state.radius * 1000,
        color: '#ffb454', weight: 2.5, dashArray: '8 8', fill: true, fillColor: '#ffb454', fillOpacity: 0.05, interactive: false
      }).addTo(map);
    }
  }

  function refreshMarkers() {
    var visFree = [], visPaid = [];
    D.spots.forEach(function (s) {
      if (isVisible(s) && isLayerVisible(s) && isMapVisible(s)) (s.paid ? visPaid : visFree).push(markers[favKey(s)]);
    });
    clusterFree.clearLayers();
    clusterFree.addLayers(visFree);
    clusterPaid.clearLayers();
    clusterPaid.addLayers(visPaid);
    refreshFmLayer();
    updateStats();
  }

  function updateStats() {
    var n = 0;
    D.spots.forEach(function (s) { if (isVisible(s) && isLayerVisible(s) && isMapVisible(s)) n++; });
    els.stats.innerHTML = '<span>Показано <b>' + n + '</b> из <b>' + D.spots.length + '</b> мест</span>' +
      '<span>Избранных <b>' + state.favs.size + '</b></span>' +
      (state.origin ? '<span>Старт: <b>' + esc(state.origin.name) + '</b></span>' : '') +
      (state.origin && state.radius > 0 ? '<span>Радиус <b>' + state.radius + ' км</b></span>' : '');
  }

  function buildFilters() {
    REGIONS.forEach(function (r, i) {
      var lab = document.createElement('label');
      lab.className = 'opt';
      lab.innerHTML = '<input type="checkbox" value="' + i + '">' + esc(r);
      els.regionPanel.appendChild(lab);
    });
    ALL_FISH.forEach(function (f) {
      var lab = document.createElement('label');
      lab.className = 'opt';
      lab.innerHTML = '<input type="checkbox" value="' + esc(f) + '">' + esc(f);
      els.fishPanel.appendChild(lab);
      var lab2 = document.createElement('label');
      lab2.className = 'opt';
      lab2.innerHTML = '<input type="checkbox" value="' + esc(f) + '">' + esc(f);
      els.lfFishPanel.appendChild(lab2);
    });
    REGIONS.forEach(function (r, i) {
      var labR = document.createElement('label');
      labR.className = 'opt';
      labR.innerHTML = '<input type="checkbox" value="' + i + '">' + esc(r);
      els.lfRegPanel.appendChild(labR);
    });
    var counts = { r: {}, t: {}, f: {} };
    D.spots.forEach(function (s) {
      counts.r[s.r] = (counts.r[s.r] || 0) + 1;
      counts.t[s.t] = (counts.t[s.t] || 0) + 1;
      s.fish.forEach(function (f) { counts.f[f] = (counts.f[f] || 0) + 1; });
    });
  }


  function buildCards() {
    D.spots.forEach(function (s, i) {
      var card = document.createElement('article');
      card.className = 'card';
      card.dataset.i = i;
      card.innerHTML = buildCardHtml(s, i);
      card.querySelector('.fav').addEventListener('click', function () { toggleFav(s); });
      card.querySelector('.go-map').addEventListener('click', function (e) {
        e.preventDefault();
        window.open(this.href, '_blank', 'noopener');
      });
      card.querySelector('.go').addEventListener('click', function () {
        goToSpot(s);
      });
      els.cards.appendChild(card);
    });
  }

  function buildCardHtml(s, i) {
    var d = state.origin ? fmtDist(s._d) : '';
    var sc = spotScore(s);
    var fav = state.favs.has(favKey(s));
    var bansNow = RULES ? activeBans(s.r, new Date()) : [];
    var ym = 'https://yandex.by/maps/?pt=' + s.lon.toFixed(5) + ',' + s.lat.toFixed(5) + '&z=15&l=map';
    return '<div class="card-top"><span class="rank">#' + (i + 1) + '</span><h3>' + esc(s.name) + '</h3>' +
      '<button class="fav' + (fav ? ' on' : '') + '" aria-label="Избранное">' + (fav ? '★' : '☆') + '</button></div>' +
      '<div class="card-meta"><span>' + esc(REGIONS[s.r]) + '</span><span>·</span><span>' + esc(s.t) + '</span>' +
      '<span class="card-dist"></span></div>' +
      '<div class="card-tags">' + s.fish.map(function (f) {
        return '<span class="tag' + (state.fishes.some(function (sf) { return normFish(sf) === normFish(f); }) ? ' hot' : '') + '">' + esc(f) + '</span>';
      }).join('') + '</div>' +
      (!s.paid && s.note ? '<div class="card-note">' + esc(s.note) + '</div>' : '') +
      '<div class="card-foot">' +
      '<span class="badge ' + (s.paid ? 'paid' : 'free') + '">' + (s.paid ? 'платно' : 'бесплатно') + '</span>' +
      (s.paid ? '<span class="badge paid">' + esc(s.paid_price || 'уточняйте') + '</span>' : '') +
      (bansNow.length ? '<span class="badge warn">⚠ запрет: ' + esc(bansNow[0].title.split(' (')[0]) + ' до ' + fmtRDM(bansNow[0].to) + '</span>' : '') +
      '<span class="score card-score">' + sc + ' <small>из 100</small></span>' +
      '<a class="go-map" href="' + ym + '" target="_blank" rel="noopener">Карта</a>' +
      (s.paid && s.phone ? '<a class="go-tel" href="tel:' + esc(s.phone) + '">Позвонить</a>' : '') +
      (s.paid && s.site ? '<a class="go-site" href="' + esc(s.site) + '" target="_blank" rel="noopener">Сайт</a>' : '') +
      '<button class="go">Показать</button></div>';
  }

  function goToSpot(s) {
    switchTab('map');
    var m = markers[favKey(s)];
    map.setView([s.lat, s.lon], 13);
    setTimeout(function () { if (m && map.hasLayer(m)) openPopup(m, s); }, 250);
  }

  function renderCards() {
    D.spots.forEach(function (s, i) {
      var card = els.cards.querySelector('.card[data-i="' + i + '"]');
      if (!card) return;
      card.classList.toggle('hide', !isListVisible(s));
      s._score = spotScore(s);
      var scEl = card.querySelector('.card-score');
      if (scEl) scEl.innerHTML = s._score + ' <small>из 100</small>';
      var favBtn = card.querySelector('.fav');
      if (favBtn) {
        favBtn.textContent = state.favs.has(favKey(s)) ? '★' : '☆';
        favBtn.classList.toggle('on', state.favs.has(favKey(s)));
      }
      var dEl = card.querySelector('.card-dist');
      if (dEl) dEl.textContent = state.origin ? '· ' + fmtDist(s._d) : '';
    });
  }

  function syncSortDist() {
    var distBtn = els.sorts.querySelector('[data-sort="dist"]');
    if (!distBtn) return;
    distBtn.disabled = !state.origin;
    distBtn.title = state.origin ? '' : 'Укажите город';
    distBtn.textContent = state.origin ? 'расстояние' : 'укажите город';
  }

  function renderList() {
    syncSortDist();
    var vis = [];
    D.spots.forEach(function (s, i) { if (isListVisible(s)) vis.push(i); });
    els.listCount.textContent = 'Мест: ' + vis.length;
    var arr = vis.slice();
    if (state.sort === 'dist' && state.origin) {
      arr.sort(function (a, b) { return D.spots[a]._d - D.spots[b]._d; });
    } else if (state.sort === 'name') {
      arr.sort(function (a, b) { return D.spots[a].name.localeCompare(D.spots[b].name, 'ru'); });
    } else {
      arr.sort(function (a, b) { return spotScore(D.spots[b]) - spotScore(D.spots[a]); });
    }
    var frag = document.createDocumentFragment();
    arr.forEach(function (i, pos) {
      var c = els.cards.querySelector('.card[data-i="' + i + '"]');
      if (c) {
        var rk = c.querySelector('.rank');
        if (rk) rk.textContent = '#' + (pos + 1);
        frag.appendChild(c);
      }
    });
    els.cards.appendChild(frag);
  }

  function buildMethods() {
    G.methods.forEach(function (m) {
      var card = document.createElement('button');
      card.className = 'method';
      card.innerHTML = '<h3>' + esc(m.name) + '</h3><p>' + esc(m.short) + '</p>' +
        '<span class="go">Подробнее</span>';
      card.addEventListener('click', function () { showMethod(m); });
      els.methods.appendChild(card);
    });
  }

  function lfFishBtnLabel() {
    if (!els.lfFishBtn) return;
    els.lfFishBtn.textContent = state.list.fishes.length ? ('Рыба: ' + state.list.fishes.length) : 'Рыба: любая ▾';
  }

  function lfTypeBtnLabel() {
    if (!els.lfTypeBtn) return;
    els.lfTypeBtn.textContent = state.list.types.length ? ('Водоём: ' + state.list.types.length) : 'Водоём: любой ▾';
  }

  function lfRegBtnLabel() {
    if (!els.lfRegBtn) return;
    els.lfRegBtn.textContent = state.list.regions.length ? ('Области: ' + state.list.regions.length) : 'Области: все ▾';
  }

  function mapminBtnLabel() {
    if (!els.mapminBtn) return;
    els.mapminBtn.textContent = state.mapMin > 0 ? ('Рейтинг: ≥ ' + state.mapMin + ' ▾') : 'Рейтинг: любой ▾';
  }

  function radiusBtnLabel() {
    if (!els.radiusBtn) return;
    if (state.radius > 0 && !state.origin) { els.radiusBtn.textContent = 'Радиус: выкл (укажите старт) ▾'; return; }
    els.radiusBtn.textContent = state.radius > 0 ? ('Радиус: ' + state.radius + ' км' + (state.origin ? '' : ' (нужен старт)') + ' ▾') : 'Радиус: выкл ▾';
  }

  function regionBtnLabel() {
    if (!els.regionBtn) return;
    els.regionBtn.textContent = state.regions.length ? ('Области: ' + state.regions.length) : 'Области: все ▾';
  }

  function fishBtnLabel() {
    if (!els.fishBtn) return;
    els.fishBtn.textContent = state.fishes.length ? ('Рыба: ' + state.fishes.length) : 'Рыба: любая ▾';
  }

  function typeBtnLabel() {
    if (!els.typeBtn) return;
    els.typeBtn.textContent = state.types.length ? ('Водоём: ' + state.types.length) : 'Водоём: любой ▾';
  }

  var SUN = [
    { d: 8.5, k: 17.0 }, { d: 7.5, k: 18.0 }, { d: 6.7, k: 18.8 },
    { d: 5.8, k: 19.8 }, { d: 4.8, k: 20.8 }, { d: 4.3, k: 21.5 },
    { d: 4.5, k: 21.3 }, { d: 5.3, k: 20.3 }, { d: 6.3, k: 19.0 },
    { d: 7.3, k: 17.5 }, { d: 8.0, k: 16.5 }, { d: 8.8, k: 16.0 }
  ];

  function hourBite(hi, ctx) {
    var hourly = state.weatherHourly;
    var h = Number(String(hourly.time[hi]).slice(11, 13));
    var t = hourly.temperature_2m[hi];
    var pr = hourly.precipitation_probability[hi] != null ? hourly.precipitation_probability[hi] : 0;
    var w = hourly.wind_speed_10m[hi] != null ? hourly.wind_speed_10m[hi] : 0;
    var sc = 50;

    var m = ctx.month;
    if (m >= 3 && m <= 5) sc += 10;
    else if (m >= 9 && m <= 11) sc += 8;
    else if (m === 12 || m <= 2) sc -= 15;

    var dawn = ctx.sunriseH != null ? ctx.sunriseH : SUN[m - 1].d;
    var dusk = ctx.sunsetH != null ? ctx.sunsetH : SUN[m - 1].k;
    var d = Math.min(Math.abs(h - dawn), Math.abs(h - (dusk - 1)));
    sc += Math.max(0, 20 - d * 5);
    if (h < dawn - 1.5 || h > dusk + 0.5) sc -= 12;

    if (t >= 12 && t <= 26) sc += 12;
    else if (t < 5) sc -= 20;
    else if (t < 12) sc -= 5;
    else if (t > 30) sc -= 15;
    else sc -= 8;

    if (pr > 60) sc -= 18;
    else if (pr > 40) sc -= 10;
    else if (pr > 10) sc -= 3;
    else if (pr > 1) sc += 4;

    if (w > 12) sc -= 15;
    else if (w > 8) sc -= 8;
    else if (w > 4) sc -= 3;
    else sc += 2;

    if (ctx.dP > 3) sc += 6;
    else if (ctx.dP < -4) sc -= 8;

    if (ctx.moonBad) sc -= 6;

    return Math.max(3, Math.min(100, Math.round(sc)));
  }

  function renderHourChart(keys) {
    if (!state.weatherHourly || !state.weatherHourly.time || !state.weatherHourly.time.length) return;
    var body = document.getElementById('chart-body');
    if (!body) return;
    var hourly = state.weatherHourly;
    if (!hourly || !hourly.time) return;
    var start = state.dayIdx * 24;
    if (!keys || !keys.length) keys = ['bite'];
    var dDate = new Date(String(state.weather.time[state.dayIdx]) + 'T00:00:00');
    var moonF = moonInfo(dDate).frac;
    var dP = state.dayIdx > 0 ? state.weather.pressure_msl_mean[state.dayIdx] - state.weather.pressure_msl_mean[state.dayIdx - 1] : 0;
    function hmToH(iso) {
      if (!iso) return null;
      var p = String(iso).slice(11, 16).split(':');
      return parseInt(p[0], 10) + parseInt(p[1], 10) / 60;
    }
    var ctx = {
      month: dDate.getMonth() + 1,
      dP: dP,
      moonBad: moonF < 0.1 || Math.abs(moonF - 0.5) < 0.1,
      sunriseH: state.weather.sunrise ? hmToH(state.weather.sunrise[state.dayIdx]) : null,
      sunsetH: state.weather.sunset ? hmToH(state.weather.sunset[state.dayIdx]) : null
    };
    var series = [];
    for (var s = 0; s < keys.length; s++) {
      var v = keys[s];
      var vals = [];
      for (var k = 0; k < 24; k++) {
        var hi = start + k;
        if (!hourly.time[hi]) break;
        if (v === 'bite') vals.push(hourBite(hi, ctx));
        else if (v === 'precip') vals.push(hourly.precipitation_probability[hi] != null ? hourly.precipitation_probability[hi] : 0);
        else if (v === 'temp') vals.push(hourly.temperature_2m[hi]);
        else vals.push(hourly.wind_speed_10m[hi] != null ? hourly.wind_speed_10m[hi] : 0);
      }
      var lo = Math.min.apply(null, vals), hi2 = Math.max.apply(null, vals);
      series.push({ key: v, vals: vals, lo: lo, span: (hi2 - lo) || 1 });
    }
    var names = { bite: 'Клёв', temp: 'Температура', precip: 'Осадки', wind: 'Ветер' };
    var units = { bite: '', temp: '°', precip: '%', wind: ' м/с' };
    var colors = { bite: '#3ecf8e', temp: '#ffb454', precip: '#5ab0ff', wind: '#8fa1b8' };
    var W = 720, H = 240, padL = 34, padR = 10, padT = 14, padB = 26;
    var n = series[0].vals.length;
    var denom = Math.max(1, n - 1);
    var x = function (i) { return padL + i * (W - padL - padR) / denom; };
    var y = function (v, lo, span) { return padT + (H - padT - padB) * (1 - (v - lo) / span); };
    var grid = '', yl = '';
    for (var g = 0; g <= 4; g++) {
      var gy = padT + (H - padT - padB) * g / 4;
      var vl = series[0].lo + series[0].span * (4 - g) / 4;
      var lbl = series[0].key === 'temp' ? (vl >= 0 ? '+' : '') + Math.round(vl) : String(Math.round(vl));
      grid += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) + '" stroke="#22304a" stroke-width="0.9"/>';
      yl += '<text x="' + (padL - 6) + '" y="' + (gy + 4).toFixed(1) + '" font-size="9" fill="#8fa1b8" text-anchor="end">' + lbl + '</text>';
    }
    var paths = '', dots = '';
    for (var si = 0; si < series.length; si++) {
      var s2 = series[si];
      var pts = [];
      for (var i2 = 0; i2 < s2.vals.length; i2++) {
        pts.push(x(i2).toFixed(1) + ',' + y(s2.vals[i2], s2.lo, s2.span).toFixed(1));
      }
      paths += '<polyline fill="none" stroke="' + colors[s2.key] + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="' + pts.join(' ') + '"/>';
      for (var i3 = 0; i3 < s2.vals.length; i3++) {
        var cx = x(i3), cy = y(s2.vals[i3], s2.lo, s2.span);
        var lbl = String(hourly.time[start + i3]).slice(11, 13) + ':00';
        var val = (s2.key === 'temp' ? (s2.vals[i3] >= 0 ? '+' : '') + s2.vals[i3] : Math.round(s2.vals[i3])) + units[s2.key];
        dots += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="2.6" fill="' + colors[s2.key] + '"><title>' + names[s2.key] + ' · ' + lbl + ' · ' + val + '</title></circle>';
      }
    }
    var xl = '', xAxis = '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) + '" stroke="#3a4a6a" stroke-width="1"/>';
    for (var i4 = 0; i4 < n; i4 += 3) {
      xl += '<text x="' + x(i4).toFixed(1) + '" y="' + (H - padB + 14) + '" font-size="9" fill="#8fa1b8" text-anchor="middle">' + String(hourly.time[start + i4]).slice(11, 13) + ':00</text>';
    }
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">' + grid + yl + xAxis + xl + paths + dots + '</svg>';
    var legend = series.map(function (s3) { return '<span class="lg ' + s3.key + '"></span>' + names[s3.key]; }).join(' ');
    body.innerHTML = svg + '<div class="chart-note">' + legend + '<span style="color:#5b6c84">(каждая метрика нормирована к своему диапазону; точные значения — при наведении)</span></div>';
  }

  function showMethod(m) {
    var d = els.methodDetail;
    d.classList.remove('hide');
    d.innerHTML =
      '<h2>' + esc(m.name) + '</h2>' +
      '<p class="muted">' + esc(m.short) + '</p>' +
      '<div class="blk"><h4>Лучшая рыба</h4><div class="chips-line">' + m.best.map(function (f) {
        return '<span class="bait-chip">' + esc(f) + '</span>';
      }).join('') + '</div></div>' +
      '<div class="blk"><h4>Снасть</h4><p>' + esc(m.tackle) + '</p></div>' +
      '<div class="blk"><h4>Монтаж</h4><p>' + esc(m.rig) + '</p></div>' +
      '<div class="blk"><h4>Наживки и приманки</h4><div class="chips-line">' +
      (m.baits.animal ? m.baits.animal.map(function (b) { return '<span class="bait-chip animal">' + esc(b) + '</span>'; }).join('') : '') +
      (m.baits.plant ? m.baits.plant.map(function (b) { return '<span class="bait-chip plant">' + esc(b) + '</span>'; }).join('') : '') +
      (m.lures ? m.lures.map(function (l) { return '<span class="bait-chip">' + esc(l) + '</span>'; }).join('') : '') +
      '</div></div>' +
      '<div class="blk"><h4>Советы</h4><p>' + esc(m.tips) + '</p></div>';
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function buildFishes() {
    G.fish.forEach(function (f) {
      var card = document.createElement('div');
      card.className = 'fish';
      card.innerHTML =
        '<h3>' + esc(f.name) + ' <span class="type ' + (f.type === 'хищник' ? 'pred' : 'peace') + '">' + esc(f.type) + '</span></h3>' +
        '<div class="fmeta"><span>Снасть: <b>' + esc(f.gear) + '</b></span><span>Время: <b>' + esc(f.time) + '</b></span></div>' +
        '<table class="seasons"><tr><th>Весна</th><th>Лето</th><th>Осень</th><th>Зима</th></tr>' +
        '<tr><td>' + esc(f.bait.spr) + '</td><td>' + esc(f.bait.sum) + '</td><td>' + esc(f.bait.aut) + '</td><td>' + esc(f.bait.win) + '</td></tr></table>' +
        '<div class="fish-notes">' + esc(f.notes) + '</div>';
      els.fishes.appendChild(card);
    });
  }

  var WCODES = {
    0: '☀', 1: '☀', 2: '⛅', 3: '☁', 45: '🌫', 48: '🌫', 51: '🌦', 53: '🌦', 55: '🌦', 61: '🌧', 63: '🌧', 65: '🌧',
    71: '🌨', 73: '🌨', 75: '🌨', 80: '🌧', 81: '🌧', 82: '🌧', 95: '⛈', 96: '⛈', 99: '⛈'
  };
  function wico(c) { return WCODES[c] || '☁'; }
  var WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  var MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  function moonInfo(d) {
    var syn = 29.53058867;
    var t0 = Date.UTC(2000, 0, 6, 18, 14);
    var days = (d.getTime() - t0) / 86400000;
    var frac = ((days % syn) + syn) % syn / syn;
    var names = ['новолуние', 'первая четверть', 'полнолуние', 'последняя четверть'];
    var qi = Math.round(frac * 4) % 4;
    return { frac: frac, name: names[qi] };
  }

  function dayScore(w) {
    var press = w.pressure, wind = w.wind, pr = w.precip, m = w.month, moon = w.moonFrac;
    var ps = (press >= 1005 && press <= 1025) ? 100 : (press >= 995 && press <= 1035) ? 60 : 25;
    var ws = wind < 5 ? 100 : wind < 8 ? 70 : wind < 12 ? 40 : 10;
    var prs = pr < 30 ? 100 : pr < 50 ? 60 : 25;
    var ss = (m === 4 || m === 5 || m === 9 || m === 10) ? 100 : (m === 3 || m === 6) ? 80 : (m === 7 || m === 8) ? 60 : 50;
    var dq = Math.min(Math.abs(moon - 0.25), Math.abs(moon - 0.75));
    var ms = dq < 0.1 ? 100 : 70;
    return Math.round(0.35 * ps + 0.2 * ws + 0.2 * prs + 0.15 * ss + 0.1 * ms);
  }

  function scoreClass(sc) { return sc >= 70 ? 'good' : sc >= 45 ? 'ok' : 'bad'; }

  function loadWeather() {
    var lat, lon, name;
    if (state.origin) { lat = state.origin.lat; lon = state.origin.lon; name = state.origin.name; }
    else { lat = 53.9; lon = 27.566; name = 'Минск (по умолчанию)'; }
    els.weatherWhere.innerHTML = 'Прогноз для <b>' + esc(name) + '</b> · 7 дней · <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>';
    var loc = { lat: lat, lon: lon };
    var locOk = state.weatherLoc &&
      Math.abs(state.weatherLoc.lat - lat) < 0.01 && Math.abs(state.weatherLoc.lon - lon) < 0.01;
    var stale = Date.now() - state.weatherAt > 30 * 60000;
    if (state.weather && locOk && !stale) { renderCalendar(); showDefaultDay(); return; }
    els.weatherStatus.textContent = 'Загрузка прогноза…';
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,pressure_msl_mean,sunrise,sunset' +
      '&hourly=temperature_2m,precipitation_probability,weathercode,wind_speed_10m' +
      '&timezone=Europe/Minsk&forecast_days=7';
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.daily) throw new Error('bad');
        state.weather = j.daily;
        state.weatherHourly = j.hourly || null;
        state.weatherAt = Date.now();
        state.weatherLoc = loc;
        try { localStorage.setItem('rb.weather', JSON.stringify({ daily: state.weather, hourly: state.weatherHourly, loc: state.weatherLoc })); } catch (e) {}
        els.weatherStatus.textContent = '';
        renderCalendar();
        showDefaultDay();
      })
      .catch(function () {
        els.weatherStatus.textContent = 'Не удалось загрузить прогноз — проверьте интернет.';
      });
  }

  function renderCalendar() {
    var w = state.weather;
    var cal = els.calendar;
    cal.innerHTML = '';
    for (var i = 0; i < w.time.length; i++) {
      var d = new Date(w.time[i] + 'T00:00:00');
      var moon = moonInfo(d);
      var sc = dayScore({
        pressure: w.pressure_msl_mean[i], wind: w.wind_speed_10m_max[i],
        precip: w.precipitation_probability_max[i], month: d.getMonth() + 1, moonFrac: moon.frac
      });
      var cell = document.createElement('div');
      cell.className = 'day' + (state.dayIdx === i ? ' on' : '');
      cell.innerHTML =
        '<div class="dow">' + WD[d.getDay()] + '</div>' +
        '<div class="dnum">' + d.getDate() + '</div>' +
        '<div class="dmon">' + MON[d.getMonth()] + '</div>' +
        '<div class="wico">' + wico(w.weathercode[i]) + '</div>' +
        '<div class="tmax">' + (w.temperature_2m_max[i] >= 0 ? '+' : '') + Math.round(w.temperature_2m_max[i]) + '°</div>' +
        '<div class="tmin">' + (w.temperature_2m_min[i] >= 0 ? '+' : '') + Math.round(w.temperature_2m_min[i]) + '°</div>' +
        '<span class="score-badge ' + scoreClass(sc) + '">' + sc + '</span>';
      cell.onclick = (function (idx) { return function () { selectDay(idx); }; })(i);
      cal.appendChild(cell);
    }
    updateRulesBanner();
  }

  function selectDay(i) {
    state.dayIdx = i;
    var w = state.weather;
    var nw = new Date();
    var todayISO = nw.getFullYear() + '-' + String(nw.getMonth() + 1).padStart(2, '0') + '-' + String(nw.getDate()).padStart(2, '0');
    var d = new Date(w.time[i] + 'T00:00:00');
    var moon = moonInfo(d);
    var tMax = w.temperature_2m_max[i], tMin = w.temperature_2m_min[i];
    var press = w.pressure_msl_mean[i];
    var prev = i > 0 ? w.pressure_msl_mean[i - 1] : null;
    var dP = prev != null ? press - prev : 0;
    var wind = w.wind_speed_10m_max[i], pr = w.precipitation_probability_max[i];
    var sc = dayScore({ pressure: press, wind: wind, precip: pr, month: d.getMonth() + 1, moonFrac: moon.frac });

    var factors = [];
    factors.push({ l: 'Давление', v: Math.round(press) + ' гПа' + (prev != null ? ' (' + (dP > 0 ? '+' : '') + Math.round(dP) + ')' : ''), g: dP > 0 ? 'mid' : 'good' });
    factors.push({ l: 'Ветер', v: Math.round(wind) + ' м/с', g: wind < 5 ? 'good' : wind < 8 ? 'mid' : 'bad' });
    factors.push({ l: 'Осадки', v: pr + '%', g: pr < 30 ? 'good' : pr < 50 ? 'mid' : 'bad' });
    factors.push({ l: 'Сезон', v: seasonName(d.getMonth() + 1), g: (d.getMonth() + 1 >= 4 && d.getMonth() + 1 <= 5) || (d.getMonth() + 1 >= 9 && d.getMonth() + 1 <= 10) ? 'good' : 'mid' });
    factors.push({ l: 'Луна', v: moon.name, g: moon.frac < 0.1 || Math.abs(moon.frac - 0.5) < 0.1 ? 'bad' : 'good' });

    var recs = [];
    var baits = [];
    if (tMax < 13) { recs.push({ t: 'Холодная вода', x: 'Вода холодная — рыба держится глубже. Работают животные насадки: червь, опарыш, мотыль. Поплавочная у берега малоэффективна.', c: '' }); baits = ['червь', 'опарыш', 'мотыль']; }
    else if (tMax > 22) { recs.push({ t: 'Тепло', x: 'Рыба капризная днём. Лучше растительные насадки (перловка, кукуруза, тесто) и ловля на рассвете и закате.', c: '' }); baits = ['перловка', 'кукуруза', 'тесто', 'горох']; }
    else { recs.push({ t: 'Комфортная температура', x: 'Наживки смешанные: животные утром и вечером, растительные днём.', c: '' }); baits = ['червь', 'опарыш', 'перловка']; }
    if (prev != null && dP < -4) recs.push({ t: 'Давление падает', x: 'Клёв ухудшается. Ищите проточные участки и глубину, работайте на течении.', c: 'warn' });
    else if (prev != null && dP > 2) recs.push({ t: 'Давление растёт', x: 'Клёв стабильный. Хорошие дни для ловли на бровках и вдали от берега.', c: '' });
    if (wind > 8) recs.push({ t: 'Сильный ветер ' + Math.round(wind) + ' м/с', x: 'Ставьте тяжёлый фидер или донку, ловите в заветренных заливах.', c: wind > 12 ? 'bad' : 'warn' });
    if (pr > 50) recs.push({ t: 'Дождь ' + pr + '%', x: 'Активность часто растёт перед дождём и сразу после. Ловите у берега с поплавком.', c: '' });
    if (moon.frac < 0.1 || Math.abs(moon.frac - 0.5) < 0.1) recs.push({ t: moon.name, x: 'Клёв обычно слабее. Планируйте ловлю на рассвете или на закате.', c: 'warn' });

    var hourBlock = '';
    var hourly = state.weatherHourly;
    if (hourly && hourly.time && hourly.time.length) {
      var cells = '';
      var start = i * 24;
      for (var k = 0; k < 24; k++) {
        var hi = start + k;
        if (!hourly.time[hi]) break;
        var hh = String(hourly.time[hi]).slice(11, 16);
        var tmp = Math.round(hourly.temperature_2m[hi]);
        cells += '<div class="hcell">' +
          '<div class="hct">' + hh + '</div>' +
          '<div class="hci">' + wico(hourly.weathercode[hi]) + '</div>' +
          '<div class="hctmp">' + (tmp >= 0 ? '+' : '') + tmp + '°</div>' +
          '<div class="hcpr">' + (hourly.precipitation_probability[hi] != null ? hourly.precipitation_probability[hi] + '%' : '—') + '</div>' +
          '<div class="hcw">' + Math.round(hourly.wind_speed_10m[hi]) + ' м/с</div>' +
          '</div>';
      }
      hourBlock = '<div class="hourly"><h4>По часам</h4><div class="hstrip">' + cells + '</div></div>' +
        '<div class="hour-chart"><div class="chart-filters" id="chart-filters">' +
        '<button class="cf-btn on" data-cf="bite">Клёв</button>' +
        '<button class="cf-btn" data-cf="temp">Температура</button>' +
        '<button class="cf-btn" data-cf="precip">Осадки</button>' +
        '<button class="cf-btn" data-cf="wind">Ветер</button>' +
        '</div><div class="chart-body" id="chart-body"></div></div>';
    }

    var detail = els.dayDetail;
    detail.classList.remove('hide');
    detail.innerHTML =
      '<h2>' + WD[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()] + ' — ' + (String(state.weather.time[i]) === todayISO ? 'сегодня' : '') + '</h2>' +
      (state.weather.sunrise && state.weather.sunrise[i]
        ? '<div class="muted" style="margin-bottom:8px">Восход ' + String(state.weather.sunrise[i]).slice(11, 16) + ' · Закат ' + String(state.weather.sunset[i]).slice(11, 16) + '</div>'
        : '') +
      '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
      '<div class="big-score">' + sc + '</div>' +
      '<div>' +
      '<div class="wico" style="font-size:26px">' + wico(w.weathercode[i]) + '</div>' +
      '<div><span class="tmax" style="color:#ffb454">' + (tMax >= 0 ? '+' : '') + Math.round(tMax) + '°</span> / <span class="tmin" style="color:#5ab0ff">' + (tMin >= 0 ? '+' : '') + Math.round(tMin) + '°</span></div>' +
      '</div></div>' +
      '<div class="factors">' + factors.map(function (f) {
        return '<div class="factor"><div class="fl">' + esc(f.l) + '</div><div class="fv ' + f.g + '">' + esc(f.v) + '</div></div>';
      }).join('') + '</div>' +
      '<div class="recs"><h4>Советы на день</h4>' +
      recs.map(function (r) { return '<div class="rec ' + r.c + '"><b>' + esc(r.t) + '.</b> ' + esc(r.x) + '</div>'; }).join('') +
      '</div>' +
      '<div class="recs"><h4>Рекомендуемые наживки на этот день</h4><div class="chips-line">' +
      baits.map(function (b) { return '<span class="bait-chip hot">' + esc(b) + '</span>'; }).join('') +
      '</div></div>' +
      hourBlock;

    var ck = (state.chartKeys && state.chartKeys.length) ? state.chartKeys : ['bite'];
    renderHourChart(ck);
    var cfBtns = detail.querySelectorAll('.cf-btn');
    for (var cb2 = 0; cb2 < cfBtns.length; cb2++) {
      (function (btn) {
        if (ck.indexOf(btn.dataset.cf) >= 0) btn.classList.add('on');
        btn.addEventListener('click', function () {
          btn.classList.toggle('on');
          var keys = [];
          for (var x2 = 0; x2 < cfBtns.length; x2++) if (cfBtns[x2].classList.contains('on')) keys.push(cfBtns[x2].dataset.cf);
          state.chartKeys = keys.length ? keys : ['bite'];
          saveState();
          renderHourChart(state.chartKeys);
        });
      })(cfBtns[cb2]);
    }

    saveState();
    renderCalendar();
  }

  function showDefaultDay() {
    var w = state.weather;
    if (!w || !w.time || !w.time.length) return;
    if (state.dayIdx >= 0 && state.dayIdx < w.time.length) { selectDay(state.dayIdx); return; }
    var now = new Date();
    var ts = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    var ti = w.time.indexOf(ts);
    if (ti >= 0) selectDay(ti); else selectDay(0);
  }

  function seasonName(m) {
    if (m >= 3 && m <= 5) return 'весна';
    if (m >= 6 && m <= 8) return 'лето';
    if (m >= 9 && m <= 11) return 'осень';
    return 'зима';
  }


  var RULES_GROUPS = [
    ['Нерестовый запрет', function (b) { return b.id.indexOf('spawn') === 0; }],
    ['Запреты по видам', function (b) { return b.id.indexOf('spawn') !== 0 && b.id !== 'pits' && b.id !== 'crayfish'; }],
    ['Зимовальные ямы и раки', function (b) { return b.id === 'pits' || b.id === 'crayfish'; }]
  ];

  function inDate(from, to, m, d) {
    var f = parseInt(from.slice(0, 2), 10) * 100 + parseInt(from.slice(3, 5), 10);
    var t = parseInt(to.slice(0, 2), 10) * 100 + parseInt(to.slice(3, 5), 10);
    var k = m * 100 + d;
    return f <= t ? (k >= f && k <= t) : (k >= f || k <= t);
  }

  function activeBans(r, date) {
    if (!RULES) return [];
    var m = date.getMonth() + 1, d = date.getDate();
    return RULES.bans.filter(function (b) {
      return (b.regions.indexOf(-1) >= 0 || b.regions.indexOf(r) >= 0) && inDate(b.from, b.to, m, d);
    });
  }

  function currentRulesRegion() {
    if (state.regions.length === 1) return state.regions[0];
    if (state.origin) return regionOf(state.origin.lat, state.origin.lon);
    return -1;
  }

  function fmtRDM(mmdd) {
    return parseInt(mmdd.slice(3, 5), 10) + ' ' + MON[parseInt(mmdd.slice(0, 2), 10) - 1];
  }

  function rulesBannerHtml(r, date) {
    if (!RULES) return '';
    var bans = activeBans(r, date);
    if (!bans.length) return '';
    var scope = r >= 0 ? REGIONS[r] + ' обл.' : 'вся Беларусь';
    return 'Сейчас действует (' + esc(scope) + '): ' + bans.map(function (b) {
      return '<b>' + esc(b.title) + '</b> до ' + fmtRDM(b.to);
    }).join(' · ');
  }

  function updateRulesBanner() {
    var b = els.rulesDayBanner;
    if (!b || !RULES) return;
    var date = new Date();
    if (state.dayIdx >= 0 && state.weather && state.weather.time && state.weather.time[state.dayIdx]) {
      date = new Date(state.weather.time[state.dayIdx] + 'T00:00:00');
    }
    var html = rulesBannerHtml(currentRulesRegion(), date);
    if (!html) { b.classList.add('hide'); b.innerHTML = ''; return; }
    b.innerHTML = html;
    b.classList.remove('hide');
  }

  function renderRulesTab() {
    var box = els.rulesBox;
    if (!box) return;
    if (!RULES) { box.innerHTML = '<p class="empty">Правила не загружены.</p>'; return; }
    var now = new Date();
    var r = currentRulesRegion();
    var scope = r >= 0 ? REGIONS[r] + ' область' : 'вся Беларусь';
    var h = '<h2>Правила рыболовства РБ-' + esc(RULES.year) + '</h2>' +
      '<p class="muted" style="margin-bottom:10px">Автопроверка даты: <b>' + (now.getDate() + ' ' + MON[now.getMonth()]) + '</b> · регион: <b>' + esc(scope) + '</b> — запреты считаются по календарю автоматически.</p>';
    var act = activeBans(r, now);
    h += '<div class="rules-card"><h3>Сейчас действует</h3>' +
      (act.length
        ? act.map(function (b) {
          return '<div class="rule-row on"><b>' + esc(b.title) + '</b> — до ' + fmtRDM(b.to) + '.<br><span class="muted">' + esc(b.note) + '</span></div>';
        }).join('')
        : '<p class="muted">Запретов на сегодня нет.</p>') + '</div>';
    RULES_GROUPS.forEach(function (g) {
      var rows = RULES.bans.filter(g[1]).map(function (b) {
        var regions = b.regions.indexOf(-1) >= 0 ? 'Вся Беларусь' : b.regions.map(function (x) { return REGIONS[x]; }).join(', ');
        var nowOn = (b.regions.indexOf(-1) >= 0 || b.regions.indexOf(r) >= 0) && inDate(b.from, b.to, now.getMonth() + 1, now.getDate());
        return '<div class="rule-row' + (nowOn ? ' on' : '') + '">' +
          (nowOn ? '<span class="badge warn">действует</span> ' : '') +
          '<b>' + esc(b.title) + '</b><br>' +
          '<span class="muted">' + fmtRDM(b.from) + ' — ' + fmtRDM(b.to) + ' · ' + esc(regions) + '</span>' +
          (b.note ? '<br><span class="muted">' + esc(b.note) + '</span>' : '') + '</div>';
      }).join('');
      h += '<div class="rules-card"><h3>' + esc(g[0]) + '</h3>' + rows + '</div>';
    });
    var n = RULES.norms;
    h += '<div class="rules-card"><h3>Нормы вылова</h3>' +
      '<div class="rule-row"><b>Лимит:</b> до ' + esc(n.limitKg) + ' кг на рыбака в сутки · не более ' + esc(n.hooks) + ' крючков' +
      (n.note ? '<br><span class="muted">' + esc(n.note) + '</span>' : '') + '</div></div>';
    h += '<div class="rules-card"><h3>Минимальные размеры</h3><table class="seasons"><tr><th>Рыба</th><th>Мин. размер</th></tr>' +
      RULES.sizes.map(function (s) { return '<tr><td>' + esc(s.fish) + '</td><td>' + s.cm + ' см</td></tr>'; }).join('') +
      '</table><p class="muted" style="margin-top:6px">Рыбу меньше минимального размера — отпустить.</p></div>';
    h += '<p class="muted" style="margin-top:10px">Источники: ' +
      RULES.sources.map(function (s) { return '<a href="https://' + esc(s) + '" target="_blank" rel="noopener">' + esc(s) + '</a>'; }).join(' · ') +
      '. Даты могут уточняться постановлениями — сверяйтесь перед выездом.</p>';
    box.innerHTML = h;
  }

  function syncBfDisplays() {
    if (!els.mapFilters || !els.listFilters || !els.topbar) return;
    var c = els.topbar.classList.contains('compact');
    els.mapFilters.style.display = (c && state.tab !== 'map') ? 'none' : '';
    els.listFilters.style.display = (c && state.tab !== 'list') ? 'none' : '';
    var hasFilters = (state.tab === 'map' || state.tab === 'list');
    if (els.burgerFiltersBtn) els.burgerFiltersBtn.style.display = hasFilters ? '' : 'none';
    if (els.bfPanel && !hasFilters) els.bfPanel.classList.remove('open');
    var hideOrigin = (state.tab === 'fish' || state.tab === 'tackle' || state.tab === 'rules');
    if (els.originForm) {
      els.originForm.style.display = hideOrigin ? 'none' : '';
      if (hideOrigin) hideSuggest();
    }
  }

  function switchTab(t) {
    state.tab = t;
    window.scrollTo(0, 0);
    saveState();
    syncBfDisplays();
    if (els.tabs) {
      els.tabs.classList.remove('open');
      if (els.burger) els.burger.setAttribute('aria-expanded', 'false');
      if (els.bfPanel) els.bfPanel.classList.remove('open');
      if (els.burgerFiltersBtn) els.burgerFiltersBtn.setAttribute('aria-expanded', 'false');
    }
    var tabs = els.tabs.children;
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].dataset.view === t);
    [['map', els.viewMap], ['list', els.viewList], ['tackle', els.viewTackle], ['fish', els.viewFish], ['rules', els.viewRules], ['weather', els.viewWeather]]
      .forEach(function (p) { p[1].classList.toggle('hide', p[0] !== t); });
    if (t === 'map' && map) {
      map.invalidateSize();
    }
    if (t === 'weather') loadWeather();
  }

  function shortName(displayName) { return String(displayName).split(',')[0].trim(); }

  function hideSuggest() {
    els.originSuggest.classList.add('hide');
    els.originSuggest.innerHTML = '';
    origItems = [];
  }

  function pickOriginItem(it) {
    var nm = shortName(it.display_name);
    els.originInput.value = nm;
    setOrigin({ name: nm, lat: parseFloat(it.lat), lon: parseFloat(it.lon) });
    hideSuggest();
  }

  function showSuggest(items) {
    var box = els.originSuggest;
    box.innerHTML = '';
    items.forEach(function (it, idx) {
      var d = document.createElement('div');
      d.className = 'sug' + (idx === 0 ? ' on' : '');
      var nm = it.display_name.length > 70 ? it.display_name.slice(0, 70) + '…' : it.display_name;
      d.textContent = nm;
      d.addEventListener('click', function () { pickOriginItem(it); });
      box.appendChild(d);
    });
    box.classList.remove('hide');
    origItems = items;
  }

  var tabsNaturalW = 0, filtersMoved = false, listFiltersMoved = false;
  function layoutFit() {
    if (!els.topbar || !els.brand) return;
    if (!tabsNaturalW) tabsNaturalW = els.tabs.scrollWidth || 0;
    var need = els.brand.offsetWidth + Math.min(els.originForm.offsetWidth, 460) + tabsNaturalW + 70;
    var compact = els.topbar.classList.contains('compact');
    var w = els.topbar.clientWidth;
    if (!compact && (need > w || w < 900)) {
      els.topbar.classList.add('compact');
      els.burger.setAttribute('aria-expanded', 'false');
      els.tabs.classList.remove('open');
      els.bfPanel.classList.remove('open');
      els.burgerFiltersBtn.setAttribute('aria-expanded', 'false');
      if (!filtersMoved && els.mapFilters && els.bfPanel) {
        els.bfPanel.appendChild(els.mapFilters);
        filtersMoved = true;
      }
      if (!listFiltersMoved && els.listFilters && els.bfPanel) {
        els.bfPanel.appendChild(els.listFilters);
        listFiltersMoved = true;
      }
      els.originForm.insertBefore(els.burgerFiltersBtn, els.originForm.firstChild);
      syncBfDisplays();
    } else if (compact && w >= 900 && need <= w - 8) {
      els.topbar.classList.remove('compact');
      els.tabs.classList.remove('open');
      els.burger.setAttribute('aria-expanded', 'false');
      els.bfPanel.classList.remove('open');
      els.burgerFiltersBtn.setAttribute('aria-expanded', 'false');
      if (filtersMoved && els.mapFilters && els.mapwrap) {
        els.viewMap.insertBefore(els.mapFilters, els.mapwrap);
        filtersMoved = false;
      }
      if (listFiltersMoved && els.listFilters && els.cardsEl) {
        els.viewList.insertBefore(els.listFilters, els.cardsEl);
        listFiltersMoved = false;
      }
      if (els.burgerFiltersBtn && els.tabs) els.topbar.insertBefore(els.burgerFiltersBtn, els.tabs);
    }
  }

  function closePanels(except) {
    var all = [['typePanel', 'typeWrap'], ['fishPanel', 'fishWrap'], ['lfTypePanel', 'lfTypeWrap'], ['lfFishPanel', 'lfFishWrap'], ['lfRegPanel', 'lfRegWrap'], ['regionPanel', 'regionWrap'], ['radiusPanel', 'radiusWrap'], ['mapminPanel', 'mapminWrap']];
    for (var i = 0; i < all.length; i++) {
      if (all[i][0] !== except && els[all[i][0]]) els[all[i][0]].classList.add('hide');
    }
  }

  function bindEvents() {
    els.originForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (origItems.length && !els.originSuggest.classList.contains('hide')) {
        pickOriginItem(origItems[0]);
        return;
      }
      var v = els.originInput.value.trim();
      if (!v) return;
      els.originInput.value = v;
      geocode(v, function (o) {
        if (!o) { els.originInput.placeholder = 'Не найдено. Попробуйте ещё раз'; return; }
        els.originInput.placeholder = 'Введите местоположение';
        setOrigin(o);
      });
    });
    els.originInput.addEventListener('input', function () {
      clearTimeout(origTimer);
      var v = els.originInput.value.trim();
      if (!v) { hideSuggest(); return; }
      origTimer = setTimeout(function () {
        fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=by&q=' + encodeURIComponent(v), { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (a) {
            if (!a || !a.length) { hideSuggest(); return; }
            showSuggest(a);
          })
          .catch(function () { hideSuggest(); });
      }, 350);
    });
    document.addEventListener('click', function (e) {
      if (e.target !== els.originInput && !els.originSuggest.contains(e.target)) hideSuggest();
      if (!els.tabs.contains(e.target) && !els.burger.contains(e.target)) {
        els.tabs.classList.remove('open');
        if (els.burger) els.burger.setAttribute('aria-expanded', 'false');
      }
      if (!els.bfPanel.contains(e.target) && !els.burgerFiltersBtn.contains(e.target)) {
        els.bfPanel.classList.remove('open');
        if (els.burgerFiltersBtn) els.burgerFiltersBtn.setAttribute('aria-expanded', 'false');
      }
    });
    els.gpsBtn.addEventListener('click', function () {
      if (!navigator.geolocation) { els.originInput.placeholder = 'GPS недоступен'; return; }
      els.gpsBtn.style.opacity = '.5';
      var tryPos = function (attempt) {
        navigator.geolocation.getCurrentPosition(function (p) {
          els.gpsBtn.style.opacity = '1';
          var lat = p.coords.latitude, lon = p.coords.longitude;
          fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lon + '&zoom=10&accept-language=ru', { headers: { Accept: 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (j) {
              var nm = j && j.display_name ? shortName(j.display_name) : 'Моё местоположение';
              setOrigin({ name: nm, lat: lat, lon: lon });
            })
            .catch(function () { setOrigin({ name: 'Моё местоположение', lat: lat, lon: lon }); });
        }, function () {
          if (attempt < 2) { setTimeout(function () { tryPos(attempt + 1); }, 600); return; }
          els.gpsBtn.style.opacity = '1';
          els.originInput.placeholder = 'GPS не определился';
        }, { enableHighAccuracy: false, timeout: 12000 });
      };
      tryPos(0);
    });
    els.typeBtn.addEventListener('click', function () {
      closePanels('typePanel');
      els.typePanel.classList.toggle('hide');
    });
    els.typePanel.querySelectorAll('input').forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (cb.id === 'ty-all' && cb.checked) {
          els.typePanel.querySelectorAll('input:not(#ty-all)').forEach(function (x) { x.checked = false; });
          state.types = [];
        } else {
          els.tyAll.checked = false;
          state.types = [];
          els.typePanel.querySelectorAll('input:not(#ty-all)').forEach(function (x) { if (x.checked) state.types.push(x.value); });
          if (!state.types.length) els.tyAll.checked = true;
        }
    typeBtnLabel();
        refreshMarkers(); renderCards(); renderList();
        saveState();
      });
    });
    els.fishBtn.addEventListener('click', function () {
      closePanels('fishPanel');
      els.fishPanel.classList.toggle('hide');
    });
    els.fishPanel.querySelectorAll('input').forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (cb.id === 'fish-all' && cb.checked) {
          els.fishPanel.querySelectorAll('input:not(#fish-all)').forEach(function (x) { x.checked = false; });
          state.fishes = [];
        } else {
          els.fishAll.checked = false;
          state.fishes = [];
          els.fishPanel.querySelectorAll('input:not(#fish-all)').forEach(function (x) { if (x.checked) state.fishes.push(x.value); });
          if (!state.fishes.length) els.fishAll.checked = true;
        }
        fishBtnLabel();
        refreshMarkers(); renderCards(); renderList();
        saveState();
      });
    });
    document.addEventListener('click', function (e) {
      var inside = els.typeWrap.contains(e.target) || els.fishWrap.contains(e.target) ||
        els.lfTypeWrap.contains(e.target) || els.lfFishWrap.contains(e.target) || els.lfRegWrap.contains(e.target) || els.regionWrap.contains(e.target) || els.radiusWrap.contains(e.target) || els.mapminWrap.contains(e.target);
      if (!inside) closePanels(null);
      if (!els.typeWrap.contains(e.target)) els.typePanel.classList.add('hide');
      if (!els.fishWrap.contains(e.target)) els.fishPanel.classList.add('hide');
      if (!els.lfTypeWrap.contains(e.target)) els.lfTypePanel.classList.add('hide');
      if (!els.lfFishWrap.contains(e.target)) els.lfFishPanel.classList.add('hide');
      if (!els.lfRegWrap.contains(e.target)) els.lfRegPanel.classList.add('hide');
      if (!els.regionWrap.contains(e.target)) els.regionPanel.classList.add('hide');
      if (!els.radiusWrap.contains(e.target)) els.radiusPanel.classList.add('hide');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closePanels(null); hideSuggest(); }
    });
    els.lfFav.addEventListener('change', function () { state.list.fav = els.lfFav.checked; renderCards(); renderList(); saveState(); });
    els.lfFree.addEventListener('change', function () { state.list.free = els.lfFree.checked; renderCards(); renderList(); saveState(); });
    els.lfPaid.addEventListener('change', function () { state.list.paid = els.lfPaid.checked; renderCards(); renderList(); saveState(); });
    els.lfDist.addEventListener('change', function () {
      state.useDist = els.lfDist.checked;
      D.spots.forEach(function (s) { s._score = spotScore(s); });
      refreshMarkers(); renderCards(); renderList(); saveState();
    });
    els.lfMin.addEventListener('change', function () { state.list.min = parseInt(els.lfMin.value, 10) || 0; renderCards(); renderList(); saveState(); });
    els.lfTypeBtn.addEventListener('click', function () {
      closePanels('lfTypePanel');
      els.lfTypePanel.classList.toggle('hide');
    });
    els.lfTypePanel.querySelectorAll('input').forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (cb.id === 'lft-all' && cb.checked) {
          els.lfTypePanel.querySelectorAll('input:not(#lft-all)').forEach(function (x) { x.checked = false; });
          state.list.types = [];
        } else {
          els.lftAll.checked = false;
          state.list.types = [];
          els.lfTypePanel.querySelectorAll('input:not(#lft-all)').forEach(function (x) { if (x.checked) state.list.types.push(x.value); });
          if (!state.list.types.length) els.lftAll.checked = true;
        }
        lfTypeBtnLabel();
        renderCards(); renderList();
        saveState();
      });
    });
    els.lfFishBtn.addEventListener('click', function () {
      closePanels('lfFishPanel');
      els.lfFishPanel.classList.toggle('hide');
    });
    els.lfRegBtn.addEventListener('click', function () {
      closePanels('lfRegPanel');
      els.lfRegPanel.classList.toggle('hide');
    });
    els.regionBtn.addEventListener('click', function () {
      closePanels('regionPanel');
      els.regionPanel.classList.toggle('hide');
    });
    els.regionPanel.querySelectorAll('input').forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (cb.id === 'region-all' && cb.checked) {
          els.regionPanel.querySelectorAll('input:not(#region-all)').forEach(function (x) { x.checked = false; });
          state.regions = [];
        } else {
          els.regionAll.checked = false;
          state.regions = [];
          els.regionPanel.querySelectorAll('input:not(#region-all)').forEach(function (x) { if (x.checked) state.regions.push(parseInt(x.value, 10)); });
          if (!state.regions.length) els.regionAll.checked = true;
        }
        regionBtnLabel();
        refreshMarkers();
        saveState();
      });
    });
    els.lfRegPanel.querySelectorAll('input').forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (cb.id === 'lf-reg-all' && cb.checked) {
          els.lfRegPanel.querySelectorAll('input:not(#lf-reg-all)').forEach(function (x) { x.checked = false; });
          state.list.regions = [];
        } else {
          els.lfRegAll.checked = false;
          state.list.regions = [];
          els.lfRegPanel.querySelectorAll('input:not(#lf-reg-all)').forEach(function (x) { if (x.checked) state.list.regions.push(parseInt(x.value, 10)); });
          if (!state.list.regions.length) els.lfRegAll.checked = true;
        }
        lfRegBtnLabel();
        renderCards(); renderList();
        saveState();
      });
    });
    els.lfFishPanel.querySelectorAll('input').forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (cb.id === 'lff-all' && cb.checked) {
          els.lfFishPanel.querySelectorAll('input:not(#lff-all)').forEach(function (x) { x.checked = false; });
          state.list.fishes = [];
        } else {
          els.lffAll.checked = false;
          state.list.fishes = [];
          els.lfFishPanel.querySelectorAll('input:not(#lff-all)').forEach(function (x) { if (x.checked) state.list.fishes.push(x.value); });
          if (!state.list.fishes.length) els.lffAll.checked = true;
        }
        lfFishBtnLabel();
        renderCards(); renderList();
        saveState();
      });
    });
    els.radiusBtn.addEventListener('click', function () {
      closePanels('radiusPanel');
      els.radiusPanel.classList.toggle('hide');
    });
    els.radiusPanel.querySelectorAll('input').forEach(function (cb) {
      cb.addEventListener('change', function () {
        state.radius = parseInt(cb.value, 10) || 0;
        radiusBtnLabel();
        els.radiusPanel.classList.add('hide');
        updateRadius(); refreshMarkers(); renderCards(); renderList(); saveState();
      });
    });
    els.mapminBtn.addEventListener('click', function () {
      closePanels('mapminPanel');
      els.mapminPanel.classList.toggle('hide');
    });
    els.mapminPanel.querySelectorAll('input').forEach(function (cb) {
      cb.addEventListener('change', function () {
        state.mapMin = parseInt(cb.value, 10) || 0;
        mapminBtnLabel();
        els.mapminPanel.classList.add('hide');
        refreshMarkers(); saveState();
      });
    });
    var t;
    els.search.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { state.q = els.search.value.trim(); refreshMarkers(); renderCards(); renderList(); saveState(); }, 250);
    });
    els.sorts.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.sort = b.dataset.sort;
      var btns = els.sorts.children;
      for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i] === b);
      renderList();
      saveState();
    });
    [
      ['lay-free', 'free', null], ['lay-paid', 'paid', null],
      ['lay-fav', 'fav', null], ['fm-layer', 'fm', null]
    ].forEach(function (c) {
      var el = $(c[0]);
      el.addEventListener('change', function () {
        state.layers[c[1]] = el.checked;
        refreshMarkers();
        saveState();
      });
    });
    els.burger.addEventListener('click', function () {
      var open = els.tabs.classList.toggle('open');
      els.burger.setAttribute('aria-expanded', String(open));
      els.bfPanel.classList.remove('open');
      els.burgerFiltersBtn.setAttribute('aria-expanded', 'false');
      closePanels(null);
      hideSuggest();
    });
    els.burgerFiltersBtn.addEventListener('click', function () {
      var open = els.bfPanel.classList.toggle('open');
      els.burgerFiltersBtn.setAttribute('aria-expanded', String(open));
      els.tabs.classList.remove('open');
      els.burger.setAttribute('aria-expanded', 'false');
      closePanels(null);
      hideSuggest();
    });
    els.legendToggle.addEventListener('click', function () {
      els.legendBody.classList.toggle('hide');
      state.legendOpen = !els.legendBody.classList.contains('hide');
      els.legendToggle.textContent = state.legendOpen ? 'Легенда ▾' : 'Легенда ▴';
      saveState();
    });
    els.weatherRefresh.addEventListener('click', function () { state.weatherAt = 0; loadWeather(); });
    var mm = window.matchMedia('(min-width:761px)');
    if (mm.addEventListener) {
      mm.addEventListener('change', function (m) {
        if (m.matches) {
          els.tabs.classList.remove('open');
          if (els.burger) els.burger.setAttribute('aria-expanded', 'false');
        }
      });
    }
  }

  function init() {
    els = {
      originForm: $('origin-form'), originInput: $('origin-input'), originSuggest: $('origin-suggest'), gpsBtn: $('gps-btn'),
      tabs: $('tabs'), viewMap: $('view-map'), viewList: $('view-list'), viewTackle: $('view-tackle'), cardsEl: $('cards'), listFilters: $('list-filters'),
      viewFish: $('view-fish'), viewRules: $('view-rules'), viewWeather: $('view-weather'),
      stats: $('stats'), cards: $('cards'), listCount: $('list-count'), sorts: $('sorts'),
      regionWrap: $('region-wrap'), regionBtn: $('region-btn'), regionPanel: $('region-panel'), regionAll: $('region-all'), typeWrap: $('type-wrap'), typeBtn: $('type-btn'), typePanel: $('type-panel'), tyAll: $('ty-all'), fishWrap: $('fish-wrap'), fishBtn: $('fish-btn'), fishPanel: $('fish-panel'), fishAll: $('fish-all'), radiusWrap: $('radius-wrap'), radiusBtn: $('radius-btn'), radiusPanel: $('radius-panel'), mapminWrap: $('mapmin-wrap'), mapminBtn: $('mapmin-btn'), mapminPanel: $('mapmin-panel'), search: $('search'),       lfFav: $('lf-fav'), lfFree: $('lf-free'), lfPaid: $('lf-paid'), lfDist: $('lf-dist'), lfMin: $('lf-min'), lfTypeWrap: $('lf-type-wrap'), lfTypeBtn: $('lf-type-btn'), lfTypePanel: $('lf-type-panel'), lftAll: $('lft-all'), lfFishWrap: $('lf-fish-wrap'), lfFishBtn: $('lf-fish-btn'), lfFishPanel: $('lf-fish-panel'), lffAll: $('lff-all'), lfRegWrap: $('lf-reg-wrap'), lfRegBtn: $('lf-reg-btn'), lfRegPanel: $('lf-reg-panel'), lfRegAll: $('lf-reg-all'),
      methods: $('methods'), methodDetail: $('method-detail'), fishes: $('fishes'),
      weatherWhere: $('weather-where'),
      weatherStatus: $('weather-status'), calendar: $('calendar'), dayDetail: $('day-detail'),
      rulesBox: $('rules-box'), rulesDayBanner: $('rules-day-banner'),
      weatherRefresh: $('weather-refresh'), legendToggle: $('legend-toggle'), legendBody: $('legend-body'),
      burger: $('burger'), burgerFiltersBtn: $('burger-filters-btn'), bfPanel: $('bf-panel'), topbar: $('topbar'), brand: $('brand'),
      mapFilters: $('map-filters'), mapwrap: $('mapwrap'),
      layFree: $('lay-free'), layPaid: $('lay-paid'), layFav: $('lay-fav'), fmLayer: $('fm-layer')
    };
    loadState();
    els.layFree.checked = state.layers.free;
    els.layPaid.checked = state.layers.paid;
    els.layFav.checked = state.layers.fav;
    els.fmLayer.checked = state.layers.fm;
    typeBtnLabel();
    try {
      var o = JSON.parse(localStorage.getItem('rb.origin'));
      if (o && o.lat) { state.origin = o; els.originInput.value = o.name || ''; }
    } catch (e) {}
    buildFilters();
    setPanelChecks(els.typePanel, state.types, 'ty-all');
    setPanelChecks(els.fishPanel, state.fishes, 'fish-all');
    setPanelChecks(els.lfTypePanel, state.list.types, 'lft-all');
    setPanelChecks(els.lfFishPanel, state.list.fishes, 'lff-all');
    setPanelChecks(els.lfRegPanel, state.list.regions, 'lf-reg-all');
    setPanelChecks(els.regionPanel, state.regions, 'region-all');
    fishBtnLabel();
    lfFishBtnLabel();
    lfTypeBtnLabel();
    regionBtnLabel();
    lfRegBtnLabel();
    var rSel = els.radiusPanel;
    if (rSel) {
      var ro = rSel.querySelector('input[value="' + (state.radius || 0) + '"]');
      if (ro) ro.checked = true;
      radiusBtnLabel();
    }
    mapminBtnLabel();
    els.search.value = state.q || '';
    els.lfFav.checked = state.list.fav;
    els.lfFree.checked = state.list.free;
    els.lfPaid.checked = state.list.paid;
    els.lfDist.checked = state.useDist;
    els.lfMin.value = String(state.list.min || 0);
    var sb = els.sorts.querySelectorAll('button');
    for (var sbi = 0; sbi < sb.length; sbi++) sb[sbi].classList.toggle('on', sb[sbi].dataset.sort === state.sort);
    if (state.legendOpen) { els.legendBody.classList.remove('hide'); els.legendToggle.textContent = 'Легенда ▾'; }
    initMap();
    buildMarkers();
    setTimeout(function () { buildFisherMarkers(); refreshFmLayer(); }, 120);
    buildActivity();
    D.spots.forEach(function (s) { s._d = state.origin ? distKm(state.origin.lat, state.origin.lon, s.lat, s.lon) : null; });
    FISHER.forEach(function (f) { f._d = state.origin ? distKm(state.origin.lat, state.origin.lon, f.lat, f.lon) : null; });
    refreshMarkers();
    buildCards();
    renderCards();
    renderList();
    buildMethods();
    buildFishes();
    renderRulesTab();
    bindEvents();
    var tabBtns = els.tabs.children;
    for (var i = 0; i < tabBtns.length; i++) {
      (function (b) {
        b.addEventListener('click', function () { switchTab(b.dataset.view); });
      })(tabBtns[i]);
    }
    if (state.origin) setOrigin(state.origin, true);
    switchTab(state.tab);
    layoutFit();
    window.addEventListener('resize', function () {
      requestAnimationFrame(layoutFit);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutFit);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
