// ===== API MÉTEO SCOOP — cerveau unique (Open-Meteo, 100% gratuit sans clé) =====

// Villes prédéfinies (métadonnées rapides)
const VILLES = {
    "sidi bel abbes": { lat: 35.19, lon: -0.63 },
    "oran": { lat: 35.70, lon: -0.64 },
    "alger": { lat: 36.75, lon: 3.06 },
    "adrar": { lat: 27.87, lon: -0.29 }
};

// Codes météo WMO → texte français
const WMO = {
    0: "ciel dégagé ☀️", 1: "globalement dégagé 🌤️", 2: "partiellement nuageux ⛅", 3: "couvert ☁️",
    45: "brouillard 🌫️", 48: "brouillard givrant 🌫️",
    51: "bruine légère 🌦️", 53: "bruine 🌦️", 55: "bruine forte 🌧️",
    56: "bruine verglaçante 🌧️", 57: "bruine verglaçante forte 🌧️",
    61: "pluie faible 🌦️", 63: "pluie modérée 🌧️", 65: "pluie forte 🌧️",
    66: "pluie verglaçante 🌧️", 67: "pluie verglaçante forte 🌧️",
    71: "neige faible 🌨️", 73: "neige 🌨️", 75: "neige forte ❄️", 77: "grains de neige ❄️",
    80: "averses faibles 🌦️", 81: "averses 🌧️", 82: "averses violentes ⛈️",
    85: "averses de neige 🌨️", 86: "fortes averses de neige ❄️",
    95: "orage ⛈️", 96: "orage avec grêle ⛈️", 99: "orage violent avec grêle ⛈️"
};

function wmoDesc(code) { return WMO[code] || "conditions inconnues"; }

// Nom libre → coordonnées (n'importe quelle ville du monde)
async function geocode(name) {
    try {
        const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=fr&format=json`);
        if (!r.ok) return null;
        const d = await r.json();
        if (Array.isArray(d.results) && d.results.length > 0) {
            const g = d.results[0];
            return { name: g.name, country: g.country || "", lat: g.latitude, lon: g.longitude };
        }
        return null;
    } catch (e) { return null; }
}

// Météo (multi-locations en 1 seul appel) : maintenant + aujourd'hui + demain
async function getForecast(places) {
    const lats = places.map(p => p.lat).join(",");
    const lons = places.map(p => p.lon).join(",");
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
        `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_gusts_10m_max,uv_index_max` +
        `&forecast_days=2&timezone=auto`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Forecast HTTP ${r.status}`);
    const d = await r.json();
    const arr = Array.isArray(d) ? d : [d];
    return arr.map((w, i) => ({
        ville: (places[i] && places[i].name) || "?",
        pays: (places[i] && places[i].country) || "",
        maintenant: {
            temp_c: Math.round(w.current.temperature_2m),
            temps: wmoDesc(w.current.weather_code),
            vent_kmh: Math.round(w.current.wind_speed_10m),
            humidite_pct: w.current.relative_humidity_2m
        },
        aujourdhui: {
            min_c: Math.round(w.daily.temperature_2m_min[0]),
            max_c: Math.round(w.daily.temperature_2m_max[0]),
            pluie_pct: w.daily.precipitation_probability_max[0],
            rafales_kmh: Math.round(w.daily.wind_gusts_10m_max[0]),
            uv_max: w.daily.uv_index_max[0],
            temps: wmoDesc(w.daily.weather_code[0])
        },
        demain: {
            min_c: Math.round(w.daily.temperature_2m_min[1]),
            max_c: Math.round(w.daily.temperature_2m_max[1]),
            pluie_pct: w.daily.precipitation_probability_max[1],
            temps: wmoDesc(w.daily.weather_code[1])
        }
    }));
}

// Qualité de l'air (indice européen) — pour courir, camping...
async function getAir(lat, lon) {
    try {
        const r = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,pm2_5&timezone=auto`);
        if (!r.ok) return null;
        const d = await r.json();
        const aqi = Math.round(d.current.european_aqi);
        let qualite = "bonne 😊 (idéal pour courir)";
        if (aqi > 20) qualite = "correcte 🙂 (ok pour le sport)";
        if (aqi > 40) qualite = "moyenne 😐 (sport ok, personne sensible : prudence)";
        if (aqi > 60) qualite = "médiocre 😷 (limiter l'effort intense)";
        if (aqi > 80) qualite = "mauvaise 🤢 (éviter le sport dehors)";
        if (aqi > 100) qualite = "très mauvaise ☠️ (rester à l'intérieur)";
        return { aqi_europeen: aqi, qualite, pm25_ugm3: d.current.pm2_5 };
    } catch (e) { return null; }
}

// Mer / vagues — renvoie null à l'intérieur des terres
async function getMarine(lat, lon) {
    try {
        const r = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_period,wave_direction&timezone=auto`);
        if (!r.ok) return null;
        const c = (await r.json()).current;
        if (!c || c.wave_height == null) return null;
        const h = c.wave_height;
        let etat = "mer calme 🌊 (baignade tranquille)";
        if (h > 0.5) etat = "mer peu agitée 🌊";
        if (h > 1.25) etat = "mer agitée 💨 (prudence en baignade)";
        if (h > 2.5) etat = "mer forte ⚠️ (éviter la baignade)";
        if (h > 4) etat = "mer très forte ⛔ (danger)";
        return { hauteur_vagues_m: h, periode_s: c.wave_period, etat };
    } catch (e) { return null; }
}

export default async function handler(req, res) {
    // POST (outils internes) = protégé · GET (tests navigateur) = libre (données publiques)
    if (req.method === 'POST') {
        const code = process.env.SCOOP_WEB_CODE;
        if (code && req.headers['x-scoop-code'] !== code) return res.status(401).json({ error: 'Accès refusé' });
    }
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const p = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const wantAir = p.air === '1' || p.air === true;
    const wantMarine = p.marine === '1' || p.marine === true;

    // 1. Résolution des lieux demandés
    let places = [];
    try {
        if (p.cities) {
            const names = String(p.cities).split(',').map(s => s.trim()).filter(Boolean);
            for (const n of names) {
                const key = n.toLowerCase();
                if (VILLES[key]) {
                    places.push({ name: n, lat: VILLES[key].lat, lon: VILLES[key].lon });
                } else {
                    const g = await geocode(n);
                    if (g) places.push(g);
                }
            }
        } else if (p.lat && p.lon) {
            places.push({ name: p.place_name || "Position actuelle", country: "", lat: parseFloat(p.lat), lon: parseFloat(p.lon) });
        } else if (p.place) {
            const key = String(p.place).toLowerCase().trim();
            if (VILLES[key]) {
                places.push({ name: p.place, lat: VILLES[key].lat, lon: VILLES[key].lon });
            } else {
                const g = await geocode(String(p.place));
                if (!g) return res.status(200).json({ error: `Lieu introuvable : ${p.place}` });
                places.push(g);
            }
        } else {
            return res.status(400).json({ error: "Précisez 'place' (nom), 'cities' (a,b,c) ou 'lat'/'lon'" });
        }
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }

    if (places.length === 0) return res.status(200).json({ error: "Aucun lieu valide trouvé" });

    try {
        const meteo = await getForecast(places);
        // air / mer : seulement pour le 1er lieu si demande multiple
        const air = wantAir ? await getAir(places[0].lat, places[0].lon) : null;
        const mer = wantMarine ? await getMarine(places[0].lat, places[0].lon) : null;
        return res.status(200).json({ meteo, air, mer });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
