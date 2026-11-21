// Bulgot: wszystkie dane gry w jednym miejscu (kafelki, postacie, wrogowie, bossowie, poziomy Garnka).
// Źródło prawdy jest tutaj; frontend dostaje kopię przez `bulgot/dev/sync-engine.mjs` (plik w bulgot/shared/ jest GENEROWANY, nie edytuj go).
// Dodanie treści = dopisanie obiektu poniżej, bez zmian w kodzie silnika.
// Czas w tickach: 1 tick = 100 ms, 10 ticków = 1 sekunda.

export const TICKS_PER_S = 10;

export const RARITY = ['Zwykły', 'Rzadki', 'Epicki', 'Legendarny'];
export const TYPES = { stat: 'Statystyka', skill: 'Umiejętność', item: 'Przedmiot', risk: 'Ryzyko' };

// ---------- Tryby ----------
// grow: o ile rośnie życie i atak wrogów z każdą rundą (mnożnik). bosses: runda -> boss. bonusAfter: po tych bossach dodatkowa oferta.
export const MODES = {
  quick: { name: 'Szybki', rounds: 10, bosses: { 5: 'brojler', 10: 'prezes' }, bonusAfter: [5], grow: { hp: 1.07, atk: 1.045 }, bossPct: { hp: 80, atk: 90 },
    zones: [{ upTo: 5, zone: 0 }, { upTo: 10, zone: 1 }], elite: [3, 8] },
  full: { name: 'Pełny', rounds: 20, bosses: { 6: 'brojler', 12: 'skubarka', 20: 'prezes' }, bonusAfter: [6, 12], grow: { hp: 1.065, atk: 1.04 }, bossPct: { hp: 100, atk: 100 },
    zones: [{ upTo: 6, zone: 0 }, { upTo: 12, zone: 1 }, { upTo: 20, zone: 2 }], elite: [3, 9, 15] },
};

export const ZONES = [
  { name: 'Kurnik i Podwórze', tag: 'I' },
  { name: 'Magazyn Pasz i Chłodnia', tag: 'II' },
  { name: 'Sortownia Jaj i Biuro Zarządu', tag: 'III' },
];

