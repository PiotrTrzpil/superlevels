// ═══════════════════════════════════
//  Music Recognizer (ACRCloud)
// ═══════════════════════════════════
import { esc } from "../lib/dom.js";

// ACRCloud credentials — loaded from storage so they're not hardcoded in source
let ACR_HOST = "";
let ACR_KEY = "";
let ACR_SECRET = "";

// Load saved creds (set defaults on first run)
chrome.storage.local.get(["acr_host", "acr_key", "acr_secret"], (data) => {
  ACR_HOST = data.acr_host || "identify-eu-west-1.acrcloud.com";
  ACR_KEY = data.acr_key || "";
  ACR_SECRET = data.acr_secret || "";
});

const listenBtn = document.getElementById("listenBtn");
const listenTimer = document.getElementById("listenTimer");
const listenLabel = document.getElementById("listenLabel");
const musicResult = document.getElementById("musicResult");
const musicHistoryEl = document.getElementById("musicHistory");
let isRecording = false;

listenBtn.addEventListener("click", () => {
  if (isRecording) return;
  startListening();
});

async function startListening() {
  if (!ACR_KEY || !ACR_SECRET) {
    musicResult.innerHTML = `<div class="music-error">ACRCloud credentials not set. <a href="https://www.acrcloud.com/sign-up/" target="_blank" style="color:#6a9fd8;">Sign up free</a> and add them below.</div>`;
    showAcrConfig();
    return;
  }
  isRecording = true;
  listenBtn.classList.add("recording");
  listenBtn.closest(".music-center").classList.add("active");
  listenLabel.textContent = "Listening...";
  musicResult.innerHTML = "";

  let seconds = 10;
  listenTimer.textContent = seconds + "s";
  const interval = setInterval(() => {
    seconds--;
    listenTimer.textContent = seconds + "s";
    if (seconds <= 0) clearInterval(interval);
  }, 1000);

  try {
    const stream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture({ audio: true, video: false }, (s) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!s) return reject(new Error("No audio stream"));
        resolve(s);
      });
    });

    // Pipe audio back to speakers so user still hears it
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(audioCtx.destination);

    // Record 10 seconds
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const blob = await new Promise((resolve) => {
      recorder.onstop = () => {
        source.disconnect();
        audioCtx.close();
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks, { type: "audio/webm" }));
      };
      recorder.start();
      setTimeout(() => recorder.stop(), 10000);
    });

    clearInterval(interval);
    listenTimer.textContent = "";
    listenLabel.textContent = "Identifying...";

    const result = await identifyWithACR(blob);
    showResult(result);
  } catch (err) {
    clearInterval(interval);
    musicResult.innerHTML = `<div class="music-error">${esc(err.message)}</div>`;
    showAcrConfig();
  } finally {
    isRecording = false;
    listenBtn.classList.remove("recording");
    listenBtn.closest(".music-center").classList.remove("active");
    listenTimer.textContent = "";
    listenLabel.textContent = "Tap to listen";
  }
}

