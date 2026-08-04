# ---------------------------------------------------------------------------
# generate_demo_data.py — מחולל נתוני ההדגמה של מפת החום.
#
# למה הקובץ הזה קיים
# ------------------
# בגרסת השרת המלאה, ה-JS פנה ל-Flask ששלף מ-SQLite. גרסת הפורטפוליו הזו
# רצה על GitHub Pages ללא שרת — ולכן הנתונים "מוקפאים" מראש לקובצי JSON
# סטטיים תחת ../data, בדיוק במבנה שה-API היה מחזיר. app.js קורא אותם כמו
# שהיה קורא ל-API, בלי לדעת שאין שרת.
#
# עיקרון פרטיות (חשוב)
# --------------------
# הקובץ הזה *לא* קורא שום מאגר אמיתי, ואין בעץ הזה שום קובץ "מאושר" או
# מיוצא ממערכת. כל מספר כאן מוגרל מהתפלגות נורמלית עם seed קבוע. הדבר
# היחיד ה"אמיתי" הוא גאוגרפיה ציבורית: שמות תחנות, מרחבים, יישובים
# והקשרים ביניהם — כולם ב-geo_seed.json.
#
# במיוחד: בהדגמה הזו **אין** נתוני איוש (תקן/מאויש/אחוז איוש), אין פילוח
# דמוגרפי של כוח אדם, ואין מועמדים בהליך. המדד היחיד הוא "משרות פתוחות" —
# כמה תקנים פנויים מפורסמים בכל תחנה — והוא מומצא במלואו.
#
# הרצה:  python generate_demo_data.py   (ללא תלויות — ספרייה סטנדרטית בלבד)
# ---------------------------------------------------------------------------
import json
import math
import random
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
SEED_FILE = Path(__file__).resolve().parent / "geo_seed.json"

# seed קבוע = פלט זהה בכל הרצה. שינוי המספר מגריל מערך נתונים אחר.
RNG = random.Random(20260804)

# --- ספי הצבע -------------------------------------------------------------
# המדד הוא **מספר המשרות הפתוחות בתחנה**, ולכן — בניגוד לאחוז איוש — גבוה
# יותר הוא גרוע יותר, והספים יורדים בחומרתם. תחנה עם 25 משרות פתוחות היא
# עומס גיוס קריטי; תחנה עם 3 היא תקינה.
THRESHOLDS = {"critical": 25, "urgent": 16, "medium": 8}
NEARBY_MINUTES = 30
URGENCY_WEIGHTS = {"critical": 1.5, "urgent": 1.2, "medium": 1.0, "ok": 0.5, "unknown": 0.0}

CRITICAL = {"status": "קריטי", "color": "#DC2626", "key": "critical"}
URGENT = {"status": "דחוף", "color": "#EA580C", "key": "urgent"}
MEDIUM = {"status": "בינוני", "color": "#EAB308", "key": "medium"}
OK = {"status": "תקין", "color": "#16A34A", "key": "ok"}
UNKNOWN = {"status": "לא ידוע", "color": "#9CA3AF", "key": "unknown"}

# --- משפחות המקצוע --------------------------------------------------------
# שש משפחות, קבועות וסגורות. זו בחירה מודעת: מערכת אמיתית מקבלת רשימת
# מקצועות ארוכה ומשתנה ("חוקר/מד"ר", "סייר/מגילות", ...) שמפוררת כל פילוח
# לעשרות שורות של 1-2 משרות. בהדגמה מרכזים לשש קטגוריות שנקראות במבט אחד —
# כך הפילוח בכרטיס התחנה, בטבלה ובייצוא נשאר קריא.
ROLE_FAMILIES = [
    ("patrol", "סיור"),
    ("investigation", "חקירות"),
    ("traffic", "תנועה"),
    ("intelligence", "מודיעין"),
    ("support", "מטה ותמיכה"),
    ("community", "שיטור קהילתי"),
]
ROLE_KEYS = [k for k, _ in ROLE_FAMILIES]
ROLE_LABELS = dict(ROLE_FAMILIES)

