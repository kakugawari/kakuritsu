/*
 * ブラウザで実際に動かして確かめるテスト。
 *
 *   npm i -D playwright && npm run test:ui
 *
 * 画面まわりの不具合は node のテストでは捕まらない。ここでは本物の
 * ブラウザを立ち上げ、指の操作をそのまま再現して確かめる。
 *
 * ★ アプリを作ったら「ここにアプリごとの確認を足す」に書き足すこと。
 *   直した不具合には、かならず見張り役をここに置く。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const PORT = Number(process.env.PORT || 8123);
const URL = `http://localhost:${PORT}/`;
const ROOT = __dirname;
const CHROMIUM = process.env.CHROMIUM_PATH;   // 手元の Chromium を使いたいとき

let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) {
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + message);
  } else {
    failed++;
    console.log('  \x1b[31m✗ FAIL\x1b[0m ' + message);
  }
}

function skip(message) {
  console.log('  \x1b[90m- とばした: ' + message + '\x1b[0m');
}

function section(name) {
  console.log('\n' + name);
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http.get(URL, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - started > 10000) reject(new Error('サーバーが起動しない'));
          else setTimeout(tick, 100);
        });
    };
    tick();
  });
}

/**
 * 何かした直後に、その要素が本来の場所からどれだけずれるかを
 * 1 フレームずつ測る。「置いた瞬間に一瞬とぶ」たぐいの不具合はこれで見つかる。
 *
 * @returns {Promise<number>} 最大のずれ (px)
 */
function measureJump(page, selector, act) {
  return page.evaluate(async ({ sel, code }) => {
    const before = document.querySelector(sel).getBoundingClientRect();
    // eslint-disable-next-line no-new-func
    new Function(code)();
    let worst = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const el = document.querySelector(sel);
      if (!el) { worst = Infinity; break; }
      const now = el.getBoundingClientRect();
      worst = Math.max(worst, Math.abs(now.left - before.left), Math.abs(now.top - before.top));
    }
    return Math.round(worst);
  }, { sel: selector, code: act });
}

