// ═══════════════════════════════════
//  DOM helpers shared by the popup features
// ═══════════════════════════════════
export function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
export function escA(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
