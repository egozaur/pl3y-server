// Bulgot: wszystkie dane gry w jednym miejscu (kafelki, postacie, wrogowie, bossowie, poziomy Garnka).
// Źródło prawdy jest tutaj; frontend dostaje kopię przez `bulgot/dev/sync-engine.mjs` (plik w bulgot/shared/ jest GENEROWANY, nie edytuj go).
// Dodanie treści = dopisanie obiektu poniżej, bez zmian w kodzie silnika.
// Czas w tickach: 1 tick = 100 ms, 10 ticków = 1 sekunda.

export const TICKS_PER_S = 10;

export const RARITY = ['Zwykły', 'Rzadki', 'Epicki', 'Legendarny'];
export const TYPES = { stat: 'Statystyka', skill: 'Umiejętność', item: 'Przedmiot', risk: 'Ryzyko' };

// ---------- Tryby ----------
// grow: o ile rośnie życie i atak wrogów z każdą rundą (mnożnik). bosses: runda -> boss. bonusAfter: po tych bossach dodatkowa oferta.
// elite: rundy z elitą (nagroda: Odznaka). zoneMul: dodatkowy mnożnik życia/ataku zwykłych wrogów w strefie (%, null = brak).
export const MODES = {
  quick: { name: 'Szybki', rounds: 10, bosses: { 5: 'brojler', 10: 'prezes' }, bonusAfter: [5], early: { rounds: 3, hp: 135, atk: 80 }, grow: { hp: 1.14, atk: 1.098 }, bossPct: { hp: 80, atk: 90 },
    zones: [{ upTo: 5, zone: 0 }, { upTo: 10, zone: 1 }], elite: [4, 8] },
  full: { name: 'Pełny', rounds: 20, bosses: { 6: 'brojler', 12: 'skubarka', 20: 'prezes' }, bonusAfter: [6, 12], early: { rounds: 4, hp: 135, atk: 80 }, grow: { hp: 1.125, atk: 1.08 }, bossPct: { hp: 100, atk: 100 },
    zones: [{ upTo: 6, zone: 0 }, { upTo: 12, zone: 1 }, { upTo: 20, zone: 2 }], elite: [4, 10, 16], zoneMul: [null, null, { hp: 130, atk: 112 }] },
};

export const ZONES = [
  { name: 'Kurnik i Podwórze', tag: 'I' },
  { name: 'Magazyn Pasz i Chłodnia', tag: 'II' },
  { name: 'Sortownia Jaj i Biuro Zarządu', tag: 'III' },
];

// Stałe zasad. prices = cena dokupienia kafelka wg rzadkości (zwykły, rzadki, epicki, legendarny); early = osłabienie ataku i wzmocnienie życia wrogów na pierwszych piętrach (dłuższe, spokojniejsze walki).
export const RULES = {
  coinsRound: 4, coinsBoss: 6, prices: [6, 12, 20, 30], restCost: 4, restPct: 20, healPct: 35, rerollBase: 2, offerSize: 4, bonusSize: 3,
  eliteCoinsPct: 50, scoreRound: 1000, scoreCoin: 50, scoreTimeMax: 2000, garnekScore: 25, maxSkills: 3, maxSkillLvl: 3,
};

// Forma kurczaka zależy od postępu (ułamek runu), nie od numeru rundy, więc tryb szybki też dochodzi do Rambo Chickena.
export const FORMS = [
  { id: 'pyrtek', name: 'Pyrtek', from: 0 },
  { id: 'kogut', name: 'Kogut', from: 0.30 },
  { id: 'bojowy', name: 'Kogut Bojowy', from: 0.60 },
  { id: 'rambo', name: 'Rambo Chicken', from: 0.80 },
];
export function formFor(mode, round) {
  const p = (round - 1) / MODES[mode].rounds;
  let f = FORMS[0];
  for (const x of FORMS) if (p >= x.from - 1e-9) f = x;
  return f;
}

