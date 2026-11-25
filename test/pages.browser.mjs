import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import test from 'node:test';
import { chromium } from '../.cache/pages-browser/node_modules/playwright/index.mjs';

const root=resolve('dist'), prefix='/scad-registry/';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'};
test('Registry published page: shared theme, links, catalog, search and details', {timeout:90000}, async()=>{
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
      }
      const first=page.locator('.library-card').first(), toggle=first.locator('.details-toggle');
      await toggle.click(); assert.equal(await toggle.getAttribute('aria-expanded'),'true');
      assert.ok(await first.locator('.details-panel').isVisible());
      await toggle.click(); assert.equal(await toggle.getAttribute('aria-expanded'),'false');
      await page.locator('#library-search').fill('zzzz-no-library-zzzz');
      assert.equal(await page.locator('.library-card').count(),0);
      assert.ok(await page.locator('#empty-state').isVisible());
      await page.locator('#library-search').fill('');
      assert.equal(await page.locator('.library-card').count(),registry.libraries.length);
      await page.locator('.brand').click();
      await page.screenshot({path:'registry-'+theme+'.png'});
    }
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(r=>server.close(r))}
});
