/* ---------------------------------------------------------------------------
   app.js — מסך "מפת גיוס": מפת חום תחנות + מפת חום יישובים.

   שני הטאבים הם אותה זרימה בדיוק, רק עם הצדדים מוחלפים: בוחרים ישות אחת
   ורואים את מי שקרוב אליה עד 30 דק'. לכן הם ממומשים כתצורה אחת (MODES) ולא
   כשני עותקים של אותו קוד — אחרת תיקון בצד אחד היה שוכח את השני.

   הצבעים והסטטוסים מגיעים מהשרת (colors.py) ולא מחושבים כאן, כדי שהמקרא,
   הסיכות, הטבלה והייצוא לא יוכלו לסטות זה מזה.
   --------------------------------------------------------------------------- */

const DEFAULT_VIEW = { center: [32.07, 34.83], zoom: 11 };

// גבולות מדינת ישראל. המפה לא ניתנת לגרירה מחוץ להם ולא לזום־אאוט מעבר להם:
// זו מערכת של משטרת ישראל, ומפה שאפשר לגרור לאירופה רק מזמינה איבוד הקשר.
// הטווח נדיב במכוון (כולל שוליים) כדי שהמחוזות בקצוות לא ייחתכו.
const ISRAEL_BOUNDS = [
  [29.35, 34.15], // דרום־מערב, אילת
  [33.40, 35.95], // צפון־מזרח, הר דב
];
const MIN_ZOOM = 7; // רואים את כל המדינה, ולא פחות מזה

// רקעי המפה. כולם חינמיים וללא מפתח API.
//
// ברירת המחדל היא Esri "רחובות" בגלל **שפת התוויות**, לא בגלל היופי:
// זה הרקע היחיד מבין הנבדקים שמציג שמות בעברית בכל רמות הזום. CARTO Voyager
// יפה יותר, אבל במבט הכללי (זום 11-12) — המבט שהמשתמש רואה רוב הזמן —
// התוויות שלו באנגלית ("TEL AVIV", "Petah Tikva"), והוא עובר לעברית רק
// בזום 13 ומעלה. במערכת עברית של משטרת ישראל זה מכריע.
//
// הבורר קיים כי "יפה" היא העדפה — עדיף לתת לבחור מאשר לנחש.
const BASEMAPS = {
  "רחובות (עברית)": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "© Esri",
    maxZoom: 19,
  },
  "צבעוני ונקי": {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution: "© OpenStreetMap · © CARTO",
    maxZoom: 20,
  },
  "OpenStreetMap": {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap",
    maxZoom: 19,
  },
  "בהיר": {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png",
    attribution: "© OpenStreetMap · © CARTO",
    maxZoom: 20,
  },
  "לוויין": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "© Esri · Maxar · Earthstar Geographics",
    maxZoom: 19,
  },
  // הרקע היחיד שעובד ברשת סגורה. מוגש מהשרת המקומי מתוך web/vendor/tiles.
  // מופיע בבורר רק אם החבילה הורדה — ראו tools/download_tiles.py.
  "מקומי (אופליין)": {
    url: "/web/vendor/tiles/{z}/{x}/{y}.png",
    attribution: "© Esri · אריחים מקומיים",
    maxZoom: 14,
    offline: true,
  },
};

const DEFAULT_BASEMAP = "רחובות (עברית)";
const BASEMAP_KEY = "geoheat.basemap"; // הבחירה נשמרת בדפדפן

const state = {
  map: null,
  stations: [],
  settlements: [],
  relations: [],
  stationsById: new Map(),
  settlementsById: new Map(),
  nearbyMinutes: 30,
  criticalThreshold: 25, // נדרס מנתוני המגייס; ברירת מחדל כדי שכרטיס לא ישבר
  screen: "map",
  mode: "stations",
  selectedId: null,
  baseLayer: null,    // הסיכות של המצב הנוכחי
  nearbyLayer: null,  // שכבת הבחירה: מי שקרוב + קווי החיבור
  baseMarkers: new Map(),
  nearbyStationMarkers: [], // תחנות קרובות בטאב היישובים, לרענון גודל בזום
};

/* --- תצורת שני המצבים ---------------------------------------------------- */

const MODES = {
  stations: {
    hash: "station",
    placeholder: "חפש תחנה… (או לחץ על סיכה במפה)",
    // מי מוצג כברירת מחדל, ומי "הצד השני" שקופץ בבחירה
    base: () => state.stations,
    other: (id) => state.settlements,
    // קשרים של הישות הנבחרת, מנקודת מבטה
    nearbyOf: (id) =>
      state.relations
        .filter((r) => r.station_id === id && r.within_nearby)
        .map((r) => ({ ...r, otherId: r.settlement_id, otherName: r.settlement_name }))
        .sort((a, b) => a.travel_min - b.travel_min),
    otherById: (id) => state.settlementsById.get(id),
    baseIcon: (entity, selected) => stationIcon(entity, selected),
    nearbyMarkers: (rel, other) => [labelMarker(other.name, rel.travel_min)],
    listTitle: "יישובים",
  },
  settlements: {
    hash: "settlement",
    placeholder: "חפש יישוב… (או לחץ על סיכה במפה)",
    base: () => state.settlements,
    other: (id) => state.stations,
    nearbyOf: (id) =>
      state.relations
        .filter((r) => r.settlement_id === id && r.within_nearby)
        .map((r) => ({ ...r, otherId: r.station_id, otherName: r.station_name }))
        .sort((a, b) => a.travel_min - b.travel_min),
    otherById: (id) => state.stationsById.get(id),
    // ביישובים הצד השני הוא תחנה — ולכן הוא נצבע לפי המשרות הפתוחות, בדיוק
    // כמו בטאב התחנות. זה מה שהופך את המסך ל"מפת חום" ולא לרשימת מרחקים.
    nearbyMarkers: (rel, other) => [stationMarkerFor(other, rel), labelMarker(null, rel.travel_min)],
    listTitle: "תחנות",
  },
};

const mode = () => MODES[state.mode];

/* --- עזר ----------------------------------------------------------------- */

// --- שכבת נתונים סטטית (GitHub Pages) --------------------------------------
//
// בגרסת השרת המלאה api() פנתה ל-Flask תחת /api/*. גרסת התצוגה הזו רצה בלי
// שרת: הנתונים יוצאו מראש מ-SQLite לקובצי JSON סטטיים (ראו tools/generate_
// demo_data.py), ו-api() מתרגמת כל נתיב /api/* לקובץ המתאים תחת data/.
// שאר הקוד לא יודע על ההבדל ולא השתנה — הוא ממשיך לקרוא ל-api("/api/...").
//
// פרמטרי שאילתה (סינון בלוח הבקרה/מגייס, בחירת N באסטרטגי) לא נתמכים בלי
// שרת: הם מקבלים את התצוגה הארצית המלאה. פעולות כתיבה (טעינה/עריכה/הגדרות)
// לא קיימות במצב תצוגה — הן היו במערכת המקורית, ומתועדות ב-README.
const STATIC_ENDPOINTS = {
  "/api/tiles-available": "data/tiles-available.json",
  "/api/health": "data/health.json",
  "/api/legend": "data/legend.json",
  "/api/stations": "data/stations.json",
  "/api/settlements": "data/settlements.json",
  "/api/relations": "data/relations.json",
  "/api/last-update": "data/last-update.json",
  "/api/loaded-files": "data/loaded-files.json",
  "/api/regions": "data/regions.json",
  "/api/dashboard": "data/dashboard.json",
  "/api/recruiter": "data/recruiter.json",
  "/api/strategic": "data/strategic.json",
  "/api/settings": "data/settings.json",
  "/api/insights": "data/insights.json",
};

const api = async (path) => {
  const clean = path.split("?")[0]; // פרמטרי סינון נופלים כאן — התצוגה ארצית
  let file = STATIC_ENDPOINTS[clean];
  const detail = clean.match(/^\/api\/stations\/(\d+)\/detail$/);
  if (detail) file = `data/station-detail/${detail[1]}.json`;
  if (!file) throw new Error(`אין קובץ סטטי עבור ${path} (מצב תצוגה בלבד)`);
  const res = await fetch(file);
  if (!res.ok) throw new Error(`${file} → ${res.status}`);
  return res.json();
};

const el = (id) => document.getElementById(id);
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

// --- המדד היחיד: משרות פתוחות ---------------------------------------------
//
// המערכת הזו מודדת דבר אחד — כמה תקנים פנויים מפורסמים בכל תחנה. אין כאן
// אחוזי איוש, אין מצבת כוח אדם ואין מועמדים; ראו tools/generate_demo_data.py.
// בניגוד לאחוז, כאן **גבוה יותר = חמור יותר**, וזה מה שקובע את כיוון הספים.
const openText = (s) => (s.open_positions === null ? "—" : s.open_positions);
const openFull = (s) =>
  s.open_positions === null ? "—" : `${s.open_positions} משרות`;

// המקצוע שבו נפתחו הכי הרבה משרות בתחנה — התשובה הקצרה ל"איפה הכאב".
const topRoleText = (s) =>
  s.top_role ? `${escapeHtml(s.top_role.label)} <em>(${s.top_role.open})</em>` : "—";

// --- פילוח לפי משפחת מקצוע (שש משפחות קבועות) -----------------------------
//
// הפילוח נשען תמיד על r.key ולא על התווית, ולכן שינוי בסדר או בניסוח
// לא יכול לשדך משפחה לערך של אחרת.