# משקל בסיס לחלוקת המשרות הפתוחות בין המשפחות. סיור הוא הגדול ביותר כי הוא
# המשפחה הרחבה ביותר בכל תחנה; מטה ושיטור קהילתי קטנים.
ROLE_WEIGHTS = {
    "patrol": 0.30,
    "investigation": 0.20,
    "traffic": 0.14,
    "intelligence": 0.13,
    "support": 0.12,
    "community": 0.11,
}

# --- התפלגות המשרות הפתוחות ------------------------------------------------
# עקומת פעמון סביב ממוצע ארצי: רוב התחנות סביב הממוצע, וזנבות דקים של תחנות
# בעומס גיוס גבוה (אדום) ותחנות רגועות (ירוק). התוחלת והסטייה נבחרו כך שכל
# ארבעת הסטטוסים יופיעו על המפה בכמות משמעותית.
OPEN_MEAN = 14.0   # תוחלת משרות פתוחות לתחנה
OPEN_STD = 8.0     # סטיית תקן — קובעת את רוחב הפעמון
OPEN_MIN, OPEN_MAX = 0, 40  # קטימה לטווח ריאלי


def gauss_open():
    """מספר המשרות הפתוחות בתחנה אחת — הגרלה נורמלית קטומה."""
    return int(round(max(OPEN_MIN, min(OPEN_MAX, RNG.gauss(OPEN_MEAN, OPEN_STD)))))


ROLES = ["מגייס ארצי", "ראש ענף גיוס", "קצין גיוס מחוזי", "מנהל מערכת"]
DEFAULTS = {
    "threshold_critical": THRESHOLDS["critical"],
    "threshold_urgent": THRESHOLDS["urgent"],
    "threshold_medium": THRESHOLDS["medium"],
    "nearby_minutes": NEARBY_MINUTES,
    "urgency_critical": 1.5, "urgency_urgent": 1.2, "urgency_medium": 1.0, "urgency_ok": 0.5,
    "alert_critical": True, "alert_weekly_report": False, "alert_new_opening": False,
    "user_name": "", "user_role": "מגייס ארצי",
}


def classify(open_positions):
    """סיווג תחנה לפי מספר המשרות הפתוחות בה. גבוה = חמור."""
    if open_positions is None:
        return dict(UNKNOWN)
    if open_positions >= THRESHOLDS["critical"]:
        return dict(CRITICAL)
    if open_positions >= THRESHOLDS["urgent"]:
        return dict(URGENT)
    if open_positions >= THRESHOLDS["medium"]:
        return dict(MEDIUM)
    return dict(OK)


def legend():
    t = THRESHOLDS
    return [
        {**CRITICAL, "label": f"{t['critical']} משרות ומעלה"},
        {**URGENT, "label": f"{t['urgent']}–{t['critical'] - 1} משרות"},
        {**MEDIUM, "label": f"{t['medium']}–{t['urgent'] - 1} משרות"},
        {**OK, "label": f"עד {t['medium'] - 1} משרות"},
    ]


def _largest_remainder(total, weights, keys):
    """מפצל מספר שלם total בין keys לפי weights, כך שהסכום מדויק == total."""
    if total <= 0:
        return {k: 0 for k in keys}
    s = sum(weights[k] for k in keys) or 1.0
    raw = {k: total * weights[k] / s for k in keys}
    floor = {k: int(math.floor(raw[k])) for k in keys}
    remainder = total - sum(floor.values())
    order = sorted(keys, key=lambda k: raw[k] - floor[k], reverse=True)
    for k in order[:remainder]:
        floor[k] += 1
    return floor


def role_split(open_positions):
    """מפרק את המשרות הפתוחות של תחנה בין שש משפחות המקצוע.
    הסכום נשמר מדויק — פילוח שלא מסתכם לסך התחנה הוא באג שקשה לראות."""
    w = {k: max(0.01, ROLE_WEIGHTS[k] * (1 + RNG.uniform(-0.25, 0.25))) for k in ROLE_KEYS}
    return _largest_remainder(open_positions, w, ROLE_KEYS)


def haversine_km(a_lat, a_lng, b_lat, b_lng):
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dphi = math.radians(b_lat - a_lat)
    dlmb = math.radians(b_lng - a_lng)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# ---------------------------------------------------------------------------
