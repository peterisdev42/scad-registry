import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import test from 'node:test';
import { chromium } from '../.cache/pages-browser/node_modules/playwright/index.mjs';

const root=resolve('dist'), prefix='/scad-registry/';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json','.txt':'text/plain','.xml':'application/xml','.png':'image/png'};
test('Registry published page: shared theme, links, static cards and search', {timeout:90000}, async()=>{
  const registry=JSON.parse(await readFile(resolve(root,'registry.json'),'utf8'));
  const server=createServer(async(req,res)=>{
    try{
      const path=new URL(req.url,'http://localhost').pathname;
      if(!path.startsWith(prefix)){res.writeHead(404).end();return}
      const file=resolve(root,decodeURIComponent(path.slice(prefix.length))||'index.html');
      if(!file.startsWith(root+sep)){res.writeHead(403).end();return}
      const data=await readFile(file);
      res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'}).end(data);
    }catch{res.writeHead(404).end()}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try{
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:960},colorScheme:'dark'});
    await context.route('https://cloud.umami.is/script.js',route=>route.fulfill({contentType:'application/javascript',body:'/* Analytics stub for CI */'}));
    const page=await context.newPage(), errors=[], requests=[];
    page.on('request',request=>requests.push(request.url()));
    page.on('pageerror',e=>errors.push(String(e)));
    await page.goto('http://127.0.0.1:'+server.address().port+prefix);
    await page.waitForFunction(()=>!document.querySelector('#library-search').disabled);
    await page.evaluate(async()=>{await document.fonts.load('400 16px Geist');await document.fonts.load('400 13px "Geist Mono"');await document.fonts.ready});
    assert.ok(await page.evaluate(()=>[...document.fonts].some(f=>f.family==='Geist'&&f.status==='loaded')));
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    assert.equal(await page.locator('.library-card').count(),registry.libraries.length);
    assert.equal(await page.locator('#updated,.catalog-meta').count(),0);
    assert.equal(await page.locator('.card-metadata .chip').count(),0);
    assert.equal(await page.locator('.card-metadata').filter({hasText:/\b\d+ versions?\b/}).count(),0);
    assert.equal(await page.locator('.details-toggle,.details-panel,.library-card [aria-expanded],.card-icon').count(),0);
    assert.equal(await page.locator('.card-footer > .card-metadata + .card-actions').count(),registry.libraries.length);
    assert.equal(await page.locator('.library-card').filter({hasText:/Default branch|Available versions|Show details|Hide details/}).count(),0);
    const sorted=registry.libraries.slice().sort((a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'}));
    const assertCardLinks=async()=>{
      const cards=await page.locator('.library-card').evaluateAll(nodes=>nodes.map(card=>({
        id:card.querySelector('.card-subtitle').textContent,
        description:card.querySelector('.card-description').textContent,
        clamp:getComputedStyle(card.querySelector('.card-description')).webkitLineClamp,
        links:[...card.querySelectorAll('.card-actions a')].map(a=>({label:a.textContent,href:a.href,rel:a.rel,target:a.target})),
      })));
      assert.equal(cards.length,sorted.length);
      for(let i=0;i<cards.length;i++){
        const library=sorted[i],card=cards[i];
        assert.equal(card.id,library.id);
        assert.equal(card.description,library.description);
        assert.equal(card.clamp,'none');
        const expected=[];
        if(library.documentationUrl&&new URL(library.documentationUrl).protocol==='https:')expected.push({label:'Documentation',href:new URL(library.documentationUrl).href});
        expected.push({label:'Repository',href:new URL(library.repositoryUrl).href});
        assert.deepEqual(card.links.map(({label,href})=>({label,href})),expected,library.id);
        assert.ok(card.links.every(l=>l.target==='_blank'&&l.rel==='noopener noreferrer'));
      }
    };
    await assertCardLinks();
    const assertFooterLayout=async(label)=>{
      const issues=await page.evaluate(()=>{
        const issues=[], near=(a,b,t=1.5)=>Math.abs(a-b)<=t;
        for(const card of document.querySelectorAll('.library-card')){
          const footer=card.querySelector('.card-footer');
          const metadata=card.querySelector('.card-metadata');
          const actions=card.querySelector('.card-actions');
          const fr=footer.getBoundingClientRect(),mr=metadata.getBoundingClientRect(),ar=actions.getBoundingClientRect();
          const id=card.querySelector('.card-subtitle').textContent;
          if(!near(mr.left,fr.left)||!near(ar.right,fr.right))issues.push(id+' footer edges');
          const gap=parseFloat(getComputedStyle(footer).columnGap);
          if(mr.width+ar.width+gap<=fr.width-1 && !near((mr.top+mr.bottom)/2,(ar.top+ar.bottom)/2,2))issues.push(id+' footer not centered on one row');
          for(const button of actions.querySelectorAll('a')){
            const style=getComputedStyle(button),rect=button.getBoundingClientRect();
            const range=document.createRange();range.selectNodeContents(button);
            const text=range.getBoundingClientRect();
            // CSS blockifies inline-flex children of a flex container to flex.
            // Both computed forms preserve the same inner flex layout.
            if(!['flex','inline-flex'].includes(style.display)||style.alignItems!=='center'||style.justifyContent!=='center'||style.textAlign!=='center')issues.push({id,button:button.textContent,display:style.display,alignItems:style.alignItems,justifyContent:style.justifyContent,textAlign:style.textAlign});
            if(!near((rect.left+rect.right)/2,(text.left+text.right)/2,2)||!near((rect.top+rect.bottom)/2,(text.top+text.bottom)/2,3))issues.push(id+' '+button.textContent+' text not centered');
            if(rect.left<fr.left-1||rect.right>fr.right+1)issues.push(id+' button overflow');
          }
        }
        return issues;
      });
      assert.deepEqual(issues,[],label);
    };
    const assertPairs=async(label)=>{
      const issues=await page.evaluate(()=>{
        const cards=[...document.querySelectorAll('.library-card')], problems=[];
        for(let i=0;i+1<cards.length;i+=2){
          const a=cards[i].getBoundingClientRect(),b=cards[i+1].getBoundingClientRect();
          if(Math.abs(a.top-b.top)>1||Math.abs(a.height-b.height)>1)problems.push({pair:i/2,first:a.height,second:b.height});
          const aa=cards[i].querySelector('.card-actions').getBoundingClientRect();
          const ba=cards[i+1].querySelector('.card-actions').getBoundingClientRect();
          if(Math.abs(aa.bottom-ba.bottom)>1)problems.push({pair:i/2,actions:[aa.bottom,ba.bottom]});
        }
        return problems;
      });
      assert.deepEqual(issues,[],label);
    };
    assert.equal(await page.locator('.main-nav a[href="https://peterisdev42.github.io/scad-ai-ide/"]').count(),1);
    assert.equal(await page.locator('head link[rel="stylesheet"]').count(),1);
    for(const theme of ['light','dark']){
      if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('[data-theme-toggle]').click();
      assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),theme==='light'?'rgb(255, 255, 255)':'rgb(0, 0, 0)');
      for(const width of [320,390,680,768,900,1024,1440]){
        await page.setViewportSize({width,height:960});
        await page.waitForFunction(()=>Math.abs(parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)-document.querySelector('.site-header').getBoundingClientRect().height)<=1);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),theme+' overflow at '+width);
        await page.locator('.main-nav a[href="#libraries"]').click();
        assert.ok(await page.evaluate(()=>Math.abs(document.getElementById('libraries').getBoundingClientRect().top-document.querySelector('.site-header').getBoundingClientRect().bottom)<=1),theme+' anchor alignment at '+width);
        await assertFooterLayout(theme+' footer at '+width);
        if(width>900){
          await assertPairs(theme+' pairs at '+width);
          assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.card-documentation')].every(a=>{
            const doc=a.getBoundingClientRect(),repo=a.nextElementSibling?.getBoundingClientRect();
            return repo&&doc.right<=repo.left+1&&Math.abs(doc.top-repo.top)<=1;
          })),theme+' documentation left of repository at '+width);
        }
      }
      await page.locator('#library-search').fill('zzzz-no-library-zzzz');
      assert.equal(await page.locator('.library-card:visible').count(),0);
      assert.ok(await page.locator('#empty-state').isVisible());
      await page.locator('#library-search').fill('');
      assert.equal(await page.locator('.library-card').count(),registry.libraries.length);
      await assertPairs(theme+' after search reset');
      await assertCardLinks();
      await assertFooterLayout(theme+' footer after search reset');
      await page.locator('.brand').click();
      await page.screenshot({path:'registry-'+theme+'.png'});
    }
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    assert.deepEqual(errors,[]);
    assert.ok(!requests.some(url=>url.endsWith('/registry.json')),'catalog must not require runtime JSON fetch');
    const plain=await browser.newContext({javaScriptEnabled:false});
    const noJs=await plain.newPage();
    await noJs.goto('http://127.0.0.1:'+server.address().port+prefix);
    assert.equal(await noJs.locator('.library-card:visible').count(),registry.libraries.length);
    assert.equal(await noJs.locator('.card-repository').count(),registry.libraries.length);
    assert.ok(await noJs.locator('#library-search').isDisabled());
    assert.equal(await noJs.locator('#faq details').count(),8);
    assert.equal(await noJs.locator('#scad-ai-ide').count(),1);
    assert.equal(await noJs.locator('.hero-ctas a.geist-button--primary').first().getAttribute('href'),'https://peterisdev42.github.io/scad-ai-ide/');
    await noJs.locator('#faq summary').first().click();
    assert.ok(await noJs.locator('#faq details').first().getAttribute('open')!==null);
    for(const path of ['llms.txt','llms-full.txt','sitemap.xml','registry.json','assets/og-card.png']){
      const response=await plain.request.get('http://127.0.0.1:'+server.address().port+prefix+path);
      assert.equal(response.status(),200,path);
    }
    await plain.close();
  }finally{await browser?.close();await new Promise(r=>server.close(r))}
});