// שדה שלא נטען הוא null ולא 0. צ'יפ בלי נתון מציג "—", וכשלכל המשפחות אין
// נתון לא מוצגת המחיצה בכלל — שישה מקפים אינם מידע.
function familyChips(title, items) {
  if (!Array.isArray(items) || !items.length) return "";
  if (items.every((i) => i.value === null || i.value === undefined)) return "";
  return `<div class="unit-section">
      <span class="unit-section-title">${escapeHtml(title)}</span>
      <div class="chips">${items
        .map(
          (i) =>
            `<span class="chip">${escapeHtml(i.label)}<b>${
              i.value === null || i.value === undefined ? "—" : i.value
            }</b></span>`
        )
        .join("")}</div>
    </div>`;
}

const roleItems = (station) =>
  (station.roles || []).map((r) => ({ key: r.key, label: r.label, value: r.open }));

// הפילוח של תחנה אחת — מוצג גם בכרטיס התחנה במפה וגם בחלונית שנפתחת
// כשבוחרים תחנה דרך יישוב. אותה תחנה, אותו מידע, שני מסלולים.
function familyBreakdown(station) {
  return familyChips("משרות פתוחות לפי מקצוע", roleItems(station));
}

// סיכום על פני כמה תחנות (התחנות שמגייסות מיישוב נבחר). null נשמר כ"אין
// נתון": תחנה בלי נתוני תקן לא נספרת כאפס, אחרת היישוב נראה מאויש יותר
// ממה שהוא באמת.
function sumFamilies(stations, toItems) {
  const totals = new Map();
  stations.forEach((station) => {
    toItems(station).forEach((item) => {
      const current = totals.get(item.key) || { key: item.key, label: item.label, value: null };
      if (item.value !== null && item.value !== undefined) {
        current.value = (current.value || 0) + item.value;
      }
      totals.set(item.key, current);
    });
  });
  return [...totals.values()];
}

