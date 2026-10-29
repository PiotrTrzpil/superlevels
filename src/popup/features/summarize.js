// ═══════════════════════════════════
//  AI Summarize
// ═══════════════════════════════════
import { esc } from "../lib/dom.js";
import { activeTab } from "../lib/tabs.js";

const AI_PROVIDERS = {
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o",
    signup: "https://platform.openai.com/api-keys",
    keyHint: "(sk-...)",
  },
  anthropic: {
    label: "Anthropic",
    defaultModel: "claude-opus-5-5",
    signup: "https://console.anthropic.com/settings/keys",
    keyHint: "(sk-ant-...)",
  },
  xai: {
    label: "xAI",
    defaultModel: "grok-4",
    signup: "https://console.x.ai/",
    keyHint: "(xai-...)",
  },
};

const LENGTH_PROMPTS = {
  brief: "Summarize it in 3-4 clear sentences.",
  bullets: "Summarize it as 5-8 concise bullet points, each starting with '- '.",
  detailed: "Write a detailed summary with a short intro paragraph followed by key points.",
};

const aiProviderEl = document.getElementById("aiProvider");
const aiLengthEl = document.getElementById("aiLength");
const aiKeyEl = document.getElementById("aiKey");
const aiModelEl = document.getElementById("aiModel");
const aiResultEl = document.getElementById("aiResult");
const aiConfigEl = document.getElementById("aiConfig");
const summarizeBtn = document.getElementById("summarizeBtn");

export function loadSummarize() {
  chrome.storage.local.get(["ai_provider", "ai_length"], (data) => {
    aiProviderEl.value = data.ai_provider || "openai";
    if (data.ai_length) aiLengthEl.value = data.ai_length;
    refreshAiProviderFields();
  });
}

// Populate key + model inputs and signup link for the currently selected provider
function refreshAiProviderFields() {
  const provider = aiProviderEl.value;
  const cfg = AI_PROVIDERS[provider];
  chrome.storage.local.get(
    [`ai_key_${provider}`, `ai_model_${provider}`],
    (data) => {
      const key = data[`ai_key_${provider}`] || "";
      aiKeyEl.value = key;
      aiModelEl.value = data[`ai_model_${provider}`] || cfg.defaultModel;
      document.getElementById("aiSignupLink").href = cfg.signup;
      document.getElementById("aiKeyHint").textContent = cfg.keyHint;
      // Auto-open config if no key saved for this provider yet
      aiConfigEl.style.display = key ? "none" : "block";
    }
  );
}

aiProviderEl.addEventListener("change", () => {
  chrome.storage.local.set({ ai_provider: aiProviderEl.value });
  refreshAiProviderFields();
});

aiLengthEl.addEventListener("change", () => {
  chrome.storage.local.set({ ai_length: aiLengthEl.value });
});

document.getElementById("aiSettingsBtn").addEventListener("click", () => {
  aiConfigEl.style.display = aiConfigEl.style.display === "none" ? "block" : "none";
});

document.getElementById("aiSaveBtn").addEventListener("click", () => {
  const provider = aiProviderEl.value;
  const cfg = AI_PROVIDERS[provider];
  chrome.storage.local.set(
    {
      [`ai_key_${provider}`]: aiKeyEl.value.trim(),
      [`ai_model_${provider}`]: aiModelEl.value.trim() || cfg.defaultModel,
    },
    () => {
      aiConfigEl.style.display = "none";
    }
  );
});

function showAiResult(html, cls) {
  aiResultEl.className = "ai-result show";
  aiResultEl.innerHTML = cls === "err" ? `<span class="ai-err">${html}</span>` : html;
}

// Grab the visible text of the active tab, capped to keep token use sane
function extractPageText() {
  const el = document.querySelector("main, article") || document.body;
  const text = (el.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  return { title: document.title, url: location.href, text: text.slice(0, 20000) };
}

summarizeBtn.addEventListener("click", async () => {
  const provider = aiProviderEl.value;
  const cfg = AI_PROVIDERS[provider];
  const key = aiKeyEl.value.trim();
  const model = aiModelEl.value.trim() || cfg.defaultModel;

  if (!key) {
    aiConfigEl.style.display = "block";
    showAiResult(`Add your ${cfg.label} API key first.`, "err");
    return;
  }

  summarizeBtn.disabled = true;
  showAiResult(`<span class="ai-spin">Reading page…</span>`);

  try {
    const tab = await activeTab();
    if (!tab || /^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
      throw new Error("Can't read this page. Open a normal website tab.");
    }
    const [{ result: page } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageText,
    });
    if (!page || !page.text) throw new Error("No readable text found on this page.");

    showAiResult(`<span class="ai-spin">Summarizing with ${cfg.label}…</span>`);

    const system =
      "You are a helpful assistant that summarizes web pages. Be accurate and concise. Use plain text with '- ' for bullet points.";
    const user =
      `Summarize this web page. ${LENGTH_PROMPTS[aiLengthEl.value]}\n\n` +
      `Title: ${page.title}\nURL: ${page.url}\n\n${page.text}`;

    const summary = await callAiProvider(provider, model, key, system, user);
    renderSummary(summary);
    chrome.storage.local.set({ ai_length: aiLengthEl.value });
  } catch (err) {
    showAiResult(esc(err.message || "Something went wrong."), "err");
  } finally {
    summarizeBtn.disabled = false;
  }
});

// Dispatch to the right provider API. Returns the summary text.
async function callAiProvider(provider, model, key, system, user) {
  let url, headers, body, pick;

  if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      // Required for calling the API directly from a browser/extension context
      "anthropic-dangerous-direct-browser-access": "true",
    };
    body = {
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    };
    pick = (d) => (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  } else {
    // OpenAI and xAI share the OpenAI-compatible chat completions shape
    url =
      provider === "xai"
        ? "https://api.x.ai/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
    headers = { "content-type": "application/json", Authorization: `Bearer ${key}` };
    body = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    pick = (d) => d.choices?.[0]?.message?.content || "";
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error?.type || `HTTP ${res.status}`;
    throw new Error(`${AI_PROVIDERS[provider].label}: ${msg}`);
  }
  const text = pick(data);
  if (!text) throw new Error("Empty response from provider.");
  return text.trim();
}

// Minimal safe markdown: escape, then **bold**, and '- ' bullet lists
function renderSummary(text) {
  const lines = text.split("\n");
  let html = "";
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+/.test(line);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${fmtInline(line.replace(/^[-*•]\s+/, ""))}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line) html += `<p style="margin:6px 0">${fmtInline(line)}</p>`;
    }
  }
  if (inList) html += "</ul>";
  showAiResult(`<button class="ai-copy" id="aiCopyBtn">Copy</button>${html}`);
  document.getElementById("aiCopyBtn").addEventListener("click", () => {
    navigator.clipboard.writeText(text).then(() => {
      const b = document.getElementById("aiCopyBtn");
      b.textContent = "Copied!";
      setTimeout(() => (b.textContent = "Copy"), 1500);
    });
  });
}

function fmtInline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}