# 1. בניית המערך הסינתטי מתוך הגאוגרפיה הציבורית
# ---------------------------------------------------------------------------
seed = json.loads(SEED_FILE.read_text(encoding="utf-8"))

stations = []
for i, s in enumerate(seed["stations"]):
    open_positions = gauss_open()
    stations.append({
        "id": i + 1,
        "name": s["name"],
        "district": s["district"],
        "area": s["area"],
        "lat": s["lat"],
        "lng": s["lng"],
        "coord_verified": 0,
        "open_positions": open_positions,
        "role_split": role_split(open_positions),
    })

settlements = []
for i, s in enumerate(seed["settlements"]):
    settlements.append({
        "id": i + 1, "name": s["name"], "lat": s["lat"], "lng": s["lng"], "coord_verified": 0,
    })

stations_by_name = {s["name"]: s for s in stations}
settlements_by_name = {s["name"]: s for s in settlements}

# קשרי תחנה-יישוב: הזוגות (מי סמוך למי) הם גאוגרפיה ציבורית מ-geo_seed;
# זמן הנסיעה מוגרל אך ריאלי — נגזר ממרחק אווירי ב~28 קמ"ש עירוני + רעש.
relations = []
rid = 0
for pair in seed["pairs"]:
    st = stations_by_name.get(pair["station"])
    se = settlements_by_name.get(pair["settlement"])
    if not st or not se:
        continue
    km = haversine_km(st["lat"], st["lng"], se["lat"], se["lng"])
    minutes = max(3, round(km / 0.47 + RNG.uniform(-2, 4)))
    rid += 1
    relations.append({
        "id": rid,
        "station_id": st["id"], "station_name": st["name"],
        "settlement_id": se["id"], "settlement_name": se["name"],
        "travel_min": minutes,
    })


# ---------------------------------------------------------------------------
# 2. פונקציות תשלובת (payloads) — זהות במבנה למה שהשרת החזיר
# ---------------------------------------------------------------------------
def roles_of(s):
    """פילוח המשרות הפתוחות לפי משפחת מקצוע, תמיד באותו סדר ולפי key."""
    return [
        {"key": k, "label": ROLE_LABELS[k], "open": s["role_split"][k]}
        for k in ROLE_KEYS
    ]


def top_role(s):
    """המשפחה עם הכי הרבה משרות פתוחות — הכותרת של 'איפה הכאב' בתחנה.
    תחנה בלי משרות פתוחות מחזירה None, ולא משפחה שרירותית עם 0."""
    best = max(roles_of(s), key=lambda r: r["open"])
    return None if best["open"] <= 0 else best


def station_payload(s):
    palette = classify(s["open_positions"])
    return {
        "id": s["id"], "name": s["name"], "district": s["district"], "area": s["area"],
        "open_positions": s["open_positions"],
        "status": palette["status"], "status_key": palette["key"], "color": palette["color"],
        "lat": s["lat"], "lng": s["lng"], "coord_verified": bool(s["coord_verified"]),
        # פילוח לפי מקצוע — כדי שכרטיס התחנה במפה יראה "איפה בדיוק חסר"
        # בלי לשלוף את קובץ הפירוט. הסכום שווה תמיד ל-open_positions.
        "roles": roles_of(s),
        "top_role": top_role(s),
    }


def nearby_of(station_id):
    items = [
        {"name": r["settlement_name"], "travel_min": r["travel_min"]}
        for r in relations
        if r["station_id"] == station_id and r["travel_min"] <= NEARBY_MINUTES
    ]
    return sorted(items, key=lambda x: x["travel_min"])


def recruiter_station(s):
    return {**station_payload(s), "nearby_settlements": nearby_of(s["id"])}


def urgency(p):
    """ציון דחיפות = משרות פתוחות × מקדם עומס לפי הסטטוס.
    נוסחה אחת, שתי כניסות, ושתיהן מוצגות במסך — ראו renderFormula ב-app.js."""
    open_positions = p["open_positions"]
    if open_positions is None:
        return {"score": None, "weight": None}
    weight = URGENCY_WEIGHTS.get(p["status_key"], 0.0)
    return {"score": round(open_positions * weight, 1), "weight": weight}