function setHealth(stateName, text) {
  const box = el("health");
  box.className = `health health--${stateName}`;
  box.querySelector(".health-text").textContent = text;
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString("he-IL", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/* --- סיכות --------------------------------------------------------------- */

// גודל הסיכה נגזר מהזום: תחנות ת"א יושבות 2-4 ק"מ זו מזו, וסיכה בגודל קבוע
// שנקראת יפה בזום 13 מכסה את שכנותיה בזום 11.
function pinSize(selected) {
  const zoom = state.map ? state.map.getZoom() : 12;
  const base = zoom <= 10 ? 24 : zoom === 11 ? 30 : zoom === 12 ? 36 : 42;
  return selected ? base + 8 : base;
}

// סיכת תחנה: עיגול בצבע הסטטוס עם מספר המשרות הפתוחות עליו. divIcon ולא
// תמונה, כדי שהצבע יגיע מהנתונים ולא נצטרך קבצי PNG שיכולים לצאת מסנכרון.
// המספר קצר (עד שתי ספרות) ולכן הוא נקרא גם בסיכה הקטנה — מכאן הסף 24.
function stationIcon(station, selected) {
  const size = pinSize(selected);
  return L.divIcon({
    className: "",
    html: `<div class="pin ${selected ? "pin--selected" : ""}"
                style="background:${station.color}; width:${size}px; height:${size}px;
                       font-size:${Math.max(10, Math.round(size * 0.38))}px">
             ${size >= 24 ? openText(station) : ""}
           </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function settlementIcon(settlement, selected) {
  return L.divIcon({
    className: "",
    html: `<div class="dot ${selected ? "dot--selected" : ""}">
             <span>${escapeHtml(settlement.name)}</span>
           </div>`,
    iconSize: [null, 20],
    iconAnchor: [7, 10],
  });
}

// תווית צפה: שם ו/או זמן נסיעה. משמשת את שני המצבים.
function labelMarker(name, travelMin) {
  return (latlng) =>
    L.marker(latlng, {
      icon: L.divIcon({
        className: "",
        html: `<div class="settlement-pin">
                 ${name ? `<span class="settlement-name">${escapeHtml(name)}</span>` : ""}
                 <span class="settlement-time">${travelMin}′</span>
               </div>`,
        iconSize: [null, 22],
        iconAnchor: name ? [0, 11] : [-14, 22],
      }),
      title: `${name || ""} ${travelMin} דקות`.trim(),
      // תחנה ועיר שנקראות באותו שם יושבות כמעט באותה נקודה (תחנת גבעתיים /
      // גבעתיים), ואז התווית נוחתת על הסיכה ומסתירה את מספר המשרות — הנתון
      // שכל המסך קיים בשבילו. הסיכות תמיד מעל.
      zIndexOffset: -1000,
    });
}

// תחנה קרובה בטאב היישובים: נלחצת ופותחת את חלונית המידע שלה.
function stationMarkerFor(station, rel) {
  return (latlng) => {
    const marker = L.marker(latlng, { icon: stationIcon(station, false), title: station.name });
    marker.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      openDrawer(station, rel);
    });
    // נרשמת לרענון בזום: היא נוצרת לפני שהמפה ממקדת, ובלי זה היא נשארת
    // בגודל של הזום הקודם — קטנה מכדי להציג את מספר המשרות, שהוא כל הנקודה.
    state.nearbyStationMarkers.push({ marker, station });
    return marker;
  };
}

/* --- מפה ----------------------------------------------------------------- */

async function initMap() {
  // רקע האופליין מוצג רק אם החבילה קיימת בפועל. רקע שמופיע בבורר ומראה
  // ריבועים ריקים גרוע מרקע שלא מופיע.
  let tiles = { available: false, zooms: [] };
  try {
    tiles = await api("/api/tiles-available");
  } catch (err) {
    // אין סיבה להפיל את המפה בגלל זה
  }

  state.map = L.map("map", {
    zoomControl: true,
    attributionControl: true,
    maxBounds: ISRAEL_BOUNDS,
    // 1.0 = הגבול קשיח. ערך נמוך יותר מאפשר "למתוח" את המפה החוצה ולחזור
    // בקפיצה — אפקט שנראה כמו תקלה, לא כמו גבול מכוון.
    maxBoundsViscosity: 1.0,
    minZoom: MIN_ZOOM,
  }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

  const layers = {};
  Object.entries(BASEMAPS).forEach(([name, cfg]) => {
    if (cfg.offline && !tiles.available) return;
    layers[name] = L.tileLayer(cfg.url, {
      // מעבר לזום שיש לו אריחים מקומיים, Leaflet ימתח את האריח האחרון
      // במקום להציג ריק. עדיף מטושטש מאשר לבן.
      maxZoom: cfg.offline ? 19 : cfg.maxZoom,
      maxNativeZoom: cfg.offline ? Math.max(...tiles.zooms) : cfg.maxZoom,
      minZoom: MIN_ZOOM,
      bounds: ISRAEL_BOUNDS, // לא מושכים אריחים מחוץ לישראל — גם חוסך רוחב פס
      attribution: cfg.attribution,
    });
  });

  // הבחירה נשמרת: משתמש שבחר רקע לא אמור לבחור אותו מחדש בכל פתיחה.
  const saved = localStorage.getItem(BASEMAP_KEY);
  const initial = layers[saved] ? saved : DEFAULT_BASEMAP;
  layers[initial].addTo(state.map);

  L.control.layers(layers, null, { position: "topleft" }).addTo(state.map);
  state.map.on("baselayerchange", (e) => localStorage.setItem(BASEMAP_KEY, e.name));

  state.baseLayer = L.layerGroup().addTo(state.map);
  state.nearbyLayer = L.layerGroup().addTo(state.map);

  // לחיצה על רקע המפה מנקה — אחרת אין דרך לחזור למבט הכללי בלי לרענן.
  state.map.on("click", () => selectEntity(null));
  state.map.on("zoomend", refreshBaseIcons);

  // בנייד גובה החלון משתנה בלי שהמשתמש עשה כלום: סרגל הכתובת נעלם בגלילה,
  // והמסך מסתובב. Leaflet לא שם לב מעצמו, ואז נשארת רצועה אפורה בלי אריחים
  // בדיוק בגודל השינוי. debounce קצר, כי resize נורה עשרות פעמים בשנייה.
  let resizeTimer = null;
  const onViewportChange = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.map) return;
      state.map.invalidateSize();
      refreshBaseIcons();
    }, 180);
  };
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("orientationchange", onViewportChange);
}

// מבט הפתיחה נגזר מהנתונים ולא ממספרים קבועים: אם יתווסף מחוז או תזוז
// קואורדינטה, המפה עדיין תיפתח על מה שקיים.
function fitToBase() {
  const points = mode()
    .base()
    .filter((e) => e.lat !== null && e.lng !== null)
    .map((e) => [e.lat, e.lng]);
  if (!points.length) return;
  // padding בפיקסלים ולא pad() יחסי: היחסי הפיל את הזום דרגה שלמה, וברמה
  // הזו סיכות תחנות ת"א נדחסות זו על זו.
  //
  // animate:false קריטי ולא קוסמטי: fitBounds מנפיש את המעבר כברירת מחדל,
  // והאנימציה נשארת תלויה. כשנכנסים דרך קישור ישיר, הבחירה קופצת מיד לזום
  // של הישות — ואז האנימציה התלויה של fitBounds נוחתת ומושכת את המפה חזרה
  // למבט הכללי. התוצאה: הרצליה נבחרה, החלונית נכונה, והמפה הראתה את כל הארץ.
  state.map.fitBounds(L.latLngBounds(points), { padding: [45, 45], animate: false });
  DEFAULT_VIEW.center = state.map.getCenter();
  DEFAULT_VIEW.zoom = state.map.getZoom();
}

function renderBaseMarkers() {
  state.baseLayer.clearLayers();
  state.baseMarkers.clear();

  mode()
    .base()
    .forEach((entity) => {
      if (entity.lat === null || entity.lng === null) return;
      const icon =
        state.mode === "stations" ? stationIcon(entity, false) : settlementIcon(entity, false);
      const marker = L.marker([entity.lat, entity.lng], {
        icon,
        title: entity.name,
        riseOnHover: true,
      }).addTo(state.baseLayer);

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e); // אחרת ה-click של המפה ינקה מיד את הבחירה
        selectEntity(entity.id);
      });
      state.baseMarkers.set(entity.id, marker);
    });
}

function refreshBaseIcons() {
  mode()
    .base()
    .forEach((entity) => {
      const marker = state.baseMarkers.get(entity.id);
      if (!marker) return;
      const selected = entity.id === state.selectedId;
      marker.setIcon(
        state.mode === "stations" ? stationIcon(entity, selected) : settlementIcon(entity, selected)
      );
    });
  state.nearbyStationMarkers.forEach(({ marker, station }) =>
    marker.setIcon(stationIcon(station, false))
  );
}

/* --- כתובת הדף ----------------------------------------------------------- */

// הכתובת משקפת את הנבחר (#/station/3, #/settlement/7). אפשר לשמור מועדף
// או לשלוח קישור שנפתח עליו, במקום "תפתח את המפה ותחפש".
function parseHash(hash = location.hash) {
  const match = hash.match(/^#\/(station|settlement)\/(\d+)$/);
  if (!match) return null;
  return { mode: match[1] === "station" ? "stations" : "settlements", id: Number(match[2]) };
}

function syncHash(id) {
  // הכתובת שייכת למסך שמוצג. בלי התנאי הזה, רענון נתונים בזמן שהמשתמש
  // נמצא בלוח הבקרה היה דורס את #/dashboard ל-#, כי הרענון מנקה את הבחירה
  // במפה ומסנכרן כתובת של מסך שכלל לא מוצג.
  if (state.screen !== "map") return;
  const target = id === null ? "#" : `#/${mode().hash}/${id}`;
  // replaceState ולא location.hash= : האחרון מוסיף רשומה להיסטוריה בכל לחיצה
  // על סיכה, וכפתור "אחורה" היה הופך למסע בין כל מה שנגעת בו.
  if (location.hash !== target) history.replaceState(null, "", target);
}

/* --- בחירה --------------------------------------------------------------- */

function selectEntity(id, { animate = true } = {}) {
  const entity = mode().base().find((e) => e.id === id);
  // ישות בלי קואורדינטה לא ניתנת למיקוד; מתייחסים לזה כביטול בחירה במקום
  // להעיף את המפה ל-null,null.
  if (id !== null && (!entity || entity.lat === null)) id = null;

  state.selectedId = id;
  syncHash(id);
  state.nearbyLayer.clearLayers();
  state.nearbyStationMarkers = []; // הסמנים נמחקו עם השכבה; לא להשאיר הפניות מתות
  closeDrawer();
  refreshBaseIcons();

  document.querySelectorAll("#stations-table tbody tr").forEach((tr) => {
    tr.classList.toggle("row--selected", state.mode === "stations" && Number(tr.dataset.id) === id);
  });

  if (id === null) {
    el("map-info").hidden = true;
    el("search").value = "";
    el("search-clear").hidden = true;
    state.map.flyTo(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom, { duration: 0.6, animate });
    return;
  }

  const nearby = mode().nearbyOf(id);

  nearby.forEach((rel) => {
    const other = mode().otherById(rel.otherId);
    if (!other || other.lat === null) return;
    const latlng = [other.lat, other.lng];

    L.polyline([[entity.lat, entity.lng], latlng], {
      color: state.mode === "stations" ? entity.color : other.color,
      weight: 2,
      opacity: 0.5,
      dashArray: "5,5",
    }).addTo(state.nearbyLayer);

    mode()
      .nearbyMarkers(rel, other)
      .forEach((factory) => factory(latlng).addTo(state.nearbyLayer));
  });

  renderMapInfo(entity, nearby);
  el("search").value = entity.name;
  el("search-clear").hidden = false;
  hideSuggestions();

  // מיקוד שמכיל את הנבחר וכל מי שקרוב אליו — לא זום קבוע, אחרת מי שבקצה
  // נשאר מחוץ למסך והמשתמש לא יודע שהוא קיים.
  const points = [[entity.lat, entity.lng]].concat(
    nearby
      .map((r) => mode().otherById(r.otherId))
      .filter((o) => o && o.lat !== null)
      .map((o) => [o.lat, o.lng])
  );
  if (points.length > 1) {
    state.map.flyToBounds(L.latLngBounds(points).pad(0.18), { duration: 0.7, animate });
  } else {
    state.map.flyTo([entity.lat, entity.lng], 13, { duration: 0.7, animate });
  }
  // המיקוד עשוי לא לשנות זום (ואז zoomend לא נורה), אבל הסמנים נבנו לפי
  // הזום הקודם. רענון מפורש מכסה את שני המקרים.
  refreshBaseIcons();
}

function renderMapInfo(entity, nearby) {
  const box = el("map-info");
  const isStation = state.mode === "stations";

  const head = isStation
    ? `<span class="pill" style="background:${entity.color}">${entity.status}</span>
       <strong>${escapeHtml(entity.name)}</strong>`
    : `<strong>${escapeHtml(entity.name)}</strong>`;

  const grid = isStation
    ? `<div><span>מרחב</span><b>${escapeHtml(entity.area || "—")}</b></div>
       <div><span>משרות פתוחות</span><b>${openText(entity)}</b></div>
       <div><span>מקצוע מוביל</span><b>${topRoleText(entity)}</b></div>`
    : `<div><span>תחנות עד 30 דק'</span><b>${nearby.length}</b></div>
       <div><span>הקרובה ביותר</span><b>${
         nearby.length ? `${nearby[0].travel_min} דק'` : "—"
       }</b></div>
       <div><span>משרות פתוחות בטווח</span><b>${nearby.reduce(
         (n, rel) => n + (state.stationsById.get(rel.otherId)?.open_positions || 0),
         0
       )}</b></div>`;

  // הפילוח לפי מקצוע מוצג בשני הטאבים, ובשניהם הוא עונה על אותה שאלה —
  // "אילו משרות פתוחות כאן". בטאב תחנות זו התחנה עצמה; בטאב יישובים זהו
  // סיכום כל התחנות שמגייסות מהיישוב הנבחר.
  const stationExtra = isStation
    ? familyBreakdown(entity)
    : (() => {
        const stations = nearby
          .map((rel) => state.stationsById.get(rel.otherId))
          .filter(Boolean);
        return familyChips(
          "משרות פתוחות לפי מקצוע בתחנות שבטווח",
          sumFamilies(stations, roleItems)
        );
      })();

  // בטאב היישובים כל פריט ברשימה הוא תחנה — ולכן נושא את נקודת הצבע של
  // הסטטוס שלה, ונלחץ לפתיחת החלונית שלה.
  const items = nearby.length
    ? nearby
        .map((rel) => {
          const other = mode().otherById(rel.otherId);
          const dot =
            isStation || !other
              ? ""
              : `<span class="sugg-dot" style="background:${other.color}"></span>`;
          const clickable = isStation ? "" : ` class="clickable" data-id="${rel.otherId}"`;
          return `<li${clickable}>${dot}<span>${escapeHtml(rel.otherName)}</span><b>${
            rel.travel_min
          } דק'</b></li>`;
        })
        .join("")
    : `<li class="muted">אין ${mode().listTitle} עד 30 דקות</li>`;

  box.innerHTML = `
    <div class="info-head">
      ${head}
      <button class="info-close" id="info-close" title="סגור">×</button>
    </div>
    <div class="info-grid">${grid}</div>
    ${stationExtra}
    <div class="info-list-head">${mode().listTitle} עד 30 דק' <em>(${nearby.length})</em></div>
    <ul class="info-list">${items}</ul>
    ${entity.coord_verified ? "" : '<div class="info-warn">מיקום הסיכה הוא ערך זרע שטרם אומת</div>'}`;
  box.hidden = false;
  el("info-close").onclick = () => selectEntity(null);

  box.querySelectorAll("li.clickable").forEach((li) => {
    li.onclick = () => {
      const station = state.stationsById.get(Number(li.dataset.id));
      const rel = nearby.find((r) => r.otherId === Number(li.dataset.id));
      openDrawer(station, rel);
    };
  });
}

/* --- חלונית תחנה קרובה (טאב יישובים) ------------------------------------- */

function openDrawer(station, rel) {
  const settlement = state.settlementsById.get(state.selectedId);
  const drawer = el("drawer");
  drawer.innerHTML = `
    <div class="info-head">
      <span class="pill" style="background:${station.color}">${station.status}</span>
      <strong>${escapeHtml(station.name)}</strong>
      <button class="info-close" id="drawer-close" title="סגור">×</button>
    </div>
    <div class="info-grid">
      <div><span>זמן נסיעה${
        settlement ? ` מ${escapeHtml(settlement.name)}` : ""
      }</span><b>${rel.travel_min} דק'</b></div>
      <div><span>משרות פתוחות</span><b>${openText(station)}</b></div>
      <div><span>מקצוע מוביל</span><b>${topRoleText(station)}</b></div>
    </div>
    ${familyBreakdown(station)}
    <div class="drawer-foot">מרחב ${escapeHtml(station.area || "—")}</div>`;
  drawer.hidden = false;
  el("drawer-close").onclick = closeDrawer;
}

function closeDrawer() {
  el("drawer").hidden = true;
}

/* --- חיפוש --------------------------------------------------------------- */

function hideSuggestions() {
  el("suggestions").hidden = true;
  el("suggestions").innerHTML = "";
}

function renderSuggestions(term) {
  const box = el("suggestions");
  const q = term.trim();
  if (!q) return hideSuggestions();

  const matches = mode().base().filter((e) => e.name.includes(q));
  if (!matches.length) {
    box.innerHTML = `<li class="empty">לא נמצא ${
      state.mode === "stations" ? "תחנה" : "יישוב"
    } בשם "${escapeHtml(q)}"</li>`;
    box.hidden = false;
    return;
  }

  box.innerHTML = matches
    .map((e) => {
      const meta =
        state.mode === "stations"
          ? `<span class="sugg-dot" style="background:${e.color}"></span>`
          : "";
      const trailing =
        state.mode === "stations"
          ? `<span class="sugg-pct">${openText(e)} משרות</span>`
          : `<span class="sugg-pct">${e.nearby_stations} תחנות</span>`;
      return `<li data-id="${e.id}">${meta}<span class="sugg-name">${escapeHtml(
        e.name
      )}</span>${trailing}</li>`;
    })
    .join("");
  box.hidden = false;
  box.querySelectorAll("li[data-id]").forEach((li) => {
    li.onclick = () => selectEntity(Number(li.dataset.id));
  });
}

function wireSearch() {
  const input = el("search");
  input.addEventListener("input", () => renderSuggestions(input.value));
  input.addEventListener("focus", () => renderSuggestions(input.value));

  // Enter בוחר את ההתאמה הראשונה — הקלדה ואישור בלי לגעת בעכבר.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = el("suggestions").querySelector("li[data-id]");
      if (first) selectEntity(Number(first.dataset.id));
    } else if (e.key === "Escape") {
      hideSuggestions();
      input.blur();
    }
  });

  el("search-clear").onclick = () => selectEntity(null);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".map-search")) hideSuggestions();
  });
}