// Stałe zasad.
export const RULES = {
  coinsRound: 4, coinsBoss: 6, healPct: 35, rerollBase: 2, offerSize: 4, bonusSize: 3,
  eliteCoinsPct: 50, scoreRound: 1000, scoreCoin: 50, scoreTimeMax: 2000, garnekScore: 25, maxSkills: 3, maxSkillLvl: 2,
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
  indor: { id: 'indor', name: 'Indor Bogdan', style: 'Ciężkie ciosy', text: '+60% Ataku, -30% tempa ataku, 15% krytyku.', base: BASE,
    fx: [{ k: 'atkPct', v: 60 }, { k: 'aspdPct', v: -30 }, { k: 'crit', v: 10 }], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-indor' },
};

// ---------- Umiejętności aktywne ----------
// cd i dur w tickach. Poziom 2: +30% mocy i -20% cooldownu.
export const SKILLS = {
  grad: { id: 'grad', name: 'Kukurydziany Grad', cd: 100, hits: 5, pct: 60, text: '5 pocisków po 60% Ataku w losowych wrogów.', key: 'grad' },
  pianie: { id: 'pianie', name: 'Pianie Grozy', cd: 140, dur: 20, text: 'Ogłusza wszystkich wrogów na 2 s i przerywa ich szarże.', key: 'pianie' },
  granat: { id: 'granat', name: 'Jajeczny Granat', cd: 120, pct: 250, text: '250% Ataku w jednym uderzeniu.', key: 'granat' },
  dziobniecie: { id: 'dziobniecie', name: 'Dziobnięcie Szału', cd: 180, dur: 60, text: '+50% tempa ataku przez 6 s.', key: 'dziobniecie' },
  unik: { id: 'unik', name: 'Unik Skrzydłem', cd: 160, dur: 15, text: 'Nietykalność przez 1,5 s.', key: 'unik' },
  zagrzebanie: { id: 'zagrzebanie', name: 'Zagrzebanie w Sianie', cd: 250, pct: 30, text: 'Leczy 30% maks. Życia.', key: 'zagrzebanie' },
};

// ---------- Zestawy przedmiotów ----------
export const SETS = {
  jajeczne: { name: 'Jajeczne', b2: 'Tykające Jajo wybucha co 6 s', b3: 'Wybuchy leczą 3% maks. Życia' },
  zbozowe: { name: 'Zbożowe', b2: '+10% Ziaren z nagród', b3: 'Worek Kukurydzy bez limitu premii' },
  rambo: { name: 'Rambo', b2: '+20% Ataku', b3: 'Ostatni Okrzyk: raz na walkę 3 s nietykalności poniżej 20% Życia' },
};

// ---------- Kafelki (30) ----------
// rarity 0..3; type stat|skill|item|risk; fx = lista modyfikatorów statystyk (patrz stats.js); lock = id odblokowania (patrz UNLOCKS);
// repeat = można brać wielokrotnie; event = kafelek-wydarzenie (obsługa w rules.js).
export const TILES = [
  // Statystyki
  { id: 'ziarno-mocy', name: 'Ziarno Mocy', type: 'stat', rarity: 0, repeat: true, text: '+4 Atak', fx: [{ k: 'atkFlat', v: 4 }], flavor: 'Jedno ziarno, a w nim cała sprawiedliwość.' },
  { id: 'twardy-grzebien', name: 'Twardy Grzebień', type: 'stat', rarity: 0, repeat: true, text: '+20 maks. Życia', fx: [{ k: 'hpFlat', v: 20 }], flavor: 'Im czerwieńszy, tym trudniej go zgasić.' },
  { id: 'szybki-dziob', name: 'Szybki Dziób', type: 'stat', rarity: 0, repeat: true, text: '+10% tempa ataku', fx: [{ k: 'aspdPct', v: 10 }], flavor: 'Stuk, stuk, stuk. Księgowość nie nadąża.' },
  { id: 'pancerz-z-pierza', name: 'Pancerz z Pierza', type: 'stat', rarity: 0, repeat: true, text: '+6 Pancerza', fx: [{ k: 'armor', v: 6 }], flavor: 'Miękki w dotyku, twardy w boju.' },
  { id: 'czujne-oko', name: 'Czujne Oko', type: 'stat', rarity: 1, repeat: true, text: '+8% krytyku', fx: [{ k: 'crit', v: 8 }], flavor: 'Widzi słabe punkty. Szczególnie Prezesa.' },
  { id: 'zwinne-nogi', name: 'Zwinne Nogi', type: 'stat', rarity: 1, repeat: true, text: '+6% uniku', fx: [{ k: 'evade', v: 6 }], flavor: 'Kto biega, ten się nie gotuje.' },
  { id: 'cieple-gniazdko', name: 'Ciepłe Gniazdko', type: 'stat', rarity: 1, repeat: true, text: '+2 Regeneracji / s', fx: [{ k: 'regen', v: 2 }], flavor: 'Nawet w fabryce znajdzie się kąt na drzemkę.' },
  { id: 'czterolistna-koniczyna', name: 'Czterolistna Koniczyna', type: 'stat', rarity: 2, repeat: true, lock: 'u-koniczyna', text: '+10 Szczęścia (lepsze kafelki w ofertach)', fx: [{ k: 'luck', v: 10 }], flavor: 'Rzadkie jak kurczak, który wraca z ubojni.' },
  // Umiejętności aktywne
  { id: 'kukurydziany-grad', name: 'Kukurydziany Grad', type: 'skill', rarity: 0, skill: 'grad', text: 'Umiejętność: 5 pocisków po 60% Ataku, cooldown 10 s', flavor: 'Deszcz ziarna, który nikogo nie nakarmi.' },
  { id: 'pianie-grozy', name: 'Pianie Grozy', type: 'skill', rarity: 1, skill: 'pianie', text: 'Umiejętność: ogłusza wrogów na 2 s, cooldown 14 s', flavor: 'Kikiriki, które słychać na dwudziestym piętrze.' },
  { id: 'jajeczny-granat', name: 'Jajeczny Granat', type: 'skill', rarity: 1, skill: 'granat', text: 'Umiejętność: 250% Ataku w jednym uderzeniu, cooldown 12 s', flavor: 'Zniesione ze złości.' },
  { id: 'dziobniecie-szalu', name: 'Dziobnięcie Szału', type: 'skill', rarity: 1, skill: 'dziobniecie', text: 'Umiejętność: +50% tempa ataku przez 6 s, cooldown 18 s', flavor: 'Gdy kurczak się wścieknie, dziób nie zna litości.' },
  { id: 'unik-skrzydlem', name: 'Unik Skrzydłem', type: 'skill', rarity: 2, skill: 'unik', lock: 'u-unik', text: 'Umiejętność: nietykalność przez 1,5 s, cooldown 16 s', flavor: 'Trzepot, którego nie dogoni żadna łyżka.' },
  { id: 'zagrzebanie-w-sianie', name: 'Zagrzebanie w Sianie', type: 'skill', rarity: 2, skill: 'zagrzebanie', lock: 'u-zagrzebanie', text: 'Umiejętność: leczy 30% maks. Życia, cooldown 25 s', flavor: 'Siano leczy wszystko. Prawie.' },
  // Przedmioty z synergią
  { id: 'zlote-jajo', name: 'Złote Jajo', type: 'item', rarity: 1, set: 'jajeczne', text: '+3 Ziarna po każdej wygranej rundzie', fx: [{ k: 'coinFlat', v: 3 }], flavor: 'Prezes by za nie zabił. Dosłownie.' },
  { id: 'tykajace-jajo', name: 'Tykające Jajo', type: 'item', rarity: 1, set: 'jajeczne', text: 'Co 8 s wybucha za 120% Ataku', fx: [{ k: 'egg', v: 1 }], flavor: 'Tik, tak. Lepiej się nie przyglądać.' },
  { id: 'gniazdo-zapasowe', name: 'Gniazdo Zapasowe', type: 'item', rarity: 2, set: 'jajeczne', lock: 'u-gniazdo', text: 'Raz na run: wskrzeszenie z 40% Życia', fx: [{ k: 'revive', v: 1 }], flavor: 'Każdy bohater ma plan B. Ten ma wyściółkę.' },
  { id: 'worek-kukurydzy', name: 'Worek Kukurydzy', type: 'item', rarity: 0, set: 'zbozowe', text: '+8% Ataku za każde 10 Ziaren (maks. +40%)', fx: [{ k: 'worek', v: 1 }], flavor: 'Bogactwo mierzy się w kolbach.' },
  { id: 'mlocarnia', name: 'Młocarnia', type: 'item', rarity: 1, set: 'zbozowe', text: '15% szans na rozbicie 10% Pancerza wroga przy trafieniu', fx: [{ k: 'shred', v: 15 }], flavor: 'Co na polu zrobi cep, to w fabryce zrobi dziób.' },
  { id: 'siewnik', name: 'Siewnik', type: 'item', rarity: 2, set: 'zbozowe', lock: 'u-siewnik', text: '+1 Ataku na stałe po każdej wygranej rundzie', fx: [{ k: 'siewnik', v: 1 }], flavor: 'Kto sieje wygrane, ten zbiera awans.' },
  { id: 'opaska-rambo', name: 'Opaska Rambo', type: 'item', rarity: 1, set: 'rambo', text: '+15% obrażeń, +10% krytyku', fx: [{ k: 'dmg', v: 15 }, { k: 'crit', v: 10 }], flavor: 'Nic tak nie dodaje odwagi jak kawałek czerwonego materiału.' },
  { id: 'kamizelka-kuloodporna', name: 'Kamizelka Kuloodporna', type: 'item', rarity: 0, set: 'rambo', text: '+15 Pancerza, -10% tempa ataku', fx: [{ k: 'armor', v: 15 }, { k: 'aspdPct', v: -10 }], flavor: 'Ciężka, ale rosół zostaje na zewnątrz.' },
  { id: 'ostrogi-bojowe', name: 'Ostrogi Bojowe', type: 'item', rarity: 1, set: 'rambo', text: 'Ataki krwawią: 4 obrażenia / s przez 3 s', fx: [{ k: 'bleed', v: 4 }], flavor: 'Dwa kolce, jedna reputacja.' },
  { id: 'okulary-aviatory', name: 'Okulary Aviatory', type: 'item', rarity: 2, set: 'rambo', lock: 'u-okulary', text: '+30% do mnożnika krytyka', fx: [{ k: 'critMult', v: 30 }], flavor: 'Gdy wchodzisz do biura w okularach, nikt nie pyta o urlop.' },
  // Ryzyko i wydarzenia
  { id: 'pakt-z-lisem', name: 'Pakt z Lisem', type: 'risk', rarity: 1, text: '+50% Ataku, -30% maks. Życia do końca runu', fx: [{ k: 'atkPct', v: 50 }, { k: 'hpPct', v: -30 }], flavor: 'Lis ma drobny druk. Bardzo drobny.' },
  { id: 'szklane-skrzydlo', name: 'Szklane Skrzydło', type: 'risk', rarity: 2, lock: 'u-szklane', text: '+80% Ataku, -50% maks. Życia', fx: [{ k: 'atkPct', v: 80 }, { k: 'hpPct', v: -50 }], flavor: 'Piękne, kruche i bardzo, bardzo groźne.' },
  { id: 'tajemnicza-skrzynka', name: 'Tajemnicza Skrzynka', type: 'risk', rarity: 1, repeat: true, event: 'skrzynka', lock: 'u-skrzynka', text: 'Losowy kafelek epicki, ale 25% szans na pułapkę (-15% Życia)', flavor: 'Kto otwiera nieznane skrzynki, ten kończy w rosole albo w legendach.' },
  { id: 'sklepik-babci-kwoki', name: 'Sklepik Babci Kwoki', type: 'risk', rarity: 0, repeat: true, event: 'sklepik', text: 'Wydarzenie: kupujesz 1 z 3 kafelków za Ziarna', flavor: 'Babcia nie bierze kart. Babcia bierze ziarno.' },
  { id: 'hazard-w-kurniku', name: 'Hazard w Kurniku', type: 'risk', rarity: 0, repeat: true, event: 'hazard', lock: 'u-hazard', text: 'Wydarzenie: stawiasz Ziarna, 50% podwajasz, 50% tracisz', flavor: 'Zasady proste: dom zawsze wygrywa. Dom to kurnik.' },
  { id: 'zakazana-pasza', name: 'Zakazana Pasza', type: 'risk', rarity: 3, lock: 'u-pasza', text: '+25% wszystkich statystyk, ale następny boss ma +30% Życia', fx: [{ k: 'allPct', v: 25 }], flavor: 'Smakuje jak moc. Kosztuje jak rachunek.' },
];
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
  { id: 'u-hazard', kind: 'tile', target: 'hazard-w-kurniku', text: 'Przegraj run z ponad 30 Ziarnami w kieszeni' },
];
export const UNLOCK_BY_ID = Object.fromEntries(UNLOCKS.map(u => [u.id, u]));

