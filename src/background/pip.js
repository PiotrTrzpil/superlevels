// ═══════════════════════════════════
//  Picture-in-Picture — toggles PiP for the largest video in a tab
// ═══════════════════════════════════
import { handle } from "./messages.js";

// Injected into the page, so it can't use anything from this module
function togglePictureInPicture() {
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture();
    return { action: "exited" };
  }
  const videos = Array.from(document.querySelectorAll("video"));
  if (!videos.length) return { error: "No video found on this page" };
  const playing = videos.filter(v => !v.paused && !v.ended);
  let video;
  if (playing.length) {
    video = playing.reduce((a, b) =>
      (b.videoWidth * b.videoHeight) > (a.videoWidth * a.videoHeight) ? b : a
    );
  } else {
    video = videos.reduce((a, b) =>
      (b.videoWidth * b.videoHeight) > (a.videoWidth * a.videoHeight) ? b : a
    );
  }
  const enterPip = () => video.requestPictureInPicture()
    .then(() => ({ action: "entered" }))
    .catch(e => ({ error: e.message }));
  // requestPictureInPicture() throws if metadata isn't loaded yet
  // (readyState 0 = HAVE_NOTHING). Wait for it, then retry.
  if (video.readyState === 0) {
    return new Promise((resolve) => {
      const onReady = () => {
        cleanup();
        resolve(enterPip());
      };
      const onError = () => {
        cleanup();
        resolve({ error: "Video failed to load" });
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve({ error: "Video metadata did not load in time" });
      }, 5000);
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("loadedmetadata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
      // Nudge the browser to start loading metadata if it hasn't.
      if (video.preload === "none") video.preload = "metadata";
      video.load();
    });
  }
  return enterPip();
}

handle("pip", async ({ tabId }) => {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func: togglePictureInPicture });
  return results[0]?.result || { error: "No result" };
});