/* --- טאבים --------------------------------------------------------------- */

function switchMode(next, { animate = true } = {}) {
  if (state.mode === next) return;
  state.mode = next;
  state.selectedId = null;

  el("tab-stations").classList.toggle("active", next === "stations");
  el("tab-settlements").classList.toggle("active", next === "settlements");
  el("search").placeholder = mode().placeholder;
  el("search").value = "";
  el("search-clear").hidden = true;
  el("map-info").hidden = true;
  closeDrawer();
  hideSuggestions();
  state.nearbyLayer.clearLayers();
  document.querySelectorAll("tr.row--selected").forEach((tr) => tr.classList.remove("row--selected"));

  renderBaseMarkers();
  fitToBase();
  if (animate) state.map.flyTo(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom, { duration: 0.5 });
  syncHash(null);
}

function wireTabs() {
  el("tab-stations").onclick = () => switchMode("stations");
  el("tab-settlements").onclick = () => switchMode("settlements");
}

/* --- מסך לוח בקרה --------------------------------------------------------- */

// כלל הברזל של מסמך הדרישות: היכן שאין נתון — מצב ריק מפורש, לעולם לא אפס
// ולא ערך משוער. זה כלי למפקדים, ומספר מומצא גרוע יותר מהיעדר מספר.
const EMPTY = (reason) => `<span class="kpi-empty">${escapeHtml(reason)}</span>`;

// מד יחסי. המדד הוא מספר מוחלט ולא אחוז, ולכן הפס תמיד נמדד מול תקרה
// מפורשת (בדרך כלל התחנה העמוסה ביותר) — פס בלי תקרה ידועה הוא קישוט.
function bar(value, max, color) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return `<div class="bar"><div class="bar-fill" style="width:${pct}%; background:${color}"></div></div>`;
}

function renderKpis(data) {
  const load = data.open_load;
  const positions = data.positions;
  const gap = data.manpower_gap;

  // כרטיס 1 — עומס גיוס ממוצע לתחנה, מסווג באותם ספים כמו תחנה בודדת
  const loadCard =
    load.value === null
      ? EMPTY("אין נתוני משרות")
      : `<b>${load.value}</b><span>משרות פתוחות בממוצע לתחנה</span>
         <span class="pill" style="background:${load.color}">${load.status}</span>
         ${bar(load.value, load.max, load.color)}
         ${load.note ? `<em class="kpi-note">${escapeHtml(load.note)}</em>` : ""}`;

  // כרטיס 2 — התפלגות התחנות בין ארבעת הסטטוסים
  const positionsCard = positions.available
    ? `<b>${positions.stations_count}</b><span>תחנות בתמונה</span>
       <div class="kpi-breakdown">
         ${Object.entries(positions.status_counts)
           .map(([status, n]) => `<span>${escapeHtml(status)}: <b>${n}</b></span>`)
           .join("")}
       </div>`
    : EMPTY("אין נתוני משרות");

  // כרטיס 3 — סך המשרות הפתוחות + מגמה. מגמה שלילית = פחות משרות פתוחות
  // מלפני חודש, כלומר שיפור — ולכן היא מסומנת כחיובית ולא באדום.
  const trendText =
    gap.trend === null || gap.trend === undefined
      ? `<em class="kpi-note">מגמת חודש: — <span class="muted">(דורש שתי תקופות מדידה)</span></em>`
      : `<em class="kpi-note">מגמת חודש: ${gap.trend > 0 ? "+" : ""}${gap.trend} משרות ${
          gap.trend < 0 ? "(שיפור)" : gap.trend > 0 ? "(החמרה)" : ""
        }</em>`;
  const gapCard = gap.available
    ? `<b>${gap.total_open.toLocaleString("he-IL")}</b><span>משרות פתוחות בסך הכל</span>${trendText}`
    : `${EMPTY("אין נתוני משרות")}${trendText}`;

  el("kpis").innerHTML = `
    <div class="kpi">
      <h3>עומס גיוס ממוצע</h3>
      ${loadCard}
    </div>
    <div class="kpi">
      <h3>התפלגות תחנות</h3>
      ${positionsCard}
    </div>
    <div class="kpi kpi--alert">
      <h3>סך משרות פתוחות</h3>
      ${gapCard}
    </div>`;
}

