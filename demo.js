/* ---------------------------------------------------------------------------
   demo.js — שכבת ההדגמה. נטענת **לפני** app.js, ומיישרת את ההבדלים בין
   הרצה על שרת Flask לבין אירוח סטטי.

   העיקרון: app.js כאן **זהה בייט-לבייט** לזה שרץ על השרת. אין פה פורק ואין
   שני קודים שיכולים להיפרד — כל ההתאמה יושבת בקובץ הזה, וכל שינוי במערכת
   מגיע לדמו בהעתקת קובץ והרצת שני סקריפטים.

   שלושה דברים מטופלים כאן:

   1. **נתונים.** אין שרת, ולכן fetch של /api/* מוסט לקובצי JSON סטטיים
      תחת data/. הקבצים אינם כתובים ביד — הם הוקפאו מהשרת האמיתי כשהוא רץ
      מול מאגר שכל הנתונים בו מוגרלים (tools/build_demo_db.py +
      tools/freeze_demo_api.py בפרויקט המלא). לכן צורות התשובה נכונות תמיד.

   2. **כתיבה.** טעינת אקסל, עריכת קשרים, שמירת הגדרות ומחיקות — כולן
      מחזירות תשובת "מוקפא" מנומסת במקום להיכשל ברשת. המשתמש רואה למה,
      ולא שגיאה סתומה.

   3. **רקע המפה.** בהתקנה המבצעית הרקע הוא חבילת אריחים מקומית (§18.1,
      רשת סגורה). באירוח ציבורי אין מי שיגיש אותה, ולכן כאן מוזרק רקע
      מקוון דרך נקודת החיבור שהמערכת חושפת.
   --------------------------------------------------------------------------- */