async function hmacSha1(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function identifyWithACR(audioBlob) {
  const timestamp = Math.floor(Date.now() / 1000);
  const stringToSign = `POST\n/v1/identify\n${ACR_KEY}\naudio\n1\n${timestamp}`;
  const signature = await hmacSha1(ACR_SECRET, stringToSign);

  const arrayBuf = await audioBlob.arrayBuffer();
  const form = new FormData();
  form.append("access_key", ACR_KEY);
  form.append("data_type", "audio");
  form.append("signature_version", "1");
  form.append("signature", signature);
  form.append("timestamp", timestamp.toString());
  form.append("sample_bytes", arrayBuf.byteLength.toString());
  form.append("sample", audioBlob, "sample.webm");

  const resp = await fetch(`https://${ACR_HOST}/v1/identify`, { method: "POST", body: form });
  const data = await resp.json();

  if (data.status && data.status.code === 0 && data.metadata) {
    const music = data.metadata.music;
    const humming = data.metadata.humming;
    if (music && music.length > 0) return music[0];
    if (humming && humming.length > 0) return humming[0];
    throw new Error("Song recognized but no match found. Try a clearer part of the track.");
  } else if (data.status && data.status.code === 0) {
    throw new Error("No match found. Try during a clearer part of the song (e.g. chorus).");
  } else if (data.status && data.status.code === 1001) {
    throw new Error("No music detected. Make sure audio is playing in the tab.");
  } else {
    throw new Error(data.status ? data.status.msg : "Unknown error");
  }
}

function showResult(song) {
  const title = song.title || "Unknown";
  const artist = (song.artists || []).map((a) => a.name).join(", ") || "Unknown";
  const album = song.album ? song.album.name : "";

  const ytQuery = encodeURIComponent(`${title} ${artist}`);
  const ytUrl = `https://www.youtube.com/results?search_query=${ytQuery}`;

  musicResult.innerHTML = `
    <a class="song-card" href="${ytUrl}" target="_blank" style="text-decoration:none;color:inherit;cursor:pointer;">
      <div class="art">🎵</div>
      <div class="info">
        <div class="title">${esc(title)}</div>
        <div class="artist">${esc(artist)}</div>
        ${album ? `<div class="album">${esc(album)}</div>` : ""}
      </div>
      <div style="color:#e94560;font-size:18px;flex-shrink:0;">▶</div>
    </a>
  `;

  // Save to history
  chrome.storage.local.get(["music_history"], (data) => {
    const history = data.music_history || [];
    history.unshift({ title, artist, album, time: Date.now() });
    if (history.length > 20) history.length = 20;
    chrome.storage.local.set({ music_history: history }, loadMusicHistory);
  });
}

// ACR config save/load
document.getElementById("acrSaveBtn").addEventListener("click", () => {
  const host = document.getElementById("acrHost").value.trim();
  const key = document.getElementById("acrKey").value.trim();
  const secret = document.getElementById("acrSecret").value.trim();
  ACR_HOST = host || ACR_HOST;
  ACR_KEY = key;
  ACR_SECRET = secret;
  chrome.storage.local.set({ acr_host: ACR_HOST, acr_key: ACR_KEY, acr_secret: ACR_SECRET });
  document.getElementById("acrSaveBtn").textContent = "Saved!";
  setTimeout(() => { document.getElementById("acrSaveBtn").textContent = "Save"; }, 1500);
});

function showAcrConfig() {
  document.getElementById("acrConfig").style.display = "";
}

document.getElementById("acrSettingsBtn").addEventListener("click", () => {
  const cfg = document.getElementById("acrConfig");
  if (cfg.style.display === "none") {
    cfg.style.display = "";
    // Load fields without the auto-hide logic
    chrome.storage.local.get(["acr_host", "acr_key", "acr_secret"], (data) => {
      document.getElementById("acrHost").value = data.acr_host || "identify-eu-west-1.acrcloud.com";
      document.getElementById("acrKey").value = data.acr_key || "";
      document.getElementById("acrSecret").value = data.acr_secret || "";
    });
  } else {
    cfg.style.display = "none";
  }
});

// Load ACR fields when music tab opens
export function loadAcrFields() {
  chrome.storage.local.get(["acr_host", "acr_key", "acr_secret"], (data) => {
    document.getElementById("acrHost").value = data.acr_host || "identify-eu-west-1.acrcloud.com";
    document.getElementById("acrKey").value = data.acr_key || "";
    document.getElementById("acrSecret").value = data.acr_secret || "";
    // Only show config if creds are missing
    if (!data.acr_key || !data.acr_secret) showAcrConfig();
    else document.getElementById("acrConfig").style.display = "none";
  });
}

export function loadMusicHistory() {
  chrome.storage.local.get(["music_history"], (data) => {
    const history = data.music_history || [];
    if (!history.length) {
      musicHistoryEl.innerHTML = "";
      return;
    }
    musicHistoryEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between"><h2>Recent</h2><button id="clearHistory" style="background:none;border:none;color:#e94560;font-size:11px;cursor:pointer;">Clear</button></div>` + history.map((h) => {
      const q = encodeURIComponent(`${h.title} ${h.artist}`);
      return `<a class="history-item" href="https://www.youtube.com/results?search_query=${q}" target="_blank" style="text-decoration:none;color:inherit;cursor:pointer;">
        <span class="h-title">${esc(h.title)}</span>
        <span class="h-artist">${esc(h.artist)}</span>
        <span style="color:#e94560;font-size:12px;flex-shrink:0;">▶</span>
      </a>`;
    }).join("");
    document.getElementById("clearHistory").addEventListener("click", () => {
      chrome.storage.local.remove("music_history", loadMusicHistory);
    });
  });
}
