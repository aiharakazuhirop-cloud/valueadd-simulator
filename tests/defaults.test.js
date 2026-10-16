// 新規データの初期値の検算テスト。実行：node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadEngine } = require('./load-engine');
const E = loadEngine();
const clone = o => JSON.parse(JSON.stringify(o));
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// 入力欄の定義 FIELDS の初期値（[キー, ラベル, 単位, 初期値, …]）を読む
const fieldDefault = k => { const m = html.match(new RegExp(`\\['${k}','[^']*','[^']*',([^,\\]]+),`)); return m ? Number(m[1]) : undefined; };

test('新規データの初期値：保有期間3年・元本据置3年', () => {
  assert.equal(fieldDefault('N'), 3, '保有期間');
  assert.equal(fieldDefault('io'), 3, '元本据置');
});

test('保有期間3年・元本据置3年なら、保有中は利息のみ（元本返済0、残債は借入額のまま）', () => {
  const st = E.migrate(clone(require('./fixtures/v8-default-state.json')));
  st.bld = { ...clone(E.BLD_DEF), ...st.bld };
  const r = E.model({ ...st, N: 3, io: 3 });
  // 借入 ＝ 取得 50,000 × 70% ＋ 改修 6,000 × 70% ＝ 39,200。利息 ＝ 39,200 × 2% ＝ 784/年
  r.years.forEach(y => { assert.equal(y.princ, 0, `${y.t}年目の元本返済`); assert.equal(y.interest, 784, `${y.t}年目の利息`); });
  assert.equal(r.payoff, 39200, '売却時の残債');
});

test('以前のデータの保有期間・元本据置（5年・2年）は移し替えで変わらない', () => {
  for (const f of ['v6-default-state', 'v7-default-state', 'v8-default-state', 'v8-custom-state']) {
    const src = require(`./fixtures/${f}.json`), m = E.migrate(clone(src));
    assert.equal(m.N, src.N, `${f} の保有期間`); assert.equal(m.io, src.io, `${f} の元本据置`);
  }
});