# ---------------------------------------------------------------------------
# 3. חישוב מדדים כלל-מערכתיים (לוח בקרה / אסטרטגי)
# ---------------------------------------------------------------------------
payloads = [station_payload(s) for s in sorted(stations, key=lambda s: s["name"])]
total_open = sum(p["open_positions"] for p in payloads)
avg_open = round(total_open / len(payloads), 1)
max_open = max(p["open_positions"] for p in payloads)

# פילוח ארצי לפי משפחת מקצוע — נצרך בלוח הבקרה ובייצוא.
open_by_role = [
    {"key": k, "label": ROLE_LABELS[k], "open": sum(s["role_split"][k] for s in stations)}
    for k in ROLE_KEYS
]

# שני צילומי מדדים כדי שלוח הבקרה יוכל להציג "מגמת חודש" (מחייבת שתי נקודות).
now = datetime.now()
snapshots = [  # ordered DESC by taken_at, כמו בשאילתה
    {"total_open": total_open, "taken_at": now.isoformat(timespec="seconds")},
    {"total_open": total_open + 47,
     "taken_at": (now - timedelta(days=30)).isoformat(timespec="seconds")},
]
trend = snapshots[0]["total_open"] - snapshots[1]["total_open"]

# יומן טעינות דמו — שמות קבצים סינתטיים, בלי נתיבים אמיתיים.
load_log = [
    {"loaded_at": (now - timedelta(days=1, hours=2)).isoformat(timespec="seconds"),
     "file_type": "openings", "source_file": "משרות_פתוחות_דמו.xlsx",
     "archived_file": None, "rows_loaded": len(stations) * len(ROLE_KEYS), "status": "ok",
     "message": ""},
    {"loaded_at": (now - timedelta(days=1, hours=2, minutes=3)).isoformat(timespec="seconds"),
     "file_type": "relations", "source_file": "קשרי_תחנה_יישוב_דמו.xlsx",
     "archived_file": None, "rows_loaded": len(relations), "status": "ok", "message": ""},
    {"loaded_at": (now - timedelta(days=5)).isoformat(timespec="seconds"),
     "file_type": "openings", "source_file": "משרות_פתוחות_טיוטה.xlsx",
     "archived_file": None, "rows_loaded": None, "status": "rejected",
     "message": "נדחה ע\"י Data Guard — סטייה של 14% מהמאגר הקיים."},
]

insights_raw = [
    {"id": 1, "station_id": 6, "text": "ריכוז משרות סיור פתוחות — לשקול יום גיוס ממוקד באזור.",
     "done": 0, "created_at": (now - timedelta(days=3)).isoformat(timespec="seconds")},
    {"id": 2, "station_id": 1, "text": "התחנה כמעט סגורה על התקן — להסיט תקציב פרסום לתחנות האדומות.",
     "done": 1, "created_at": (now - timedelta(days=8)).isoformat(timespec="seconds")},
    {"id": 3, "station_id": 8, "text": "משרות חקירות פתוחות לאורך זמן — לבחון שיתוף מרחבי.",
     "done": 0, "created_at": (now - timedelta(days=1)).isoformat(timespec="seconds")},
]

recruitment_days = [
    {"id": 1, "date": (date.today() + timedelta(days=7)).isoformat(),
     "location": "לשכת גיוס דן", "expected_success_pct": 65.0, "station_name": "תחנת מסובים"},
    {"id": 2, "date": (date.today() + timedelta(days=18)).isoformat(),
     "location": "מתחם יפו", "expected_success_pct": 58.0, "station_name": "תחנת יפו"},
]


def dashboard_data():
    status_counts = {}
    for p in payloads:
        status_counts[p["status"]] = status_counts.get(p["status"], 0) + 1
    top5 = sorted(payloads, key=lambda p: (-p["open_positions"], p["name"]))[:5]
    return {
        "filters": {"region": None, "station": None},
        # עומס הגיוס הארצי: ממוצע משרות פתוחות לתחנה, מסווג באותם ספים
        # כמו תחנה בודדת — כך הצבע בלוח הבקרה ובמפה אומר את אותו דבר.
        "open_load": {
            "value": avg_open, "max": max_open, "note": None,
            **classify(round(avg_open)),
        },
        "positions": {
            "available": True, "total_open": total_open,
            "stations_count": len(payloads), "status_counts": status_counts,
        },
        "manpower_gap": {
            "available": True, "total_open": total_open,
            "trend": trend, "snapshots": len(snapshots),
        },
        "by_role": open_by_role,
        "top5": [
            {"name": p["name"], "district": p["district"], "area": p["area"],
             "open_positions": p["open_positions"], "status": p["status"],
             "color": p["color"], "top_role": p["top_role"], "max": max_open}
            for p in top5
        ],
    }


