const searchInput = document.querySelector("#library-search");
const grid = document.querySelector("#library-grid");
const status = document.querySelector("#status-message");
const empty = document.querySelector("#empty-state");
const count = document.querySelector("#result-count");
const updated = document.querySelector("#updated");
let libraries = [];

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
}

function externalLink(url, label) {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return null;
  const link = element("a", "", label);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function addDetail(container, label, value) {
  if (value === null || value === undefined || value === "") return;
  const row = element("div", "details-row");
  row.append(element("span", "details-label", label), element("span", "details-value", value));
  container.append(row);
}

function cardFor(library) {
  const versions = Array.isArray(library.versions) ? library.versions : [];
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
  metadata.append(element("span", "chip", library.license));
  if (library.latestVersion) {
    metadata.append(element("span", "chip chip-version", library.latestVersion));
  }
  metadata.append(element("span", "chip", versions.length + (versions.length === 1 ? " version" : " versions")));
  if (library.sync && library.sync.status !== "ok") {
    metadata.append(element("span", "chip chip-warn", library.sync.status === "stale" ? "Cached metadata" : "Sync unavailable"));
  }

  // The expandable panel follows the action row so opening it never moves
  // the Repository link away from the Show details control.
  const details = element("div", "details-panel");
  details.id = "library-details-" + library.id;
  details.hidden = true;
  const content = element("div", "details-content");
  content.append(element("p", "", library.description));
  addDetail(content, "License", library.license);
  addDetail(content, "Default branch", library.defaultBranch);
  if (library.latestVersion) addDetail(content, "Latest stable", library.latestVersion);
  if (library.documentationUrl) {
    const row = element("div", "details-row");
    row.append(element("span", "details-label", "Documentation"));
    const docs = externalLink(library.documentationUrl, "Open docs ↗");
    if (docs) row.append(docs);
    content.append(row);
  }
  if (versions.length) {
    const versionTitle = element("div", "details-label", "Available versions");
    const tags = element("div", "version-tags");
    for (const version of versions.slice(0, 8)) {
      const label = version.tag || (version.kind === "snapshot" ? "Development snapshot" : "Unknown version");
      tags.append(element("span", "version-tag", label));
    }
    if (versions.length > 8) tags.append(element("span", "version-tag", "+" + (versions.length - 8) + " more"));
    content.append(versionTitle, tags);
  } else {
    content.append(element("div", "details-label", "No indexed versions are available."));
  }
  details.append(content);

  const actions = element("div", "card-actions");
  const toggle = element("button", "details-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-controls", details.id);
  toggle.setAttribute("aria-expanded", "false");
  const toggleLabel = element("span", "", "Show details");
  toggle.append(toggleLabel);
  toggle.addEventListener("click", () => {
    const opening = details.hidden;
    details.hidden = !opening;
    toggle.setAttribute("aria-expanded", String(opening));
    toggleLabel.textContent = opening ? "Hide details" : "Show details";
  });
  actions.append(toggle);
  const repository = externalLink(library.repositoryUrl, "Repository ↗");
  if (repository) actions.append(repository);

  card.append(heading, description, metadata, element("div", "card-divider"), actions, details);
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
    if (registry.generatedAt && Number.isFinite(Date.parse(registry.generatedAt))) {
      const when = new Date(registry.generatedAt);
      updated.textContent = "Updated " + new Intl.DateTimeFormat("en", {
        year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
      }).format(when) + " (UTC)";
    }
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
