const puppeteer=require('puppeteer');
(async()=>{
  const b=await puppeteer.launch({args:['--no-sandbox']});
  const pages=[['/','home'],['/erp/','erp'],['/cms/','cms'],['/it-solutions/','it'],['/cloud/','cloud'],['/terms/','terms'],['/404.html','404']];
  for(const [u,name] of pages){
    const p=await b.newPage();
    const errs=[];
    p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
    p.on('pageerror',e=>errs.push('JS: '+e.message));
    p.on('requestfailed',r=>errs.push('REQ FAIL: '+r.url()));
    await p.setViewport({width:1440,height:900,deviceScaleFactor:1});
    await p.goto('http://127.0.0.1:8099'+u,{waitUntil:'networkidle0'});
    await new Promise(r=>setTimeout(r,600));
    await p.screenshot({path:`shots/${name}.png`});
    // full height for reference
    const h=await p.evaluate(()=>document.body.scrollHeight);
    console.log(name.padEnd(7), 'height='+h, errs.length?('ERRORS: '+errs.join(' | ')):'clean');
    await p.close();
  }
  await b.close();
})();
