// ============================================================================
// TAZAWWUD — Magnetic declination (World Magnetic Model, WMM2025)
// ----------------------------------------------------------------------------
// A phone compass reads magnetic north. The Qiblah bearing is measured from
// true north. The difference, the magnetic declination, is applied to the
// compass heading in qibla.js.
//
// Model: NOAA's World Magnetic Model WMM2025, degree and order 12, valid
// 2025.0 to 2030.0. The coefficients below are the official WMM2025 values,
// copied from NOAA's WMM2025.COF file. The spherical-harmonic reference radius
// (6371.2 km) and the Schmidt semi-normalised functions follow the WMM technical
// report. Geodetic latitude is converted to geocentric using WGS84.
// Altitude is taken as sea level, which is accurate enough for a compass.
// ============================================================================

const WMM_TEXT = `
    2025.0            WMM-2025     11/13/2024
  1  0  -29351.8       0.0       12.0        0.0
  1  1   -1410.8    4545.4        9.7      -21.5
  2  0   -2556.6       0.0      -11.6        0.0
  2  1    2951.1   -3133.6       -5.2      -27.7
  2  2    1649.3    -815.1       -8.0      -12.1
  3  0    1361.0       0.0       -1.3        0.0
  3  1   -2404.1     -56.6       -4.2        4.0
  3  2    1243.8     237.5        0.4       -0.3
  3  3     453.6    -549.5      -15.6       -4.1
  4  0     895.0       0.0       -1.6        0.0
  4  1     799.5     278.6       -2.4       -1.1
  4  2      55.7    -133.9       -6.0        4.1
  4  3    -281.1     212.0        5.6        1.6
  4  4      12.1    -375.6       -7.0       -4.4
  5  0    -233.2       0.0        0.6        0.0
  5  1     368.9      45.4        1.4       -0.5
  5  2     187.2     220.2        0.0        2.2
  5  3    -138.7    -122.9        0.6        0.4
  5  4    -142.0      43.0        2.2        1.7
  5  5      20.9     106.1        0.9        1.9
  6  0      64.4       0.0       -0.2        0.0
  6  1      63.8     -18.4       -0.4        0.3
  6  2      76.9      16.8        0.9       -1.6
  6  3    -115.7      48.8        1.2       -0.4
  6  4     -40.9     -59.8       -0.9        0.9
  6  5      14.9      10.9        0.3        0.7
  6  6     -60.7      72.7        0.9        0.9
  7  0      79.5       0.0       -0.0        0.0
  7  1     -77.0     -48.9       -0.1        0.6
  7  2      -8.8     -14.4       -0.1        0.5
  7  3      59.3      -1.0        0.5       -0.8
  7  4      15.8      23.4       -0.1        0.0
  7  5       2.5      -7.4       -0.8       -1.0
  7  6     -11.1     -25.1       -0.8        0.6
  7  7      14.2      -2.3        0.8       -0.2
  8  0      23.2       0.0       -0.1        0.0
  8  1      10.8       7.1        0.2       -0.2
  8  2     -17.5     -12.6        0.0        0.5
  8  3       2.0      11.4        0.5       -0.4
  8  4     -21.7      -9.7       -0.1        0.4
  8  5      16.9      12.7        0.3       -0.5
  8  6      15.0       0.7        0.2       -0.6
  8  7     -16.8      -5.2       -0.0        0.3
  8  8       0.9       3.9        0.2        0.2
  9  0       4.6       0.0       -0.0        0.0
  9  1       7.8     -24.8       -0.1       -0.3
  9  2       3.0      12.2        0.1        0.3
  9  3      -0.2       8.3        0.3       -0.3
  9  4      -2.5      -3.3       -0.3        0.3
  9  5     -13.1      -5.2        0.0        0.2
  9  6       2.4       7.2        0.3       -0.1
  9  7       8.6      -0.6       -0.1       -0.2
  9  8      -8.7       0.8        0.1        0.4
  9  9     -12.9      10.0       -0.1        0.1
 10  0      -1.3       0.0        0.1        0.0
 10  1      -6.4       3.3        0.0        0.0
 10  2       0.2       0.0        0.1       -0.0
 10  3       2.0       2.4        0.1       -0.2
 10  4      -1.0       5.3       -0.0        0.1
 10  5      -0.6      -9.1       -0.3       -0.1
 10  6      -0.9       0.4        0.0        0.1
 10  7       1.5      -4.2       -0.1        0.0
 10  8       0.9      -3.8       -0.1       -0.1
 10  9      -2.7       0.9       -0.0        0.2
 10 10      -3.9      -9.1       -0.0       -0.0
 11  0       2.9       0.0        0.0        0.0
 11  1      -1.5       0.0       -0.0       -0.0
 11  2      -2.5       2.9        0.0        0.1
 11  3       2.4      -0.6        0.0       -0.0
 11  4      -0.6       0.2        0.0        0.1
 11  5      -0.1       0.5       -0.1       -0.0
 11  6      -0.6      -0.3        0.0       -0.0
 11  7      -0.1      -1.2       -0.0        0.1
 11  8       1.1      -1.7       -0.1       -0.0
 11  9      -1.0      -2.9       -0.1        0.0
 11 10      -0.2      -1.8       -0.1        0.0
 11 11       2.6      -2.3       -0.1        0.0
 12  0      -2.0       0.0        0.0        0.0
 12  1      -0.2      -1.3        0.0       -0.0
 12  2       0.3       0.7       -0.0        0.0
 12  3       1.2       1.0       -0.0       -0.1
 12  4      -1.3      -1.4       -0.0        0.1
 12  5       0.6      -0.0       -0.0       -0.0
 12  6       0.6       0.6        0.1       -0.0
 12  7       0.5      -0.1       -0.0       -0.0
 12  8      -0.1       0.8        0.0        0.0
 12  9      -0.4       0.1        0.0       -0.0
 12 10      -0.2      -1.0       -0.1       -0.0
 12 11      -1.3       0.1       -0.0        0.0
 12 12      -0.7       0.2       -0.1       -0.1
`;

