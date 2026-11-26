import type { Registry } from './types.js';

export const BASE = 'https://peterisdev42.github.io/scad-registry/';
export const IDE = 'https://peterisdev42.github.io/scad-ai-ide/';
export const SOURCE = 'https://github.com/peterisdev42/scad-registry';
export const DESCRIPTION = 'Discover curated OpenSCAD libraries, compare licenses and latest stable versions, and access commit-pinned library metadata for SCAD AI IDE and other tools.';
type Library = Omit<Registry['libraries'][number], 'documentationUrl'> & { documentationUrl?: string | null };
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const e=escapeHtml;
const absolute = (path: string) => new URL(path, BASE).href;
const https = (value: string | null | undefined) => {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
};
export function sortedLibraries(registry: Registry) {
  return registry.libraries.slice().sort((a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'}));
}
function link(url: string | null | undefined,label: string,cls: string) {
  const href=https(url);
  return href ? '<a class="geist-button geist-button--small '+cls+'" href="'+e(href)+'" target="_blank" rel="noopener noreferrer">'+e(label)+'</a>' : '';
}
export function libraryCard(library: Library): string {
  const badges='<span class="geist-badge">'+e(library.license)+'</span>'+
    (library.latestVersion ? '<span class="geist-badge geist-badge--info" title="'+e('Latest stable version: '+library.latestVersion)+'">'+e(library.latestVersion)+'</span>' : '')+
    (library.sync.status!=='ok' ? '<span class="geist-badge geist-badge--warning">'+(library.sync.status==='stale'?'Cached metadata':'Sync unavailable')+'</span>' : '');
  const search=[library.name,library.id,library.description,library.license].join(' ');
  return '<article class="library-card" id="library-'+e(library.id)+'" data-search="'+e(search)+'">'+
    '<div class="card-heading"><h3 class="card-title">'+e(library.name)+'</h3><div class="card-subtitle">'+e(library.id)+'</div></div>'+
    '<p class="card-description">'+e(library.description)+'</p><div class="card-divider"></div>'+
    '<div class="card-footer"><div class="card-metadata">'+badges+'</div><div class="card-actions">'+
    link(library.documentationUrl,'Documentation','card-documentation')+link(library.repositoryUrl,'Repository','card-repository')+
    '</div></div></article>';
}
export const FAQ = [
  ['What is SCAD Registry?', 'SCAD Registry is an independent, open-source catalog of OpenSCAD libraries. It combines curated descriptions, licenses and upstream links with version metadata from GitHub and Codeberg.'],
  ['How do I install an OpenSCAD library?', 'SCAD Registry provides metadata, not an installer. Use SCAD AI IDE Library Manager or another compatible tool to install a selected version, or follow the upstream library documentation.'],
  ['How is the latest stable version selected?', 'The latestVersion field is populated only when all tags are SemVer-compatible and a stable SemVer version exists. Mixed or unknown tag schemes, prerelease-only libraries and tagless snapshots may have no latestVersion. Never infer the latest version from the first array item.'],
  ['Are download URLs reproducible?', 'Indexed downloads point to ZIP archives identified by the full upstream commit SHA, not a mutable branch or tag name. A tagless repository can have a development snapshot of its default branch. A pinned commit identifies source, not a guarantee that an upstream archive remains available forever.'],
  ['Is this an official OpenSCAD package registry?', 'No. SCAD Registry is an independent community project. It is not affiliated with OpenSCAD or Microsoft. Individual libraries keep their own upstream licenses.'],
  ['Does the registry resolve dependencies or verify compatibility?', 'No. It indexes library and version metadata; it does not install software, resolve transitive dependencies, certify compatibility or run library tests. Consult upstream documentation before use.'],
] as const;
function md(value:string) { return value.replace(/[\\`*_\[\]<>]/g,'\\$&').replace(/\r?\n/g,' '); }
export function buildDiscovery(registry: Registry) {
  const libraries=sortedLibraries(registry);
  const faqHtml=FAQ.map(([q,a])=>'<details class="geist-collapse"><summary><span class="geist-collapse-title">'+e(q)+'</span><span class="geist-collapse-indicator" aria-hidden="true"></span></summary><p>'+e(a)+'</p></details>').join('\n');
  const graph={
    '@context':'https://schema.org',
    '@graph':[
      {'@type':'WebSite','@id':BASE+'#website',url:BASE,name:'SCAD Registry',description:DESCRIPTION,inLanguage:'en'},
      {'@type':'CollectionPage','@id':BASE+'#page',url:BASE,name:'SCAD Registry — OpenSCAD Library Catalog',description:DESCRIPTION,isPartOf:{'@id':BASE+'#website'},mainEntity:{'@id':BASE+'#dataset'},inLanguage:'en'},
      {'@type':'Dataset','@id':BASE+'#dataset',name:'SCAD Registry OpenSCAD Library Metadata',description:DESCRIPTION,url:BASE+'#libraries',identifier:absolute('registry.json'),keywords:['OpenSCAD','OpenSCAD libraries','library metadata','parametric CAD','SCAD AI IDE'],creator:{'@type':'Organization',name:'SCAD Registry project',url:SOURCE},dateModified:registry.generatedAt,version:String(registry.schemaVersion),distribution:{'@type':'DataDownload',encodingFormat:'application/json',contentUrl:absolute('registry.json')},isAccessibleForFree:true,measurementTechnique:'Curated library metadata enriched with public GitHub and Codeberg tags, releases and commit-pinned archives.',variableMeasured:['Library name','License','Repository URL','Documentation URL','Version tag','Commit SHA','Download URL','Synchronization status'],mainEntityOfPage:{'@id':BASE+'#page'}},
      {'@type':'ItemList','@id':BASE+'#catalog',name:'OpenSCAD library catalog',numberOfItems:libraries.length,itemListElement:libraries.map((lib,i)=>({'@type':'ListItem',position:i+1,item:{'@type':'SoftwareSourceCode','@id':BASE+'#library-'+lib.id,name:lib.name,description:lib.description,url:BASE+'#library-'+lib.id,codeRepository:lib.repositoryUrl,programmingLanguage:'OpenSCAD',...(https(lib.documentationUrl)?{subjectOf:{'@type':'CreativeWork',name:lib.name+' documentation',url:lib.documentationUrl}}:{}),...(lib.latestVersion?{version:lib.latestVersion}:{})}}))}
    ]
  };
  const jsonLd=JSON.stringify(graph).replace(/</g,'\\u003c');
  const llms='# SCAD Registry\n\n> '+DESCRIPTION+'\n\nIndependent open-source project; not affiliated with OpenSCAD or Microsoft. The registry indexes metadata, not verified compatibility or transitive dependencies.\n\n## Core resources\n\n- [Library catalog]('+BASE+'#libraries): '+libraries.length+' indexed libraries; static HTML with upstream links.\n- [Registry JSON]('+absolute('registry.json')+'): Authoritative machine-readable schema version '+registry.schemaVersion+'; tags, commits, download URLs and sync status.\n- [Complete catalog and API guide]('+absolute('llms-full.txt')+'): Plain-text library summaries, licensing, source links and interpretation rules.\n- [API and limitations]('+BASE+'#registry-api): How to use pinned metadata.\n- [FAQ]('+BASE+'#faq): Common questions.\n- [Source and version rules]('+SOURCE+'): Builder, schema and license.\n- [SCAD AI IDE]('+IDE+'): Companion IDE with Library Manager.\n\n## Optional\n\n- [Schema]('+SOURCE+'/blob/main/src/types.ts): Runtime validation definitions.\n- [Curated catalog source]('+SOURCE+'/blob/main/data/libraries.json): Original descriptions and license identifiers.\n\nllms.txt is an optional discovery convention, not a search ranking prerequisite.\n';
  const full='# SCAD Registry — Catalog and API Guide\n\n'+DESCRIPTION+'\n\nCanonical: '+BASE+'\nRegistry JSON: '+absolute('registry.json')+'\nSchema version: '+registry.schemaVersion+'\nGenerated at (UTC): '+registry.generatedAt+'\nLibrary count: '+libraries.length+'\n\n## API and interpretation\n\n'+FAQ.map(([q,a])=>'### '+q+'\n\n'+a+'\n').join('\n')+'\nThe JSON envelope contains schemaVersion, generatedAt and libraries. Library entries include id, name, description, repositoryUrl, documentationUrl, license, defaultBranch, archived, versions, latestVersion and sync. Versions contain kind, tag (null for snapshots), commit, prerelease, releaseUrl, publishedAt and downloadUrl; snapshots also include branch. sync.status is ok, stale or error. Stale means last successful metadata, error means no successful history. Check timestamps and sync status before relying on versions. The JSON is the source of truth for exact commit SHAs and available downloads. The curated license field is not legal certification; verify upstream licensing.\n\n## Libraries\n\n'+libraries.map(lib=>'### '+md(lib.name)+'\n\n- Registry ID: '+lib.id+'\n- Description: '+md(lib.description)+'\n- License: '+md(lib.license)+'\n- Latest stable: '+(lib.latestVersion?md(lib.latestVersion):'Not determined')+'\n- Sync status: '+lib.sync.status+'\n- Catalog: '+BASE+'#library-'+lib.id+'\n- Repository: '+lib.repositoryUrl+'\n- Documentation: '+lib.documentationUrl+'\n').join('\n')+'\n## Sources\n\n- '+SOURCE+'\n- '+IDE+'\n- https://openscad.org/libraries.html\n';
  return {cards:libraries.map(libraryCard).join('\n'),count:libraries.length+' '+(libraries.length===1?'library':'libraries'),faqHtml,jsonLd,llms,full,sitemap:'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>'+BASE+'</loc></url></urlset>\n'};
}
