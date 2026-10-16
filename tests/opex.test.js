// 運営費の内訳化（Opex・Capex・ファンド費用）の検算テスト。実行：node --test
// 期待値はコードの式を使わずに手計算した値（コメントに計算式）か、変更前のコードで記録した値（fixtures/v7-results.json）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./load-engine');
const E = loadEngine();

const clone = o => JSON.parse(JSON.stringify(o));
const plain = clone;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} 期待 ${b} / 実際 ${a}`);
const v7Default = require('./fixtures/v7-default-state.json');
const v7Custom = require('./fixtures/v7-custom-state.json');
const v7Results = require('./fixtures/v7-results.json');

// 手計算しやすい物件：オフィス1区画 100坪 × 10,000円/坪 ＝ 月100万円（年1,200万円）、稼働95%、
// 延床 1,000㎡ ＝ 302.5坪、改修なし、賃料・経費の上昇なし、借入 50%・金利2%・元本据置2年、保有5年
function simple(patch = {}, usePatch = {}) {
  const st = clone(v7Default);
  Object.assign(st, {
    ver: 8, rentMode: 1, units: [{ name: 'A', use: 'office', n: 1, area: 100, cur: 10000, post: 10000 }],
    occNow: 95, occReno: 95, capex: 0, cMonths: 0, cDelay: 0, delayCost: 0, rg: 0, eg: 0, gfaM2: 1000,
    price: 50000, priceMode: 0, acq: 6, ltv: 50, cltv: 70, rate: 2, io: 2, amort: 30, N: 5,
    pmRate: 2, bmTsubo: 600, utilCost: 300, utilInc: 240, repTsubo: 3000, propTax: 330, propTaxPost: 330,
    ins: 30, leaseMo: 2, opexOther: 40, capexTsubo: 4000, res: 1,
    amAcq: 0, amFee: 0, amBase: 0, amSale: 0, spc: 0, saleBasis: 1, exitCap: 4.3, saleMode: 0, taxMode: 0,
  }, patch);
  st.uses = { ...clone(E.USE_DEF), office: { stab: 95, L: 0, fr: 0, ...usePatch } };
  return st;
}

// ---------- Opex の各項目 ----------
test('Opex：各項目の年額を手計算と照合（1年目）', () => {
  // 賃料収入 ＝ 100万円 × 12 × 95% ＝ 1,140万円、水道光熱費収入 240万円
  // PM ＝ 1,140 × 2% ＝ 22.8 ／ BM ＝ 600円 × 302.5坪 × 12 ÷ 1万 ＝ 217.8 ／ 修繕 ＝ 3,000円 × 302.5坪 ÷ 1万 ＝ 90.75
  // Opex ＝ 22.8 ＋ 217.8 ＋ 300 ＋ 90.75 ＋ 330 ＋ 30 ＋ 0（リーシング）＋ 40 ＝ 1,031.35
  // NOI ＝ 1,140 ＋ 240 − 1,031.35 ＝ 348.65
  const y = E.model(simple()).years[0];
  near(y.egi, 1140, 1e-9, '賃料収入');
  near(y.uInc, 240, 1e-9, '水道光熱費収入');
  near(y.pm, 22.8, 1e-9, 'PM報酬');
  near(y.bm, 217.8, 1e-9, 'BM費');
  near(y.util, 300, 1e-9, '水道光熱費');
  near(y.rep, 90.75, 1e-9, '修繕費');
  near(y.ptax, 330, 1e-9, '公租公課');
  near(y.ins, 30, 1e-9, '損害保険料');
  near(y.lease, 0, 1e-9, 'リーシング費用（新規契約なし）');
  near(y.oth, 40, 1e-9, 'その他運営費');
  near(y.opex, 1031.35, 1e-9, 'Opex合計');
  near(y.noi, 348.65, 1e-9, 'NOI');
});

test('Capex・NCF：延床ベースと収入比の両方を NOI から差し引く', () => {
  // Capex（延床）＝ 4,000円 × 302.5坪 ÷ 1万 ＝ 121、Capex（収入比）＝ 1,140 × 1% ＝ 11.4
  // NCF ＝ 348.65 − 121 − 11.4 ＝ 216.25
  const y = E.model(simple()).years[0];
  near(y.capexHold, 121, 1e-9, 'Capex（延床）');
  near(y.reserve, 11.4, 1e-9, 'Capex（収入比）');
  near(y.ncf, 216.25, 1e-9, 'NCF');
});

test('経費上昇率：円/坪・年額の費用は2年目に経費上昇率で増える', () => {
  // BM 2年目 ＝ 217.8 × 1.015 ＝ 221.067、公租公課 ＝ 330 × 1.015 ＝ 334.95
  const y = E.model(simple({ eg: 1.5 })).years[1];
  near(y.bm, 221.067, 1e-9, 'BM費');
  near(y.ptax, 334.95, 1e-9, '公租公課');
  near(y.capexHold, 122.815, 1e-9, 'Capex（延床）121 × 1.015');
});

test('PM報酬：フリーレント控除後の賃料収入に掛け、水道光熱費収入は含めない', () => {
  // 稼働 80%→95% を3か月でリースアップ、フリーレント3か月：新規分 0.15 × 100万 × 3か月 ＝ 45万円を3か月で 15万円ずつ
  // 1か月目の稼働 ＝ 80% ＋ 15% × 0.5/3 ＝ 82.5% → 賃料 82.5 − 15 ＝ 67.5 → PM ＝ 1.35
  const r = E.model(simple({ occNow: 80, occReno: 80 }, { L: 3, fr: 3 }));
  near(r.mo[0].egi, 67.5, 1e-9, '1か月目の賃料収入');
  near(r.mo[0].pm, 1.35, 1e-9, '1か月目のPM報酬');
});

// ---------- 公租公課の切り替え ----------
for (const [C, y1, y2, y3] of [[0, 400, 400, 400], [10, 330, 400, 400], [12, 330, 400, 400], [13, 330, 330, 400]]) {
  test(`公租公課：工期${C}か月 → 竣工した月を含む年の翌年から改修後の額（${y1}／${y2}／${y3}）`, () => {
    // 竣工月を含む年 ＝ ceil(C/12) 年目。その翌年から改修後の年額。改修なし（工期0）は1年目から改修後の額
    const ys = E.model(simple({ cMonths: C, propTax: 330, propTaxPost: 400 })).years;
    near(ys[0].ptax, y1, 1e-9, '1年目'); near(ys[1].ptax, y2, 1e-9, '2年目'); near(ys[2].ptax, y3, 1e-9, '3年目');
  });
}

// ---------- リーシング費用 ----------
test('リーシング費用：新規契約が発生した月に、新規分の月額賃料 × 2か月を計上', () => {
  // 稼働 80%→95% を3か月で：毎月の新規契約 ＝ 15% ÷ 3 × 100万円 ＝ 5万円/月、× 2か月 ＝ 10万円を1〜3か月目に計上
  const r = E.model(simple({ occNow: 80, occReno: 80 }, { L: 3 }));
  assert.deepEqual(plain(r.mo.slice(0, 5).map(m => +m.lease.toFixed(9))), [10, 10, 10, 0, 0]);
  near(r.years[0].lease, 30, 1e-9, '1年目合計 ＝ 15% × 100万 × 2か月');
  near(r.years[1].lease, 0, 1e-9, '2年目は新規契約なし');
});

test('リーシング費用：改修工事がある場合は竣工の翌月から（工期6か月 → 7〜9か月目）', () => {
  const r = E.model(simple({ occNow: 80, occReno: 80, cMonths: 6 }, { L: 3 }));
  assert.deepEqual(plain(r.mo.slice(0, 10).map(m => +m.lease.toFixed(9))), [0, 0, 0, 0, 0, 0, 10, 10, 10, 0]);
});

test('リーシング費用：リースアップ期間0か月なら竣工の翌月に一括', () => {
  // 0.15 × 100 × 2 ＝ 30万円を1か月目に
  const r = E.model(simple({ occNow: 80 }, { L: 0 }));
  near(r.mo[0].lease, 30, 1e-9); near(r.mo[1].lease, 0, 1e-9);
});

// ---------- 売却価格・DSCR ----------
test('売却価格：NCF基準は翌年NCF ÷ キャップ、NOI基準は翌年NOI ÷ キャップ', () => {
  // 上昇なしなので翌年も同額：NCF 216.25 ÷ 4.3% ＝ 5,029.0698…、NOI 348.65 ÷ 4.3% ＝ 8,108.1395…
  near(E.model(simple({ saleBasis: 1 })).salePrice, 216.25 / 0.043, 1e-6, 'NCF基準');
  near(E.model(simple({ saleBasis: 0 })).salePrice, 348.65 / 0.043, 1e-6, 'NOI基準');
});

test('DSCR：NCF ÷ 元利返済（ファンド費用は含めない）', () => {
  // 借入 25,000万円 × 2% ＝ 利息 500（元本据置中）→ DSCR ＝ 216.25 ÷ 500 ＝ 0.4325
  const y = E.model(simple({ amFee: 0.3, spc: 400 })).years[0];
  near(y.ds, 500, 1e-9, '元利返済');
  near(y.dscr, 0.4325, 1e-12, 'DSCR');
});

// ---------- ファンド費用 ----------
test('ファンド費用：入れても NOI・NCF・売却価格・アンレバードIRR は変わらない', () => {
  const r0 = E.model(simple()), r1 = E.model(simple({ amAcq: 1, amFee: 0.3, amSale: 0.5, spc: 400 }));
  r0.years.forEach((y, i) => { near(r1.years[i].noi, y.noi, 1e-12, 'NOI'); near(r1.years[i].ncf, y.ncf, 1e-12, 'NCF'); });
  near(r1.salePrice, r0.salePrice, 1e-9, '売却価格');
  near(r1.uirr, r0.uirr, 1e-12, 'アンレバードIRR');
  // この手計算用の物件は価格に比べ収入が小さくIRRが計算できない（null）ため、税引後純利益で比べる
  assert.equal(r0.atIRR, null);
  assert.ok(r1.atProfit < r0.atProfit, '税引後純利益は下がる');
});

test('ファンド費用：AM報酬・SPC運営費をエクイティCFに計上（物件価格基準）', () => {
  // AM取得 ＝ 50,000 × 1% ＝ 500（取得時）、AM期中 ＝ 50,000 × 0.3% ＝ 150/年、SPC ＝ 400/年
  // AM売却 ＝ 売却価格 × 0.5%
  const r0 = E.model(simple()), r1 = E.model(simple({ amAcq: 1, amFee: 0.3, amSale: 0.5, spc: 400 }));
  near(r1.amAcqFee, 500, 1e-9, 'AM取得報酬');
  near(r1.years[0].amFee, 150, 1e-9, 'AM期中報酬');
  near(r1.years[0].spc, 400, 1e-9, 'SPC運営費');
  near(r1.amSaleFee, r1.salePrice * 0.005, 1e-9, 'AM売却報酬');
  near(r1.eqCF[0] - r0.eqCF[0], -500, 1e-9, '取得時');
  near(r1.eqCF[1] - r0.eqCF[1], -550, 1e-9, '1年目');
  near(r1.eqCF[5] - r0.eqCF[5], -550 - r1.salePrice * 0.005, 1e-9, '売却年');
});

test('ファンド費用：AM期中報酬をNOI基準にすると NOI × 料率', () => {
  // 348.65 × 0.3% ＝ 1.04595
  near(E.model(simple({ amFee: 0.3, amBase: 1 })).years[0].amFee, 1.04595, 1e-12);
});

test('ファンド費用の税務：期中報酬・SPCは損金、取得報酬は取得原価、売却報酬は譲渡費用', () => {
  const r0 = E.model(simple()), r1 = E.model(simple({ amAcq: 1, amFee: 0.3, amSale: 0.5, spc: 400 }));
  // 課税所得は毎年 150 ＋ 400 ＝ 550 減る
  near((r1.years[0].taxable - r0.years[0].taxable) + (r1.years[0].dep - r0.years[0].dep), -550, 1e-9, '損金（減価償却の差を除く）');
  // 取得報酬 500 を土地・建物に按分（建物比率40%）：建物分 200 を20年で償却 → 年10、5年で50
  near(r1.years[0].dep - r0.years[0].dep, 10, 1e-9, '取得報酬の建物分の償却');
  near(r1.book - r0.book, 500 - 50, 1e-9, '簿価に含まれる取得報酬（償却後）');
  // 譲渡益 ＝ 売却手取り − AM売却報酬 − 簿価
  near(r1.gain - r0.gain, -r1.amSaleFee - 450, 1e-9, '譲渡益');
});

// ---------- 既存データの移し替え（v7 → v8） ----------
test('移し替え：v7 の運営費はその他運営費へ、修繕積立は Capex（収入比）へ、ほかは0、売却はNOI基準', () => {
  const m = E.migrate(clone(v7Default));
  assert.equal(m.ver, 8);
  assert.equal(m.opexOther, 800);
  assert.equal(m.res, 3);
  for (const k of ['pmRate', 'bmTsubo', 'utilCost', 'utilInc', 'repTsubo', 'propTax', 'propTaxPost', 'ins', 'leaseMo', 'capexTsubo', 'amAcq', 'amFee', 'amSale', 'spc'])
    assert.equal(m[k], 0, k);
  assert.equal(m.saleBasis, 0);
  assert.equal(m.amBase, 0);
  assert.equal(m.exitCap, 4.5, 'キャップレートは保存値のまま');
});

for (const [key, src] of [['default', v7Default], ['custom', v7Custom]]) {
  test(`移し替え：v7 の${key === 'default' ? '初期値' : '独自入力'}データの税引前の結果が変更前と完全に一致する`, () => {
    const st = E.migrate(clone(src));
    st.bld = { ...clone(E.BLD_DEF), ...st.bld };
    const r = E.model(st), g = v7Results[key];
    // 税引前の指標は変更前と完全に一致する
    assert.equal(r.lirr, g.lirr, '税引前IRR');
    assert.equal(r.salePrice, g.salePrice, '売却価格');
    assert.equal(r.uirr, g.uirr, 'アンレバードIRR');
    // 税引後は、修繕積立（Capex）を資産計上・減価償却する税務修正の分だけ変わる（変更前は税計算に反映されていなかった）
    // 運営期間の税金は減り、税引後IRR・純利益は上がる。差の大きさは報告書に記載
    assert.ok(r.taxOpTot < g.taxOpTot, '運営期間の税金は減る');
    assert.ok(r.atIRR > g.atIRR, '税引後IRRは上がる');
    assert.ok(r.atProfit > g.atProfit, '税引後純利益は上がる');
  });
}

test('移し替え：v8 形式のデータは変更しない', () => {
  const v8 = simple();
  assert.deepEqual(plain(E.migrate(clone(v8))), v8);
});

test('ファンド費用：初期値の物件でも NOI・NCF・売却価格は変わらず、税引後IRRだけ下がる', () => {
  const base = E.migrate(clone(v7Default)); base.bld = { ...clone(E.BLD_DEF), ...base.bld };
  const r0 = E.model(base), r1 = E.model({ ...base, amAcq: 1, amFee: 0.3, amSale: 0.5, spc: 400 });
  r0.years.forEach((y, i) => { assert.equal(r1.years[i].noi, y.noi); assert.equal(r1.years[i].ncf, y.ncf); });
  assert.equal(r1.salePrice, r0.salePrice);
  assert.equal(r1.uirr, r0.uirr);
  assert.ok(r1.atIRR < r0.atIRR && r1.lirr < r0.lirr, '税引前・税引後IRRとも下がる');
});

// ---------- Capex の税務（資産計上・減価償却） ----------
test('Capexの税務：各年の Capex（延床＋収入比）を資産に計上し、改修費の償却年数（15年）で定額償却', () => {
  // 売却価格を NOI 基準にして、Capex の有無で売却価格が変わらないようにして比べる
  // 毎年の Capex ＝ 121 ＋ 11.4 ＝ 132.4。1年目の償却 ＝ 132.4 ÷ 15 ＝ 8.8267、3年目 ＝ 3本分 ＝ 26.48
  const r0 = E.model(simple({ saleBasis: 0, capexTsubo: 0, res: 0 })), r1 = E.model(simple({ saleBasis: 0 }));
  near(r1.years[0].dep - r0.years[0].dep, 132.4 / 15, 1e-9, '1年目の償却');
  near(r1.years[2].dep - r0.years[2].dep, 3 * 132.4 / 15, 1e-9, '3年目の償却');
  // 売却時の未償却残高 ＝ Σ 132.4 × (1 − 償却年数/15) ＝ 132.4 × (5 − (5+4+3+2+1)/15) ＝ 132.4 × 4 ＝ 529.6
  near(r1.book - r0.book, 529.6, 1e-9, '簿価');
  near(r1.gain - r0.gain, -529.6, 1e-9, '譲渡益');
  near(r1.salePrice, r0.salePrice, 1e-9, '売却価格は同じ（NOI基準）');
});