const WMM_EPOCH = 2025.0;
const N_MAX = 12;
const REFERENCE_RADIUS_KM = 6371.2;
const WGS84_A_KM = 6378.137;
const WGS84_F = 1 / 298.257223563;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function parseCoefficients(text) {
  const table = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s*$/);
    if (!match) continue;
    const n = Number(match[1]);
    const m = Number(match[2]);
    (table[n] ||= [])[m] = {
      g: Number(match[3]),
      h: Number(match[4]),
      gDot: Number(match[5]),
      hDot: Number(match[6]),
    };
  }
  return table;
}

const COEFFICIENTS = parseCoefficients(WMM_TEXT);

/** Schmidt semi-normalisation factor for degree n, order m. */
function schmidtFactor(n, m) {
  if (m === 0) return 1;
  let ratio = 1; // (n - m)! / (n + m)!
  for (let k = n - m + 1; k <= n + m; k += 1) ratio /= k;
  return Math.sqrt(2 * ratio);
}

/**
 * Schmidt semi-normalised associated Legendre functions P[n][m] and their
 * derivatives with respect to colatitude dP[n][m], for n = 0..nMax.
 */
export function schmidtLegendre(nMax, cosTheta, sinTheta) {
  const s = Math.max(Math.abs(sinTheta), 1e-9) * Math.sign(sinTheta || 1);
  const c = cosTheta;
  const pu = [];
  for (let n = 0; n <= nMax; n += 1) pu.push(new Array(nMax + 1).fill(0));
  pu[0][0] = 1;
  for (let m = 1; m <= nMax; m += 1) pu[m][m] = (2 * m - 1) * s * pu[m - 1][m - 1];
  for (let m = 0; m < nMax; m += 1) pu[m + 1][m] = (2 * m + 1) * c * pu[m][m];
  for (let m = 0; m <= nMax; m += 1) {
    for (let n = m + 2; n <= nMax; n += 1) {
      pu[n][m] = ((2 * n - 1) * c * pu[n - 1][m] - (n + m - 1) * pu[n - 2][m]) / (n - m);
    }
  }
  const p = [];
  const dp = [];
  for (let n = 0; n <= nMax; n += 1) {
    p[n] = [];
    dp[n] = [];
    for (let m = 0; m <= n; m += 1) {
      const factor = schmidtFactor(n, m);
      p[n][m] = factor * pu[n][m];
      dp[n][m] = factor * ((n * c * pu[n][m]) - (n + m) * pu[n - 1 >= 0 ? n - 1 : 0][m] * (n - 1 >= m ? 1 : 0)) / s;
    }
  }
  return { p, dp };
}

/** Decimal year, for example 2026.79, from a Date. */
function toDecimalYear(date) {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return year + (date.getTime() - start) / (end - start);
}

/**
 * Magnetic declination in degrees, positive east, at a latitude and longitude
 * on the given date. Accurate to a small fraction of a degree in most places.
 */
export function magneticDeclination(latitudeDeg, longitudeDeg, date = new Date()) {
  const dt = toDecimalYear(date) - WMM_EPOCH;

  // Geodetic (WGS84) to geocentric coordinates, in km.
  const phi = latitudeDeg * DEG;
  const lambda = longitudeDeg * DEG;
  const e2 = WGS84_F * (2 - WGS84_F);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const radiusOfCurvature = WGS84_A_KM / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const x = radiusOfCurvature * cosPhi;
  const z = radiusOfCurvature * (1 - e2) * sinPhi;
  const r = Math.hypot(x, z);
  const phiGeocentric = Math.atan2(z, x);
  const psi = phi - phiGeocentric;
  const theta = Math.PI / 2 - phiGeocentric;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  const { p, dp } = schmidtLegendre(N_MAX, cosTheta, sinTheta);
  const s = Math.max(Math.abs(sinTheta), 1e-9) * Math.sign(sinTheta || 1);

  let br = 0;
  let bTheta = 0;
  let bPhi = 0;
  for (let n = 1; n <= N_MAX; n += 1) {
    const ratio = Math.pow(REFERENCE_RADIUS_KM / r, n + 2);
    for (let m = 0; m <= n; m += 1) {
      const k = COEFFICIENTS[n][m];
      const g = k.g + dt * k.gDot;
      const h = k.h + dt * k.hDot;
      const cosMl = Math.cos(m * lambda);
      const sinMl = Math.sin(m * lambda);
      const term = g * cosMl + h * sinMl;
      br += (n + 1) * ratio * term * p[n][m];
      bTheta += ratio * term * dp[n][m];
      bPhi += ratio * m * (g * sinMl - h * cosMl) * p[n][m] / s;
    }
  }

  // Field in geocentric north / east / down. Bθ = -bTheta, so north = +bTheta.
  // Geodetic north is the geocentric north rotated by psi = latitude difference.
  const northC = bTheta;
  const downC = -br;
  const east = bPhi;
  const north = northC * Math.cos(psi) + downC * Math.sin(psi);
  return Math.atan2(east, north) * RAD;
}
