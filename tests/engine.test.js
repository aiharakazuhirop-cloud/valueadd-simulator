// 計算エンジンの検算テスト。実行：node --test tests/
// 期待値は、コードの式を使わずに手計算した値（コメントに計算式）か、
// 変更前のコードで記録した値（fixtures/v6-results.json）と突き合わせる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./load-engine');
const E = loadEngine();

const clone = o => JSON.parse(JSON.stringify(o));
// vm で読み込んだ配列・オブジェクトは別の実行環境のものなので、比較前に通常の値へ変換する
const plain = clone;
const v6Default = require('./fixtures/v6-default-state.json');
const v6Custom = require('./fixtures/v6-custom-state.json');
const v6Results = require('./fixtures/v6-results.json');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} 期待 ${b} / 実際 ${a}`);

// 新規利用者の初期状態に相当する入力（v6 の初期値＋自動モード）
function autoState(bldPatch = {}, patch = {}) {
  const st = clone(v6Default);
  st.bld = { ...clone(E.BLD_DEF), ...bldPatch };
  return { ...st, ...patch };
}
const nra = units => units.reduce((a, u) => a + u.n * u.area, 0);

// ---------- 汎用の財務関数 ----------
test('IRR：[-100, 110] は 10%', () => {
  near(E.irr([-100, 110]), 0.10, 1e-9);
});
test('IRR：[-100, 0, 121] は 10%', () => {
  near(E.irr([-100, 0, 121]), 0.10, 1e-9);
});
test('元利均等の年返済額：1000万円・2%・30年 ＝ 44.6499万円（Excel PMT と同値）', () => {
  near(E.annuity(1000, 0.02, 30), 44.64992, 1e-4);
});

// ---------- 自動モードの専有面積 ----------
test('自動：延床1,210㎡・地上8階・75% → 各階 34.31484375坪', () => {
  // 1210 × 0.3025 = 366.025坪、÷ 8 = 45.753125坪、× 0.75 = 34.31484375坪
  const a = E.autoAreas(autoState());
  near(a.gross, 45.753125, 1e-9, '1階あたり延床');
  near(a.per, 34.31484375, 1e-9, '1階あたり専有');
});

test('自動：区画は 1F 店舗 34.31坪 ＋ 2〜8F オフィス 7階 × 34.31坪', () => {
  const u = E.genUnits(autoState());
  assert.deepEqual(plain(u.map(x => [x.name, x.n])), [['店舗 1F', 1], ['オフィス 2〜8F', 7]]);
  near(u[0].area, 34.31484375, 1e-9);
  near(u[1].area, 34.31484375, 1e-9);
  near(nra(u), 274.51875, 1e-9, '専有合計（366.025 × 0.75）');
});

test('自動：改修後の満室賃料 ＝ 4,220.73万円/年（手計算）', () => {
  // (7 × 34.31484375 × 12,500 ＋ 34.31484375 × 15,000) ÷ 10,000 × 12 ＝ 4,220.7258…万円
  const r = E.model(autoState());
  near(r.gprPost, 4220.72578125, 1e-6);
});

test('自動：地下2階（店舗）を足すと総階数10で割る', () => {
  // 366.025 ÷ 10 × 0.75 ＝ 27.451875坪/階、専有合計 ＝ 27.451875 × 10 ＝ 274.51875坪
  const st = autoState({ bFloors: 2, bUse: 'retail' });
  near(E.autoAreas(st).per, 27.451875, 1e-9);
  const u = E.genUnits(st);
  assert.equal(u[0].name, '店舗 B1〜B2F');
  assert.equal(u[0].n, 2);
  near(nra(u), 274.51875, 1e-9);
});

test('自動：地下「賃貸なし」は延床・階数に含めるが専有はゼロ', () => {
  // 366.025 ÷ 9 × 0.75 ＝ 30.502083…坪/階、賃貸階は地上8階のみ → 244.016666…坪
  // レンタブル比（結果）＝ 0.75 × 8/9 ＝ 66.67%
  const st = autoState({ bFloors: 1, bUse: 'none' });
  const r = E.model(st);
  near(r.nraT, 244.01666666666668, 1e-9);
  near(r.nraT / r.gfaT, 0.75 * 8 / 9, 1e-12);
  assert.ok(!r.units.some(u => /B1/.test(u.name)));
});

test('自動：1階「なし（共用部のみ）」は専有ゼロ', () => {
  // 7 × 34.31484375 ＝ 240.20390625坪
  const r = E.model(autoState({ f1use: 'none' }));
  near(r.nraT, 240.20390625, 1e-9);
});

test('自動：想定レンタブル比の物件タイプ別初期値は オフィス75%・住宅80%・複合75%', () => {
  assert.deepEqual([...E.RR_DEF], [75, 80, 75]);
  assert.equal(E.BLD_DEF.rr, 75);
  assert.equal(E.BLD_DEF.areaMode, 'auto');
});

test('自動：延床坪単価で価格入力のとき、延床を10%増やすと価格も専有面積も10%増える', () => {
  // 1,210㎡：価格 ＝ 366.025坪 × 136.6万円 ＝ 49,999.015万円
  // 1,331㎡：価格 ＝ 402.6275坪 × 136.6万円 ＝ 54,998.9165万円、専有 ＝ 402.6275 × 0.75 ＝ 301.970625坪
  const r0 = E.model(autoState({}, { priceMode: 1, priceTsubo: 136.6, gfaM2: 1210 }));
  const r1 = E.model(autoState({}, { priceMode: 1, priceTsubo: 136.6, gfaM2: 1331 }));
  near(r0.p.price, 49999.015, 1e-6);
  near(r1.p.price, 54998.9165, 1e-6);
  near(r0.nraT, 274.51875, 1e-9);
  near(r1.nraT, 301.970625, 1e-9);
});

test('自動：延床が0のときは専有0（エラーにならない）', () => {
  const r = E.model(autoState({}, { gfaM2: 0 }));
  assert.equal(r.nraT, 0);
});

// ---------- 詳細モード ----------
test('詳細：入力した各階の専有面積をそのまま使い、延床を変えても動かない', () => {
  const b = { areaMode: 'detail', detailInit: true, typArea: 40, f1Area: 20, bFloors: 1, bUse: 'office', bArea: 15 };
  const r0 = E.model(autoState(b, { gfaM2: 1210 }));
  const r1 = E.model(autoState(b, { gfaM2: 3000 }));
  near(r0.nraT, 15 + 20 + 7 * 40, 1e-12);
  near(r1.nraT, 15 + 20 + 7 * 40, 1e-12);
});

test('切替：初めて詳細にしたときだけ自動の値を丸めずに引き継ぐ', () => {
  const st = autoState();
  const b = E.setAreaMode(st, 'detail');
  assert.equal(b.areaMode, 'detail');
  assert.equal(b.detailInit, true);
  // 1210 × 0.3025 ÷ 8 × 0.75 ＝ 34.31484375（表示だけ 34.31）
  assert.equal(b.typArea, 34.31484375);
  assert.equal(b.f1Area, 34.31484375);
  assert.equal(b.bArea, 34.31484375);
  assert.equal(st.bld.areaMode, 'auto', '元の state は書き換えない');
});

for (const [label, bld] of [['初期値', {}], ['地下2階店舗', { bFloors: 2, bUse: 'retail' }], ['複合・地下賃貸なし', { bFloors: 1, bUse: 'none', officeRatio: 50 }]]) {
  test(`切替：自動→詳細に切り替えた直後は結果が変わらない（${label}）`, () => {
    const st = autoState(bld, label === '複合・地下賃貸なし' ? { ptype: 2 } : {});
    const r0 = E.model(st);
    const r1 = E.model({ ...st, bld: E.setAreaMode(st, 'detail') });
    assert.equal(r1.nraT, r0.nraT, '専有合計');
    assert.equal(r1.gprPost, r0.gprPost, '改修後の満室賃料');
    assert.equal(r1.lirr, r0.lirr, '税引前IRR');
    assert.equal(r1.atIRR, r0.atIRR, '税引後IRR');
    assert.equal(r1.atProfit, r0.atProfit, '税引後純利益');
    assert.equal(r1.salePrice, r0.salePrice, '売却価格');
  });
}

test('切替：詳細→自動→詳細 で前回の詳細の値が戻る', () => {
  let st = autoState();
  st.bld = E.setAreaMode(st, 'detail');
  st.bld = { ...st.bld, typArea: 40, f1Area: 25, bArea: 12 };   // 詳細で編集
  st.bld = E.setAreaMode(st, 'auto');
  assert.equal(st.bld.areaMode, 'auto');
  near(E.model(st).nraT, 274.51875, 1e-9, '自動に戻すと自動の値で計算');
  st = { ...st, gfaM2: 2000 };                                   // 自動のあいだに延床を変えても
  st.bld = E.setAreaMode(st, 'detail');
  assert.deepEqual([st.bld.typArea, st.bld.f1Area, st.bld.bArea], [40, 25, 12]);
  near(E.model(st).nraT, 25 + 7 * 40, 1e-12);
});

test('切替：「自動計算の値で上書き」を押したときだけ自動の値で入れ直す', () => {
  let st = autoState();
  st.bld = { ...E.setAreaMode(st, 'detail'), typArea: 40 };
  st = { ...st, gfaM2: 2000 };
  st.bld = E.overwriteDetail(st);
  // 2000 × 0.3025 ÷ 8 × 0.75 ＝ 56.71875
  assert.equal(st.bld.areaMode, 'detail');
  assert.deepEqual([st.bld.typArea, st.bld.f1Area, st.bld.bArea], [56.71875, 56.71875, 56.71875]);
});

// ---------- レンタブル比（全体・地上） ----------
// 全体 ＝ 専有合計 ÷ 延床、地上 ＝ 地上階の専有合計 ÷ 地上階の延床（＝ 延床 × 地上階数 ÷ 全階数）
test('レンタブル比：地下1階を店舗で賃貸 → 全体75%・地上75%', () => {
  // 延床 366.025坪、1階あたり 366.025 ÷ 9 × 0.75 ＝ 30.5020833坪
  // 全体：9 × 30.5020833 ＝ 274.51875坪 ÷ 366.025 ＝ 75%
  // 地上：8 × 30.5020833 ＝ 244.0166667坪 ÷ (366.025 × 8/9 ＝ 325.3555556坪) ＝ 75%
  const r = E.model(autoState({ bFloors: 1, bUse: 'retail' }));
  near(r.rr.gfaAbove, 325.35555555555555, 1e-9, '地上階の延床');
  near(r.rr.nraAbove, 244.01666666666668, 1e-9, '地上階の専有');
  near(r.rr.all, 0.75, 1e-12, '全体');
  near(r.rr.above, 0.75, 1e-12, '地上');
});

test('レンタブル比：地下1階が賃貸なし → 全体66.67%・地上75%', () => {
  // 全体：244.0166667 ÷ 366.025 ＝ 0.75 × 8/9 ＝ 66.67%、地上：244.0166667 ÷ 325.3555556 ＝ 75%
  const r = E.model(autoState({ bFloors: 1, bUse: 'none' }));
  near(r.rr.all, 0.75 * 8 / 9, 1e-12, '全体');
  near(r.rr.above, 0.75, 1e-12, '地上');
});

test('レンタブル比：1階なし（共用部のみ）・地下なし → 全体・地上とも65.625%', () => {
  // 7 × 34.31484375 ＝ 240.20390625坪 ÷ 366.025 ＝ 0.75 × 7/8 ＝ 65.625%（地上階の延床 ＝ 延床）
  const r = E.model(autoState({ f1use: 'none' }));
  near(r.rr.gfaAbove, 366.025, 1e-9, '地上階の延床');
  near(r.rr.all, 0.65625, 1e-12, '全体');
  near(r.rr.above, 0.65625, 1e-12, '地上');
});

test('レンタブル比：1階なし・地下1階を賃貸 → 全体66.67%・地上65.63%', () => {
  // 1階あたり 30.5020833坪。全体：(7 ＋ 1) × 30.5020833 ÷ 366.025 ＝ 0.75 × 8/9
  // 地上：7 × 30.5020833 ÷ 325.3555556 ＝ 0.75 × 7/8
  const r = E.model(autoState({ f1use: 'none', bFloors: 1, bUse: 'office' }));
  near(r.rr.all, 0.75 * 8 / 9, 1e-12, '全体');
  near(r.rr.above, 0.75 * 7 / 8, 1e-12, '地上');
});

test('レンタブル比：詳細モード（1階20坪・基準階40坪・地下1階15坪）', () => {
  // 全体：(15 ＋ 20 ＋ 7 × 40) ÷ 366.025 ＝ 315 ÷ 366.025 ＝ 0.8605969…
  // 地上：(20 ＋ 280) ÷ (366.025 × 8/9) ＝ 300 ÷ 325.3555556 ＝ 0.9220682…
  const r = E.model(autoState({ areaMode: 'detail', detailInit: true, typArea: 40, f1Area: 20, bFloors: 1, bUse: 'office', bArea: 15 }));
  near(r.rr.all, 315 / 366.025, 1e-12, '全体');
  near(r.rr.above, 300 / (366.025 * 8 / 9), 1e-12, '地上');
});

test('レンタブル比：区画手入力モードでは地上レンタブル比を出さない', () => {
  const st = autoState({}, { rentMode: 1 });
  const r = E.model(st);
  near(r.rr.all, r.nraT / r.gfaT, 1e-12, '全体');
  assert.equal(r.rr.above, null);
});

// ---------- 物件価格と延床坪単価（内部で丸めない） ----------
// 画面の「物件価格の入力方法」の切り替えを、syncPrice の結果を state に書き戻す形で再現する
function switchPriceMode(st, mode) {
  const s0 = E.syncPrice(st);                       // 切り替え前に、入力していない側を同期
  const st1 = { ...st, price: s0.price, priceTsubo: s0.priceTsubo, priceMode: mode };
  const s1 = E.syncPrice(st1);                      // 切り替え後の再描画でも同期される
  return { ...st1, price: s1.price, priceTsubo: s1.priceTsubo };
}

test('価格：総額52,000万円 → 坪単価入力 → 総額入力 と往復しても1円も変わらない（延床1,331㎡）', () => {
  // 延床 1,331㎡ ＝ 402.6275坪。延床坪単価 ＝ 52,000 ÷ 402.6275 ＝ 129.15164…万円/坪（表示は 129.2）
  // 丸めていた旧方式では 129.2 × 402.6275 ＝ 52,019.47万円 にずれていた
  let st = autoState({}, { gfaM2: 1331, priceMode: 0, price: 52000 });
  st = switchPriceMode(st, 1);
  near(st.priceTsubo, 52000 / 402.6275, 1e-12, '延床坪単価（内部値）');
  near(E.model(st).p.price, 52000, 1e-8, '坪単価入力時の物件価格');
  st = switchPriceMode(st, 0);
  near(st.price, 52000, 1e-8, '総額入力に戻した物件価格（1円 ＝ 0.0001万円 より十分小さい誤差）');
  near(E.model(st).p.price, 52000, 1e-8);
});

test('価格：往復を10回くり返しても物件価格・延床坪単価がずれない', () => {
  let st = autoState({}, { gfaM2: 1210, priceMode: 0, price: 50123 });
  for (let i = 0; i < 10; i++) { st = switchPriceMode(st, 1); st = switchPriceMode(st, 0); }
  near(st.price, 50123, 1e-8, '物件価格');
  near(st.priceTsubo, 50123 / 366.025, 1e-12, '延床坪単価');
});

test('価格：坪単価入力 136.6万円/坪 → 総額入力 → 坪単価入力 で坪単価が変わらない', () => {
  // 366.025坪 × 136.6 ＝ 49,999.015万円（旧方式は 49,999 に丸めていた）
  let st = autoState({}, { gfaM2: 1210, priceMode: 1, priceTsubo: 136.6 });
  st = switchPriceMode(st, 0);
  near(st.price, 49999.015, 1e-8, '総額に切り替えたときの物件価格');
  st = switchPriceMode(st, 1);
  near(st.priceTsubo, 136.6, 1e-12, '延床坪単価');
});

test('価格：坪単価入力のとき延床を変えると価格が連動する（延床1,210→1,331㎡）', () => {
  let st = autoState({}, { gfaM2: 1210, priceMode: 1, priceTsubo: 136.6 });
  st = { ...st, gfaM2: 1331 };
  near(E.syncPrice(st).price, 402.6275 * 136.6, 1e-8);
});

test('価格：延床が0のときは延床坪単価を変えない（0で割らない）', () => {
  const st = autoState({}, { gfaM2: 0, priceMode: 0, price: 50000, priceTsubo: 137 });
  const s = E.syncPrice(st);
  assert.equal(s.price, 50000);
  assert.equal(s.priceTsubo, 137);
});

for (const [key, src] of [['default', v6Default], ['custom', v6Custom]]) {
  test(`価格：保存データ（v6 ${key === 'default' ? '初期値・総額入力' : '独自入力・坪単価入力'}）を読み込んで同期しても結果が変わらない`, () => {
    const st = E.migrate(clone(src));
    st.bld = { ...clone(E.BLD_DEF), ...st.bld };
    const s = E.syncPrice(st);
    const r = E.model({ ...st, price: s.price, priceTsubo: s.priceTsubo }), g = v6Results[key];
    near(r.p.price, g.price, 1e-8, '物件価格');
    near(r.atIRR, g.atIRR, 1e-12, '税引後IRR');
    near(r.atProfit, g.atProfit, 1e-6, '税引後純利益');
  });
}

// ---------- 保存データの移し替え（v6 → v7） ----------
test('移し替え：v6 のデータは詳細モードになり、物件名は空欄', () => {
  const m = E.migrate(clone(v6Default));
  assert.equal(m.bld.areaMode, 'detail');
  assert.equal(m.bld.detailInit, true);
  assert.equal(m.bld.rr, 75);
  assert.equal(m.propName, '');
  assert.equal(m.bld.typArea, 35);
  assert.equal(m.bld.f1Area, 30);
});

test('移し替え：複合タイプの v6 データは想定レンタブル比75%', () => {
  assert.equal(E.migrate(clone(v6Custom)).bld.rr, 75);
  assert.equal(E.migrate({ ...clone(v6Default), ptype: 1 }).bld.rr, 80);
});

test('移し替え：bld を持たない古い v6 データも詳細モードになる', () => {
  const old = clone(v6Default); delete old.bld;
  const m = E.migrate(old);
  assert.equal(m.bld.areaMode, 'detail');
});

for (const [key, src] of [['default', v6Default], ['custom', v6Custom]]) {
  test(`移し替え：v6 の${key === 'default' ? '初期値' : '独自入力'}データの計算結果が変更前と一致する`, () => {
    const st = E.migrate(clone(src));
    st.bld = { ...clone(E.BLD_DEF), ...st.bld };          // 画面の読み込み処理と同じ合成
    const r = E.model(st), g = v6Results[key];
    near(r.lirr, g.lirr, 1e-12, '税引前IRR');
    near(r.atIRR, g.atIRR, 1e-12, '税引後IRR');
    near(r.atProfit, g.atProfit, 1e-6, '税引後純利益');
    near(r.salePrice, g.salePrice, 1e-6, '売却価格');
    near(r.nraT, g.nraT, 1e-9, '専有合計');
    near(r.p.price, g.price, 1e-6, '物件価格');
  });
}

test('移し替え：v7 形式のデータの建物設定と物件名は変更しない（運営費の移し替えは opex.test.js で確認）', () => {
  const v7 = { ...clone(v6Default), propName: 'テストビル', bld: { ...clone(E.BLD_DEF), areaMode: 'auto', rr: 72, detailInit: false } };
  const m = plain(E.migrate(clone(v7)));
  assert.deepEqual(m.bld, v7.bld);
  assert.equal(m.propName, 'テストビル');
});
