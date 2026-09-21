/* Nav dropdown state machine: one panel at a time, click pins. node tools/shoot-nav2.js */
const puppeteer = require('puppeteer');

(async () => {
  const b = await puppeteer.launch({ protocolTimeout: 120000 });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto('http://localhost:8099/', { waitUntil: 'networkidle0' });

  // Panels counted as "shown" by computed visibility, so a fading-out panel
  // that still overlaps its neighbour is caught rather than missed.
  const shown = () =>
    p.evaluate(() =>
      [...document.querySelectorAll('.primary-nav .nav-group')]
        .filter((g) => getComputedStyle(g.querySelector('.nav-panel')).visibility === 'visible')
        .map((g) => g.querySelector('button').textContent.trim().split('\n')[0])
    );
  const aria = () =>
    p.evaluate(() =>
      [...document.querySelectorAll('.primary-nav .nav-group button')]
        .map((btn) => btn.textContent.trim().split('\n')[0] + '=' + btn.getAttribute('aria-expanded'))
        .join(' ')
    );
  const btn = async (i) => (await p.$$('.primary-nav .nav-group > button'))[i];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const check = async (label, expected) => {
    const s = await shown();
    const ok = JSON.stringify(s) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + label, '->', JSON.stringify(s), ok ? '' : 'expected ' + JSON.stringify(expected));
    return ok;
  };

  let pass = true;

  await (await btn(0)).hover();
  await wait(300);
  pass &= await check('hover Technology', ['Technology']);

  // The overlap case: sampled mid-transition, 60ms after the pointer moves.
  await (await btn(2)).hover();
  await wait(60);
  pass &= await check('mid-move to Legal (60ms)', ['Legal']);
  await wait(300);
  pass &= await check('settled on Legal', ['Legal']);
  await p.screenshot({ path: 'shots/nav-one-at-a-time.png', clip: { x: 0, y: 0, width: 1440, height: 420 } });

  // Click to pin, then take the pointer right away from the navbar.
  await (await btn(0)).click();
  await p.mouse.move(700, 800);
  await wait(300);
  pass &= await check('clicked Technology, pointer moved away', ['Technology']);
  console.log('      aria:', await aria());
  await p.screenshot({ path: 'shots/nav-pinned.png', clip: { x: 0, y: 0, width: 1440, height: 420 } });

  // Hovering another group releases the pin.
  await (await btn(1)).hover();
  await wait(300);
  pass &= await check('hover Printing while Technology pinned', ['Printing']);
  await p.mouse.move(700, 800);
  await wait(300);
  pass &= await check('pointer away again (pin released)', []);

  // Click the same trigger twice: open, then shut, with focus still on it.
  await (await btn(1)).click();
  await p.mouse.move(700, 800);
  await wait(250);
  pass &= await check('clicked Printing', ['Printing']);
  await (await btn(1)).click();
  await wait(250);
  pass &= await check('clicked Printing again (toggles shut)', []);
  console.log('      aria:', await aria());

  // Keyboard: focus opens, Escape closes and keeps focus on the trigger.
  await p.mouse.move(700, 800);
  await p.evaluate(() => document.querySelectorAll('.primary-nav .nav-group button')[2].focus());
  await wait(250);
  pass &= await check('keyboard focus on Legal', ['Legal']);
  await p.keyboard.press('Escape');
  await wait(250);
  pass &= await check('Escape', []);
  console.log(
    '      focus kept on trigger:',
    await p.evaluate(() => document.activeElement.textContent.trim().split('\n')[0])
  );

  await b.close();
  console.log(pass ? '\nall nav states correct' : '\nSOME STATES WRONG');
  process.exit(pass ? 0 : 1);
})();
