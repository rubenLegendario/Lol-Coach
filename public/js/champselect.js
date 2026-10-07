'use strict';
/* LoL Coach — Selección de campeón: draft, picks, baneos y asesor de dodge. */

// ---------- Selección de campeón ----------
function teamCard(c, side) {
  if (!c) return `<div class="tcard empty ${side}"></div>`;
  if (!c.champ) {
    return `<div class="tcard empty ${side} ${c.isMe ? 'me' : ''}">${posIcon(c.pos, 'pos-big') || ''}<div class="tc-bot"><div class="tc-sub">${c.isMe ? 'Tú · eligiendo…' : 'Eligiendo…'}</div></div></div>`;
  }
  const sub = c.scout ? `<div class="tc-sub rank ell">${esc(c.scout.rank.text.split(' · ')[0])}</div>` : c.name ? `<div class="tc-sub ell">${esc(c.name.split('#')[0])}</div>` : side === 'enemy' && c.pos ? `<div class="tc-sub">Probable ${POS[c.pos]}</div>` : '';
  return `<div class="tcard ${side} ${c.isMe ? 'me' : ''} ${c.hovering ? 'hover' : ''}" title="${esc(c.champ.name)}">
    <img class="art" src="${esc(c.champ.loading || c.champ.icon)}" alt="" loading="lazy">
    <div class="tc-top">${posIcon(c.pos) || '<span></span>'}${c.isMe ? '<span class="tag gold">TÚ</span>' : c.hovering ? '<span class="tag">Pensando</span>' : ''}</div>
    <div class="tc-bot"><div class="tc-name ell">${esc(c.champ.name)}</div>${sub}</div>
  </div>`;
}

function versus(cs) {
  const allies = cs.allies;
  const enemies = [...cs.enemies];
  while (enemies.length < 5) enemies.push(null);
  const d = cs.draft;
  return `<section class="panel" style="padding:16px"><div class="versus">
    <div class="team-row">${allies.map((a) => teamCard(a, 'ally')).join('')}</div>
    <div class="vs-core">
      ${d ? winRing(d.winProb, 156, 'Prob. victoria') : `<div class="dsp dim" style="font-size:40px">VS</div>`}
      ${d ? `<div class="vs-split"><span class="allyc">Tú ${d.winProb.toFixed(1)}%</span><span class="enemyc">Rival ${(100 - d.winProb).toFixed(1)}%</span></div>` : ''}
      ${cs.bans?.length ? `<div class="bans-row" title="Baneados">${cs.bans.map((b) => img(b, 'xs dim')).join('')}</div>` : ''}
    </div>
    <div class="team-row">${enemies.map((e) => teamCard(e, 'enemy')).join('')}</div>
  </div></section>`;
}

/** Baneos sugeridos: counters de tu campeón, fuertes en tu línea y los más baneados, con sus números del parche. */
function banPanel(cs) {
  const bs = cs.banSuggestions;
  const row = (b) => `<div class="ban-r">${img(b.champ, 'm')}
    <div style="min-width:0;flex:1"><div class="b ell">${esc(b.champ.name)} ${tierB(b.tier)}</div><div class="xs dim ell">${esc(b.reason)}</div></div>
    <div class="ban-n"><span title="Winrate en el parche">${b.winRate != null ? `<b class="${wrClass(b.winRate, 51, 49)}">${b.winRate}%</b>` : '—'}<small>WR</small></span>
      <span title="Ban rate">${b.banRate != null ? `<b>${b.banRate}%</b>` : '—'}<small>BAN</small></span>
      <span title="Pick rate">${b.pickRate != null ? `<b>${b.pickRate}%</b>` : '—'}<small>PICK</small></span></div></div>`;
  const group = (title, list) => (list?.length ? `${lbl(title)}<div class="stack" style="gap:5px">${list.map(row).join('')}</div>` : '');
  return panel('Baneos sugeridos', 'ban', `
    ${group(cs.myChamp ? `Countean a ${esc(cs.myChamp.name)}` : 'Countean a tu campeón', bs.counters)}
    ${group('Fuertes en tu línea', bs.strong)}
    ${group('Los más baneados del parche', bs.mostBanned)}`,
    { cls: cs.banning ? 'gold' : '', right: cs.banning ? '<span class="chip warn">Te toca banear</span>' : '' });
}

function pickBreakdown(p) {
  const b = p.breakdown;
  if (!b) return '';
  const chip = (label, v) => (Math.abs(v) < 0.1 ? '' : `<span class="bd ${v > 0 ? 'good' : 'bad'}"><span>${label}</span><b>${v > 0 ? '+' : ''}${v}%</b></span>`);
  const r = p.record;
  const rec = r && r.games ? `<span class="bd ${r.wins / r.games >= 0.5 ? 'good' : 'bad'}"><span>Tú</span><b>${r.wins}V ${r.games - r.wins}D</b></span>` : '';
  const recVs = r && r.vsGames ? `<span class="bd ${r.vsWins / r.vsGames >= 0.5 ? 'good' : 'bad'}"><span>Tú en este matchup</span><b>${r.vsWins}V ${r.vsGames - r.vsWins}D</b></span>` : '';
  const html = chip('Counter', b.matchup) + chip('Sinergia', b.synergy) + chip('Composición', b.comp) + chip('Parche', b.strength) + chip('Maestría', b.mastery) + rec + recVs;
  return html ? `<div class="bds">${html}</div>` : '';
}