def recruiter_data():
    rows = sorted(stations, key=lambda s: (s["district"], s["area"], s["name"]))
    rec_stations = [recruiter_station(s) for s in rows]
    # "בעומס" = מעל סף הצהוב. מונה "יחידות עם משרה פתוחה אחת לפחות" היה
    # מראה כמעט 100% תמיד, ומדד שתמיד מלא אינו מדד.
    under_load = [s for s in rec_stations if s["open_positions"] >= THRESHOLDS["medium"]]
    critical = [s for s in rec_stations if s["status_key"] == "critical"]

    tree = {}
    for s in rec_stations:
        tree.setdefault(s["district"] or "ללא מחוז", {}).setdefault(s["area"] or "ללא מרחב", []).append(s)

    return {
        "kpis": {
            "total_open": {"available": True, "value": total_open},
            "units_under_load": {
                "available": True, "value": len(under_load),
                "threshold": THRESHOLDS["medium"],
                "pct": round(len(under_load) / len(rec_stations) * 100, 1),
            },
            "avg_open": {"available": True, "value": avg_open},
            "critical_units": {"available": True, "value": len(critical),
                               "threshold": THRESHOLDS["critical"]},
        },
        "units_count": len(rec_stations),
        "nearby_minutes": NEARBY_MINUTES,
        "tree": [
            {"district": d, "areas": [{"area": a, "stations": items} for a, items in sorted(areas.items())]}
            for d, areas in sorted(tree.items())
        ],
    }


def advertising_targets(top_stations):
    by_id = {s["id"]: s for s in top_stations}
    ids = set(by_id)
    targets = {}
    for r in relations:
        if r["station_id"] not in ids or r["travel_min"] > NEARBY_MINUTES:
            continue
        entry = targets.setdefault(
            r["settlement_id"], {"name": r["settlement_name"], "stations": [], "score": 0.0}
        )
        station = by_id[r["station_id"]]
        entry["stations"].append({
            "name": station["name"], "travel_min": r["travel_min"],
            "status": station["status"], "color": station["color"],
        })
        entry["score"] += station["urgency"]["score"]
    result = []
    for settlement_id, entry in targets.items():
        entry["stations"].sort(key=lambda s: s["travel_min"])
        result.append({
            "settlement_id": settlement_id, "name": entry["name"],
            "score": round(entry["score"], 1), "station_count": len(entry["stations"]),
            "stations": entry["stations"],
        })
    result.sort(key=lambda t: (-t["score"], t["name"]))
    return result


def strategic_data(n=10):
    scored = []
    for p in payloads:
        u = urgency(p)
        if u["score"] is None:
            continue
        scored.append({**p, "urgency": u})
    scored.sort(key=lambda s: (-s["urgency"]["score"], s["name"]))
    top_n = scored[:n]

    above = [p for p in payloads if p["open_positions"] >= THRESHOLDS["medium"]]
    critical = [p for p in payloads if p["status_key"] == "critical"]
    critical_open = sum(p["open_positions"] for p in critical)

    return {
        "n": n, "n_options": [5, 10, 20, 30, 50], "nearby_minutes": NEARBY_MINUTES,
        "weights": URGENCY_WEIGHTS,
        "kpis": {
            "annual_goal": {"available": False, "value": None},
            "total_open": {"available": True, "value": total_open},
            "units_above": {"available": True, "value": len(above),
                            "threshold": THRESHOLDS["medium"]},
            "critical_gap": {
                "available": bool(critical),
                "value": critical_open if critical else None,
                "units": len(critical),
            },
        },
        "max_open": max_open,
        "top": [
            {"id": s["id"], "name": s["name"], "district": s["district"], "area": s["area"],
             "open_positions": s["open_positions"], "status": s["status"],
             "status_key": s["status_key"], "color": s["color"], "top_role": s["top_role"],
             **s["urgency"]}
            for s in top_n
        ],
        "targets": advertising_targets(top_n),
        "recruitment_days": recruitment_days,
    }


