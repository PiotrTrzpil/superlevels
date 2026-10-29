// ═══════════════════════════════════
//  Small helpers shared by the background modules
// ═══════════════════════════════════

// Runs async jobs one at a time, in call order. Returns the job's promise;
// a failed job doesn't stop the ones queued after it.
export function createQueue() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  };
}

// Call fn when any of these chrome.storage.local keys change
export function onLocalChange(keys, fn) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && keys.some((key) => key in changes)) fn();
  });
}
