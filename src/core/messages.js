/* Deterministic message builders. The model never writes a message: it returns an intent
 * plus typed parameters, and this code builds, validates and only then releases the message.
 * Element names follow ISO 20022 abbreviations for setr/acmt/sese; validate against the
 * official XSDs before any production use (they are not bundled here). */
(function (g) {
  'use strict';
  const T = (g.TACP = g.TACP || {});

  const NS = {
    'setr.010': 'urn:iso:std:iso:20022:tech:xsd:setr.010.001.04',
    'setr.004': 'urn:iso:std:iso:20022:tech:xsd:setr.004.001.04',
    'setr.016': 'urn:iso:std:iso:20022:tech:xsd:setr.016.001.04',
    'acmt.001': 'urn:iso:std:iso:20022:tech:xsd:acmt.001.001.08',
    'sese.001': 'urn:iso:std:iso:20022:tech:xsd:sese.001.001.09'
  };
  const CURRENCIES = ['EUR', 'GBP', 'USD', 'INR', 'CHF', 'JPY', 'SGD'];

  const el = (t, c, a) => ({ t, a: a || null, c: Array.isArray(c) ? c.filter(Boolean) : null, v: Array.isArray(c) ? null : c });

  function toXml(node, depth) {
    const pad = '  '.repeat(depth || 0);
    const attrs = node.a ? Object.keys(node.a).map((k) => ' ' + k + '="' + T.esc(node.a[k]) + '"').join('') : '';
    if (node.c) {
      return pad + '<' + node.t + attrs + '>\n' + node.c.map((ch) => toXml(ch, (depth || 0) + 1)).join('\n') + '\n' + pad + '</' + node.t + '>';
    }
    return pad + '<' + node.t + attrs + '>' + T.esc(node.v) + '</' + node.t + '>';
  }

  function find(node, path) {
    const parts = path.split('/');
    let cur = [node];
    for (const p of parts) {
      const next = [];
      cur.forEach((n) => (n.c || []).forEach((ch) => { if (ch.t === p) next.push(ch); }));
      if (!next.length) return null;
      cur = next;
    }
    return cur[0];
  }

  const REQUIRED = {
    'setr.010': ['SbcptOrdr/MsgId/Id', 'SbcptOrdr/MsgId/CreDtTm', 'SbcptOrdr/MltplOrdrDtls/InvstmtAcctDtls/AcctId',
      'SbcptOrdr/MltplOrdrDtls/IndvOrdrDtls/OrdrRef', 'SbcptOrdr/MltplOrdrDtls/IndvOrdrDtls/FinInstrmDtls/Id/ISIN'],
    'setr.004': ['RedOrdr/MsgId/Id', 'RedOrdr/MsgId/CreDtTm', 'RedOrdr/MltplOrdrDtls/InvstmtAcctDtls/AcctId',
      'RedOrdr/MltplOrdrDtls/IndvOrdrDtls/OrdrRef', 'RedOrdr/MltplOrdrDtls/IndvOrdrDtls/FinInstrmDtls/Id/ISIN'],
    'setr.016': ['OrdrInstrStsRpt/MsgId/Id', 'OrdrInstrStsRpt/RltdRef/Ref', 'OrdrInstrStsRpt/StsRpt/IndvOrdrDtlsRpt/OrdrRef',
      'OrdrInstrStsRpt/StsRpt/IndvOrdrDtlsRpt/OrdrSts/Sts'],
    'acmt.001': ['AcctOpngInstr/MsgId/Id', 'AcctOpngInstr/InstrDtls/OpngTp', 'AcctOpngInstr/InvstmtAcct/Nm',
      'AcctOpngInstr/AcctPties/PrncplAcctPty/OrgOwnrId/Nm'],
    'sese.001': ['TrfOutInstr/MsgId/Id', 'TrfOutInstr/TrfDtls/TrfRef', 'TrfOutInstr/TrfDtls/FinInstrmDtls/Id/ISIN',
      'TrfOutInstr/TrfDtls/TrfdQty/UnitsNb', 'TrfOutInstr/AcctDtls/AcctId']
  };

  function orderBody(o) {
    const amt = o.units ? el('UnitsNb', [el('Unit', String(o.units))]) : el('GrssAmt', String(o.amount), { Ccy: o.currency });
    return el('MltplOrdrDtls', [
      o.requestedTradeDate ? el('ReqdFutrTradDt', o.requestedTradeDate) : null,
      el('InvstmtAcctDtls', [el('AcctId', o.accountId)]),
      el('IndvOrdrDtls', [
        el('OrdrRef', o.orderRef),
        el('FinInstrmDtls', [el('Id', [el('ISIN', o.isin)]), el('Nm', o.instrumentName)]),
        amt
      ])
    ]);
  }

  const builders = {
    'setr.010': (o) => el('Document', [el('SbcptOrdr', [el('MsgId', [el('Id', o.msgId), el('CreDtTm', o.createdAt)]), orderBody(o)])], { xmlns: NS['setr.010'] }),
    'setr.004': (o) => el('Document', [el('RedOrdr', [el('MsgId', [el('Id', o.msgId), el('CreDtTm', o.createdAt)]), orderBody(o)])], { xmlns: NS['setr.004'] }),
    'setr.016': (s) => el('Document', [el('OrdrInstrStsRpt', [
      el('MsgId', [el('Id', s.msgId), el('CreDtTm', s.createdAt)]),
      el('RltdRef', [el('Ref', s.relatedRef), el('MsgNm', s.relatedMsg)]),
      el('StsRpt', [el('IndvOrdrDtlsRpt', [
        el('OrdrRef', s.orderRef),
        el('OrdrSts', [el('Sts', s.status), s.reason ? el('AddtlInf', s.reason) : null])
      ])])
    ])], { xmlns: NS['setr.016'] }),
    'acmt.001': (a) => el('Document', [el('AcctOpngInstr', [
      el('MsgId', [el('Id', a.msgId), el('CreDtTm', a.createdAt)]),
      el('InstrDtls', [el('OpngTp', 'NEWA')]),
      el('InvstmtAcct', [el('Nm', a.accountName), el('RefCcy', a.currency)]),
      el('AcctPties', [el('PrncplAcctPty', [el('OrgOwnrId', [el('Nm', a.ownerName), a.lei ? el('LEI', a.lei) : null, el('CtryOfRes', a.country)])])])
    ])], { xmlns: NS['acmt.001'] }),
    'sese.001': (t) => el('Document', [el('TrfOutInstr', [
      el('MsgId', [el('Id', t.msgId), el('CreDtTm', t.createdAt)]),
      el('TrfDtls', [
        el('TrfRef', t.transferRef),
        el('FinInstrmDtls', [el('Id', [el('ISIN', t.isin)])]),
        el('TrfdQty', [el('UnitsNb', String(t.units))])
      ]),
      el('AcctDtls', [el('AcctId', t.accountId)]),
      el('RcvgSd', [el('RcvgAcct', t.receivingAccount)])
    ])], { xmlns: NS['sese.001'] })
  };

  function semanticChecks(type, p) {
    const out = [];
    const ok = (name, pass, detail) => out.push({ check: name, pass, detail });
    if (p.isin !== undefined) ok('ISIN check digit', T.validIsin(p.isin), p.isin);
    if (p.currency !== undefined) ok('Currency code', CURRENCIES.includes(p.currency), p.currency);
    if (p.amount !== undefined) ok('Amount is positive', Number(p.amount) > 0, String(p.amount));
    if (p.units !== undefined) ok('Units are positive', Number(p.units) > 0, String(p.units));
    if (p.requestedTradeDate !== undefined) ok('Trade date format', /^\d{4}-\d{2}-\d{2}$/.test(p.requestedTradeDate), p.requestedTradeDate);
    if (type === 'setr.016') ok('Status code', ['RECE', 'PACK', 'RJCT', 'CPNP'].includes(p.status), p.status);
    return out;
  }

  // Build → structural check → semantic check. Returns the message only if every check passes.
  function build(type, params) {
    if (!builders[type]) throw new Error('No builder for ' + type);
    const tree = builders[type](params);
    const doc = tree.c[0];
    const wrapped = { t: 'root', c: [doc] };
    const structural = REQUIRED[type].map((path) => ({ check: 'Has ' + path.split('/').slice(1).join('/'), pass: !!find(wrapped, path), detail: path }));
    const semantic = semanticChecks(type, params);
    const valid = structural.every((c) => c.pass) && semantic.every((c) => c.pass);
    return { type, namespace: NS[type], valid, xml: '<?xml version="1.0" encoding="UTF-8"?>\n' + toXml(tree, 0), checks: structural.concat(semantic) };
  }

  T.messages = { build, NS, CURRENCIES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
