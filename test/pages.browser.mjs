import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import test from 'node:test';
import { chromium } from '../.cache/pages-browser/node_modules/playwright/index.mjs';

const root=resolve('dist'), prefix='/scad-registry/';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'};
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
    const page=await context.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.goto('http://127.0.0.1:'+server.address().port+prefix);
    await page.waitForFunction(()=>document.querySelector('#status-message').hidden);
    await page.evaluate(async()=>{await document.fonts.load('400 16px Geist');await document.fonts.load('400 13px "Geist Mono"');await document.fonts.ready});
    assert.ok(await page.evaluate(()=>[...document.fonts].some(f=>f.family==='Geist'&&f.status==='loaded')));
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    assert.equal(await page.locator('.library-card').count(),registry.libraries.length);
    assert.equal(await page.locator('#updated,.catalog-meta').count(),0);
    assert.equal(await page.locator('.card-metadata .chip').count(),0);
    assert.equal(await page.locator('.card-metadata').filter({hasText:/\b\d+ versions?\b/}).count(),0);
    assert.equal(await page.locator('.details-toggle,.details-panel,.library-card [aria-expanded]').count(),0);
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
        if(width>900){
          await assertPairs(theme+' pairs at '+width);
          assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.card-documentation')].every(a=>{
            const doc=a.getBoundingClientRect(),repo=a.nextElementSibling?.getBoundingClientRect();
            return repo&&doc.right<=repo.left+1&&Math.abs(doc.top-repo.top)<=1;
          })),theme+' documentation left of repository at '+width);
        }
      }
      await page.locator('#library-search').fill('zzzz-no-library-zzzz');
      assert.equal(await page.locator('.library-card').count(),0);
      assert.ok(await page.locator('#empty-state').isVisible());
      await page.locator('#library-search').fill('');
      assert.equal(await page.locator('.library-card').count(),registry.libraries.length);
      await assertPairs(theme+' after search reset');
      await assertCardLinks();
      await page.locator('.brand').click();
      await page.screenshot({path:'registry-'+theme+'.png'});
    }
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    assert.deepEqual(errors,[]);
    await page.route('**/registry.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({...registry,libraries:[{...sorted[0],documentationUrl:null}]})}));
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#status-message').hidden);
    assert.equal(await page.locator('.library-card').count(),1);
    assert.equal(await page.locator('.card-documentation').count(),0);
    assert.equal(await page.locator('.card-repository').count(),1);
  }finally{await browser?.close();await new Promise(r=>server.close(r))}
});