function pickCard(p, best = false) {
  return `<div class="pick ${best ? 'best' : ''}">
    ${img(p.champ, 'l')}
    <div style="min-width:0"><div class="row nw"><span class="pick-n ell">${esc(p.champ.name)}</span>${best ? '<span class="best-badge">Mejor</span>' : ''}</div>
      <div class="pick-m">${p.masteryPoints ? `${fmtNum(p.masteryPoints)} pts de maestría` : p.where ? esc(p.where) : 'Sin partidas con él'}</div></div>
    <div class="pick-p"><div class="v ${wrClass(p.winProb)}">${p.winProb?.toFixed(1) ?? '—'}%</div>
      ${p.delta != null ? `<div class="d ${p.delta >= 0 ? 'good' : 'bad'}">${p.delta >= 0 ? '+' : ''}${p.delta} vs actual</div>` : ''}</div>
    ${p.inPool ? pickBreakdown(p) : ''}
    ${p.reasons?.length ? `<div class="reasons">${p.reasons.map(reasonRow).join('')}</div>` : ''}
  </div>`;
}

function advisorRow(cs) {
  const d = cs.dodge;
  const tilt = cs.session?.verdict === 'stop' ? cs.session.warnings.find((w) => w.level === 'stop') : null;
  if (!d && !tilt) return '';
  const cls = d ? { play: 'good', consider: 'warn', dodge: 'bad' }[d.verdict] : 'bad';
  return `<section class="panel advisor ${cls} mt"><div class="pb"><div class="adv">
    ${d ? `<div class="adv-main"><div class="adv-ic ${cls}">${icon(d.verdict === 'play' ? 'check' : 'alert')}</div>
      <div style="min-width:0"><div class="adv-t">${{ play: 'Juega la partida', consider: '¿Esquivar? Piénsatelo', dodge: 'Te conviene esquivar' }[d.verdict]}</div><div class="s muted">${esc(d.text)}</div></div></div>
    <div class="adv-ev">
      <div class="kv2"><div class="v ${d.evPlay >= 0 ? 'good' : 'bad'}">${d.evPlay > 0 ? '+' : ''}${d.evPlay}</div><div class="k">LP esperados jugando</div></div>
      <div class="kv2"><div class="v bad">${d.evDodge}</div><div class="k">LP si esquivas</div></div>
      <div class="kv2"><div class="v">${d.winProb}%</div><div class="k">Prob. ajustada</div></div>
    </div>
    ${d.reasons.length ? `<div class="tags adv-tags">${d.reasons.map((r) => `<span class="tag ${r.type === 'bad' ? 'bad' : 'warn'}">${esc(r.text)}</span>`).join('')}</div>` : ''}` : ''}
    ${tilt ? `<div class="note stop" style="width:100%">${icon('alert')}<span><b>Anti-tilt:</b> ${esc(tilt.text)}</span></div>` : ''}
  </div>${d ? `<div class="xs dim" style="margin-top:10px">${esc(d.note)} Con tus LP medios: +${d.lpWin} por victoria, ${d.lpLoss} por derrota.</div>` : ''}</div></section>`;
}