(function () {
  "use strict";

  /* --- 3. רקע המפה ------------------------------------------------------- */
  // Esri "רחובות" נבחר בגלל **שפת התוויות**, לא בגלל היופי: זה הרקע היחיד
  // מבין הנבדקים שמציג שמות בעברית בכל רמות הזום. במערכת עברית זה מכריע.
  window.BASEMAPS_OVERRIDE = {
    "רחובות (עברית)": {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      attribution: "© Esri",
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
  };
  window.DEFAULT_BASEMAP_OVERRIDE = "רחובות (עברית)";

  /* --- 1. ניתוב הנתונים -------------------------------------------------- */

  // רוב הנתיבים הם קובץ-לנתיב: /api/regions/heat -> data/regions__heat.json.
  const flatten = (apiPath) =>
    "data/" + apiPath.replace(/^\/api\//, "").replace(/\/+$/, "").replace(/\//g, "__") + ".json";

  // שתי נקודות קצה שהפרמטר בהן משנה את התשובה נשמרו כ"חבילה" — אובייקט אחד
  // שממפה שאילתה לתשובה. הסיבה מעשית: שם מרחב יכול להכיל גרשיים, וויסנדוז
  // אינה מרשה אותם בשם קובץ. המטמון מונע הורדה חוזרת בכל ריחוף.
  const bundles = {};
  async function fromBundle(file, key) {
    if (!bundles[file]) {
      const res = await fetch("data/" + file);
      if (!res.ok) throw new Error(file + " → " + res.status);
      bundles[file] = await res.json();
    }
    return bundles[file][key];
  }

  const json = (payload, status) =>
    new Response(JSON.stringify(payload), {
      status: status || 200,
      headers: { "Content-Type": "application/json" },
    });

  const FROZEN = {
    ok: false,
    error:
      "פעולה זו זמינה בגרסת השרת המלאה. ההדגמה הזו היא תצוגה בלבד — " +
      "היא רצה ללא שרת, על נתונים מוגרלים קפואים.",
  };

  async function serve(url, init) {
    const method = ((init && init.method) || "GET").toUpperCase();
    const [path, query = ""] = url.split("?");

    // כל מה שאינו GET הוא פעולת כתיבה: טעינת קובץ, עריכה, מחיקה, שמירה.
    if (method !== "GET") return json(FROZEN, 200);

    // פירוט תחנה — קובץ לכל תחנה.
    const detail = path.match(/^\/api\/stations\/(\d+)\/detail$/);
    if (detail) {
      const res = await fetch(`data/station-detail/${detail[1]}.json`);
      if (!res.ok) throw new Error(path + " → " + res.status);
      return json(await res.json());
    }

    // פילוח עיסוקים — המפתח הוא מחרוזת השאילתה כלשונה (ריקה = ארצי).
    if (path === "/api/role-occupations") {
      const found = await fromBundle("role-occupations__by-scope.json", query);
      return json(found || {});
    }

    // תכנון אסטרטגי — רק N משנה כאן. שאר הפרמטרים הם סינון, והוא מוקפא.
    if (path === "/api/strategic") {
      const n = new URLSearchParams(query).get("n") || "10";
      const found = await fromBundle("strategic__by-n.json", n);
      if (found) return json(found);
    }

    // מסך המנהלה — הסינון מחושב כאן, ראו adminOptions/adminPositions.
    if (path === "/api/admin-options") return json(await adminOptions(query));
    if (path === "/api/admin-positions") return json(await adminPositions(query));

    const res = await fetch(flatten(path));
    if (!res.ok) throw new Error(path + " → " + res.status);
    return json(await res.json());
  }

  /* --- סינון מסך המנהלה -------------------------------------------------
     ארבעת הסינונים (תפקיד · אזור · אגף · יחידה) הם מכפלה קרטזית של אלפי
     צירופים, ולכן אי אפשר להקפיא קובץ לכל אחד. הפשרה: מקפיאים את חומר
     הגלם פעם אחת, והסינון עצמו רץ בדפדפן.

     זה **המקום היחיד בדמו שמחשב משהו** במקום להציג תשובה של השרת, והוא
     מוגבל בכוונה לשוויון על ארבעה שדות ולחיפוש תת-מחרוזת. ההגדרות שקל
     לטעות בהן — מהי "משרה שאפשר לגייס אליה", מהו היקף המשרה, ומה סדר
     המיון — נשארו בשרת: הקובץ admin-vacancies כבר מסונן, מחושב וממוין
     על ידו, וכאן רק בוררים ממנו. */

  const cache = {};
  async function table(name) {
    if (!cache[name]) {
      const res = await fetch("data/" + name + ".json");
      if (!res.ok) throw new Error(name + " → " + res.status);
      cache[name] = await res.json();
    }
    return cache[name];
  }

  // שם הפרמטר במסך אינו שם העמודה בנתונים — "אזור" הוא geo_area, "יחידה"
  // היא region. המיפוי במקום אחד, כדי ששני הצרכנים לא יסטו זה מזה.
  const FIELD = { profession: "profession", area: "geo_area",
                  department: "department", region: "region" };

  const params = (q) => {
    const p = new URLSearchParams(q);
    return {
      profession: p.get("profession") || "", area: p.get("area") || "",
      department: p.get("department") || "", region: p.get("region") || "",
      q: (p.get("q") || "").trim(), position: (p.get("position") || "").trim(),
    };
  };

  const matches = (row, f, skip) =>
    Object.keys(FIELD).every(
      (key) => key === skip || !f[key] || row[FIELD[key]] === f[key]
    );

  async function adminOptions(query) {
    const f = params(query);
    const facets = await table("admin-facets");

    // כל רשימה מחושבת מול *שאר* הסינונים ולא מול עצמה — אחרת הבחירה
    // הנוכחית מצמצמת את הרשימה שממנה היא נבחרה, והמשתמש ננעל עליה.
    const group = (key) => {
      const totals = new Map();
      facets.forEach((row) => {
        const name = row[FIELD[key]];
        if (!name || !matches(row, f, key)) return;
        const acc = totals.get(name) || { name: name, vacant: 0, required: 0 };
        acc.vacant += row.vacant || 0;
        acc.required += row.required || 0;
        totals.set(name, acc);
      });
      return [...totals.values()]
        .map((o) => ({ name: o.name, vacant: o.vacant, required: Math.round(o.required) }))
        .sort((a, b) => a.name.localeCompare(b.name, "he"));
    };

    return {
      professions: group("profession"), areas: group("area"),
      departments: group("department"), units: group("region"),
    };
  }

  async function adminPositions(query) {
    const f = params(query);
    const LIMIT = 1000; // POSITIONS_LIMIT בשרת
    const like = (value, term) => String(value || "").indexOf(term) !== -1;

    const rows = (await table("admin-vacancies")).filter((row) => {
      if (!matches(row, f, null)) return false;
      // חיפוש חופשי מחפש גם בסיווג, גם בתיאור העיסוק וגם במספר המשרה:
      // מי שמדביק מספר לשדה מחפש משרה, ולא סיווג.
      if (f.q && !f.profession &&
          !(like(row.profession, f.q) || like(row.occupation, f.q) || like(row.position_no, f.q)))
        return false;
      if (f.position && !like(row.position_no, f.position)) return false;
      return true;
    });

    const counts = new Map();
    rows.forEach((row) => counts.set(row.profession, (counts.get(row.profession) || 0) + 1));
    const byLabel = [...counts.entries()]
      .map(([name, n]) => ({ name: name, n: n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 12);

    const items = rows.slice(0, LIMIT);
    return {
      profession: f.profession || null, q: f.q, position: f.position,
      area: f.area || null, department: f.department || null, region: f.region || null,
      total: rows.length, shown: items.length, limit: LIMIT,
      by_label: byLabel, items: items,
    };
  }

  // פרמטרי סינון אינם נתמכים בלי שרת: מסכי הסינון מוקפאים, וכל בקשה
  // מקבלת את התמונה הארצית המלאה — בדיוק מה שהמסכים מציגים.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    if (typeof url === "string" && url.indexOf("/api/") === 0) {
      return serve(url, init).catch((err) => json({ ok: false, error: err.message }, 502));
    }
    return nativeFetch(input, init);
  };

  /* --- 2. הקפאת פקדי הכתיבה ---------------------------------------------

     הדרישה: **הכול מוצג, שום דבר לא ניתן ללחיצה, והריחוף מסביר למה.**

     לכן לא משתמשים כאן ב-disabled. אלמנט מנוטרל אינו מקבל אירועי עכבר
     בכלל — ה-title שלו אינו נפתח וה-cursor שלו אינו משתנה, ולכן המשתמש
     מגלה שהוא מוקפא רק אחרי שלחץ ולא קרה כלום. במקום זה הפקד נשאר "חי"
     לדפדפן, ומסומן ב-aria-disabled + title, והחסימה עצמה נעשית בשלב
     ה-capture על document: לחיצה, הקלדה ושינוי נבלעים לפני שהם מגיעים
     ל-app.js. התוצאה: tooltip עובד, סמן "אסור" מופיע, והערכים נשארים
     קריאים — אבל שום פעולה אינה יוצאת לדרך.

     מה **אינו** מוקפא, בכוונה: סינון, חיפוש, לשוניות, ניווט ובוררי המפה.
     אלה פעולות צפייה ולא שינוי, והקפאתן הייתה הופכת את ההדגמה לתמונה
     סטטית במקום למערכת שאפשר להסתובב בה. */

  const FROZEN_TITLE =
    "מוקפא בהדגמה — הפעולה משנה נתונים, וזמינה בגרסת השרת המלאה";

  // כל מה שכותב, עורך, מוחק או טוען. מקובץ לפי המסך שהוא יושב בו.
  const MUTATORS = [
    // הגדרות — ספי צבע, סף מרחק, התראות, פרטי משתמש, שמירה
    "#pane-config input", "#pane-config select", "#pane-config textarea",
    "#pane-config .toggle", "#settings-save",
    // טעינת נתונים — בוחרי קבצים וכפתורי הבחירה
    "#pane-upload input", "#pane-upload button", ".drop-btn",
    // ניהול נתונים — הוספה, עריכה בשורה, מחיקה
    ".add-btn", ".add-save", ".add-cancel", ".row-del",
    ".travel-input", ".unit-input",
    "#add-station", "#add-settlement", "#add-travel",
    "#add-region", "#add-region-settlement", "#add-region-travel",
    // ימי גיוס מתוכננים
    "#day-add", "#day-save", "#day-cancel",
    "#day-station", "#day-date", "#day-location", "#day-pct", "[data-day]",
    // תובנות המגייס — כתיבה, סימון בוצע, מחיקה
    "[data-save]", "[data-text]", "[data-toggle]", "[data-del]",
  ].join(",");

  const isFrozen = (node) => node && node.closest && node.closest(".is-frozen");

  function freezeControls() {
    document.querySelectorAll(MUTATORS).forEach((node) => {
      if (node.classList.contains("is-frozen")) return;
      node.classList.add("is-frozen");
      node.setAttribute("aria-disabled", "true");
      node.title = FROZEN_TITLE;
      // שדה טקסט/מספר נשאר קריא אך לא ניתן לעריכה. readOnly (ולא disabled)
      // כדי שהערך לא יאפור והריחוף ימשיך לעבוד.
      if (node.tagName === "INPUT" && /^(text|number|search|date)$/.test(node.type)) {
        node.readOnly = true;
      }
      // התווית שמעל השדה נושאת את אותו הסבר: בשדה עצמו הסמן כבר "אסור",
      // ומי שמרחף על השם שלצדו צריך לקבל את אותה תשובה.
      const label = node.closest("label");
      if (label && !label.title) label.title = FROZEN_TITLE;
    });

    // גרירת קובץ אל אזור ההשלכה — בלי החסימה הדפדפן פותח את הקובץ במקומנו.
    document.querySelectorAll(".drop-zone").forEach((zone) => {
      if (zone.classList.contains("drop-zone--locked")) return;
      zone.classList.add("drop-zone--locked", "is-frozen");
      zone.title = FROZEN_TITLE;
      ["dragenter", "dragover", "drop"].forEach((evt) =>
        zone.addEventListener(evt, (e) => e.preventDefault())
      );
    });
  }

  // החסימה עצמה. capture=true כדי להקדים כל מאזין ש-app.js רשם על האלמנט.
  ["click", "mousedown", "keydown", "change", "input", "paste"].forEach((evt) =>
    document.addEventListener(
      evt,
      (e) => {
        if (!isFrozen(e.target)) return;
        // Tab וניווט במקלדת נשארים — חסימתם הייתה כולאת משתמש מקלדת במסך.
        if (evt === "keydown" && (e.key === "Tab" || e.key === "Escape")) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      },
      true
    )
  );

  // המסכים נבנים אחרי טעינת נתונים אסינכרונית, ולכן פקדים מופיעים גם אחרי
  // ה-load הראשוני. משגיחים ומקפיאים שוב במקום לנחש תזמון.
  window.addEventListener("load", () => {
    freezeControls();
    new MutationObserver(freezeControls).observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
})();
