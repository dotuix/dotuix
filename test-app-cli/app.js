/**
 * app.js
 *
 * window.__uix is injected by the dotuix viewer:
 *   __uix.data.find({ type, where?, orderBy?, limit? })
 *   __uix.data.get(id)
 *   __uix.state.find / get / insert / update / delete
 *   __uix.manifest
 */
const bridge = window.__uix ?? null;

async function main() {
  const name = bridge?.manifest?.name ?? "test-app-cli";
  document.querySelector("h1").textContent = name;
  document.getElementById("status").textContent = "Edit app.js to build your experience.";
}

main().catch(console.error);
