// 入力の連動（自動／手動）・テナントの残留・立退料・公租公課・指値の上限の検算テスト。実行：node --test
// 期待値はコードの式を使わずに手計算した値（コメントに計算式）か、変更前のコードで記録した値（fixtures/v8-results.json）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./load-engine');
const E = loadEngine();

const clone = o => JSON.parse(JSON.stringify(o));
const plain = clone;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} 期待 ${b} / 実際 ${a}`);
const v8Default = require('./fixtures/v8-default-state.json');
const v8Custom = require('./fixtures/v8-custom-state.json');
const v8Results = require('./fixtures/v8-results.json');

// 新規データ相当：連動はすべて自動（manual が空）、賃料は新方式
function fresh(patch = {}) {
  const st = clone(v8Default);
  return { ...st, ver: 9, manual: {}, rentModel: 'new', landVal: null, bldgVal: null, siteM2: null,
    evictMo: 0, evictTax: 0, evictLoan: 0, bidBasis: 0, ...patch };
}
const ALL_MANUAL = () => Object.fromEntries(E.LINKED.map(k => [k, true]));

// ---------- 1. 延床面積に連動する運営費・Capex ----------
test('BM費の自動値：基準点 250坪 500円・750坪 800円・1,500坪 1,500円 を直線でつなぐ（両端は一定）', () => {
  // 250坪以下 500円、250→750坪で 500→800円、750→1,500坪で 800→1,500円、1,500坪以上 1,500円
  for (const [t, y] of [[100, 500], [250, 500], [500, 650], [750, 800], [1000, 800 + 250 / 750 * 700], [1500, 1500], [3000, 1500]])
    near(E.bmAuto(t), y, 1e-9, `${t}坪`);
});

test('自動値：延床1,210㎡（366.025坪）の初期値の物件', () => {
  const a = E.model(fresh()).auto;
  near(a.bmTsubo, 500 + (366.025 - 250) / 500 * 300, 1e-9, 'BM費 ＝ 569.615円/坪/月');
  near(a.utilCost, 366.025 * 700 * 12 / 1e4, 1e-9, '水道光熱費 ＝ 307.461万円');
  near(a.utilInc, 366.025 * 700 * 12 / 1e4 * 0.8, 1e-9, '水道光熱費収入 ＝ 80%');
  near(a.ins, 366.025 * 100 * 0.0008, 1e-9, '損害保険料 ＝ 延床 × 100万円/坪 × 0.08% ＝ 29.282万円');
  assert.equal(a.pmRate, 2); assert.equal(a.repTsubo, 3000); assert.equal(a.capexTsubo, 4000);
  assert.equal(a.res, 0); assert.equal(a.opexOther, 0); assert.equal(a.leaseMo, 2);
});

test('自動値：水道光熱費を手動にすると、水道光熱費収入の自動値はその80%に追随する', () => {
  const r = E.model(fresh({ manual: { utilCost: true }, utilCost: 400 }));
  near(r.eff.utilCost, 400, 1e-12); near(r.eff.utilInc, 320, 1e-12);
});

test('手動：手動にした項目は入力値、手動でない項目は自動値を使う', () => {
  const r = E.model(fresh({ manual: { bmTsubo: true }, bmTsubo: 700, repTsubo: 9999 }));
  assert.equal(r.eff.bmTsubo, 700, '手動の値');
  assert.equal(r.eff.repTsubo, 3000, '手動でなければ保存値 9999 ではなく自動値');
  near(r.years[1].bm, 700 * 366.025 * 12 / 1e4 * 1.015, 1e-9, '計算にも手動の値が使われる（2年目は経費上昇1.5%）');
});

// ---------- 2. 公租公課 ----------
test('公租公課：評価額が未入力なら 物件価格 × 0.5% の推定値', () => {
  const r = E.model(fresh());
  near(r.auto.propTax, 50000 * 0.005, 1e-9, '250万円');
  assert.equal(r.auto.propTaxEst, true);
  near(r.auto.propTaxPost, 250, 1e-9, '改修後の自動値は改修前と同額');
});

test('公租公課：住宅以外の土地は評価額 × 70% × 1.7%、建物は評価額 × 1.7%', () => {
  // 土地 20,000 × 0.7 × 1.7% ＝ 238、建物 10,000 × 1.7% ＝ 170 → 408
  near(E.propTaxCalc({ land: 20000, bldg: 10000, resiShare: 0, floors: 8 }).total, 408, 1e-9);
  const r = E.model(fresh({ landVal: 20000, bldgVal: 10000 }));
  near(r.auto.propTax, 408, 1e-9, 'オフィスの初期値の物件');
  assert.equal(r.auto.propTaxEst, false);
});

test('公租公課：住宅用地の特例（全部住宅・小規模住宅用地）', () => {
  // 固定資産税 20,000 × 1/6 × 1.4% ＝ 46.667、都市計画税 20,000 × 1/3 × 0.3% ＝ 20、建物 170 → 236.667
  near(E.propTaxCalc({ land: 20000, bldg: 10000, resiShare: 1, floors: 8 }).total, 46.666666666666664 + 20 + 170, 1e-9);
});

test('公租公課：併用住宅（5階以上の耐火、住宅60% → 住宅用地 75%）', () => {
  // 住宅用地 15,000：固定 15,000/6 × 1.4% ＝ 35、都計 15,000/3 × 0.3% ＝ 15
  // 非住宅 5,000 × 0.7 × 1.7% ＝ 59.5、建物 170 → 279.5
  near(E.propTaxCalc({ land: 20000, bldg: 10000, resiShare: 0.6, floors: 8 }).total, 279.5, 1e-9);
});

test('公租公課：併用住宅の率（4階以下は 1/2以上で全部、1/4未満は住宅用地なし）', () => {
  // 4階・住宅60% → 率1.0 → 全部住宅用地：46.667 ＋ 20 ＋ 170
  near(E.propTaxCalc({ land: 20000, bldg: 10000, resiShare: 0.6, floors: 4 }).total, 46.666666666666664 + 20 + 170, 1e-9);
  // 住宅20% → 率0 → 408
  near(E.propTaxCalc({ land: 20000, bldg: 10000, resiShare: 0.2, floors: 8 }).total, 408, 1e-9);
  // 5階以上・住宅30% → 率0.5：住宅用地 10,000（固定 23.333・都計 10）＋ 非住宅 10,000 × 0.7 × 1.7%（119）＋ 170
  near(E.propTaxCalc({ land: 20000, bldg: 10000, resiShare: 0.3, floors: 8 }).total, 10000 / 6 * 0.014 + 10000 / 3 * 0.003 + 119 + 170, 1e-9);
});

test('公租公課：敷地面積があれば 戸数 × 200㎡ までを小規模、残りを一般住宅用地', () => {
  // 40戸 × 200㎡ ＝ 8,000㎡ ÷ 敷地 10,000㎡ → 小規模 80%・一般 20%
  // 固定 20,000 × (0.8/6 ＋ 0.2/3) × 1.4% ＝ 56、都計 20,000 × (0.8/3 ＋ 0.2 × 2/3) × 0.3% ＝ 24、建物 170 → 250
  near(E.propTaxCalc({ land: 20000, bldg: 10000, resiShare: 1, floors: 8, siteM2: 10000, resiUnits: 40 }).total, 250, 1e-9);
});

// ---------- 3. テナントの残留と賃料（新方式） ----------
// オフィス1区画 100坪：現況 10,000円/坪（月100万円）、新規テナント 12,000円/坪（月120万円）
// 現況稼働80%、残る割合50%、値上げ率10%、安定稼働95%、リースアップ3か月、工期6か月、上昇なし
function rent(patch = {}, use = {}) {
  const st = fresh({ rentMode: 1, units: [{ name: 'A', use: 'office', n: 1, area: 100, cur: 10000, post: 12000 }],
    occNow: 80, cMonths: 6, cDelay: 0, capex: 0, rg: 0, eg: 0, manual: { ...ALL_MANUAL(), occReno: false }, ...patch });
  st.uses = { ...clone(E.USE_DEF), office: { stab: 95, L: 3, fr: 0, keep: 50, up: 10, ...use } };
  return st;
}

test('新方式：工事中は残るテナント（80% × 50% ＝ 40%）が現況の単価で入居', () => {
  const r = E.model(rent());
  near(r.eff.occReno, 40, 1e-9, '工事中稼働率の自動値');
  for (let m = 0; m < 6; m++) near(r.mo[m].egi, 40, 1e-9, `${m + 1}か月目 ＝ 100万円 × 40%`);
});

test('新方式：竣工後は 残るテナント × 現況 × 1.1 ＋ 新しいテナント × 新規単価', () => {
  // 7か月目：稼働 40% ＋ 55% × 0.5/3 ＝ 49.167% → 40% × 110 ＝ 44 ＋ 9.167% × 120 ＝ 11 → 55
  // 8か月目：稼働 67.5% → 44 ＋ 27.5% × 120 ＝ 33 → 77、9か月目：85.833% → 44 ＋ 55 ＝ 99、10か月目：95% → 44 ＋ 66 ＝ 110
  const r = E.model(rent());
  assert.deepEqual(plain(r.mo.slice(6, 11).map(m => +m.egi.toFixed(9))), [55, 77, 99, 110, 110]);
});

test('新方式：改修後の平均単価（面積加重）と安定期の賃料収入', () => {
  // [40% × 10,000 × 1.1 ＋ 55% × 12,000] ÷ 95% ＝ (4,400 ＋ 6,600) ÷ 0.95 ＝ 11,578.947円/坪
  const r = E.model(rent());
  near(r.grp.office.avgPostP, 11000 / 0.95, 1e-9, '平均単価');
  near(r.stabRent, (44 + 66) * 12, 1e-9, '安定期の年間賃料収入 ＝ 1,320万円');
});

test('新方式：フリーレントとリーシング費用は新しいテナントの分（55%）だけ', () => {
  // フリーレント2か月：55% × 120 × 2 ÷ 3か月 ＝ 44/月（7〜9か月目）
  // リーシング2か月：55% × 120 × 2 ÷ 3 ＝ 44/月（7〜9か月目）
  const r = E.model(rent({}, { fr: 2 }));
  for (const m of [6, 7, 8]) { near(r.mo[m].fr, 44, 1e-9, 'フリーレント'); near(r.mo[m].lease, 44, 1e-9, 'リーシング'); }
  near(r.mo[9].fr, 0, 1e-12); near(r.mo[9].lease, 0, 1e-12);
});

test('新方式：工事中稼働率を手動（70%）にすると工事中は70%、竣工時に残る40%から再リースアップ', () => {
  const r = E.model(rent({ manual: { ...ALL_MANUAL() }, occReno: 70 }));
  near(r.mo[0].egi, 70, 1e-9, '工事中 ＝ 100 × 70%');
  near(r.mo[6].egi, 55, 1e-9, '竣工翌月は自動のときと同じ');
});

test('新方式：改修なし（工期0）なら1か月目から残るテナントと新しいテナント', () => {
  near(E.model(rent({ cMonths: 0 })).mo[0].egi, 55, 1e-9);
});

test('新方式：売却価格には残るテナントの低い賃料が反映される（残る割合を上げると売却価格が下がる）', () => {
  const lo = E.model(rent({ N: 3 }, { keep: 20 })), hi = E.model(rent({ N: 3 }, { keep: 80 }));
  assert.ok(hi.fwdNOI < lo.fwdNOI && hi.salePrice < lo.salePrice);
});

// ---------- 4. 立退料 ----------
test('立退料：退去する面積（80% × 50%）× 現況月額 100万円 × 3か月 ＝ 120万円を1か月目に', () => {
  const r = E.model(rent({ evictMo: 3 }));
  near(r.mo[0].evict, 120, 1e-9); near(r.mo[1].evict, 0, 1e-12);
  near(r.evictTotal, 120, 1e-9);
});

test('立退料の融資：初期値は融資なし、「改修費と同じ割合」なら 70% を借入', () => {
  const r0 = E.model(rent({ evictMo: 0 })), r1 = E.model(rent({ evictMo: 3 })), r2 = E.model(rent({ evictMo: 3, evictLoan: 1 }));
  near(r1.years[0].draw - r0.years[0].draw, 0, 1e-9, '融資なし');
  near(r1.eqCF[1] - r0.eqCF[1], -120, 1e-9, '自己資金で全額');
  near(r2.years[0].draw - r0.years[0].draw, 84, 1e-9, '120 × 70%');
});

test('立退料の税務：支払った年の経費／取得価額に含める／譲渡費用', () => {
  const r0 = E.model(rent({ N: 5 }));
  const ex = E.model(rent({ N: 5, evictMo: 3, evictTax: 0 }));
  near(ex.years[0].taxable - r0.years[0].taxable, -120, 1e-9, '経費：1年目の課税所得が120減る');
  const cap = E.model(rent({ N: 5, evictMo: 3, evictTax: 1 }));
  // 取得価額に含める：建物比率40%分 48 を20年で償却 → 年2.4。5年後の簿価増 ＝ 120 − 12 ＝ 108
  near(cap.years[0].taxable - r0.years[0].taxable, -2.4, 1e-9, '取得価額：償却分だけ減る');
  near(cap.book - r0.book, 108, 1e-9, '簿価');
  const sale = E.model(rent({ N: 5, evictMo: 3, evictTax: 2 }));
  near(sale.years[0].taxable - r0.years[0].taxable, 0, 1e-9, '譲渡費用：期中は変わらない');
  near(sale.gain - r0.gain, -120, 1e-9, '譲渡益が120減る');
});

// ---------- 5. 指値の上限 ----------
function migrated(src) { const st = E.migrate(clone(src)); st.bld = { ...clone(E.BLD_DEF), ...st.bld }; return st; }

test('指値の上限：その価格で税引後IRRが目標（10%）に一致し、それより高いと届かない', () => {
  const st = migrated(v8Default), b = E.maxBid(st, 0.10, 0);
  assert.equal(b.status, 'ok');
  near(E.model({ ...st, priceMode: 0, price: b.price }).atIRR, 0.10, 1e-6, '税引後IRR');
  assert.ok(E.model({ ...st, priceMode: 0, price: b.price * 1.01 }).atIRR < 0.10);
  assert.ok(b.price > 50000, '現状 12.3% > 10% なので現在の価格より高い');
});

test('指値の上限：税引前IRRを基準にもできる', () => {
  const st = migrated(v8Default), b = E.maxBid(st, 0.15, 1);
  assert.equal(b.status, 'ok');
  near(E.model({ ...st, priceMode: 0, price: b.price }).lirr, 0.15, 1e-6);
});

test('指値の上限：価格を10%まで下げても届かなければ unreachable', () => {
  const st = migrated(v8Default);
  // 運営費が賃料収入を上回り NOI がマイナスの物件は、価格をいくら下げても目標に届かない
  assert.equal(E.maxBid({ ...st, opexOther: 10000 }, 0.10, 0).status, 'unreachable');
});

// ---------- 以前のデータの移し替え（v8 → v9） ----------
test('移し替え：v8 のデータは連動項目をすべて手動、賃料は旧方式、新項目は0・空欄', () => {
  const m = E.migrate(clone(v8Default));
  assert.equal(m.ver, 9);
  assert.equal(m.rentModel, 'legacy');
  for (const k of E.LINKED) assert.equal(m.manual[k], true, k);
  assert.equal(m.evictMo, 0); assert.equal(m.evictTax, 0); assert.equal(m.evictLoan, 0);
  assert.equal(m.landVal, null); assert.equal(m.bldgVal, null); assert.equal(m.siteM2, null);
});

for (const [key, src] of [['default', v8Default], ['custom', v8Custom]]) {
  test(`移し替え：v8 の${key === 'default' ? '初期値' : '独自入力'}データの結果が変更前と完全に一致する（DSCR を含む）`, () => {
    const r = E.model(migrated(src)), g = v8Results[key];
    for (const k of ['lirr', 'atIRR', 'atProfit', 'salePrice', 'uirr', 'minDSCR', 'stabNOI']) assert.equal(r[k], g[k], k);
    assert.equal(r.p.price, g.price, '物件価格');
  });
}

test('移し替え：v9 形式のデータは変更しない', () => {
  const v9 = fresh();
  assert.deepEqual(plain(E.migrate(clone(v9))), v9);
});