# ---------------------------------------------------------------------------
# 4. כתיבת כל קובצי ה-JSON הסטטיים
# ---------------------------------------------------------------------------
def settlements_payload():
    out = []
    for se in sorted(settlements, key=lambda s: s["name"]):
        nearby = sum(
            1 for r in relations
            if r["settlement_id"] == se["id"] and r["travel_min"] <= NEARBY_MINUTES
        )
        out.append({
            "id": se["id"], "name": se["name"], "lat": se["lat"], "lng": se["lng"],
            "coord_verified": bool(se["coord_verified"]), "nearby_stations": nearby,
        })
    return out


def relations_payload():
    ordered = sorted(relations, key=lambda r: (r["station_name"], r["travel_min"]))
    return [
        {**{k: r[k] for k in ("id", "station_id", "station_name", "settlement_id",
                              "settlement_name", "travel_min")},
         "within_nearby": r["travel_min"] <= NEARBY_MINUTES}
        for r in ordered
    ]


def write(name, obj):
    path = DATA_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    return path


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    write("tiles-available.json", {"available": False, "zooms": []})
    write("health.json", {
        "ok": True, "db": "(demo)", "stations": len(stations),
        "settlements": len(settlements), "relations": len(relations),
        "nearby_minutes": NEARBY_MINUTES,
    })
    write("legend.json", legend())
    write("stations.json", payloads)
    write("settlements.json", settlements_payload())
    write("relations.json", relations_payload())
    write("regions.json", {
        "regions": sorted({s["area"] for s in stations if s["area"]}),
        "districts": sorted({s["district"] for s in stations if s["district"]}),
    })
    write("last-update.json", {
        "last_update": load_log[0]["loaded_at"], "file_type": load_log[0]["file_type"],
        "archived_file": load_log[0]["archived_file"], "rows_loaded": load_log[0]["rows_loaded"],
    })
    write("loaded-files.json", {"archive_dir": "(demo)", "loads": load_log})
    write("dashboard.json", dashboard_data())
    write("recruiter.json", recruiter_data())
    write("strategic.json", strategic_data(10))
    write("settings.json", {**{k: DEFAULTS[k] for k in DEFAULTS}, "roles": ROLES, "defaults": DEFAULTS})

    insights_list = sorted(insights_raw, key=lambda i: (i["done"], -i["id"]))
    write("insights.json", [
        {**i, "station_name": stations[i["station_id"] - 1]["name"]} for i in insights_list
    ])

    # פירוט לכל תחנה — נצרך ע"י חלונית ממשק המגייס.
    for s in stations:
        detail = recruiter_station(s)
        detail["insights"] = [
            {"id": i["id"], "text": i["text"], "done": i["done"], "created_at": i["created_at"]}
            for i in sorted((x for x in insights_raw if x["station_id"] == s["id"]),
                            key=lambda x: -x["id"])
        ]
        write(f"station-detail/{s['id']}.json", detail)

    counts = {}
    for p in payloads:
        counts[p["status"]] = counts.get(p["status"], 0) + 1
    print(f"נכתבו קובצי JSON אל {DATA_DIR}")
    print(f"  תחנות: {len(stations)} · יישובים: {len(settlements)} · קשרים: {len(relations)}")
    print(f"  משרות פתוחות: {total_open} · ממוצע לתחנה: {avg_open} · מקסימום: {max_open}")
    print("  התפלגות: " + " · ".join(f"{k} {v}" for k, v in counts.items()))

    # קובץ הייצוא לאקסל (data/export.xlsx) — מה שכפתורי "ייצוא אקסל" באתר מורידים.
    # דורש openpyxl; אם אינו מותקן, מדלגים בלי להיכשל (ה-JSON כבר נכתב).
    try:
        import build_export_xlsx
        path = build_export_xlsx.build(DATA_DIR)
        print(f"  נכתב גם {path.name} (ייצוא לאקסל)")
    except ImportError:
        print("  (דילוג על export.xlsx — openpyxl אינו מותקן)")


if __name__ == "__main__":
    main()