function viewChampSelect(cs) {
  if (cs.aram) return viewAramSelect(cs);
  const picks = cs.picks;
  const all = picks ? [...picks.pool, ...picks.meta] : [];
  const bestWp = Math.max(...all.map((p) => p.winProb), 0);

  const left = `
    ${picks && on('champSelect.picks') ? panel('Mejores picks', 'target', `
      <div class="s dim" style="margin:-4px 0 4px">Probabilidad de victoria si lo eliges, y por qué</div>
      ${picks.pool.length ? `${lbl(picks.customPool ? 'Tu pool, de mejor a peor para esta partida' : 'Tus campeones', picks.customPool ? '' : `<a href="#" onclick="go('pool');return false">Elige tu pool</a>`)}<div class="stack">${picks.pool.map((p) => pickCard(p, p.winProb === bestWp)).join('')}</div>` : ''}
      ${picks.poolTaken?.length ? `<div class="row" style="margin-top:8px;gap:6px">${picks.poolTaken.map((t) => `<span class="chip dim" title="${esc(t.why)}">${img(t.champ, 'xs dim')}${esc(t.champ.name)} · ${esc(t.why)}</span>`).join('')}</div>` : ''}
      ${picks.meta.length ? `${lbl('Del meta')}<div class="stack">${picks.meta.map((p) => pickCard(p, p.winProb === bestWp)).join('')}</div>` : ''}`,
      { right: picks.vs ? `vs <b style="color:var(--text)">${esc(picks.vs.name)}</b>` : '' }) : ''}
    ${cs.banSuggestions && on('champSelect.bans') ? banPanel(cs) : ''}
    ${cs.matchups && on('champSelect.matchups') ? panel(`Matchups de ${esc(cs.myChamp?.name)}`, 'swords', `
      ${lbl('Difíciles')}<div class="row">${cs.matchups.hard.map((m) => `<div style="text-align:center">${img(m.champ, 'm')}<div class="xs wr bad" style="margin-top:3px">${m.winRate}%</div></div>`).join('')}</div>
      ${lbl('Fáciles')}<div class="row">${cs.matchups.easy.map((m) => `<div style="text-align:center">${img(m.champ, 'm')}<div class="xs wr good" style="margin-top:3px">${m.winRate}%</div></div>`).join('')}</div>`) : ''}`;

  const right = `
    ${on('champSelect.notes') ? notesPanel(cs.notes) : ''}
    ${on('champSelect.why') ? whyPanel(cs.draft) : ''}
    ${panel('Composiciones', 'layers', `${compBar(cs.allyComp, '<span class="allyc">Tu equipo</span>')}${compBar(cs.enemyComp, '<span class="enemyc">Rival</span>')}
      ${cs.warnings.length ? `<div class="stack" style="margin-top:14px">${cs.warnings.map((w) => `<div class="note">${icon('alert')}<span>${esc(w)}</span></div>`).join('')}</div>` : ''}`)}
    ${cs.allies.some((a) => a.puuid) ? panel('Tus aliados', 'users', `<div class="stack">${cs.allies.filter((a) => a.puuid && !a.isMe).map((a) => `<div class="prow">${img(a.champ, 'm')}<div style="min-width:0"><div class="pn">${posIcon(a.pos)}<span class="ell">${esc(a.name || 'Aliado')}</span></div>${scoutLine(a.scout, 'ally')}</div><div class="s dim" style="text-align:right">${a.scout?.champMastery ? `<b style="color:var(--text)">${fmtNum(a.scout.champMastery.points)}</b><br>pts` : ''}</div></div>`).join('')}</div>`) : ''}`;

  const auto = cs.autoImport ? `<div class="note ${cs.autoImport.items.every((x) => x.ok) ? 'good-n' : ''} mt">${icon('check')}<span>Importado automáticamente para <b>${esc(cs.autoImport.champ)}</b>: ${cs.autoImport.items.map((x) => `${esc(x.label)} ${x.ok ? '<b class="good">✓</b>' : `<b class="bad" title="${esc(x.error || '')}">✗</b>`}`).join(' · ')}</span></div>` : '';
  return `${versus(cs)}${auto}${on('champSelect.dodge') ? advisorRow(cs) : ''}
    <div class="grid g-cs mt">
      <div class="col">${left || emptyState('clock', 'Esperando a tu turno', 'Las recomendaciones de pick aparecerán cuando sepamos tu posición.')}</div>
      <div class="col">${buildPanel(cs.build, { actions: true })}</div>
      <div class="col">${right}</div>
    </div>`;
}

function viewAramSelect(cs) {
  const allies = cs.allies.map((a) => ({ ...a, pos: null }));
  const best = cs.options[0];
  const strip = `<section class="panel" style="padding:16px"><div class="versus" style="grid-template-columns:minmax(0,1fr) auto">
    <div class="team-row">${allies.map((a) => teamCard(a, 'ally')).join('')}</div>
    <div class="vs-core">${cs.draft ? winRing(cs.draft.winProb, 156, 'Tu equipo') : ''}${cs.rerolls != null ? `<span class="chip">${icon('dice')}${cs.rerolls} rerolls</span>` : ''}</div>
  </div></section>`;
  return `${strip}
    <div class="grid g-cs mt">
      <div class="col">${panel('¿Te quedas o cambias?', 'swap', `${cs.advice ? `<div class="advice" style="margin-bottom:10px">${icon('bulb')}<span>${esc(cs.advice)}</span></div>` : ''}<div class="stack">${cs.options.map((o) => pickCard(o, o === best)).join('')}</div>`, { cls: cs.advice ? 'gold' : '' })}</div>
      <div class="col">${buildPanel(cs.build, { actions: true })}</div>
      <div class="col">${whyPanel(cs.draft, 'Tu composición')}${panel('Daño de tu equipo', 'layers', compBar(cs.allyComp, 'Reparto') + (cs.warnings.length ? `<div class="stack" style="margin-top:14px">${cs.warnings.map((w) => `<div class="note">${icon('alert')}<span>${esc(w)}</span></div>`).join('')}</div>` : ''))}</div>
    </div>`;
}
