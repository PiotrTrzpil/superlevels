// ═══════════════════════════════════
//  Picture-in-Picture
// ═══════════════════════════════════

const pipBtn = document.getElementById("pipBtn");
const pipLabel = document.getElementById("pipLabel");
const pipStatus = document.getElementById("pipStatus");

pipBtn.addEventListener("click", enterPiP);

export async function enterPiP() {
  pipStatus.textContent = "";
  pipStatus.className = "pip-status";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    pipStatus.textContent = "No active tab";
    pipStatus.className = "pip-status err";
    return;
  }

  try {
    const result = await chrome.runtime.sendMessage({ type: "pip", tabId: tab.id });
    if (!result) {
      pipStatus.textContent = "Could not access page";
      pipStatus.className = "pip-status err";
    } else if (result.error) {
      pipStatus.textContent = result.error;
      pipStatus.className = "pip-status err";
    } else if (result.action === "entered") {
      pipStatus.textContent = "Video in Picture-in-Picture";
      pipStatus.className = "pip-status ok";
      pipBtn.classList.add("active");
    } else if (result.action === "exited") {
      pipStatus.textContent = "Exited Picture-in-Picture";
      pipStatus.className = "pip-status ok";
      pipBtn.classList.remove("active");
    }
  } catch (err) {
    pipStatus.textContent = err.message;
    pipStatus.className = "pip-status err";
  }
}
