// Match the IDE's sticky-header offset without extra space.
const header = document.querySelector(".site-header");
const updateHeader = () => document.documentElement.style.setProperty("--header-height", header.getBoundingClientRect().height + "px");
updateHeader();
if ("ResizeObserver" in window) new ResizeObserver(updateHeader).observe(header);
else window.addEventListener("resize", updateHeader);
const searchInput = document.querySelector("#library-search");
const grid = document.querySelector("#library-grid");
const status = document.querySelector("#status-message");
const empty = document.querySelector("#empty-state");
const count = document.querySelector("#result-count");
let libraries = [];

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
}

function externalLink(url, label) {
  if (typeof url !== "string") return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:") return null;
  const link = element("a", "", label);
  link.href = parsed.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function cardFor(library) {
  const card = element("article", "library-card");

  const heading = element("div", "card-heading");
  const icon = element("div", "card-icon", (library.name || "?").trim().charAt(0).toUpperCase());
  icon.setAttribute("aria-hidden", "true");
  const nameGroup = element("div", "card-title-group");
  const title = element("h3", "card-title", library.name);
  const subtitle = element("div", "card-subtitle", library.id);
  nameGroup.append(title, subtitle);
  heading.append(icon, nameGroup);

  const description = element("p", "card-description", library.description);
  const metadata = element("div", "card-metadata");
  metadata.append(element("span", "geist-badge", library.license));
  if (library.latestVersion) {
    const latest = element("span", "geist-badge geist-badge--info", library.latestVersion);
    latest.title = "Latest stable version: " + library.latestVersion;
    metadata.append(latest);
  }
  if (library.sync && library.sync.status !== "ok") {
    metadata.append(element("span", "geist-badge geist-badge--warning", library.sync.status === "stale" ? "Cached metadata" : "Sync unavailable"));
  }

  const actions = element("div", "card-actions");
  const documentation = externalLink(library.documentationUrl, "Documentation");
  if (documentation) {
    documentation.className = "geist-button geist-button--small geist-button--text card-documentation";
    actions.append(documentation);
  }
  const repository = externalLink(library.repositoryUrl, "Repository");
  if (repository) {
    repository.className = "geist-button geist-button--small geist-button--text card-repository";
    actions.append(repository);
  }

  card.append(heading, description, metadata, element("div", "card-divider"), actions);
  return card;
}

function render() {
  const term = searchInput.value.trim().toLocaleLowerCase();
  const matches = libraries.filter((library) =>
    [library.name, library.id, library.description, library.license]
      .some((field) => String(field || "").toLocaleLowerCase().includes(term))
  );
  const fragment = document.createDocumentFragment();
  for (const library of matches) fragment.append(cardFor(library));
  grid.replaceChildren(fragment);
  empty.hidden = matches.length !== 0;
  count.textContent = matches.length === libraries.length
    ? libraries.length + (libraries.length === 1 ? " library" : " libraries")
    : matches.length + " of " + libraries.length + " libraries";
}

function showFailure(message) {
  status.hidden = false;
  status.classList.add("is-error");
  status.textContent = message;
  count.textContent = "Unavailable";
}

async function loadRegistry() {
  try {
    const response = await fetch("./registry.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const registry = await response.json();
    if (!registry || !Array.isArray(registry.libraries)) throw new Error("Unexpected registry format");
    libraries = registry.libraries
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    status.hidden = true;
    render();
  } catch (error) {
    console.error("Unable to load SCAD Registry:", error);
    showFailure("Unable to load the library catalog. Please check the Registry JSON.");
  }
}

searchInput.addEventListener("input", () => {
  if (status.hidden) render();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
  const active = document.activeElement;
  if (active && ["INPUT", "TEXTAREA"].includes(active.tagName)) return;
  event.preventDefault();
  searchInput.focus();
});

loadRegistry();