function renderTop5(data) {
  el("top5-note").textContent = data.top5.length
    ? `${data.top5.length} התחנות עם הכי הרבה משרות פתוחות`
    : "";

  el("top5-table").querySelector("tbody").innerHTML = data.top5.length
    ? data.top5
        .map(
          (r) => `<tr>
            <td data-th="תחנה"><strong>${escapeHtml(r.name)}</strong></td>
            <td data-th="מחוז" class="muted">${escapeHtml(r.district || "—")}</td>
            <td data-th="מרחב" class="muted">${escapeHtml(r.area || "—")}</td>
            <td data-th="משרות פתוחות" class="td-bar">
              <span>${r.open_positions}</span>
              ${bar(r.open_positions, r.max, r.color)}
            </td>
            <td data-th="סטטוס"><span class="pill" style="background:${r.color}">${r.status}</span></td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="muted">אין תחנות התואמות את הסינון.</td></tr>`;
}

async function loadDashboard() {
  const params = new URLSearchParams();
  const region = el("f-region").value;
  const station = el("f-station").value;
  if (region) params.set("region", region);
  if (station) params.set("station", station);

  const data = await api(`/api/dashboard?${params}`);
  renderKpis(data);
  renderTop5(data);
}

function wireFilters(regions) {
  const districtSelect = el("f-district");
  districtSelect.innerHTML = regions.districts
    .map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`)
    .join("");
  // מחוז ת"א הוא ברירת המחדל וגם היחיד בנתונים. הוא מנוטרל ולא מוסתר, כדי
  // שיהיה גלוי שהמסך מתאר מחוז אחד ולא את כל הארץ.
  // בגרסת הדמו הפילטרים מוקפאים (הם מחזירים תמיד את אותם נתונים סטטיים),
  // לכן הבורר נשאר מנוטרל גם אם יתווספו מחוזות לנתוני הדמו.
  districtSelect.disabled = true;

  el("f-region").innerHTML =
    `<option value="">כל המרחבים</option>` +
    regions.regions.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("");

  el("f-station").innerHTML =
    `<option value="">כל התחנות</option>` +
    state.stations
      .map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`)
      .join("");

  // בחירת מרחב מצמצמת את רשימת התחנות: להשאיר בה תחנות ממרחב אחר מזמין
  // בחירה שתחזיר תוצאה ריקה בלי להסביר למה.
  el("f-region").onchange = () => {
    const region = el("f-region").value;
    const allowed = region ? state.stations.filter((s) => s.area === region) : state.stations;
    el("f-station").innerHTML =
      `<option value="">כל התחנות</option>` +
      allowed
        .map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`)
        .join("");
    loadDashboard();
  };
  el("f-station").onchange = loadDashboard;
  el("f-reset").onclick = () => {
    el("f-region").value = "";
    el("f-region").onchange();
  };
}

/* --- מסך טעינת נתונים ----------------------------------------------------- */

function timeAgo(iso) {
  if (!iso) return "טרם נטענו נתונים";
  const minutes = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (minutes < 1) return "עדכון אחרון: הרגע";
  if (minutes < 60) return `עדכון אחרון: לפני ${minutes} דק'`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `עדכון אחרון: לפני ${hours} שעות`;
  return `עדכון אחרון: לפני ${Math.floor(hours / 24)} ימים`;
}

async function uploadFile(type, file) {
  const box = el(`drop-${type}`);
  const result = box.querySelector(".drop-result");
  result.hidden = false;
  result.className = "drop-result drop-result--busy";
  result.innerHTML = `טוען את "${escapeHtml(file.name)}"…`;

  const body = new FormData();
  body.append("file", file);
  body.append("file_type", type);

  try {
    const response = await fetch("/api/upload", { method: "POST", body });
    const data = await response.json();

    if (data.ok) {
      result.className = "drop-result drop-result--ok";
      result.innerHTML = `<strong>התקבל.</strong> נטענו ${data.rows} שורות.
        <span class="muted">נשמר: ${escapeHtml(data.archived)}</span>
        ${
          data.conflicts.length
            ? `<div class="drop-warn">אזהרה — סתירות זמנים (נלקח הקצר): ${escapeHtml(
                data.conflicts.join("; ")
              )}</div>`
            : ""
        }`;
      // הנתונים במסך נשענים על מה שנטען, ולכן צריך לרענן הכול — לא רק
      // את המסך הזה. הרענון המלא זול יותר מסנכרון ידני של כל מסך בנפרד.
      await refreshAll();
    } else if (data.rejected) {
      result.className = "drop-result drop-result--rejected";
      result.innerHTML = `<strong>נדחה — Data Guard.</strong><div>${escapeHtml(data.error)}</div>`;
    } else {
      result.className = "drop-result drop-result--err";
      result.innerHTML = `<strong>שגיאה.</strong><div>${escapeHtml(data.error)}</div>`;
    }
  } catch (err) {
    result.className = "drop-result drop-result--err";
    result.innerHTML = `<strong>שגיאה.</strong><div>${escapeHtml(err.message)}</div>`;
  }
}

function wireUpload() {
  // במצב ההדגמה הסטטי הטעינה מושבתת: בוחר הקובץ הוסר וכפתור "בחר קובץ" מנוטרל
  // (בדומה לכפתורי הייצוא). כאן רק חוסמים גרירת קובץ אל אזורי ההשלכה, אחרת
  // הדפדפן היה פותח את הקובץ שנגרר במקום להתעלם ממנו.
  ["openings", "relations"].forEach((type) => {
    const zone = el(`drop-${type}`).querySelector(".drop-zone");
    ["dragenter", "dragover", "drop"].forEach((evt) =>
      zone.addEventListener(evt, (e) => e.preventDefault())
    );
  });
}

/* --- מסך ניהול נתונים ----------------------------------------------------- */

function renderManageKpis() {
  const settlements = new Set(state.relations.map((r) => r.settlement_id));
  el("manage-kpis").innerHTML = [
    { n: state.relations.length, label: "קשרי תחנה‑יישוב" },
    { n: state.stations.length, label: "תחנות" },
    { n: settlements.size, label: "יישובים ייחודיים" },
  ]
    .map((k) => `<div class="kpi"><h3>${k.label}</h3><b>${k.n}</b></div>`)
    .join("");
}

function visibleRelations() {
  const term = el("rel-search").value.trim();
  const station = el("rel-filter").value;
  return state.relations.filter((r) => {
    if (station && r.station_name !== station) return false;
    if (!term) return true;
    return r.station_name.includes(term) || r.settlement_name.includes(term);
  });
}

function renderRelationsTable() {
  const rows = visibleRelations();
  el("manage-note").textContent = `${rows.length} מתוך ${state.relations.length} קשרים`;

  el("rel-table").querySelector("tbody").innerHTML = rows.length
    ? rows
        .map(
          (r) => `<tr data-id="${r.id}">
            <td data-th="תחנה"><strong>${escapeHtml(r.station_name)}</strong></td>
            <td data-th="יישוב">${escapeHtml(r.settlement_name)}</td>
            <td data-th="זמן נסיעה (דקות)" class="cell-edit">
              <input type="number" class="travel-input" value="${r.travel_min}"
                     min="0" max="600" data-id="${r.id}" data-original="${r.travel_min}">
            </td>
            <td data-th="עד 30 דק'">${r.within_nearby ? '<span class="yes">כן</span>' : '<span class="muted">לא</span>'}</td>
            <td class="cell-actions">
              <button class="row-del" data-id="${r.id}"
                      data-label="${escapeHtml(r.station_name)} → ${escapeHtml(r.settlement_name)}">מחק</button>
            </td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="muted">לא נמצאו קשרים התואמים את החיפוש.</td></tr>`;

  // עריכה בשורה: נשמרת ב-blur או ב-Enter, ורק אם הערך באמת השתנה — אחרת
  // כל מעבר עם Tab על הטבלה היה יוצר גיבוי וכתיבה מיותרים.
  el("rel-table")
    .querySelectorAll(".travel-input")
    .forEach((input) => {
      input.onblur = () => saveTravel(input);
      input.onkeydown = (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") {
          input.value = input.dataset.original;
          input.blur();
        }
      };
    });

  el("rel-table")
    .querySelectorAll(".row-del")
    .forEach((button) => {
      button.onclick = () => deleteRelation(button.dataset.id, button.dataset.label);
    });
}

async function saveTravel(input) {
  const original = input.dataset.original;
  if (input.value === original) return;

  const response = await fetch(`/api/relations/${input.dataset.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ travel_min: Number(input.value) }),
  });
  const data = await response.json();

  if (!data.ok) {
    input.value = original; // הערך נדחה — לא להשאיר במסך מספר שלא נשמר
    input.classList.add("input--err");
    setTimeout(() => input.classList.remove("input--err"), 1500);
    alert(data.error);
    return;
  }
  input.dataset.original = input.value;
  input.classList.add("input--ok");
  setTimeout(() => input.classList.remove("input--ok"), 900);
  await refreshAll();
}

async function deleteRelation(id, label) {
  if (!confirm(`למחוק את הקישור?\n\n${label}\n\nהפעולה נשמרת מיד. גיבוי נוצר לפני המחיקה.`)) return;
  const data = await (await fetch(`/api/relations/${id}`, { method: "DELETE" })).json();
  if (!data.ok) return alert(data.error);
  await refreshAll();
}

function wireManage() {
  el("rel-search").oninput = renderRelationsTable;
  el("rel-filter").onchange = renderRelationsTable;

  el("rel-add").onclick = () => {
    el("add-row").hidden = false;
    el("add-error").textContent = "";
    el("add-travel").value = "";
  };
  el("add-cancel").onclick = () => (el("add-row").hidden = true);

  el("add-save").onclick = async () => {
    const payload = {
      station_id: Number(el("add-station").value),
      settlement_id: Number(el("add-settlement").value),
      travel_min: Number(el("add-travel").value),
    };
    if (!el("add-travel").value) {
      el("add-error").textContent = "יש להזין זמן נסיעה.";
      return;
    }
    const response = await fetch("/api/relations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data.ok) {
      el("add-error").textContent = data.error;
      return;
    }
    el("add-row").hidden = true;
    await refreshAll();
  };
}

function fillManageSelects() {
  const stationOptions = state.stations
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
    .join("");
  el("add-station").innerHTML = stationOptions;
  el("add-settlement").innerHTML = state.settlements
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
    .join("");
  el("rel-filter").innerHTML =
    `<option value="">כל התחנות</option>` +
    state.stations
      .map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`)
      .join("");
}

/* --- מסך ממשק מגייס ------------------------------------------------------- */

function renderRecruiterKpis(kpis) {
  const cards = [
    {
      title: 'סה"כ משרות פתוחות',
      alert: true,
      body: kpis.total_open.available
        ? `<b>${kpis.total_open.value.toLocaleString("he-IL")}</b><span>בכל היחידות שבתמונה</span>`
        : EMPTY("אין נתוני משרות"),
    },
    {
      title: "יחידות בעומס גיוס",
      body: kpis.units_under_load.available
        ? `<b>${kpis.units_under_load.value.toLocaleString("he-IL")}</b>
           <span>${kpis.units_under_load.threshold} משרות ומעלה · ${kpis.units_under_load.pct}% מהיחידות</span>`
        : EMPTY("אין נתוני משרות"),
    },
    {
      title: "ממוצע ליחידה",
      body: kpis.avg_open.available
        ? `<b>${kpis.avg_open.value}</b><span>משרות פתוחות</span>`
        : EMPTY("אין נתוני משרות"),
    },
    {
      title: "יחידות קריטיות",
      alert: kpis.critical_units.value > 0,
      body: `<b>${kpis.critical_units.value}</b><span>${kpis.critical_units.threshold} משרות פתוחות ומעלה</span>`,
    },
  ];

  el("rec-kpis").innerHTML = cards
    .map(
      (c) => `<div class="kpi ${c.alert ? "kpi--alert" : ""}">
        <h3>${c.title}</h3>${c.body}
      </div>`
    )
    .join("");
}

function roleChips(roles) {
  // משפחה בלי נתון היא null ולא 0. כשלכל המשפחות אין נתון — תווית אחת במקום
  // שש תוויות "אין נתונים", כי שש פעמים אותה הודעה היא רעש ולא מידע.
  if (roles.every((r) => r.open === null || r.open === undefined)) {
    return `<div class="card-empty">אין נתוני פילוח מקצועות</div>`;
  }
  return `<div class="chips">${roles
    .map(
      (r) =>
        `<span class="chip ${r.open ? "" : "chip--zero"}">${escapeHtml(r.label)}<b>${
          r.open === null || r.open === undefined ? "—" : r.open
        }</b></span>`
    )
    .join("")}</div>`;
}

function stationCard(s) {
  const nearby = s.nearby_settlements;
  // הפס נמדד מול סף הקריטיות: הוא עונה על "כמה רחוקה התחנה מלהיחשב אדומה",
  // ולא מול מקסימום ארצי שמשתנה בכל טעינה ומזיז את כל הפסים ביחד. הסף מגיע
  // עם נתוני המגייס (ראו loadRecruiter) ולא ממסך ההגדרות, שאולי טרם נפתח.
  const ceiling = state.criticalThreshold;

  return `<div class="unit-card" data-id="${s.id}">
    <div class="unit-head">
      <div class="unit-title">
        <strong>${escapeHtml(s.name)}</strong>
        <span class="unit-meta">${escapeHtml(s.district || "—")} · ${escapeHtml(s.area || "—")}</span>
      </div>
      <span class="pill" style="background:${s.color}">${s.status}</span>
    </div>

    <div class="unit-metrics">
      <div><span>משרות פתוחות</span><b class="${s.open_positions ? "neg" : ""}">${
    s.open_positions ?? "—"
  }</b></div>
      <div><span>מקצוע מוביל</span><b>${s.top_role ? escapeHtml(s.top_role.label) : "—"}</b></div>
      <div><span>יישובים בטווח</span><b>${nearby.length}</b></div>
    </div>

    <div class="unit-bar">
      <div class="unit-bar-head">
        <span>עומס גיוס</span><b>${s.open_positions ?? "—"} / ${ceiling}</b>
      </div>
      ${bar(s.open_positions || 0, ceiling, s.color)}
    </div>

    <div class="unit-section">
      <span class="unit-section-title">משרות פתוחות לפי מקצוע</span>
      ${roleChips(s.roles)}
    </div>

    <div class="unit-section">
      <span class="unit-section-title">נקודות עניין לגיוס</span>
      ${
        nearby.length
          ? `<select class="poi-select">
               ${nearby
                 .map(
                   (n) =>
                     `<option>${escapeHtml(n.name)} — ${n.travel_min} דק'</option>`
                 )
                 .join("")}
             </select>`
          : `<div class="card-empty">אין יישובים בטווח הנסיעה</div>`
      }
    </div>

    <div class="unit-actions">
      <button class="unit-btn unit-btn--ghost" data-insight="${s.id}">תובנות גיוס חכמות</button>
      <button class="unit-btn unit-btn--ghost" disabled title="הפקת דוחות זמינה בגרסת השרת המלאה">
        הפקת דוח משרות
      </button>
    </div>

    <div class="unit-insights" id="insights-${s.id}"></div>
  </div>`;
}

function renderRecruiterTree(data) {
  if (!data.tree.length) {
    el("rec-tree").innerHTML = `<div class="panel"><div class="empty-state">
      לא נמצאו יחידות התואמות את הסינון.</div></div>`;
    return;
  }

  el("rec-tree").innerHTML = data.tree
    .map(
      (district) => `<div class="acc">
        <div class="acc-district">
          <span>מחוז ${escapeHtml(district.district)}</span>
          <em>${district.areas.reduce((n, a) => n + a.stations.length, 0)} יחידות</em>
        </div>
        ${district.areas
          .map(
            (area) => `<details class="acc-area" open>
              <summary>
                <span>מרחב ${escapeHtml(area.area)}</span>
                <em>${area.stations.length} יחידות</em>
              </summary>
              <div class="unit-grid">
                ${area.stations.map(stationCard).join("")}
              </div>
            </details>`
          )
          .join("")}
      </div>`
    )
    .join("");

  el("rec-tree")
    .querySelectorAll("[data-insight]")
    .forEach((button) => {
      button.onclick = () => showSmartInsights(Number(button.dataset.insight));
    });
}

// "תובנות גיוס חכמות" מהמסמך נשענות על נתוני היענות לפרסום ברמת היישוב —
// נתון שאינו בגרסת ההדגמה. מה שכן אפשר לגזור מהקיים: היישובים הקרובים
// ביותר לתחנה. מוצג כמה שהוא, ולא מוצג כהמלצה מבוססת היענות שהיא לא.
async function showSmartInsights(stationId) {
  const box = el(`insights-${stationId}`);
  const station = state.stationsById.get(stationId);
  const detail = await api(`/api/stations/${stationId}/detail`);
  const nearby = (state.recruiterNearby && state.recruiterNearby[stationId]) || [];

  box.innerHTML = `
    <div class="insight-panel">
      <div class="insight-head">
        <strong>תובנות גיוס — ${escapeHtml(station.name)}</strong>
        <button class="info-close" data-close="${stationId}">×</button>
      </div>

      <div class="insight-warn">
        המלצה מבוססת היענות לפרסום דורשת נתוני היענות ברמת היישוב, שאינם
        בגרסת ההדגמה. להלן מה שניתן לגזור מזמני הנסיעה בלבד:
      </div>

      ${
        nearby.length
          ? `<ol class="insight-list">
               ${nearby
                 .slice(0, 5)
                 .map(
                   (n) =>
                     `<li><span>${escapeHtml(n.name)}</span><b>${n.travel_min} דק'</b></li>`
                 )
                 .join("")}
             </ol>`
          : `<div class="card-empty">אין יישובים בטווח הנסיעה</div>`
      }

      <div class="insight-add">
        <input type="text" placeholder="תובנה או החלטה לתיעוד…" data-text="${stationId}" maxlength="500">
        <button class="add-save" data-save="${stationId}">שמור</button>
      </div>

      <div class="insight-saved">
        <span class="unit-section-title">תובנות שמורות</span>
        ${
          detail.insights.length
            ? detail.insights
                .map(
                  (i) => `<div class="saved-item ${i.done ? "saved-item--done" : ""}">
                    <input type="checkbox" data-toggle="${i.id}" ${i.done ? "checked" : ""}>
                    <span>${escapeHtml(i.text)}</span>
                    <button class="row-del" data-del="${i.id}">מחק</button>
                  </div>`
                )
                .join("")
            : `<div class="card-empty">טרם נשמרו תובנות</div>`
        }
      </div>
    </div>`;

  box.querySelector("[data-close]").onclick = () => (box.innerHTML = "");
  box.querySelector("[data-save]").onclick = async () => {
    const input = box.querySelector("[data-text]");
    const text = input.value.trim();
    if (!text) return;
    const response = await fetch("/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ station_id: stationId, text }),
    });
    const result = await response.json();
    if (!result.ok) return alert(result.error);
    showSmartInsights(stationId);
  };
  box.querySelectorAll("[data-toggle]").forEach((cb) => {
    cb.onchange = async () => {
      await fetch(`/api/insights/${cb.dataset.toggle}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: cb.checked }),
      });
      showSmartInsights(stationId);
    };
  });
  box.querySelectorAll("[data-del]").forEach((button) => {
    button.onclick = async () => {
      await fetch(`/api/insights/${button.dataset.del}`, { method: "DELETE" });
      showSmartInsights(stationId);
    };
  });
}

async function loadRecruiter() {
  const params = new URLSearchParams();
  const district = el("rec-district").value;
  const region = el("rec-region").value;
  const status = el("rec-status").value;
  const term = el("rec-search").value.trim();
  if (district) params.set("district", district);
  if (region) params.set("region", region);
  if (status) params.set("status", status);
  if (term) params.set("q", term);

  const data = await api(`/api/recruiter?${params}`);
  state.criticalThreshold = data.kpis.critical_units.threshold;
  state.recruiterNearby = {};
  data.tree.forEach((d) =>
    d.areas.forEach((a) =>
      a.stations.forEach((s) => (state.recruiterNearby[s.id] = s.nearby_settlements))
    )
  );
  renderRecruiterKpis(data.kpis);
  renderRecruiterTree(data);
}

function wireRecruiter(regions) {
  el("rec-district").innerHTML =
    `<option value="">כל המחוזות</option>` +
    regions.districts.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
  el("rec-region").innerHTML =
    `<option value="">כל המרחבים</option>` +
    regions.regions.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("");

  ["rec-district", "rec-region", "rec-status"].forEach((id) => (el(id).onchange = loadRecruiter));
  el("rec-search").oninput = loadRecruiter;
  el("rec-reset").onclick = () => {
    ["rec-district", "rec-region", "rec-status", "rec-search"].forEach((id) => (el(id).value = ""));
    loadRecruiter();
  };
  // "עדכון אוטומטי" מהמסמך: מרענן מהמאגר. הוא לא טוען קבצים מחדש — לכך יש
  // מסך טעינת נתונים, שעובר דרך ה-Data Guard.
  el("rec-sync").onclick = () => refreshAll();
}

/* --- מסך תכנון אסטרטגי ---------------------------------------------------- */

function renderStrategicKpis(kpis) {
  const cards = [
    {
      title: "יעד גיוס שנתי",
      body: kpis.annual_goal.available
        ? `<b>${kpis.annual_goal.value}%</b>`
        : EMPTY("אין נתוני יעדים"),
    },
    {
      title: 'סה"כ משרות פתוחות',
      body: kpis.total_open.available
        ? `<b>${kpis.total_open.value.toLocaleString("he-IL")}</b><span>בכל הארץ</span>`
        : EMPTY("אין נתוני משרות"),
    },
    {
      title: "יחידות בעומס גיוס",
      body: `<b>${kpis.units_above.value}</b><span>${kpis.units_above.threshold} משרות פתוחות ומעלה</span>`,
    },
    {
      title: "משרות ביחידות קריטיות",
      alert: true,
      body: kpis.critical_gap.available
        ? `<b>${kpis.critical_gap.value}</b><span>ב‑${kpis.critical_gap.units} יחידות קריטיות</span>`
        : `${EMPTY("אין יחידות קריטיות")}<span class="kpi-note">${
            kpis.critical_gap.units
          } יחידות בסטטוס קריטי</span>`,
    },
  ];

  el("str-kpis").innerHTML = cards
    .map((c) => `<div class="kpi ${c.alert ? "kpi--alert" : ""}"><h3>${c.title}</h3>${c.body}</div>`)
    .join("");
}

// הנוסחה מוצגת במסך, לא מוסתרת בקוד. מנהל מקצה לפי הציון הזה תקציב פרסום,
// ומספר שאי אפשר לשחזר איך התקבל אינו בר-ערעור.
function renderFormula(weights) {
  el("str-formula").innerHTML = `
    <div class="formula-line">
      <b>ציון דחיפות</b> = משרות פתוחות × מקדם קריטיות
    </div>
    <div class="formula-weights">
      ${[
        ["קריטי", weights.critical, "#DC2626"],
        ["דחוף", weights.urgent, "#EA580C"],
        ["בינוני", weights.medium, "#EAB308"],
        ["תקין", weights.ok, "#16A34A"],
      ]
        .map(
          ([label, value, color]) =>
            `<span class="chip"><span class="legend-swatch" style="background:${color}"></span>${label}<b>×${value}</b></span>`
        )
        .join("")}
      <span class="formula-note">המקדם נקבע לפי סטטוס התחנה · ניתן לכוונון בהגדרות</span>
    </div>`;
}

function renderStrategicTable(data) {
  el("str-note").textContent = `${data.top.length} תחנות, ממוינות לפי ציון דחיפות`;

  el("str-table").querySelector("tbody").innerHTML = data.top.length
    ? data.top
        .map(
          (t) => `<tr>
            <td data-th="שם היחידה"><strong>${escapeHtml(t.name)}</strong></td>
            <td data-th="מרחב" class="muted">${escapeHtml(t.area || "—")}</td>
            <td data-th="משרות פתוחות" class="td-bar">
              <b class="neg">${t.open_positions}</b>
              ${bar(t.open_positions, data.max_open, t.color)}
            </td>
            <td data-th="מקצוע מוביל">${
              t.top_role ? escapeHtml(t.top_role.label) : '<span class="muted">—</span>'
            }</td>
            <td data-th="ציון דחיפות"><b>${t.score}</b></td>
            <td data-th="סטטוס"><span class="pill" style="background:${t.color}">${t.status}</span></td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="6" class="muted">אין תחנות עם משרות פתוחות.</td></tr>`;
}

function renderTargets(data) {
  el("str-targets").innerHTML = data.targets.length
    ? `<div class="targets-note">מבוסס על ${data.top.length} התחנות הדחופות ביותר ועל
         זמני נסיעה עד ${data.nearby_minutes} דק'</div>
       <ol class="targets">
         ${data.targets
           .slice(0, 5)
           .map(
             (t) => `<li>
               <div class="target-head">
                 <strong>${escapeHtml(t.name)}</strong>
                 <span class="target-score">ציון ${t.score}</span>
               </div>
               <div class="target-meta">בטווח נסיעה מ‑${t.station_count} תחנות</div>
               <div class="target-stations">
                 ${t.stations
                   .map(
                     (s) =>
                       `<span class="chip"><span class="legend-swatch" style="background:${s.color}"></span>${escapeHtml(
                         s.name
                       )}<b>${s.travel_min}′</b></span>`
                   )
                   .join("")}
               </div>
             </li>`
           )
           .join("")}
       </ol>`
    : `<div class="empty-state">אין יישובים בטווח הנסיעה של התחנות הדחופות.</div>`;
}

function renderDays(data) {
  el("str-days").innerHTML = data.recruitment_days.length
    ? `<div class="table-wrap"><table class="table">
         <thead><tr><th>תאריך</th><th>תחנה</th><th>מיקום</th><th>% צפוי</th><th></th></tr></thead>
         <tbody>
           ${data.recruitment_days
             .map(
               (d) => `<tr>
                 <td data-th="תאריך">${escapeHtml(d.date)}</td>
                 <td data-th="תחנה"><strong>${escapeHtml(d.station_name)}</strong></td>
                 <td data-th="מיקום" class="muted">${escapeHtml(d.location || "—")}</td>
                 <td data-th="% צפוי">${d.expected_success_pct === null ? "—" : d.expected_success_pct + "%"}</td>
                 <td class="cell-actions"><button class="row-del" data-day="${d.id}">מחק</button></td>
               </tr>`
             )
             .join("")}
         </tbody></table></div>`
    : `<div class="empty-state">טרם תוכננו ימי גיוס.</div>`;

  el("str-days")
    .querySelectorAll("[data-day]")
    .forEach((button) => {
      button.onclick = async () => {
        if (!confirm("למחוק את יום הגיוס?")) return;
        await fetch(`/api/recruitment-days/${button.dataset.day}`, { method: "DELETE" });
        loadStrategic();
      };
    });
}

async function loadStrategic() {
  const data = await api(`/api/strategic?n=${el("str-n").value || 10}`);
  renderStrategicKpis(data.kpis);
  renderFormula(data.weights);
  renderStrategicTable(data);
  renderTargets(data);
  renderDays(data);
}

async function wireStrategic() {
  // אפשרויות ה-N מגיעות מהשרת ולא מרשימה קשיחה ב-JS: המסמך סותר את עצמו
  // בנקודה הזו (טקסט מול איור), וההכרעה צריכה לחיות במקום אחד.
  const options = (await api("/api/strategic?n=10")).n_options;
  el("str-n").innerHTML = options
    .map((n) => `<option value="${n}"${n === 10 ? " selected" : ""}>${n}</option>`)
    .join("");
  el("str-n").onchange = loadStrategic;

  el("day-station").innerHTML = state.stations
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
    .join("");

  el("day-add").onclick = () => {
    el("day-row").hidden = false;
    el("day-error").textContent = "";
  };
  el("day-cancel").onclick = () => (el("day-row").hidden = true);
  el("day-save").onclick = async () => {
    const response = await fetch("/api/recruitment-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        station_id: Number(el("day-station").value),
        date: el("day-date").value,
        location: el("day-location").value,
        expected_success_pct: el("day-pct").value || null,
      }),
    });
    const data = await response.json();
    if (!data.ok) {
      el("day-error").textContent = data.error;
      return;
    }
    el("day-row").hidden = true;
    ["day-date", "day-location", "day-pct"].forEach((id) => (el(id).value = ""));
    loadStrategic();
  };
}

/* --- מסך הגדרות ----------------------------------------------------------- */

const SETTINGS_FIELDS = {
  "s-critical": "threshold_critical",
  "s-urgent": "threshold_urgent",
  "s-medium": "threshold_medium",
  "s-nearby": "nearby_minutes",
  "s-alert-critical": "alert_critical",
  "s-alert-weekly": "alert_weekly_report",
  "s-alert-opening": "alert_new_opening",
  "s-name": "user_name",
  "s-role": "user_role",
};

async function loadSettings() {
  const data = await api("/api/settings");
  state.settings = data;

  el("s-role").innerHTML = data.roles
    .map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`)
    .join("");

  Object.entries(SETTINGS_FIELDS).forEach(([id, key]) => {
    const field = el(id);
    if (field.type === "checkbox") field.checked = Boolean(data[key]);
    else field.value = data[key];
  });
  renderSettingsPreview();
}

// תצוגה מקדימה של המקרא לפי מה שמוקלד כרגע, לפני שמירה. בלי זה המשתמש
// מגלה את המשמעות של המספר שהקליד רק אחרי שהוא כבר החליף צבע לכל תחנה.
function renderSettingsPreview() {
  const critical = Number(el("s-critical").value);
  const urgent = Number(el("s-urgent").value);
  const medium = Number(el("s-medium").value);
  // המדד הוא מספר משרות ולא אחוז — ולכן הסף החמור הוא הגבוה, לא הנמוך.
  const valid = medium < urgent && urgent < critical;

  const rows = [
    { color: "#DC2626", status: "קריטי", label: `${critical} משרות ומעלה` },
    { color: "#EA580C", status: "דחוף", label: `${urgent}–${critical - 1} משרות` },
    { color: "#EAB308", status: "בינוני", label: `${medium}–${urgent - 1} משרות` },
    { color: "#16A34A", status: "תקין", label: `עד ${medium - 1} משרות` },
  ];

  el("settings-legend").innerHTML = valid
    ? rows
        .map(
          (r) => `<div class="legend-item">
            <span class="legend-swatch" style="background:${r.color}"></span>
            <strong>${r.status}</strong><span>${r.label}</span>
          </div>`
        )
        .join("")
    : `<span class="preview-bad">הספים חייבים לעלות בסדר: בינוני &lt; דחוף &lt; קריטי</span>`;
}

async function saveSettings() {
  const payload = {};
  Object.entries(SETTINGS_FIELDS).forEach(([id, key]) => {
    const field = el(id);
    payload[key] = field.type === "checkbox" ? field.checked : field.value;
  });

  const error = el("settings-error");
  const status = el("save-status");
  error.hidden = true;
  status.textContent = "שומר…";

  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();

  if (!data.ok) {
    status.textContent = "";
    error.textContent = data.error;
    error.hidden = false;
    return;
  }

  status.textContent = "נשמר ✓";
  setTimeout(() => (status.textContent = ""), 2500);

  // ספי הצבע וסף הנסיעה משנים את כל מה שמוצג. בלי רענון מלא, המפה ולוח
  // הבקרה היו ממשיכים להציג את הצבעים הישנים עד רענון ידני של הדף.
  await refreshAll();
}

function wireSettings() {
  // במצב ההדגמה הסטטי ההגדרות מוקפאות: השדות מציגים את הערכים אך אינם ניתנים
  // לעריכה, וכפתור השמירה מנוטרל (בדומה לכפתורי הייצוא). התצוגה המקדימה של
  // המקרא נבנית פעם אחת מהערכים הקיימים.
  Object.keys(SETTINGS_FIELDS).forEach((id) => {
    const field = el(id);
    // readOnly לא נתמך על select/checkbox — שם משתמשים ב-disabled. שדות טקסט
    // ומספר נשארים readOnly כדי שהערך יישאר קריא וברור, רק לא ניתן לעריכה.
    if (field.tagName === "SELECT" || field.type === "checkbox") field.disabled = true;
    else field.readOnly = true;
  });
  renderSettingsPreview();
}

/* --- ניווט בין מסכים ------------------------------------------------------ */

const SCREENS = {
  map: { el: "screen-map", nav: "nav-map", hash: "#" },
  dashboard: { el: "screen-dashboard", nav: "nav-dashboard", hash: "#/dashboard" },
  upload: { el: "screen-upload", nav: "nav-upload", hash: "#/upload" },
  manage: { el: "screen-manage", nav: "nav-manage", hash: "#/manage" },
  recruiter: { el: "screen-recruiter", nav: "nav-recruiter", hash: "#/recruiter" },
  strategic: { el: "screen-strategic", nav: "nav-strategic", hash: "#/strategic" },
  settings: { el: "screen-settings", nav: "nav-settings", hash: "#/settings" },
};

function showScreen(name) {
  state.screen = name;
  Object.entries(SCREENS).forEach(([key, cfg]) => {
    el(cfg.el).hidden = key !== name;
    el(cfg.nav).classList.toggle("active", key === name);
  });

  if (name === "map") {
    syncHash(state.selectedId);
    // המפה נבנתה בזמן שהמסך שלה היה מוסתר או בגודל אחר, ואז Leaflet מחשיב
    // גודל שגוי ומצייר אריחים באזור חלקי. invalidateSize מיישר אותה לגודל
    // האמיתי בכל חזרה למסך.
    if (state.map) state.map.invalidateSize();
    return;
  }

  const hash = SCREENS[name].hash;
  if (location.hash !== hash) history.replaceState(null, "", hash);
  if (name === "dashboard") loadDashboard();
  if (name === "recruiter") loadRecruiter();
  if (name === "strategic") loadStrategic();
  // ההגדרות נטענות מחדש בכל כניסה: אם נשמרו במקום אחר, המסך היה מציג ערך ישן.
  if (name === "settings") loadSettings();
}

function wireNav() {
  Object.entries(SCREENS).forEach(([key, cfg]) => {
    el(cfg.nav).onclick = () => showScreen(key);
  });
}

/* --- לוחות מידע ----------------------------------------------------------- */

function renderStats(health, stations) {
  const critical = stations.filter((s) => s.status_key === "critical").length;
  const urgent = stations.filter((s) => s.status_key === "urgent").length;
  const openTotal = stations.reduce((n, s) => n + (s.open_positions || 0), 0);

  el("stats").innerHTML = [
    { n: health.stations, label: "תחנות" },
    { n: openTotal.toLocaleString("he-IL"), label: "משרות פתוחות" },
    { n: health.settlements, label: "יישובים" },
    { n: health.relations, label: "קשרי תחנה‑יישוב" },
    { n: critical + urgent, label: "תחנות קריטי / דחוף" },
  ]
    .map((s) => `<div class="stat"><b>${s.n}</b><span>${s.label}</span></div>`)
    .join("");
}

function renderLegend(legend) {
  el("legend").innerHTML =
    `<div class="legend-title">משרות פתוחות</div>` +
    legend
      .map(
        (l) => `<div class="legend-item">
          <span class="legend-swatch" style="background:${l.color}"></span>
          <strong>${l.status}</strong><span>${l.label}</span>
        </div>`
      )
      .join("");
}

function renderStationsTable(stations) {
  const nearbyCount = new Map();
  state.relations
    .filter((r) => r.within_nearby)
    .forEach((r) => nearbyCount.set(r.station_id, (nearbyCount.get(r.station_id) || 0) + 1));

  el("stations-note").textContent = `${stations.length} תחנות · לחיצה על שורה בוחרת את התחנה במפה`;

  el("stations-table").querySelector("tbody").innerHTML = stations
    .map(
      (s) => `<tr data-id="${s.id}">
        <td data-th="תחנה"><strong>${escapeHtml(s.name)}</strong></td>
        <td data-th="מרחב" class="muted">${escapeHtml(s.area || "—")}</td>
        <td data-th="משרות פתוחות"><b>${openText(s)}</b></td>
        <td data-th="סטטוס"><span class="pill" style="background:${s.color}">${s.status}</span></td>
        <td data-th="מקצוע מוביל">${topRoleText(s)}</td>
        <td data-th="יישובים עד 30 דק'">${nearbyCount.get(s.id) || 0}</td>
      </tr>`
    )
    .join("");

  el("stations-table")
    .querySelectorAll("tbody tr")
    .forEach((tr) => {
      // לחיצה על שורה בזמן שהטאב השני פתוח חייבת קודם לחזור לטאב התחנות,
      // אחרת היינו בוחרים id של תחנה בתוך מצב שמכיר רק יישובים.
      tr.onclick = () => {
        switchMode("stations");
        selectEntity(Number(tr.dataset.id));
      };
    });
}

function renderLoads(data) {
  const label = { openings: "משרות פתוחות", relations: "קשרי תחנה‑יישוב" };
  const statusText = { ok: "נטען", rejected: "נדחה", error: "שגיאה" };

  const html = data.loads.length
    ? data.loads
        .map((l) => {
          const file = l.archived_file
            ? `<a href="/api/archive/${encodeURIComponent(l.archived_file)}">${escapeHtml(
                l.archived_file
              )}</a>`
            : `<span class="muted">${escapeHtml(l.source_file.split(/[\\/]/).pop())}</span>`;
          return `<tr>
            <td data-th="מתי">${formatDateTime(l.loaded_at)}</td>
            <td data-th="סוג">${label[l.file_type] || l.file_type}</td>
            <td data-th="קובץ">${file}</td>
            <td data-th="שורות">${l.rows_loaded ?? "—"}</td>
            <td data-th="סטטוס" class="status-${l.status}" title="${escapeHtml(l.message || "")}">${
            statusText[l.status] || l.status
          }</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="muted">עדיין לא נטענו קבצים.</td></tr>`;

  // אותה טבלה מוצגת גם במסך המפה וגם במסך הטעינה.
  ["loads-table", "loads-table-2"].forEach((id) => {
    const table = el(id);
    if (table) table.querySelector("tbody").innerHTML = html;
  });
}

/* --- טעינה ורענון --------------------------------------------------------- */

// כל מסך במערכת נשען על אותם נתונים. אחרי העלאה או עריכה הכול חייב
// להתעדכן — מפה, לוח בקרה וטבלאות — ולכן יש נקודת רענון אחת ולא סנכרון
// ידני של כל מסך בנפרד, שהיה משאיר מסך אחד מציג נתון מת.
async function refreshAll() {
  const health = await api("/api/health");
  setHealth("ok", "מערכת מחוברת");
  state.nearbyMinutes = health.nearby_minutes;

  const [legend, stations, settlements, relations, lastUpdate, loads, regions] = await Promise.all([
    api("/api/legend"),
    api("/api/stations"),
    api("/api/settlements"),
    api("/api/relations"),
    api("/api/last-update"),
    api("/api/loaded-files"),
    api("/api/regions"),
  ]);

  state.stations = stations;
  state.settlements = settlements;
  state.relations = relations;
  state.stationsById = new Map(stations.map((s) => [s.id, s]));
  state.settlementsById = new Map(settlements.map((s) => [s.id, s]));

  el("last-update").textContent = formatDateTime(lastUpdate.last_update);
  el("live-age").textContent = timeAgo(lastUpdate.last_update);
  renderStats(health, stations);
  renderLegend(legend);
  renderStationsTable(stations);
  renderLoads(loads);
  renderManageKpis();
  fillManageSelects();
  renderRelationsTable();

  if (state.map) {
    // טעינה חדשה יכולה למחוק את מה שהיה נבחר. אם הוא עדיין קיים — הבחירה
    // נשמרת; אם לא — חוזרים למבט הכללי במקום להשאיר חלונית של ישות שאיננה.
    const previous = state.selectedId;
    renderBaseMarkers();
    const stillExists = mode().base().some((e) => e.id === previous);
    selectEntity(stillExists ? previous : null, { animate: false });
  }
  if (state.screen === "dashboard") await loadDashboard();
  if (state.screen === "recruiter") await loadRecruiter();
  if (state.screen === "strategic") await loadStrategic();
  return { regions };
}

/* --- אתחול ---------------------------------------------------------------- */

async function init() {
  try {
    // נקרא ראשון: refreshAll מנקה את הבחירה במפה ומסנכרן כתובת, וזה דורס
    // את ה-hash שאיתו המשתמש נכנס לפני שהספקנו לקרוא אותו.
    const initialHash = location.hash;

    wireSearch();
    wireTabs();
    wireNav();
    wireUpload();
    wireManage();
    wireSettings();

    await initMap();
    const { regions } = await refreshAll();
    wireFilters(regions);
    wireRecruiter(regions);
    await wireStrategic();

    // כניסה דרך קישור ישיר נוחתת על הטאב והישות הנכונים, בלי אנימציה —
    // אין טעם להנפיש מעבר ממבט שהמשתמש מעולם לא ראה.
    const target = parseHash(initialHash);
    if (target) {
      state.mode = target.mode;
      el("tab-stations").classList.toggle("active", target.mode === "stations");
      el("tab-settlements").classList.toggle("active", target.mode === "settlements");
      el("search").placeholder = mode().placeholder;
      renderBaseMarkers();
    }
    fitToBase();
    if (target) selectEntity(target.id, { animate: false });

    const screenByHash = Object.entries(SCREENS).find(([, c]) => c.hash === initialHash);

    window.addEventListener("hashchange", () => {
      const match = Object.entries(SCREENS).find(([, c]) => c.hash === location.hash);
      if (match && match[0] !== "map") return showScreen(match[0]);
      const next = parseHash();
      if (!next) return selectEntity(null);
      showScreen("map");
      switchMode(next.mode, { animate: false });
      selectEntity(next.id);
    });

    // המעבר למסך אחר נעשה בסוף, אחרי שהמפה כבר נבנתה ומוקדה: fitToBase
    // על מסך מוסתר מקבל גודל 0 ומחשב זום שגוי — אותה משפחת באגים שכבר
    // תפסה אותנו עם האנימציה.
    if (screenByHash && screenByHash[0] !== "map") showScreen(screenByHash[0]);
  } catch (err) {
    setHealth("err", "אין חיבור למאגר");
    document
      .querySelector(".content")
      .insertAdjacentHTML(
        "afterbegin",
        `<div class="error-banner">השרת עלה אבל המאגר לא נענה (${escapeHtml(err.message)}).
         הרץ טעינה: <code>python tools\\load_all.py</code></div>`
      );
  }
}

init();
