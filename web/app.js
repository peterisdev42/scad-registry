// Progressive enhancement: all library content is in the initial HTML.
const header = document.querySelector(".site-header");
const updateHeader = () => document.documentElement.style.setProperty("--header-height", header.getBoundingClientRect().height + "px");
updateHeader();
if ("ResizeObserver" in window) new ResizeObserver(updateHeader).observe(header);
else window.addEventListener("resize", updateHeader);
const searchInput = document.querySelector("#library-search");
const cards = [...document.querySelectorAll("#library-grid > .library-card")];
const empty = document.querySelector("#empty-state");
const count = document.querySelector("#result-count");
searchInput.disabled = false;
function render() {
  const term = searchInput.value.trim().toLocaleLowerCase();
  let matches = 0;
  for (const card of cards) {
    const visible = card.dataset.search.toLocaleLowerCase().includes(term);
    card.hidden = !visible;
    if (visible) matches++;
  }
  empty.hidden = matches !== 0;
  count.textContent = matches === cards.length
    ? cards.length + (cards.length === 1 ? " library" : " libraries")
    : matches + " of " + cards.length + " libraries";
}
searchInput.addEventListener("input", render);
window.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
  const active = document.activeElement;
  if (active && (["INPUT", "TEXTAREA"].includes(active.tagName) || active.isContentEditable)) return;
  event.preventDefault();
  searchInput.focus();
});
render();
