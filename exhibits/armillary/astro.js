// Low-precision solar ephemeris (NOAA / Meeus), good to about an arc-minute:
// more than enough for an instrument, a sky view and prayer times to the minute.
const D2R = Math.PI / 180, R2D = 180 / Math.PI, TAU = Math.PI * 2;
export const KAABA = { lat: 21.4225, lon: 39.8262 };
export const SIDEREAL_DAY_S = 86164.0905;

const wrap360 = (x) => ((x % 360) + 360) % 360;
const wrap180 = (x) => wrap360(x + 180) - 180;

export const julianDay = (ms) => ms / 86400000 + 2440587.5;

export function sun(ms) {
  const n = julianDay(ms) - 2451545.0;
  const L = wrap360(280.460 + 0.9856474 * n);
  const g = wrap360(357.528 + 0.9856003 * n) * D2R;
  const lambda = wrap360(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const eotMin = wrap180(L - wrap360(ra * R2D)) * 4;
  return { ra: (ra + TAU) % TAU, dec, lambda, eps, eotMin };
}

export function lst(ms, lonDeg) {
  const n = julianDay(ms) - 2451545.0;
  const gmst = 18.697374558 + 24.06570982441908 * n;
  const h = (((gmst + lonDeg / 15) % 24) + 24) % 24;
  return (h / 24) * TAU;
}

// Altitude and azimuth (from north, eastward), radians.
export function altAz(ra, dec, lstRad, latDeg) {
  const phi = latDeg * D2R, H = lstRad - ra;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.cos(dec) * Math.sin(H), Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.cos(H) * Math.sin(phi));
  return { alt, az: (az + TAU) % TAU };
}

// Umm al-Qura method (Saudi Arabia): Fajr at 18.5° below the horizon, Asr when a shadow
// equals its object plus the noon shadow, Isha 90 minutes after Maghrib (120 in Ramadan).
// `day` = { y, m, d } local calendar date; tz in hours. Returns local decimal hours (NaN if the event never happens).
export function prayerTimes(day, latDeg, lonDeg, tz, ramadan = false) {
  const phi = latDeg * D2R;
  const midnightUTC = Date.UTC(day.y, day.m, day.d) - tz * 3600000;
  const atHour = (t) => midnightUTC + t * 3600000;
  const transitAt = (t) => 12 + tz - lonDeg / 15 - sun(atHour(t)).eotMin / 60;

  function event(altFn, side) {
    let t = 12 + side * 6;
    for (let i = 0; i < 4; i++) {
      const s = sun(atHour(t));
      const alt = altFn(s.dec) * D2R;
      const cosH = (Math.sin(alt) - Math.sin(phi) * Math.sin(s.dec)) / (Math.cos(phi) * Math.cos(s.dec));
      if (cosH < -1 || cosH > 1) return NaN;
      t = transitAt(t) + side * (Math.acos(cosH) * R2D) / 15;
    }
    return t;
  }

  const dhuhr = transitAt(transitAt(12));
  const sunrise = event(() => -0.833, -1);
  const maghrib = event(() => -0.833, 1);
  const fajr = event(() => -18.5, -1);
  const asr = event((dec) => Math.atan(1 / (1 + Math.tan(Math.abs(phi - dec)))) * R2D, 1);
  const isha = maghrib + (ramadan ? 2 : 1.5);
  return { fajr, sunrise, dhuhr, asr, maghrib, isha };
}

// Altitude of the sun (degrees) at which Asr begins on a given day.
export function asrAltitude(latDeg, dec) {
  return Math.atan(1 / (1 + Math.tan(Math.abs(latDeg * D2R - dec)))) * R2D;
}

// Great-circle bearing to the Kaaba (degrees from north) and distance (km).
export function qibla(latDeg, lonDeg) {
  const p1 = latDeg * D2R, p2 = KAABA.lat * D2R, dl = (KAABA.lon - lonDeg) * D2R;
  const bearing = wrap360(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * R2D);
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const km = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
  return { bearing, km };
}