// Kafelki dostępne od początku (bez blokady).
export const STARTER_TILES = TILES.filter(t => !t.lock).map(t => t.id);

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
  'pisklak-stazysta': { id: 'pisklak-stazysta', name: 'Pisklak-stażysta', zone: 0, hp: 9, atk: 2, aspd: 100, armor: 0, evade: 0, crit: 0, minion: true, art: 'intern', text: 'Pracuje za darmo i za nic.' },
};

export const BOSSES = {
  brojler: { id: 'brojler', name: 'Brojler Zdzisław', title: 'Szef Zmiany', hp: 95, atk: 6, aspd: 90, armor: 3, evade: 0, crit: 0, art: 'broiler',
    text: 'Co jakiś czas wzywa stażystów. Poniżej połowy życia dostaje Premię Motywacyjną.', quote: 'Nikt nie widział go na urlopie.' },
  skubarka: { id: 'skubarka', name: 'Skubarka 3000', title: 'Maszyna', hp: 149, atk: 12, aspd: 80, armor: 6, evade: 0, crit: 0, shield: 25, art: 'plucker',
    text: 'Tarcza z pierza, potem fale uderzeń, a na koniec Skubanie twoich kafelków.', quote: 'Skubie, bo kocha.' },
  prezes: { id: 'prezes', name: 'Prezes Rosołu', title: 'Zarząd', hp: 88, atk: 11, aspd: 90, armor: 6, evade: 0, crit: 0, art: 'boss',
    text: 'Nietykalny, dopóki żyją Ochroniarze. Potem Restrukturyzacja i Wrzący Garnek.', quote: 'Padł Prezes, a z nim upadł cały cennik.' },
};

