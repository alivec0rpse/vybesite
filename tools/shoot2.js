const puppeteer=require('puppeteer');
(async()=>{
  const b=await puppeteer.launch({args:['--no-sandbox']});
  for(const [u,name,sel] of [['/','home-faq','#faq'],['/cloud/','cloud-faq','#faq'],['/terms/','terms-top','main'],['/404.html','404','main']]){
    const p=await b.newPage();
    await p.setViewport({width:1440,height:900});
    await p.goto('http://127.0.0.1:8099'+u,{waitUntil:'networkidle0'});
    await p.evaluate(s=>document.querySelector(s)?.scrollIntoView(),sel);
    await new Promise(r=>setTimeout(r,900));
    await p.screenshot({path:`shots/${name}.png`});
    await p.close();
  }
  await b.close(); console.log('ok');
})();
