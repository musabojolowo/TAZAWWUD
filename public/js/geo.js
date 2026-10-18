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

export function getPosition({ timeout = 15000 } = {}) {
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
      { enableHighAccuracy: false, maximumAge: 300000, timeout: Math.max(1000, timeout - 1000) }
    );
  });
}