// ---------- Temperatura Garnka (poziomy trudności) ----------
export const GARNEK = [
  { name: 'Letni', text: 'Brak modyfikatorów.' },
  { name: 'Ciepły', text: 'Wrogowie mają +10% Życia.' },
  { name: 'Gorący', text: 'Reroll droższy o 1 Ziarno, pojawiają się elitarni wrogowie.' },
  { name: 'Wrzący', text: 'Leczenie po rundzie spada z 35% do 20%.' },
  { name: 'Kipiący', text: 'Bossowie mają +20% tempa ataku.' },
  { name: 'Wulkan Rosołu', text: 'Wrogowie mają +15% Ataku, a regeneracja w walce jest wyłączona.' },
];
// Modyfikatory sumują się od poziomu 0 do wybranego.
export function garnekMods(level) {
  const L = Math.max(0, Math.min(5, level | 0));
  return {
    enemyHp: L >= 1 ? 10 : 0,
    rerollExtra: L >= 2 ? 1 : 0,
    elites: L >= 2,
    healPct: L >= 3 ? 20 : RULES.healPct,
    bossAspd: L >= 4 ? 20 : 0,
    enemyAtk: L >= 5 ? 15 : 0,
    noRegen: L >= 5,
  };
}

// Wagi rzadkości: [zwykły, rzadki, epicki, legendarny] dla trzech etapów runu (początek, środek, koniec).
export const RARITY_WEIGHTS = [[70, 25, 5, 0], [50, 35, 13, 2], [35, 38, 22, 5]];
// Wagi typów kafelków w ofercie.
export const TYPE_WEIGHTS = { stat: 40, skill: 20, item: 25, risk: 15 };
