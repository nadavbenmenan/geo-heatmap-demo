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

    const res = await fetch(flatten(path));
    if (!res.ok) throw new Error(path + " → " + res.status);
    return json(await res.json());
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

  /* --- 2. הקפאת פקדי הכתיבה --------------------------------------------- */
  //
  // ה-fetch כבר מחזיר "מוקפא", אבל שדה שנראה פעיל ואינו עושה דבר הוא ממשק
  // גרוע. כאן מנטרלים את הפקדים עצמם ומסבירים למה, אחרי ש-app.js סיים
  // לבנות את המסכים.
  const FROZEN_TITLE = "מוקפא בגרסת ההדגמה — הפעולה זמינה בגרסת השרת המלאה";

  function freezeControls() {
    document
      .querySelectorAll(
        '.drop-zone input[type="file"], .drop-btn, .add-btn, .add-save, .row-del,' +
          ' #settings-save, .unit-btn:not([data-insight])'
      )
      .forEach((node) => {
        node.disabled = true;
        node.classList.add("is-frozen");
        node.title = FROZEN_TITLE;
      });

    // גרירת קובץ אל אזור ההשלכה — בלי החסימה הדפדפן פותח את הקובץ במקומנו.
    document.querySelectorAll(".drop-zone").forEach((zone) => {
      ["dragenter", "dragover", "drop"].forEach((evt) =>
        zone.addEventListener(evt, (e) => e.preventDefault())
      );
      zone.classList.add("drop-zone--locked");
    });
  }

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