// ---------- Postacie ----------
const BASE = { hp: 70, atk: 8, aspd: 100, armor: 0, crit: 5, critMult: 150, evade: 0, regen: 0, luck: 0, dmg: 0 };
export const CHARS = {
  pyrtek: { id: 'pyrtek', name: 'Pyrtek', style: 'Uniwersalny', text: 'Mały, ale zawzięty. Statystyki bazowe, bez fanaberii.', base: BASE, fx: [], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: null },
  kwoka: { id: 'kwoka', name: 'Kwoka Babcia', style: 'Czołg', text: '+30% Życia, -20% tempa ataku. Zaczyna z Zagrzebaniem w Sianie.', base: BASE,
    fx: [{ k: 'hpPct', v: 30 }, { k: 'aspdPct', v: -20 }], startSkills: [['zagrzebanie', 1]], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-kwoka' },
  kaczor: { id: 'kaczor', name: 'Kaczor Hazardzista', style: 'Ryzyko', text: '+10 Ziaren, 1 darmowy reroll na rundę, więcej kafelków ryzyka w ofertach.', base: BASE,
    fx: [], startSkills: [], coins: 10, freeRerolls: 1, riskWeight: 2, lock: 'u-kaczor' },
  indor: { id: 'indor', name: 'Indor Bogdan', style: 'Ciężkie ciosy', text: '+60% Ataku, -30% tempa ataku, 15% szansy na trafienie krytyczne.', base: BASE,
    fx: [{ k: 'atkPct', v: 60 }, { k: 'aspdPct', v: -30 }, { k: 'crit', v: 10 }], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-indor' },
};

// ---------- Umiejętności aktywne ----------
// cd i dur w tickach. Poziom 2: +30% mocy i -20% cooldownu. Trzecia kopia = Mutacja (poziom 3): wybór jednej z dwóch gałęzi (mut 1 lub 2),
// moc i cooldown jak na poziomie 2 plus efekt gałęzi. el = żywioł (oznaczenie na karcie).
export const SKILLS = {
  grad: { id: 'grad', name: 'Kukurydziany Grad', cd: 65, hits: 5, pct: 60, text: '5 pocisków po 60% Ataku w losowych wrogów.', key: 'grad', el: 'ziarno',
    muts: [{ name: 'Ognisty Grad', text: 'Każdy pocisk nakłada stos Oparzenia.' }, { name: 'Nawałnica', text: '9 pocisków zamiast 5.' }] },
  pianie: { id: 'pianie', name: 'Pianie Grozy', cd: 90, dur: 20, text: 'Ogłusza wszystkich wrogów na 2 s i przerywa ich szarże.', key: 'pianie',
    muts: [{ name: 'Mroźne Pianie', text: 'Dodatkowo 3 stosy Mrozu na wszystkich wrogach.' }, { name: 'Pianie Bojowe', text: 'Ogłuszenie trwa prawie 2 razy dłużej.' }] },
  granat: { id: 'granat', name: 'Jajeczny Granat', cd: 80, pct: 250, text: '250% Ataku w jednym uderzeniu.', key: 'granat', el: 'jajo',
    muts: [{ name: 'Granat Kasetowy', text: 'Odłamki trafiają pozostałych wrogów za 60% siły.' }, { name: 'Granat Wrzący', text: 'Dodatkowo 5 stosów Oparzenia na celu.' }] },
  dziobniecie: { id: 'dziobniecie', name: 'Dziobnięcie Szału', cd: 120, dur: 60, text: '+50% tempa ataku przez 6 s.', key: 'dziobniecie', el: 'krew',
    muts: [{ name: 'Szał Krwi', text: 'W szale każdy cios nakłada 2 stosy Krwawienia.' }, { name: 'Wieczny Szał', text: 'Szał trwa 2 razy dłużej.' }] },
  unik: { id: 'unik', name: 'Unik Skrzydłem', cd: 100, dur: 15, text: 'Nietykalność przez 1,5 s.', key: 'unik',
    muts: [{ name: 'Unik z Kontrą', text: 'Każdy zablokowany cios oddaje atakującemu 100% Ataku.' }, { name: 'Skrzydło Wiatru', text: 'Nietykalność trwa 2 razy dłużej.' }] },
  zagrzebanie: { id: 'zagrzebanie', name: 'Zagrzebanie w Sianie', cd: 160, pct: 30, text: 'Leczy 30% maks. Życia.', key: 'zagrzebanie',
    muts: [{ name: 'Głębokie Siano', text: 'Leczy 50% maks. Życia zamiast 30%.' }, { name: 'Wściekłe Siano', text: 'Po wyjściu z siana przez 4 s każdy cios jest krytyczny.' }] },
  chlust: { id: 'chlust', name: 'Rosołowy Chlust', cd: 85, pct: 40, n: 3, text: '40% Ataku i 3 stosy Oparzenia na wszystkich wrogach.', key: 'chlust', el: 'ogien',
    muts: [{ name: 'Kocioł', text: '6 stosów Oparzenia zamiast 3.' }, { name: 'Rosół z Kością', text: 'Dodatkowo ogłusza wszystkich wrogów na 1 s.' }] },
  lodowy: { id: 'lodowy', name: 'Lodowy Dziób', cd: 60, pct: 150, n: 2, text: '150% Ataku i 2 stosy Mrozu na celu.', key: 'lodowy', el: 'lod',
    muts: [{ name: 'Sopel', text: 'Cel od razu zamarza.' }, { name: 'Szron', text: 'Mróz spada na wszystkich wrogów.' }] },
  zgnile: { id: 'zgnile', name: 'Zgniłe Jajo', cd: 75, n: 5, text: '5 stosów Salmonelli na celu i 1 na pozostałych wrogach.', key: 'zgnile', el: 'trucizna',
    muts: [{ name: 'Śmierdziel', text: '4 stosy Salmonelli na każdym wrogu.' }, { name: 'Wylęg Bakterii', text: 'Po rzucie podwaja stosy Salmonelli na celu.' }] },
  kontra: { id: 'kontra', name: 'Kogucia Kontra', cd: 100, dur: 25, pct: 120, text: 'Przez 2,5 s dostajesz o połowę mniej obrażeń, a każdy atakujący dostaje 120% Ataku.', key: 'kontra',
    muts: [{ name: 'Żelazny Grzebień', text: 'Obrażenia mniejsze o 75% zamiast o połowę.' }, { name: 'Odwet', text: 'Atakujący dostaje 250% Ataku.' }] },
  darcie: { id: 'darcie', name: 'Darcie Pierza', cd: 80, pct: 50, n: 2, text: '50% Ataku i 2 stosy Krwawienia na wszystkich wrogach.', key: 'darcie', el: 'krew',
    muts: [{ name: 'Pierzasta Burza', text: '3 stosy i +2 do limitu Krwawienia do końca walki.' }, { name: 'Krwawa Uczta', text: 'Leczy 3% maks. Życia za każdy stos Krwawienia na wrogach.' }] },
  kapiel: { id: 'kapiel', name: 'Piaskowa Kąpiel', cd: 110, dur: 30, pct: 50, text: 'Przez 3 s wrogowie pudłują połowę ciosów.', key: 'kapiel',
    muts: [{ name: 'Burza Piaskowa', text: 'Wrogowie pudłują 75% ciosów.' }, { name: 'Piach w Oczy', text: 'Dodatkowo ogłusza wszystkich wrogów na 1 s.' }] },
  premia: { id: 'premia', name: 'Dziobanie Premii', cd: 70, pct: 160, text: '160% Ataku w cel; jeśli go zabije, +1 Ziarno (do 3 na walkę).', key: 'premia', el: 'korpo',
    muts: [{ name: 'Premia Roczna', text: '+2 Ziarna za zabójstwo, do 6 na walkę.' }, { name: 'Nadgodziny', text: '300% Ataku zamiast 160%.' }] },
  egzekucja: { id: 'egzekucja', name: 'Egzekucja Ostrogą', cd: 90, pct: 130, exec: 400, thr: 30, text: '130% Ataku; wróg poniżej 30% Życia dostaje 400%.', key: 'egzekucja', el: 'krew',
    muts: [{ name: 'Wyrok', text: 'Próg egzekucji to 50% Życia.' }, { name: 'Seria', text: 'Zabójstwo od razu odnawia umiejętność.' }] },
};

// ---------- Efekty statusowe (nakładane na wrogów) ----------
// dur = czas trwania w tickach (odświeżany przy każdym nałożeniu), max = limit stosów.
// Oparzenie i Salmonella zadają co sekundę (stosy × per% Ataku, min. 1 na stos), ignorują pancerz i tarcze.
// Mróz: każdy stos spowalnia wroga o slow%, przy `need` stosach wróg zamarza na `freeze` ticków (bossowie o połowę krócej).
// Salmonella: po śmierci nosiciela `spread`% stosów przechodzi na następnego żywego wroga.
// Krwawienie: stosy × (moc krwawienia + 8% Ataku) na sekundę.
export const STATUS = {
  burn: { id: 'burn', name: 'Oparzenie', dur: 40, max: 10, per: 10, text: 'Obrażenia co sekundę, rosną z każdym stosem.' },
  frost: { id: 'frost', name: 'Mróz', dur: 40, need: 5, slow: 8, freeze: 15, text: 'Spowalnia wroga; 5 stosów zamraża go na 1,5 s.' },
  poison: { id: 'poison', name: 'Salmonella', dur: 60, max: 12, per: 6, spread: 50, text: 'Słabsze obrażenia co sekundę, ale przechodzą na kolejnego wroga.' },
  bleed: { id: 'bleed', name: 'Krwawienie', dur: 30, max: 3, per: 8, text: 'Obrażenia co sekundę; do 3 stosów.' },
};

// Żywioły (oznaczenia kafelków): pokazywane na kartach, używane przez przepisy Wylęgarni i Odznaki.
export const ELEMENTS = {
  ogien: { name: 'Ogień', color: '#ff7a3d' }, lod: { name: 'Lód', color: '#7fd3ff' }, trucizna: { name: 'Salmonella', color: '#9ccc65' },
  krew: { name: 'Krew', color: '#e53950' }, jajo: { name: 'Jajo', color: '#fff3d6' }, ziarno: { name: 'Ziarno', color: '#ffc933' }, korpo: { name: 'Korpo', color: '#b0bec5' },
};

// ---------- Zestawy przedmiotów ----------
export const SETS = {
  jajeczne: { name: 'Jajeczne', b2: 'Tykające Jajo wybucha co 6 s', b3: 'Wybuchy leczą 3% maks. Życia' },
  zbozowe: { name: 'Zbożowe', b2: '+10% Ziaren z nagród', b3: 'Worek Kukurydzy bez limitu premii' },
  rambo: { name: 'Rambo', b2: '+20% Ataku', b3: 'Ostatni Okrzyk: raz na walkę 3 s nietykalności poniżej 20% Życia' },
  rosolowe: { name: 'Rosołowe', b2: '+25% obrażeń od Oparzenia', b3: 'Ataki zawsze nakładają Oparzenie', b4: 'Wrogowie zaczynają walkę z 3 stosami Oparzenia' },
  chlodnicze: { name: 'Chłodnicze', b2: 'Każdy stos Mrozu spowalnia o 12% zamiast 8%', b3: 'Zamrożenie wywołuje Lodową Falę: 80% Ataku we wszystkich wrogów', b4: 'Wrogowie zaczynają walkę z 2 stosami Mrozu' },
  korpo: { name: 'Korporacyjne', b2: 'Odpoczynek tańszy o 2 Ziarna', b3: 'Dokupowanie kafelków 25% taniej', b4: 'Odsetki: po każdej wygranej +10% posiadanych Ziaren (maks. 5)' },
};

// ---------- Kafelki ----------
// rarity 0..3; type stat|skill|item|risk; fx = lista modyfikatorów statystyk (patrz stats.js); lock = id odblokowania (patrz UNLOCKS);
// repeat = można brać wielokrotnie; event = kafelek-wydarzenie (obsługa w rules.js).
export const TILES = [
  // Statystyki
  { id: 'ziarno-mocy', name: 'Ziarno Mocy', type: 'stat', rarity: 0, repeat: true, text: '+6 Atak', fx: [{ k: 'atkFlat', v: 6 }], flavor: 'Jedno ziarno, a w nim cała sprawiedliwość.' },
  { id: 'ostry-dziob', name: 'Ostry Dziób', type: 'stat', rarity: 0, repeat: true, text: '+12% obrażeń', fx: [{ k: 'dmg', v: 12 }], flavor: 'Naostrzony na kamieniu, na którym ostrzy się cennik.' },
  { id: 'twardy-grzebien', name: 'Twardy Grzebień', type: 'stat', rarity: 0, repeat: true, text: '+20 maks. Życia', fx: [{ k: 'hpFlat', v: 20 }], flavor: 'Im czerwieńszy, tym trudniej go zgasić.' },
  { id: 'szybki-dziob', name: 'Szybki Dziób', type: 'stat', rarity: 0, repeat: true, text: '+10% tempa ataku', fx: [{ k: 'aspdPct', v: 10 }], flavor: 'Stuk, stuk, stuk. Księgowość nie nadąża.' },
  { id: 'pancerz-z-pierza', name: 'Pancerz z Pierza', type: 'stat', rarity: 0, repeat: true, text: '+6 Pancerza', fx: [{ k: 'armor', v: 6 }], flavor: 'Miękki w dotyku, twardy w boju.' },
  { id: 'czujne-oko', name: 'Czujne Oko', type: 'stat', rarity: 1, repeat: true, text: '+8% szansy na trafienie krytyczne', fx: [{ k: 'crit', v: 8 }], flavor: 'Widzi słabe punkty. Szczególnie Prezesa.' },
  { id: 'zwinne-nogi', name: 'Zwinne Nogi', type: 'stat', rarity: 1, repeat: true, text: '+6% uniku', fx: [{ k: 'evade', v: 6 }], flavor: 'Kto biega, ten się nie gotuje.' },
  { id: 'cieple-gniazdko', name: 'Ciepłe Gniazdko', type: 'stat', rarity: 1, repeat: true, text: '+2 Regeneracji / s', fx: [{ k: 'regen', v: 2 }], flavor: 'Nawet w fabryce znajdzie się kąt na drzemkę.' },
  { id: 'czterolistna-koniczyna', name: 'Czterolistna Koniczyna', type: 'stat', rarity: 2, repeat: true, lock: 'u-koniczyna', text: '+10 Szczęścia (lepsze kafelki w ofertach)', fx: [{ k: 'luck', v: 10 }], flavor: 'Rzadkie jak kurczak, który wraca z ubojni.' },
  // Umiejętności aktywne
  { id: 'kukurydziany-grad', name: 'Kukurydziany Grad', type: 'skill', rarity: 0, skill: 'grad', text: 'Umiejętność: 5 pocisków po 60% Ataku, cooldown 6,5 s', flavor: 'Deszcz ziarna, który nikogo nie nakarmi.' },
  { id: 'pianie-grozy', name: 'Pianie Grozy', type: 'skill', rarity: 1, skill: 'pianie', text: 'Umiejętność: ogłusza wrogów na 2 s, cooldown 9 s', flavor: 'Kikiriki, które słychać na dwudziestym piętrze.' },
  { id: 'jajeczny-granat', name: 'Jajeczny Granat', type: 'skill', rarity: 1, skill: 'granat', text: 'Umiejętność: 250% Ataku w jednym uderzeniu, cooldown 8 s', flavor: 'Zniesione ze złości.' },
  { id: 'dziobniecie-szalu', name: 'Dziobnięcie Szału', type: 'skill', rarity: 1, skill: 'dziobniecie', text: 'Umiejętność: +50% tempa ataku przez 6 s, cooldown 12 s', flavor: 'Gdy kurczak się wścieknie, dziób nie zna litości.' },
  { id: 'unik-skrzydlem', name: 'Unik Skrzydłem', type: 'skill', rarity: 2, skill: 'unik', lock: 'u-unik', text: 'Umiejętność: nietykalność przez 1,5 s, cooldown 10 s', flavor: 'Trzepot, którego nie dogoni żadna łyżka.' },
  { id: 'rosolowy-chlust', name: 'Rosołowy Chlust', type: 'skill', rarity: 1, skill: 'chlust', tags: ['ogien'], text: 'Umiejętność: 40% Ataku i 3 stosy Oparzenia na wszystkich, cooldown 8,5 s', flavor: 'Gorący wywar prosto z kotła. Uwaga, parzy.' },
  { id: 'lodowy-dziob', name: 'Lodowy Dziób', type: 'skill', rarity: 0, skill: 'lodowy', tags: ['lod'], text: 'Umiejętność: 150% Ataku i 2 stosy Mrozu, cooldown 6 s', flavor: 'Dziób trzymany całą noc w zamrażarce.' },
  { id: 'zgnile-jajo', name: 'Zgniłe Jajo', type: 'skill', rarity: 1, skill: 'zgnile', tags: ['trucizna', 'jajo'], text: 'Umiejętność: 5 stosów Salmonelli na celu, 1 na reszcie, cooldown 7,5 s', flavor: 'Data ważności: wczoraj. Rok temu.' },
  { id: 'kogucia-kontra', name: 'Kogucia Kontra', type: 'skill', rarity: 1, skill: 'kontra', lock: 'u-kontra', text: 'Umiejętność: 2,5 s połowy obrażeń i oddawania 120% Ataku, cooldown 10 s', flavor: 'Kto zaczepia koguta, ten zbiera.' },
  { id: 'darcie-pierza', name: 'Darcie Pierza', type: 'skill', rarity: 0, skill: 'darcie', tags: ['krew'], text: 'Umiejętność: 50% Ataku i 2 stosy Krwawienia na wszystkich, cooldown 8 s', flavor: 'Pierze leci, a wrogowie płaczą.' },
  { id: 'piaskowa-kapiel', name: 'Piaskowa Kąpiel', type: 'skill', rarity: 1, skill: 'kapiel', text: 'Umiejętność: przez 3 s wrogowie pudłują połowę ciosów, cooldown 11 s', flavor: 'Kurza kąpiel w piachu. Higiena po wiejsku.' },
  { id: 'dziobanie-premii', name: 'Dziobanie Premii', type: 'skill', rarity: 1, skill: 'premia', tags: ['korpo'], lock: 'u-premia', text: 'Umiejętność: 160% Ataku, zabójstwo daje Ziarno (do 3), cooldown 7 s', flavor: 'Premia uznaniowa. Uznaje ją dziób.' },
  { id: 'egzekucja-ostroga', name: 'Egzekucja Ostrogą', type: 'skill', rarity: 2, skill: 'egzekucja', tags: ['krew'], lock: 'u-egzekucja', text: 'Umiejętność: 130% Ataku, 400% poniżej 30% Życia wroga, cooldown 9 s', flavor: 'Szybko, sprawnie i bez zbędnej papierologii.' },
  { id: 'zagrzebanie-w-sianie', name: 'Zagrzebanie w Sianie', type: 'skill', rarity: 2, skill: 'zagrzebanie', lock: 'u-zagrzebanie', text: 'Umiejętność: leczy 30% maks. Życia, cooldown 16 s', flavor: 'Siano leczy wszystko. Prawie.' },
  // Przedmioty z synergią
  { id: 'zlote-jajo', name: 'Złote Jajo', type: 'item', rarity: 1, set: 'jajeczne', text: '+3 Ziarna po każdej wygranej rundzie', fx: [{ k: 'coinFlat', v: 3 }], flavor: 'Prezes by za nie zabił. Dosłownie.' },
  { id: 'tykajace-jajo', name: 'Tykające Jajo', type: 'item', rarity: 1, set: 'jajeczne', text: 'Co 8 s wybucha za 120% Ataku', fx: [{ k: 'egg', v: 1 }], flavor: 'Tik, tak. Lepiej się nie przyglądać.' },
  { id: 'gniazdo-zapasowe', name: 'Gniazdo Zapasowe', type: 'item', rarity: 2, set: 'jajeczne', lock: 'u-gniazdo', text: 'Raz na run: wskrzeszenie z 40% Życia', fx: [{ k: 'revive', v: 1 }], flavor: 'Każdy bohater ma plan B. Ten ma wyściółkę.' },
  { id: 'worek-kukurydzy', name: 'Worek Kukurydzy', type: 'item', rarity: 0, set: 'zbozowe', text: '+8% Ataku za każde 10 Ziaren (maks. +40%)', fx: [{ k: 'worek', v: 1 }], flavor: 'Bogactwo mierzy się w kolbach.' },
  { id: 'mlocarnia', name: 'Młocarnia', type: 'item', rarity: 1, set: 'zbozowe', text: '15% szans na rozbicie 10% Pancerza wroga przy trafieniu', fx: [{ k: 'shred', v: 15 }], flavor: 'Co na polu zrobi cep, to w fabryce zrobi dziób.' },
  { id: 'siewnik', name: 'Siewnik', type: 'item', rarity: 2, set: 'zbozowe', lock: 'u-siewnik', text: '+1 Ataku na stałe po każdej wygranej rundzie', fx: [{ k: 'siewnik', v: 1 }], flavor: 'Kto sieje wygrane, ten zbiera awans.' },
  { id: 'opaska-rambo', name: 'Opaska Rambo', type: 'item', rarity: 1, set: 'rambo', text: '+15% obrażeń, +10% szansy na trafienie krytyczne', fx: [{ k: 'dmg', v: 15 }, { k: 'crit', v: 10 }], flavor: 'Nic tak nie dodaje odwagi jak kawałek czerwonego materiału.' },
  { id: 'kamizelka-kuloodporna', name: 'Kamizelka Kuloodporna', type: 'item', rarity: 0, set: 'rambo', text: '+15 Pancerza, -10% tempa ataku', fx: [{ k: 'armor', v: 15 }, { k: 'aspdPct', v: -10 }], flavor: 'Ciężka, ale rosół zostaje na zewnątrz.' },
  { id: 'ostrogi-bojowe', name: 'Ostrogi Bojowe', type: 'item', rarity: 1, set: 'rambo', text: 'Ataki krwawią: 4 obrażenia / s przez 3 s', fx: [{ k: 'bleed', v: 4 }], flavor: 'Dwa kolce, jedna reputacja.' },
  { id: 'okulary-aviatory', name: 'Okulary Aviatory', type: 'item', rarity: 2, set: 'rambo', lock: 'u-okulary', text: '+30% do siły trafienia krytycznego', fx: [{ k: 'critMult', v: 30 }], flavor: 'Gdy wchodzisz do biura w okularach, nikt nie pyta o urlop.' },
  { id: 'zepsute-jajo', name: 'Zepsute Jajo', type: 'item', rarity: 1, set: 'jajeczne', tags: ['trucizna', 'jajo'], text: 'Wybuchy jaj i Granat nakładają 3 stosy Salmonelli; 10% szans na Salmonellę przy ataku', fx: [{ k: 'eggPoison', v: 3 }, { k: 'poisonHit', v: 10 }], flavor: 'Nikt nie chce wiedzieć, ile leżało w kącie.' },
  { id: 'mokra-pasza', name: 'Mokra Pasza', type: 'item', rarity: 0, set: 'zbozowe', tags: ['trucizna', 'ziarno'], text: '25% szans na Salmonellę przy ataku, +20% obrażeń Salmonelli', fx: [{ k: 'poisonHit', v: 25 }, { k: 'poisonPct', v: 20 }], flavor: 'Pachnie jak magazyn po powodzi.' },
  { id: 'kolczatka', name: 'Kolczatka', type: 'item', rarity: 1, set: 'rambo', tags: ['krew'], text: 'Ataki krwawią (3 na stos), +2 do limitu stosów Krwawienia', fx: [{ k: 'bleed', v: 3 }, { k: 'bleedMax', v: 2 }], flavor: 'Obroża po psie łańcuchowym. Teraz w lepszych rękach.' },
  // Zestaw Rosołowy (Oparzenie)
  { id: 'chochla', name: 'Chochla', type: 'item', rarity: 0, set: 'rosolowe', tags: ['ogien'], text: '25% szans na Oparzenie przy ataku', fx: [{ k: 'burnHit', v: 25 }], flavor: 'Służbowa. Z inwentarzem numer 0001.' },
  { id: 'kostka-rosolowa', name: 'Kostka Rosołowa', type: 'item', rarity: 1, set: 'rosolowe', tags: ['ogien'], text: '+40% obrażeń od Oparzenia, limit Oparzenia +5 stosów', fx: [{ k: 'burnPct', v: 40 }, { k: 'burnMax', v: 5 }], flavor: 'Skoncentrowany smak wroga.' },
  { id: 'lubczyk', name: 'Lubczyk', type: 'item', rarity: 1, set: 'rosolowe', tags: ['ogien'], text: '+15 maks. Życia; płonący wrogowie leczą cię (1 Życie na 2 stosy co sekundę)', fx: [{ k: 'hpFlat', v: 15 }, { k: 'burnHeal', v: 5 }], flavor: 'Bez lubczyku to nie rosół, tylko woda z kurczakiem.' },
  { id: 'garnek-cisnieniowy', name: 'Garnek Ciśnieniowy', type: 'item', rarity: 2, set: 'rosolowe', tags: ['ogien'], lock: 'u-garnek', text: 'Wróg z 8+ stosami Oparzenia wybucha: 150% Ataku we wszystkich, stosy znikają', fx: [{ k: 'pressure', v: 150 }], flavor: 'Gwizdek oznacza, że ktoś zaraz będzie miał zły dzień.' },
  // Zestaw Chłodniczy (Mróz)
  { id: 'kostka-lodu', name: 'Kostka Lodu', type: 'item', rarity: 0, set: 'chlodnicze', tags: ['lod'], text: '25% szans na Mróz przy ataku', fx: [{ k: 'frostHit', v: 25 }], flavor: 'Wyniesiona z Chłodni w dziobie. Szybko.' },
  { id: 'termometr', name: 'Termometr', type: 'item', rarity: 1, set: 'chlodnicze', tags: ['lod'], text: '+30% obrażeń przeciw wrogom z Mrozem albo zamrożonym', fx: [{ k: 'vsCold', v: 30 }], flavor: 'Pokazuje minus. Wrogom też.' },
  { id: 'zamrazarka', name: 'Zamrażarka', type: 'item', rarity: 1, set: 'chlodnicze', tags: ['lod'], text: 'Zamrożenie trwa 2 razy dłużej, wystarczą 4 stosy Mrozu', fx: [{ k: 'freezePct', v: 100 }, { k: 'frostNeed', v: 1 }], flavor: 'Kurczak wie najlepiej, jak się w niej siedzi.' },
  { id: 'szron', name: 'Szron na Piórach', type: 'item', rarity: 2, set: 'chlodnicze', tags: ['lod'], lock: 'u-szron', text: '+10 Pancerza; każdy wróg, który cię trafi, dostaje stos Mrozu', fx: [{ k: 'armor', v: 10 }, { k: 'frostThorns', v: 1 }], flavor: 'Zimny jak spojrzenie kadrowej.' },
  // Zestaw Korporacyjny (ekonomia)
  { id: 'teczka', name: 'Teczka', type: 'item', rarity: 0, set: 'korpo', tags: ['korpo'], text: '+2 Ziarna po każdej wygranej rundzie', fx: [{ k: 'coinFlat', v: 2 }], flavor: 'W środku drugie śniadanie i raport kwartalny.' },
  { id: 'krawat', name: 'Krawat', type: 'item', rarity: 1, set: 'korpo', tags: ['korpo'], text: '+1 darmowy reroll w każdej rundzie, +5% obrażeń', fx: [{ k: 'freeReroll', v: 1 }, { k: 'dmg', v: 5 }], flavor: 'Zawiązany na węzeł windsorski. Albo na szyi wroga.' },
  { id: 'polisa', name: 'Polisa Ubezpieczeniowa', type: 'item', rarity: 1, set: 'korpo', tags: ['korpo'], text: 'Nikt nie kradnie ci Ziaren; +5 Pancerza', fx: [{ k: 'noSteal', v: 1 }, { k: 'armor', v: 5 }], flavor: 'Obejmuje lisy, kanarki i inne zdarzenia losowe.' },
  { id: 'premia-kwartalna', name: 'Premia Kwartalna', type: 'item', rarity: 2, set: 'korpo', tags: ['korpo'], lock: 'u-premiakw', text: '+12 Ziaren za każdego pokonanego bossa, +10% Ataku', fx: [{ k: 'bossCoins', v: 12 }, { k: 'atkPct', v: 10 }], flavor: 'Wypłacana w ziarnie. Zarząd mówi, że to benefit.' },
  // Ryzyko i wydarzenia
  { id: 'pakt-z-lisem', name: 'Pakt z Lisem', type: 'risk', rarity: 1, text: '+50% Ataku, -30% maks. Życia do końca runu', fx: [{ k: 'atkPct', v: 50 }, { k: 'hpPct', v: -30 }], flavor: 'Lis ma drobny druk. Bardzo drobny.' },
  { id: 'szklane-skrzydlo', name: 'Szklane Skrzydło', type: 'risk', rarity: 2, lock: 'u-szklane', text: '+80% Ataku, -50% maks. Życia', fx: [{ k: 'atkPct', v: 80 }, { k: 'hpPct', v: -50 }], flavor: 'Piękne, kruche i bardzo, bardzo groźne.' },
  { id: 'tajemnicza-skrzynka', name: 'Tajemnicza Skrzynka', type: 'risk', rarity: 1, repeat: true, event: 'skrzynka', lock: 'u-skrzynka', text: 'Losowy kafelek epicki, ale 25% szans na pułapkę (-15% Życia)', flavor: 'Kto otwiera nieznane skrzynki, ten kończy w rosole albo w legendach.' },
  { id: 'sklepik-babci-kwoki', name: 'Sklepik Babci Kwoki', type: 'risk', rarity: 0, repeat: true, event: 'sklepik', text: 'Wydarzenie: kupujesz 1 z 3 kafelków za Ziarna', flavor: 'Babcia nie bierze kart. Babcia bierze ziarno.' },
  { id: 'hazard-w-kurniku', name: 'Hazard w Kurniku', type: 'risk', rarity: 0, repeat: true, event: 'hazard', lock: 'u-hazard', text: 'Wydarzenie: stawiasz Ziarna, 50% podwajasz, 50% tracisz', flavor: 'Zasady proste: dom zawsze wygrywa. Dom to kurnik.' },
  { id: 'automat-z-pasza', name: 'Automat z Paszą', type: 'risk', rarity: 0, repeat: true, event: 'automat', text: 'Wydarzenie: wrzucasz 5 Ziaren, wypadają 2 losowe kafelki statystyk', flavor: 'Czasem zwraca resztę. Czasem nie.' },
  { id: 'kontrakt-hr', name: 'Kontrakt z Działem HR', type: 'risk', rarity: 1, repeat: true, event: 'kontrakt', lock: 'u-kontrakt', text: 'Wydarzenie: podpisujesz etat (+Atak, mniej Ziaren) albo B2B (Ziarna teraz, mniej Życia)', flavor: 'Drobnym drukiem: „dusza w cenie”.' },
  { id: 'kapliczka', name: 'Kapliczka Świętego Rosołu', type: 'risk', rarity: 1, repeat: true, event: 'kapliczka', text: 'Wydarzenie: pełne uleczenie albo Odznaka do wyboru', flavor: 'Ktoś zostawił tu marchewkę. I pietruszkę.' },
  { id: 'umowa-etat', name: 'Umowa o Pracę', type: 'risk', rarity: 1, hidden: true, text: '+30% Ataku, -2 Ziarna po każdej rundzie', fx: [{ k: 'atkPct', v: 30 }, { k: 'coinFlat', v: -2 }], flavor: 'Etat, karta Multisport i wieczna lojalność.' },
  { id: 'umowa-b2b', name: 'Umowa B2B', type: 'risk', rarity: 1, hidden: true, text: '-15% maks. Życia (w zamian za 15 Ziaren od ręki)', fx: [{ k: 'hpPct', v: -15 }], flavor: 'Sam sobie sterem, żeglarzem i ZUS-em.' },
  { id: 'zakazana-pasza', name: 'Zakazana Pasza', type: 'risk', rarity: 3, lock: 'u-pasza', text: '+25% wszystkich statystyk, ale następny boss ma +30% Życia', fx: [{ k: 'allPct', v: 25 }], flavor: 'Smakuje jak moc. Kosztuje jak rachunek.' },
];
// ---------- Wylęgarnia: przedmioty wyklute z dwóch innych ----------
// Gdy gracz ma oba składniki przepisu, znikają i wykluwa się z nich legendarny przedmiot (ma efekty obu i premię, liczy się do ich zestawów).
// Wyklutych przedmiotów nie ma w ofertach.
const HATCHED = [
  { id: 'jajko-na-twardo', name: 'Jajko na Twardo', of: ['tykajace-jajo', 'kostka-rosolowa'], sets: ['jajeczne', 'rosolowe'], tags: ['jajo', 'ogien'], text: 'Co 6 s jajo wybucha we WSZYSTKICH wrogów (120% Ataku) i nakłada 4 stosy Oparzenia; +40% obrażeń od Oparzenia, limit +5', fx: [{ k: 'eggAll', v: 1 }, { k: 'eggBurn', v: 4 }, { k: 'burnPct', v: 40 }, { k: 'burnMax', v: 5 }], flavor: 'Gotowane dziesięć minut. W złości.' },
  { id: 'termos', name: 'Termos', of: ['chochla', 'kostka-lodu'], sets: ['rosolowe', 'chlodnicze'], tags: ['ogien', 'lod'], text: '40% szans na Oparzenie i 40% szans na Mróz przy każdym ataku', fx: [{ k: 'burnHit', v: 40 }, { k: 'frostHit', v: 40 }], flavor: 'Trzyma ciepło. I zimno. Nikt nie wie jak.' },
  { id: 'ostrogi-rzeznika', name: 'Ostrogi Rzeźnika', of: ['ostrogi-bojowe', 'kolczatka'], sets: ['rambo', 'rambo'], tags: ['krew'], text: 'Każdy atak nakłada 2 stosy Krwawienia (8 na stos), limit Krwawienia +4', fx: [{ k: 'bleed', v: 8 }, { k: 'bleedMax', v: 4 }, { k: 'bleedStacks', v: 2 }], flavor: 'Rzeźnik zrezygnował z pracy. Ostrogi zostały.' },
  { id: 'zloty-spadochron', name: 'Złoty Spadochron', of: ['zlote-jajo', 'teczka'], sets: ['jajeczne', 'korpo'], tags: ['jajo', 'korpo'], text: '+7 Ziaren po każdej wygranej rundzie, nikt nie kradnie ci Ziaren', fx: [{ k: 'coinFlat', v: 7 }, { k: 'noSteal', v: 1 }], flavor: 'Zarząd ląduje miękko. Teraz ty też.' },
  { id: 'spojrzenie-rambo', name: 'Spojrzenie Rambo', of: ['okulary-aviatory', 'opaska-rambo'], sets: ['rambo', 'rambo'], tags: ['krew'], text: '+20% obrażeń, +25% szansy na trafienie krytyczne, +50% siły trafienia krytycznego', fx: [{ k: 'dmg', v: 20 }, { k: 'crit', v: 25 }, { k: 'critMult', v: 50 }], flavor: 'Wrogowie mdleją, zanim zdejmie okulary.' },
  { id: 'kurtka-puchowa', name: 'Kurtka Puchowa', of: ['kamizelka-kuloodporna', 'szron'], sets: ['rambo', 'chlodnicze'], tags: ['lod'], text: '+30 Pancerza; każdy wróg, który cię trafi, dostaje 2 stosy Mrozu', fx: [{ k: 'armor', v: 30 }, { k: 'frostThorns', v: 2 }], flavor: 'Puch z własnych piór. Bez komentarza.' },
  { id: 'kompostownik', name: 'Kompostownik', of: ['mokra-pasza', 'zepsute-jajo'], sets: ['zbozowe', 'jajeczne'], tags: ['trucizna'], text: '40% szans na Salmonellę przy ataku, +50% jej obrażeń; jaja i Granat nakładają 3 stosy; przy śmierci wroga przechodzą WSZYSTKIE stosy', fx: [{ k: 'poisonHit', v: 40 }, { k: 'poisonPct', v: 50 }, { k: 'eggPoison', v: 3 }, { k: 'spreadPct', v: 50 }], flavor: 'Nic się nie marnuje. Zwłaszcza zaraza.' },
  { id: 'feniks-z-rosolu', name: 'Feniks z Rosołu', of: ['gniazdo-zapasowe', 'lubczyk'], sets: ['jajeczne', 'rosolowe'], tags: ['ogien'], text: 'Raz na run: wskrzeszenie z 70% Życia i 6 stosami Oparzenia na wszystkich wrogach; +15 maks. Życia, płonący wrogowie leczą', fx: [{ k: 'revivePct', v: 70 }, { k: 'reviveBurn', v: 6 }, { k: 'hpFlat', v: 15 }, { k: 'burnHeal', v: 5 }], flavor: 'Powstaje z garnka. Pachnie lubczykiem.' },
];
for (const h of HATCHED) TILES.push({ ...h, type: 'item', rarity: 3, hatched: true });
export const RECIPES = HATCHED.map(h => ({ out: h.id, of: h.of }));

// Progi statystyk: każde 3 kopie tego samego kafelka statystyki dają nazwaną premię.
export const MILESTONE_EVERY = 3;
export const MILESTONES = {
  'ziarno-mocy': { name: 'Kolba Mocy', text: '+15% Ataku', fx: [{ k: 'atkPct', v: 15 }] },
  'ostry-dziob': { name: 'Dziób Brzytwa', text: '+8% szansy na trafienie krytyczne, +20% jego siły', fx: [{ k: 'crit', v: 8 }, { k: 'critMult', v: 20 }] },
  'twardy-grzebien': { name: 'Koguci Hełm', text: '+10% maks. Życia, +4 Pancerza', fx: [{ k: 'hpPct', v: 10 }, { k: 'armor', v: 4 }] },
  'szybki-dziob': { name: 'Młot Pneumatyczny', text: '+12% tempa ataku', fx: [{ k: 'aspdPct', v: 12 }] },
  'pancerz-z-pierza': { name: 'Pierzasta Twierdza', text: '+6 Pancerza, +25 maks. Życia', fx: [{ k: 'armor', v: 6 }, { k: 'hpFlat', v: 25 }] },
  'czujne-oko': { name: 'Sokole Oko', text: '+30% siły trafienia krytycznego', fx: [{ k: 'critMult', v: 30 }] },
  'zwinne-nogi': { name: 'Taniec Kurczaka', text: '+5% uniku, +8% tempa ataku', fx: [{ k: 'evade', v: 5 }, { k: 'aspdPct', v: 8 }] },
  'cieple-gniazdko': { name: 'Kurza Drzemka', text: '+3 Regeneracji / s, +10 maks. Życia', fx: [{ k: 'regen', v: 3 }, { k: 'hpFlat', v: 10 }] },
  'czterolistna-koniczyna': { name: 'Pięciolistna Koniczyna', text: '+15 Szczęścia, +2 Ziarna po każdej rundzie', fx: [{ k: 'luck', v: 15 }, { k: 'coinFlat', v: 2 }] },
};

export const TILE_BY_ID = Object.fromEntries(TILES.map(t => [t.id, t]));

// ---------- Odblokowania ----------
// kind: 'char' | 'tile'; target = id postaci/kafelka; check w profile.js (po id).
export const UNLOCKS = [
  { id: 'u-kwoka', kind: 'char', target: 'kwoka', text: 'Ukończ pełny run' },
  { id: 'u-kaczor', kind: 'char', target: 'kaczor', text: 'Weź 5 kafelków ryzyka w jednym runie' },
  { id: 'u-indor', kind: 'char', target: 'indor', text: 'Pokonaj Prezesa Rosołu w trybie szybkim' },
  { id: 'u-koniczyna', kind: 'tile', target: 'czterolistna-koniczyna', text: 'Zbierz 100 Ziaren w jednym runie' },
  { id: 'u-unik', kind: 'tile', target: 'unik-skrzydlem', text: 'Pokonaj Brojlera Zdzisława' },
  { id: 'u-zagrzebanie', kind: 'tile', target: 'zagrzebanie-w-sianie', text: 'Wygraj walkę, kończąc ją z mniej niż 10% życia' },
  { id: 'u-gniazdo', kind: 'tile', target: 'gniazdo-zapasowe', text: 'Dojdź do rundy 10 w trybie pełnym' },
  { id: 'u-siewnik', kind: 'tile', target: 'siewnik', text: 'Ukończ tryb szybki' },
  { id: 'u-okulary', kind: 'tile', target: 'okulary-aviatory', text: 'Zadaj jednym trafieniem 150 obrażeń' },
  { id: 'u-szklane', kind: 'tile', target: 'szklane-skrzydlo', text: 'Weź Pakt z Lisem w 3 różnych runach' },
  { id: 'u-skrzynka', kind: 'tile', target: 'tajemnicza-skrzynka', text: 'Zakończ 5 runów' },
  { id: 'u-pasza', kind: 'tile', target: 'zakazana-pasza', text: 'Pokonaj Skubarkę 3000' },
  { id: 'u-kontra', kind: 'tile', target: 'kogucia-kontra', text: 'Wygraj walkę, w której wrogowie zadali ci łącznie więcej niż twoje maks. Życie' },
  { id: 'u-premia', kind: 'tile', target: 'dziobanie-premii', text: 'Miej 40 Ziaren naraz' },
  { id: 'u-egzekucja', kind: 'tile', target: 'egzekucja-ostroga', text: 'Zmutuj dowolną umiejętność' },
  { id: 'u-garnek', kind: 'tile', target: 'garnek-cisnieniowy', text: 'Zadaj 250 obrażeń Oparzeniem w jednej walce' },
  { id: 'u-szron', kind: 'tile', target: 'szron', text: 'Zamroź 8 wrogów w jednym runie' },
  { id: 'u-premiakw', kind: 'tile', target: 'premia-kwartalna', text: 'Pokonaj bossa, mając co najmniej 30 Ziaren' },
  { id: 'u-kontrakt', kind: 'tile', target: 'kontrakt-hr', text: 'Zdobądź 3 Odznaki w jednym runie' },
  { id: 'u-hazard', kind: 'tile', target: 'hazard-w-kurniku', text: 'Przegraj run z ponad 30 Ziarnami w kieszeni' },
];
export const UNLOCK_BY_ID = Object.fromEntries(UNLOCKS.map(u => [u.id, u]));

// Kafelki dostępne od początku (bez blokady).
export const STARTER_TILES = TILES.filter(t => !t.lock && !t.hatched && !t.hidden).map(t => t.id);

// ---------- Wrogowie ----------
// hp/atk to wartości bazowe w rundzie 1; skalowane mnożnikiem rundy (rules.js). aspd w % (100 = 1 cios/s).
export const ENEMIES = {
  'szczur-pasz': { id: 'szczur-pasz', name: 'Szczur Pasz', zone: 0, hp: 19, atk: 3, aspd: 120, armor: 0, evade: 0, crit: 0, art: 'rat', text: 'Szybki i słaby. Na rozgrzewkę.' },
  'lis-windykator': { id: 'lis-windykator', name: 'Lis Windykator', zone: 0, hp: 26, atk: 3, aspd: 100, armor: 0, evade: 0, crit: 0, steal: { n: 1, max: 3 }, art: 'fox', text: 'Przy trafieniu kradnie Ziarno.' },
  'pies-lancuchowy': { id: 'pies-lancuchowy', name: 'Pies Łańcuchowy', zone: 0, hp: 58, atk: 4, aspd: 60, armor: 5, evade: 0, crit: 0, art: 'dog', text: 'Wolny, ale bardzo dużo życia.' },
  'mysz-magazynier': { id: 'mysz-magazynier', name: 'Mysz Magazynier', zone: 1, hp: 15, atk: 3, aspd: 110, armor: 0, evade: 0, crit: 0, swarm: 3, art: 'mouse', text: 'Wchodzi w roju po trzy.' },
  'wozek-widlowy': { id: 'wozek-widlowy', name: 'Wózek Widłowy', zone: 1, hp: 71, atk: 8, aspd: 50, armor: 4, evade: 0, crit: 0, spec: { every: 110, windup: 20, mult: 300 }, art: 'forklift', text: 'Szarżuje. Ogłusz go albo unikaj.' },
  'balwan-z-chlodni': { id: 'balwan-z-chlodni', name: 'Bałwan z Chłodni', zone: 1, hp: 75, atk: 6, aspd: 80, armor: 3, evade: 0, crit: 0, slow: { pct: 20, ticks: 30 }, art: 'snowman', text: 'Każdym trafieniem spowalnia twoje ataki.' },
  'jajo-sortownik': { id: 'jajo-sortownik', name: 'Jajo-Sortownik', zone: 2, hp: 60, atk: 5, aspd: 90, armor: 8, evade: 0, crit: 0, shieldHits: 3, art: 'robot', text: 'Tarcza pochłania pierwsze 3 ciosy.' },
  'kot-ochroniarz': { id: 'kot-ochroniarz', name: 'Kot Ochroniarz', zone: 2, hp: 39, atk: 6, aspd: 130, armor: 2, evade: 25, crit: 25, art: 'cat', text: 'Wysoki unik i krytyk.' },
  'ksiegowy-kanarek': { id: 'ksiegowy-kanarek', name: 'Księgowy Kanarek', zone: 2, hp: 37, atk: 5, aspd: 100, armor: 0, evade: 0, crit: 0, steal: { n: 1, max: 99 }, art: 'canary', text: 'Każdy cios zabiera Ziarno.' },
  'kaczka-podpalaczka': { id: 'kaczka-podpalaczka', name: 'Kaczka Podpalaczka', zone: 0, hp: 22, atk: 2, aspd: 100, armor: 0, evade: 0, crit: 0, ignite: 30, art: 'duck', text: 'Jej ciosy cię podpalają: Oparzenie co sekundę.' },
  'kurczak-z-zamrazarki': { id: 'kurczak-z-zamrazarki', name: 'Kurczak z Zamrażarki', zone: 1, hp: 52, atk: 6, aspd: 80, armor: 2, evade: 0, crit: 0, rise: 50, resist: ['frost'], art: 'zombie', text: 'Odporny na Mróz. Po śmierci wstaje z połową Życia, chyba że płonie.' },
  'sep-audytor': { id: 'sep-audytor', name: 'Sęp Audytor', zone: 2, hp: 55, atk: 6, aspd: 90, armor: 4, evade: 0, crit: 0, audit: 60, art: 'vulture', text: 'Co 6 s Audyt: zdejmuje efekty z sojuszników i dostaje tarczę na 2 ciosy.' },
  'pisklak-stazysta': { id: 'pisklak-stazysta', name: 'Pisklak-stażysta', zone: 0, hp: 9, atk: 2, aspd: 100, armor: 0, evade: 0, crit: 0, minion: true, art: 'intern', text: 'Pracuje za darmo i za nic.' },
};

export const BOSSES = {
  brojler: { id: 'brojler', name: 'Brojler Zdzisław', title: 'Szef Zmiany', hp: 95, atk: 6, aspd: 90, armor: 3, evade: 0, crit: 0, art: 'broiler',
    text: 'Co jakiś czas wzywa stażystów. Poniżej połowy życia dostaje Premię Motywacyjną.', quote: 'Nikt nie widział go na urlopie.' },
  skubarka: { id: 'skubarka', name: 'Skubarka 3000', title: 'Maszyna', hp: 149, atk: 12, aspd: 80, armor: 6, evade: 0, crit: 0, shield: 25, art: 'plucker',
    text: 'Tarcza z pierza, potem fale uderzeń, a na koniec Skubanie twoich kafelków.', quote: 'Skubie, bo kocha.' },
  prezes: { id: 'prezes', name: 'Prezes Rosołu', title: 'Zarząd', hp: 108, atk: 12, aspd: 90, armor: 6, evade: 0, crit: 0, art: 'boss',
    text: 'Nietykalny, dopóki żyją Ochroniarze. Potem Restrukturyzacja i Wrzący Garnek.', quote: 'Padł Prezes, a z nim upadł cały cennik.' },
};

// ---------- Cechy elitarnych wrogów ----------
export const AFFIXES = {
  opancerzony: { name: 'Opancerzony', text: '+15 Pancerza i tarcza na 2 ciosy' },
  wampiryczny: { name: 'Wampiryczny', text: 'Leczy się o połowę zadanych obrażeń' },
  wybuchowy: { name: 'Wybuchowy', text: 'Po śmierci wybucha za 200% swojego Ataku' },
  ognioodporny: { name: 'Ognioodporny', text: 'Odporny na Oparzenie i Salmonellę' },
  mrozny: { name: 'Mroźny', text: 'Odporny na Mróz, jego ciosy spowalniają' },
  szybki: { name: 'Szybki', text: '+40% tempa ataku' },
  regenerujacy: { name: 'Regenerujący', text: 'Odnawia 2% maks. Życia na sekundę' },
};

// ---------- Odznaki Pracownicze (nagroda za bossa i elitę; pasywne, nie zajmują miejsca) ----------
export const BADGES = {
  'pracownik-miesiaca': { name: 'Pracownik Miesiąca', text: 'Umiejętność w 1. slocie jest gotowa od początku walki', fx: [{ k: 'firstReady', v: 1 }] },
  'nadgodziny': { name: 'Nadgodziny', text: 'Po 20 s walki +25% obrażeń', fx: [{ k: 'overtime', v: 25 }] },
  'bhp': { name: 'Szkolenie BHP', text: '+10% maks. Życia, leczenie po rundzie +10 pkt proc.', fx: [{ k: 'hpPct', v: 10 }, { k: 'healBonus', v: 10 }] },
  'delegacja': { name: 'Delegacja', text: '+1 darmowy reroll w każdej rundzie, +1 Ziarno po rundzie', fx: [{ k: 'freeReroll', v: 1 }, { k: 'coinFlat', v: 1 }] },
  'team-building': { name: 'Team Building', text: 'Umiejętności mają o 15% krótszy cooldown', fx: [{ k: 'cdPct', v: 15 }] },
  'karta-multisport': { name: 'Karta Multisport', text: '+3 Regeneracji / s, +5% uniku', fx: [{ k: 'regen', v: 3 }, { k: 'evade', v: 5 }] },
  'awans': { name: 'Awans', text: '+20% Ataku', fx: [{ k: 'atkPct', v: 20 }] },
  'kawa-z-ekspresu': { name: 'Kawa z Ekspresu', text: '+15% tempa ataku', fx: [{ k: 'aspdPct', v: 15 }] },
  'nagana-z-wpisem': { name: 'Nagana z Wpisem', text: '+10% szansy na trafienie krytyczne; krytyki nakładają 2 stosy Krwawienia', fx: [{ k: 'crit', v: 10 }, { k: 'critBleed', v: 2 }] },
  'fundusz-socjalny': { name: 'Fundusz Socjalny', text: 'Odpoczynek leczy 2 razy więcej i kosztuje 1 Ziarno mniej', fx: [{ k: 'restBonus', v: 20 }, { k: 'restDisc', v: 1 }] },
  'klucz-do-serwerowni': { name: 'Klucz do Serwerowni', text: 'Efekty statusowe trwają 50% dłużej, Oparzenie i Salmonella +15% obrażeń', fx: [{ k: 'stDur', v: 50 }, { k: 'burnPct', v: 15 }, { k: 'poisonPct', v: 15 }] },
  'parasol-ochronny': { name: 'Parasol Ochronny', text: 'Pierwsze 3 ciosy wrogów w każdej walce są zablokowane', fx: [{ k: 'parasol', v: 3 }] },
};
export const BADGE_OFFER = 3;

// ---------- Temperatura Garnka (poziomy trudności) ----------
export const GARNEK = [
  { name: 'Letni', text: 'Brak modyfikatorów.' },
  { name: 'Ciepły', text: 'Wrogowie mają +10% Życia.' },
  { name: 'Gorący', text: 'Reroll droższy o 1 Ziarno, elitarni wrogowie (poza pierwszymi piętrami) mają 2 cechy.' },
  { name: 'Wrzący', text: 'Leczenie po rundzie spada z 35% do 20%.' },
  { name: 'Kipiący', text: 'Bossowie mają +20% tempa ataku.' },
  { name: 'Wulkan Rosołu', text: 'Wrogowie mają +5% Ataku, a regeneracja w walce działa o połowę słabiej.' },
];
// Modyfikatory sumują się od poziomu 0 do wybranego.
export function garnekMods(level) {
  const L = Math.max(0, Math.min(5, level | 0));
  return {
    enemyHp: L >= 1 ? 10 : 0,
    rerollExtra: L >= 2 ? 1 : 0,
    elites: true, eliteAffixes: L >= 2 ? 2 : 1,
    healPct: L >= 3 ? 20 : RULES.healPct,
    bossAspd: L >= 4 ? 20 : 0,
    enemyAtk: L >= 5 ? 5 : 0,
    noRegen: L >= 5,
  };
}

// Wagi rzadkości: [zwykły, rzadki, epicki, legendarny] dla trzech etapów runu (początek, środek, koniec).
export const RARITY_WEIGHTS = [[70, 25, 5, 0], [50, 35, 13, 2], [35, 38, 22, 5]];
// Wagi typów kafelków w ofercie.
export const TYPE_WEIGHTS = { stat: 40, skill: 20, item: 25, risk: 15 };
