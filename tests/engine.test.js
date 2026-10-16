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

test('切替：初めて詳細にしたときだけ自動の値（0.01坪単位）を引き継ぐ', () => {
  const st = autoState();
  const b = E.setAreaMode(st, 'detail');
  assert.equal(b.areaMode, 'detail');
  assert.equal(b.detailInit, true);
  assert.equal(b.typArea, 34.31);
  assert.equal(b.f1Area, 34.31);
  assert.equal(b.bArea, 34.31);
  assert.equal(st.bld.areaMode, 'auto', '元の state は書き換えない');
});

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
  // 2000 × 0.3025 ÷ 8 × 0.75 ＝ 56.71875 → 56.72
  assert.equal(st.bld.areaMode, 'detail');
  assert.deepEqual([st.bld.typArea, st.bld.f1Area, st.bld.bArea], [56.72, 56.72, 56.72]);
});

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

test('移し替え：すでに v7 形式のデータは変更しない', () => {
  const v7 = { ...clone(v6Default), propName: 'テストビル', bld: { ...clone(E.BLD_DEF), areaMode: 'auto', rr: 72, detailInit: false } };
  assert.deepEqual(plain(E.migrate(clone(v7))), v7);
});