async function run() {
  let chromium;
  let devices;
  try {
    ({ chromium, devices } = require('playwright'));
  } catch (e) {
    console.error('playwright が必要です:  npm i -D playwright');
    process.exit(1);
  }

  const server = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(PORT)], {
    stdio: 'ignore'
  });
  await waitForServer();

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  try {
    // ------------------------------------------------ スマホで開く
    section('スマホで開く');
    const context = await browser.newContext({ ...devices['iPhone 14 Pro Max'] || devices['iPhone 13'] });
    const phone = await context.newPage();
    phone.on('pageerror', (e) => errors.push('スマホ: ' + e.message));
    phone.on('console', (m) => { if (m.type() === 'error') errors.push('スマホ: ' + m.text()); });
    await phone.goto(URL, { waitUntil: 'load' });
    ok(true, 'ページが開く');

    const fit = await phone.evaluate(() => ({
      wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      title: document.title.trim(),
      painted: document.body.innerText.trim().length + document.querySelectorAll('canvas, svg, img').length
    }));
    ok(fit.wide <= 1, 'スマホ幅で横スクロールが出ない');
    ok(fit.title.length > 0, `ページの名前 (title) がある (${fit.title})`);
    ok(fit.painted > 0, '画面に何か出ている (真っ白ではない)');

    // ホーム画面から開いたとき、時計や電池の帯の下まで描く指定がそろっている
    // (無いと、画面のいちばん上が theme-color の板になる。帯そのものは実機でしか見られない)
    const bar = await phone.evaluate(() => {
      const meta = (n) => (document.querySelector(`meta[name="${n}"]`) || {}).content || '';
      return {
        capable: meta('apple-mobile-web-app-capable'),
        style: meta('apple-mobile-web-app-status-bar-style'),
        cover: /viewport-fit=cover/.test(meta('viewport')),
        theme: meta('theme-color')
      };
    });
    ok(bar.capable === 'yes' && bar.style === 'black-translucent' && bar.cover,
      `ホーム画面から開くと帯の下まで描く指定がある (${JSON.stringify(bar)})`);
    ok(/^#[0-9a-f]{6}$/i.test(bar.theme), `帯の色 (theme-color) が決めてある (${bar.theme})`);

    // ------------------------------------------------ ここにアプリごとの確認を足す
    section('アプリの操作 (かくりつゲーム)');
    {
      // iPhone 16 Plus の大きさ。乱数 (crypto) は window.__r で決め打ちにする
      const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
      await ctx.addInitScript(() => {
        window.__r = null;
        const real = crypto.getRandomValues.bind(crypto);
        crypto.getRandomValues = (arr) => {
          if (window.__r === null || !(arr instanceof Uint32Array)) return real(arr);
          arr[0] = Math.floor(window.__r * 4294967296); return arr;
        };
      });
      const pg = await ctx.newPage();
      pg.on('pageerror', (e) => errors.push('操作: ' + e.message));
      await pg.goto(URL, { waitUntil: 'load' });
      const idle = () => pg.waitForFunction(() => !window.__app.busy, null, { timeout: 5000 });

      // 安全域 (上 59・下 34) を差し込んでも、いちばん下の字まで画面に収まる
      const fit = await pg.evaluate(() => {
        document.body.style.paddingTop = '59px'; document.body.style.paddingBottom = '34px';
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const out = { hint: Math.round(r('#hint').bottom), btn: Math.round(r('#spin').bottom), head: Math.round(r('header').top), h: innerHeight };
        document.body.style.paddingTop = ''; document.body.style.paddingBottom = '';
        return out;
      });
      ok(fit.head >= 59 && fit.hint <= fit.h && fit.btn <= fit.h - 34,
        `安全域を足しても上下に収まる (見出し ${fit.head} / ボタンの下 ${fit.btn} / 説明の下 ${fit.hint} / 画面 ${fit.h})`);

      // 100% ↓: 当たると 1% 下がる。まわっている間は 2 回目を受けつけない
      await pg.evaluate(() => { window.__r = 0.3; });
      await pg.locator('#spin').tap();
      await pg.locator('#wrap').tap().catch(() => {});
      await idle();
      let st = await pg.evaluate(() => ({ p: window.__app.p, streak: window.__app.streak, pct: document.getElementById('pct').textContent }));
      ok(st.p === 99 && st.streak === 1 && st.pct === '99%', `あたると 1% 下がる。続けて押しても 1 回だけ (${JSON.stringify(st)})`);

      // 玉は止まった場所 (0.3 → 108°) にいる
      const ball = await pg.evaluate(() => document.getElementById('ballG').getAttribute('transform'));
      ok(/rotate\(\s*(468|108|828|1188)(\.0+)?\s/.test(ball) || /rotate\(([\d.]+)/.test(ball) && Math.abs((+ball.match(/rotate\(([\d.]+)/)[1]) % 360 - 108) < 0.01,
        `玉が止まった場所 (108°) にいる (${ball})`);

      // はずれ (99% のとき 0.995) → おしまいの札。さいこう記録を覚える
      await pg.evaluate(() => { window.__r = 0.995; });
      await pg.locator('#spin').tap();
      await pg.waitForFunction(() => window.__app.over, null, { timeout: 5000 });
      const card = await pg.evaluate(() => {
        const b = document.querySelector('#over .card').getBoundingClientRect();
        return { lost: document.getElementById('lostAt').textContent, score: document.getElementById('score').textContent,
          best: window.__app.bests.normal, top: Math.round(b.top), bottom: Math.round(b.bottom), h: innerHeight };
      });
      ok(card.lost === '99% で はずれ' && card.score === '100%' && card.best === 100,
        `はずれると おしまい。100% までクリア・さいこう 100 (${card.lost} / ${card.score})`);
      ok(card.top >= 0 && card.bottom <= card.h, `おしまいの札が画面に収まる (${card.top}〜${card.bottom})`);
      await pg.locator('#again').tap();
      st = await pg.evaluate(() => ({ p: window.__app.p, over: window.__app.over }));
      ok(st.p === 100 && !st.over, 'もういちど で 100% から');

      // 1% ↑: はずれると 1% 上がる。あたると おしまい
      await pg.locator('.modes button[data-mode="gyaku"]').tap();
      await pg.evaluate(() => { window.__r = 0.5; });
      await pg.locator('#spin').tap();
      await idle();
      st = await pg.evaluate(() => ({ p: window.__app.p, misses: window.__app.misses }));
      ok(st.p === 2 && st.misses === 1, `1% ↑ ではずれると 2% に (${JSON.stringify(st)})`);
      await pg.evaluate(() => { window.__r = 0.001; });
      await pg.locator('#spin').tap();
      await pg.waitForFunction(() => window.__app.over, null, { timeout: 5000 });
      const g = await pg.evaluate(() => ({ lost: document.getElementById('lostAt').textContent, best: window.__app.bests.gyaku }));
      ok(g.lost === '2回目で あたり!' && g.best === 2, `2回目 (2%) で あたり。さいこう 2% (${g.lost})`);

      // 開き直しても、モードとさいこう記録が残る
      await pg.reload({ waitUntil: 'load' });
      const kept = await pg.evaluate(() => ({ mode: window.__app.mode, best: document.getElementById('best').textContent }));
      ok(kept.mode === 'gyaku' && kept.best === '2%', `開き直してもモードと記録が残る (${JSON.stringify(kept)})`);
      await ctx.close();
    }

    // ------------------------------------------------ 明るい画面・暗い画面
    section('明るい画面と暗い画面');
    for (const scheme of ['light', 'dark']) {
      const themed = await browser.newContext({ ...devices['iPhone 14 Pro Max'] || devices['iPhone 13'], colorScheme: scheme });
      const page = await themed.newPage();
      page.on('pageerror', (e) => errors.push(scheme + ': ' + e.message));
      await page.goto(URL, { waitUntil: 'load' });
      const colors = await page.evaluate(() => ({
        bg: getComputedStyle(document.body).backgroundColor,
        fg: getComputedStyle(document.body).color
      }));
      ok(colors.bg !== colors.fg, `${scheme}: 文字と背景の色が違う (${colors.bg} / ${colors.fg})`);
      await themed.close();
    }

    // ------------------------------------------------ アイコン (用意していれば)
    section('アイコン');
    const desk = await browser.newPage();
    await desk.goto(URL);
    const apple = await desk.evaluate(() =>
      document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'));
    // 対象は iPhone のホーム画面から開く使い方なので、無ければとばさずに落とす
    // (とばしにしていたら、れんだメーターでアイコンが無いまま公開した。CLAUDE.md の落とし穴)
    ok(!!apple, 'ホーム画面用のアイコン (apple-touch-icon) の指定がある');
    if (apple) {
      // iOS は SVG のアイコンを使えない
      ok(apple.endsWith('.png'), `ホーム画面用アイコンが PNG (${apple})`);
      const res = await desk.request.get(URL + apple.replace('./', ''));
      ok(res.ok(), `${apple} が配信される`);
    }

    // ------------------------------------------------ 更新とオフライン (sw.js があれば)
    section('更新とオフライン');
    if (!fs.existsSync(path.join(ROOT, 'sw.js'))) {
      skip('サービスワーカーはまだ無い (オフライン対応するときに用意する)');
    } else {
      const swCtx = await browser.newContext();
      const swPage = await swCtx.newPage();
      await swPage.goto(URL, { waitUntil: 'load' });
      ok(await swPage.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active).catch(() => false)),
        'サービスワーカーが動く');
      await swPage.waitForTimeout(800);

      // 直したものが 1 回のリロードで出るか (キャッシュ優先だと古い画面が出る)
      const indexPath = path.join(ROOT, 'index.html');
      const original = fs.readFileSync(indexPath, 'utf8');
      // 画面を JS で描くアプリもあるので、<h1> ではなく <title> を書き換えて見る
      const marker = original.match(/<title[^>]*>([^<]*)<\/title>/);
      fs.writeFileSync(indexPath, original.replace(marker[0], '<title>こうしんかくにん</title>'));
      await swPage.reload();
      await swPage.waitForTimeout(400);
      const title = await swPage.title();
      fs.writeFileSync(indexPath, original);
      ok(title.trim() === 'こうしんかくにん', `直したものが 1 回のリロードで出る (${title.trim()})`);

      await swPage.reload();
      await swPage.waitForTimeout(500);
      await swCtx.setOffline(true);
      await swPage.reload().catch(() => {});
      await swPage.waitForTimeout(400);
      // 画面が絵だけで字が無いアプリもあるので、字の量ではなくページの名前で見る (はんにんダンスで踏んだ)
      ok(await swPage.evaluate(() => document.title.length > 0 && document.body.children.length > 0).catch(() => false),
        'ネットにつながらなくても開ける');
      await swCtx.setOffline(false);
    }

    section('エラー');
    ok(errors.length === 0, errors.length ? '画面のエラー: ' + errors.join(' / ') : 'JS エラーなし');
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} 件合格 / ${failed} 件失敗`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
