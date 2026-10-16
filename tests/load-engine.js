// index.html の計算エンジン（// @engine-begin 〜 // @engine-end）を読み込み、関数を返す。
// 外部パッケージは使わない（Node 標準の fs / vm のみ）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const NAMES = ['model', 'coreModel', 'floorPlan', 'genUnits', 'autoAreas', 'effAreas', 'setAreaMode',
  'overwriteDetail', 'migrate', 'syncPrice', 'bmAuto', 'propTaxCalc', 'maxBid', 'LINKED', 'annuity', 'irr', 'BLD_DEF', 'USE_DEF', 'RR_DEF'];

function loadEngine() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/\/\/ @engine-begin\n([\s\S]*?)\/\/ @engine-end/);
  if (!m) throw new Error('index.html に // @engine-begin 〜 // @engine-end が見つかりません');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(m[1] + `\n;globalThis.__engine={${NAMES.map(n => `${n}:typeof ${n}==='undefined'?undefined:${n}`).join(',')}};`, ctx);
  return ctx.__engine;
}

module.exports = { loadEngine };
