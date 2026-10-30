# scad-registry

Making OpenSCAD libraries easier to discover, install, and manage.

The TypeScript Registry Builder enriches the curated 29-library catalog with
installable, commit-pinned versions from GitHub and Codeberg. The generated
`dist/registry.json` is intended for the SCAD AI IDE Library Manager and is
published alongside a lightweight searchable catalog on GitHub Pages.

## Run locally

Requires Node.js 22.12 or newer and npm.

```sh
npm ci
export GITHUB_TOKEN="$(gh auth token)" # Or supply your own token through the environment.
npm run check
```

`gh` is optional; the builder reads `GITHUB_TOKEN` and never invokes the GitHub CLI
itself. Without a token, a full build can exhaust GitHub's unauthenticated API
quota. `CODEBERG_TOKEN` is optional and is sent only to Codeberg. The curated
repositories are public; private repositories and draft release metadata are
excluded from the generated registry.

| Command | Purpose |
| --- | --- |
| `npm run validate` | Validate required catalog fields, IDs, URLs and uniqueness, without network access. |
| `npm run typecheck` | Check all source and test TypeScript. |
| `npm test` | Run deterministic tests with mocked APIs, without network access. |
| `npm run build` | Fetch repository metadata, all tags and releases, then write the registry. |
| `npm run check` | Run validation, typechecking, tests and a live build. |
| `npm run validate -- --registry dist/registry.json` | Check the generated schema and verify every catalog entry and base field is present. |

Build options:

```sh
npm run build -- --input data/libraries.json --output dist/registry.json --cache-dir .cache --concurrency 3
npm run build -- --allow-partial
```

Paths are relative to the current working directory. Concurrency is restricted
to 1–3 repositories, with sequential API requests within each repository.
`dist/`, `.cache/`, and dependency directories are ignored by Git. GitHub Actions publishes the generated data and site together; local builds
still work independently of the workflow.

## Website and GitHub Pages

The website is a single responsive page built with plain HTML, CSS and JavaScript.
It fetches the generated registry from `./registry.json` and supports a simple
search, expandable library metadata, and links to repositories and documentation.
There is no client-side router or additional frontend dependency.

After generating the registry locally:

```sh
npm run build
npm run site:build
# dist/ now contains index.html, styles.css, app.js, favicon.svg, and registry.json
```

Open `dist/index.html` using a static HTTP server (not the `file://` protocol,
because the page uses `fetch` to load JSON). The `site:build` command requires
`dist/registry.json` and never modifies its contents.

To publish, go to **Settings → Pages → Build and deployment → Source** and
select **GitHub Actions**. After merging the workflow on `main`, run
**Actions → Publish SCAD Registry → Run workflow**, or push to `main`.

- Website: https://peterisdev42.github.io/scad-registry/
- JSON: https://peterisdev42.github.io/scad-registry/registry.json

The publishing workflow validates the catalog, typechecks, runs tests, fetches
fresh GitHub/Codeberg data, validates the generated registry, and deploys
`dist/` only when every step succeeds. Builds fail on incomplete synchronization;
there is no automatic partial publish and no scheduled refresh.

## Catalog and output

Maintain the six fields in `data/libraries.json`: `id`, `name`, `description`,
`repositoryUrl`, `documentationUrl`, and `license`. These curated values are
preserved in the output; upstream descriptions and licensing do not overwrite
them. The catalog is validated before any requests or output writes.

