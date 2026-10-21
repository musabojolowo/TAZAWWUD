// ============================================================================
// TAZAWWUD — Location request with a watchdog
// ----------------------------------------------------------------------------
// navigator.geolocation does not always call back: if the permission prompt is
// ignored, some browsers never invoke either callback. Without a limit the
// caller's button or view would wait forever. This wrapper rejects after the
// time limit, and the browser's own callback is ignored if it arrives later.
//
// Low accuracy is used on purpose: prayer times and the Qiblah bearing need
// city-level location, and low accuracy gets a fix much more reliably on phones.
// ============================================================================

export function getPosition({ timeout = 15000, enableHighAccuracy = false, maximumAge = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error("Geolocation is unavailable in this browser."), { code: 0 }));
      return;
    }
    let settled = false;
    const finish = (callback) => (value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      callback(value);
    };
    const watchdog = window.setTimeout(() => {
      finish(reject)(Object.assign(new Error("Location request timed out."), { code: 3 }));
    }, timeout);
    navigator.geolocation.getCurrentPosition(
      finish(resolve),
      finish(reject),
      { enableHighAccuracy, maximumAge, timeout: Math.max(1000, timeout - 1000) }
    );
  });
}

/**
 * Tries the preferred accuracy first. If the phone can't find its position
 * (code 2) or the request times out (code 3), it tries once more with the other
 * accuracy: some phones only get a fix from GPS, others only from the network.
 * A refused permission (code 1) or no support (code 0) is not retried.
 */
export async function getPositionWithFallback({ primaryHighAccuracy = false, timeout = 15000 } = {}) {
  try {
    return await getPosition({
      timeout,
      enableHighAccuracy: primaryHighAccuracy,
      maximumAge: primaryHighAccuracy ? 0 : 300000,
    });
  } catch (error) {
    if (error?.code === 0 || error?.code === 1) throw error;
    return getPosition({
      timeout,
      enableHighAccuracy: !primaryHighAccuracy,
      maximumAge: 0,
    });
  }
}

/** A short, specific sentence for a location error, including its code. */
export function describeLocationError(error) {
  switch (error?.code) {
    case 0: return "This browser can't share location.";
    case 1: return "Location permission was refused.";
    case 2: return "Your phone couldn't find its position (code 2).";
    case 3: return "The location request took too long (code 3).";
    default: return `Location failed (${error?.message || "unknown error"}).`;
  }
}