The output is a versioned envelope. This example is illustrative:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-29T10:00:00.000Z",
  "libraries": [
    {
      "id": "example-library",
      "name": "Example Library",
      "description": "An OpenSCAD library.",
      "repositoryUrl": "https://github.com/example/example-library",
      "documentationUrl": "https://github.com/example/example-library/wiki",
      "license": "MIT",
      "defaultBranch": "main",
      "archived": false,
      "versions": [
        {
          "kind": "tag",
          "tag": "v1.2.0",
          "commit": "0123456789abcdef0123456789abcdef01234567",
          "prerelease": false,
          "releaseUrl": "https://github.com/example/example-library/releases/tag/v1.2.0",
          "publishedAt": "2026-08-01T12:00:00Z",
          "downloadUrl": "https://github.com/example/example-library/archive/0123456789abcdef0123456789abcdef01234567.zip"
        }
      ],
      "latestVersion": "v1.2.0",
      "sync": {
        "status": "ok",
        "attemptedAt": "2026-10-29T10:00:00.000Z",
        "lastSuccessAt": "2026-10-29T10:00:00.000Z"
      }
    }
  ]
}
```

The runtime schemas and inferred TypeScript types are in `src/types.ts`.
Release bodies, assets, stars and forks are intentionally absent.

## Version rules

- Tags are the installable-version source. Every tag is retained, including tags
  without releases. Releases enrich matching tag names with their public URL,
  publication date and prerelease flag. Releases without an existing tag are
  excluded because they cannot identify an installable tagged version.
  Codeberg repositories that explicitly disable the releases feature skip its
  unavailable endpoint while still resolving tags or a development snapshot.
- Duplicate identical tags merge into one entry. Conflicting commits for the
  same name fail the repository sync rather than choosing an arbitrary commit.
- Every ZIP URL contains the full commit SHA from the tag API. The builder
  ignores mutable tag archive URLs and release `target_commitish` values.
- SemVer-compatible tags (including `v1.2.3`) are sorted with `semver`, descending.
  Short versions such as `v1.2`, date tags such as `2025.01`, and arbitrary names
  are preserved without coercion. They follow SemVer tags, ordered by release
  date where available, then by name as a deterministic display order.
- A public release's `prerelease` flag takes precedence. Without a release,
  SemVer tags derive this flag from the version; unrecognized tags use `null`
  because their stability is unknown. A missing release URL or date is `null`.
- `latestVersion` is the original tag of the highest stable SemVer version only
  when **every** tag is SemVer-compatible. It is `null` for mixed/unknown tag
  schemes, prerelease-only libraries, and snapshots. The consumer must not infer
  "latest" from the first entry in `versions`.
- A tagless repository gets one development snapshot resolved from the current
  default branch: `kind: "snapshot"`, `tag: null`, `branch: "main"` (or its actual
  branch), `prerelease: true`, and a full commit SHA with a pinned ZIP URL. An
  empty/unresolvable repository instead records a sync failure.

## Caching and failure behavior

The HTTP client follows pagination links and supports numbered pagination when
links are absent, retaining all pages even if a server clamps the requested page
size. Responses with ETags are reused only after a successful `304 Not Modified`
response. Cached pagination headers are retained along with response bodies.
Malformed HTTP cache entries are refetched. API calls time out after 30 seconds;
network failures, invalid JSON, transient 5xx responses and short rate limits
receive at most two retries. Long rate-limit waits fail promptly, and a forge
whose quota is exhausted stops receiving further requests for that build.

Each library reports one sync status:

| Status | Data available |
| --- | --- |
| `ok` | Freshly fetched or server-confirmed cached data. |
| `stale` | Last successful versions and repository metadata, plus the current curated base fields, original `lastSuccessAt`, and sync error. |
| `error` | Base fields and error only; no successful history exists for this library/repository pair. `versions` is empty and repository metadata is `null`. |

A failed repository is never dropped from the catalog. A failure in any page or
endpoint fails that repository sync as a whole; incomplete new results do not
replace its last successful versions. Previous output and `.cache/registry.json`
provide fallback data; the newer registry is preferred. Keep the cache to retain
fallback data when cleaning `dist/`. Changing a library's repository URL prevents
reuse of another repository's versions. Damaged previous registries stop the
build before overwriting output, so they can be inspected or restored.

The builder validates the full output before writing it and replaces each JSON
file atomically. When any sync fails, it still writes all libraries and returns
exit code **1**. `--allow-partial` explicitly permits exit code **0** with failed
syncs. Validation/configuration errors always return nonzero. When deploying
later, upload `dist/` only after a successful `npm run check`, and preserve
`.cache/` across builds to enable ETags and last-success fallback.

API contracts: [GitHub repository tags](https://docs.github.com/en/rest/repos/repos#list-repository-tags),
[GitHub releases](https://docs.github.com/en/rest/releases/releases#list-releases),
[GitHub pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api),
[GitHub conditional requests](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate),
and [Codeberg's live Forgejo API specification](https://codeberg.org/swagger.v1.json).
