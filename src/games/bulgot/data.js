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
  quick: { name: 'Szybki', extraPct: { hp: 80, atk: 90 }, rounds: 10, bosses: { 5: 'brojler', 10: 'prezes' }, bonusAfter: [5], early: { rounds: 3, hp: 120, atk: 80 }, grow: { hp: 1.090, atk: 1.060 }, bossPct: { hp: 80, atk: 90 },
    zones: [{ upTo: 5, zone: 0 }, { upTo: 10, zone: 1 }], elite: [4, 8], doors: [2, 6, 9] },
  full: { name: 'Pełny', extraPct: { hp: 80, atk: 90 }, rounds: 20, bosses: { 6: 'brojler', 12: 'skubarka', 20: 'prezes' }, bonusAfter: [6, 12], early: { rounds: 4, hp: 120, atk: 80 }, grow: { hp: 1.091, atk: 1.056 }, bossPct: { hp: 100, atk: 100 },
    zones: [{ upTo: 6, zone: 0 }, { upTo: 12, zone: 1 }, { upTo: 20, zone: 2 }], elite: [4, 10, 16], zoneMul: [null, null, { hp: 130, atk: 112 }], doors: [2, 5, 8, 11, 14, 17] },
};
// doors: piętra z Rozwidleniem Korytarza (wybór: zwykłe piętro albo wróg z cechą elity za nagrodę).

export const ZONES = [
  { name: 'Kurnik i Podwórze', tag: 'I' },
  { name: 'Magazyn Pasz i Chłodnia', tag: 'II' },
  { name: 'Sortownia Jaj i Biuro Zarządu', tag: 'III' },
];

// Stałe zasad. prices = cena dokupienia kafelka wg rzadkości (zwykły, rzadki, epicki, legendarny); early = osłabienie ataku i wzmocnienie życia wrogów na pierwszych piętrach (dłuższe, spokojniejsze walki).
export const RULES = {
  shopPct: 60, betPct: 60,   // Sklepik Babci Kwoki sprzedaje za 60% ceny, a rzut w Hazardzie wygrywa się w 60% (audyt: wydarzenia, które graczom nie opłacały się wcale)
  extraCoins: 8, extraLoot: true,   // nagroda za dodatkową rundę (Gruszka, Pipsztal): Ziarna i wybór legendarnej statystyki
  coinsRound: 4, coinsBoss: 6, prices: [6, 12, 20, 30], restCost: 4, restPct: 20, healPct: 35, rerollBase: 2, offerSize: 4, bonusSize: 3,
  eliteCoinsPct: 50, scoreRound: 1000, scoreCoin: 50, scoreTimeMax: 2000, garnekScore: 25, maxSkills: 3, maxSkillLvl: 3,
  // Odsetki w Spiżarni: +1 Ziarno za każde `interestPer` niewydanych Ziaren po wygranej walce, najwyżej `interestMax` (Kaczor: CHARS.kaczor.interestMax).
  interestPer: 10, interestMax: 3,
  // Rozwidlenie Korytarza: ryzykowne drzwi = pierwszy wróg z cechą elity (życie/atak w %), nagroda: Ziarna albo wybór rzadkiego kafelka.
  doorCoins: 10, doorHp: 161, doorAtk: 124,   // doorCoins: zamiast rzadkiego kafelka można wziąć tyle Ziaren; zwykłe drzwi leczą jak Odpoczynek, ryzykowne odbierają leczenie po walce
  // Łup z bossa: po pokonaniu bossa (poza ostatnim) wybierasz 1 z `lootSize` legendarnych statystyk (kafelki z flagą boss).
  lootSize: 3, lootChance: 15, upgradeCost: 2,   // % szans, że po bossie (nie ostatnim) pojawia się okno wyboru łupu
  // Lombard Lisa: zastaw = pełna cena rzadkości teraz, wykup na następnym piętrze za `pawnBack`% ceny; przepadek wzmacnia Lisy o `pawnFox`%.
  pawnBack: 150, pawnFox: 25,
  // Wadliwa Partia: szansa (%) na kafelek z wadą w ofercie i o ile (%) mocniejsze są jego dodatnie efekty.
  flawChance: 25, flawBoost: 50,
  // Okno Gdakania: kolejna umiejętność w ciągu `chainWindow` ticków podbija obrażenia (2. o chainPct[0]%, 3. o chainPct[1]%), pełna seria ogłusza na `chainStun`.
  chainWindow: 15, chainPct: [20, 50], chainStun: 10,
  // Awans Wroga: Nemezis ma tyle % życia/ataku (rośnie z każdym awansem).
  nemesisHp: 140, nemesisAtk: 115,
  // Zjarany Kurczak (ukryte odblokowanie): tyle Ziaren łącznie zdobytych w jednym runie. Chmura Dymu co `smokeEvery` ticków (4 s): stosy Oparzenia, spowolnienie wrogów (%) i jego czas.
  u420: 420, smokeBurn: 2, smokeSlow: 22, smokeTicks: 24,
  // Arena Duchów: Duch ma tyle % statystyk gracza z tego samego piętra jego runu; nagroda: Ziarna i wybór rzadkiego kafelka.
  ghostPct: 95, ghostAtk: 120, arenaCoins: 6,
  // Dogrywka: po Prezesie wrogowie rosną dodatkowo o tyle % Życia i Ataku na każde piętro ponad limit trybu; super-boss co 5 pięter.
  endlessHp: 8, endlessAtk: 6, superEvery: 5,
  // Kurnik: Pióra za run = ukończone piętra + premia za wygraną (+ palnik) + 2 za każde piętro Dogrywki.
  featherWin: 8, featherGarnek: 2, featherEndless: 2,
  // Hordy i Armie (szablony pięter z wieloma wrogami): górny limit wrogów w jednej walce = foeCap + foePerPet za każdego towarzysza gracza.
  // Część wrogów wchodzi od razu, reszta falami po 2 co `waveGap` ticków (6 s); wchodzący wróg przez `waveIdle` ticków nie atakuje.
  foeCap: 5, foePerPet: 2, waveGap: 60, waveIdle: 10, waveSize: 2,
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
  pyrtek: { id: 'pyrtek', name: 'Pyrtek', style: 'Uniwersalny', text: 'Mały, ale zawzięty. +7% Ataku i Życia, bez fanaberii.', base: BASE, fx: [{ k: 'atkPct', v: 7 }, { k: 'hpPct', v: 7 }], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: null },
  kwoka: { id: 'kwoka', retired: true, name: 'Kwoka Babcia', style: 'Czołg', text: '+12% Życia, -25% szybkości ataku. Zaczyna z Zagrzebaniem w Sianie.', base: BASE,
    fx: [{ k: 'hpPct', v: 12 }, { k: 'aspdPct', v: -25 }], startSkills: [['zagrzebanie', 1]], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-kwoka' },
  kaczor: { id: 'kaczor', retired: true, name: 'Kaczor Hazardzista', style: 'Ryzyko', text: '+10 Ziaren, 1 darmowy reroll na rundę, więcej kafelków ryzyka w ofertach, Odsetki do 5 Ziaren.', base: BASE,
    fx: [], startSkills: [], coins: 10, freeRerolls: 1, riskWeight: 2, lock: 'u-kaczor', interestMax: 5 },
  indor: { id: 'indor', retired: true, name: 'Indor Bogdan', style: 'Ciężkie ciosy', text: '+55% Ataku, -30% szybkości ataku, 15% szansy na dziobnięcie.', base: BASE,
    fx: [{ k: 'atkPct', v: 55 }, { k: 'aspdPct', v: -30 }, { k: 'crit', v: 10 }], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-indor' },
  zjarany: { id: 'zjarany', name: 'Zjarany Kurczak', style: 'Oparzenie i luz', secret: true,
    text: 'Podpala wrogów (30% Oparzenia, limit +4, leczy się od płonących), ale jest najarany od rana: -45% szybkości ataku i -10% Ataku. Co 4 s Chmura Dymu: Oparzenie i spowolnienie wrogów.', base: BASE,
    fx: [{ k: 'burnHit', v: 30 }, { k: 'burnMax', v: 4 }, { k: 'regen', v: 14 }, { k: 'burnHeal', v: 3 }, { k: 'aspdPct', v: -45 }, { k: 'atkPct', v: -10 }, { k: 'smoke', v: 40 }],
    startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-420', hasCode: true },
  barista: { id: 'barista', name: 'Kurczak Barista', style: 'Szybkie ciosy', text: 'Espresso w żyłach: każdy cios w walce daje +5% szybkości ataku (maks. +60%), nowa walka zaczyna się od zera. Zaczyna ze Szałem Dziobów, ma -20% maks. Życia i -5% Ataku, a każda walka zaczyna się od zimnego startu.', base: BASE,
    fx: [{ k: 'aspdPct', v: 0 }, { k: 'hpPct', v: -20 }, { k: 'atkPct', v: -5 }, { k: 'ramp', v: 5 }], startSkills: [['dziobniecie', 1]], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-barista' },
  ges: { id: 'ges', name: 'Gęś Księgowa', style: 'Ekonomia', text: 'Kapitał pracuje: za każde 5 Ziaren w kieszeni +1% Ataku (maks. +25%). +15 Ziaren na start, +1 Ziarno po wygranej, Odsetki do 6 Ziaren. Każde wydane Ziarno to utracona moc, a -10% Ataku bez kapitału boli.', base: BASE,
    fx: [{ k: 'coinFlat', v: 1 }, { k: 'atkPct', v: -10 }], startSkills: [], coins: 15, freeRerolls: 0, riskWeight: 1, lock: 'u-ges', interestMax: 6, coinAtk: true },
  lodziarz: { id: 'lodziarz', retired: true, name: 'Kurczak Lodziarz', style: 'Mróz', text: '15% szans na Mróz przy ataku, wrogowie z Mrozem zadają o 10% mniej obrażeń, -25% szybkości ataku. Zaczyna z Lodowym Dziobem.', base: BASE,
    fx: [{ k: 'frostHit', v: 15 }, { k: 'frostWeak', v: 10 }, { k: 'aspdPct', v: -25 }], startSkills: [['lodowy', 1]], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-lodziarz' },
  pielegniarka: { id: 'pielegniarka', retired: true, name: 'Kura Pielęgniarka', style: 'Leczenie', text: '+0,8 Regeneracji / s, leczenie po rundzie +5 pkt proc., -25% Ataku. Zaczyna z Zagrzebaniem w Sianie. Nie wygra szybko, ale też nie padnie.', base: BASE,
    fx: [{ k: 'regen', v: 8 }, { k: 'healBonus', v: 5 }, { k: 'atkPct', v: -25 }], startSkills: [['zagrzebanie', 1]], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-pielegniarka' },
  rzeznik: { id: 'rzeznik', name: 'Kogut Rzeźnik', style: 'Krwawienie', text: 'Każdy atak nakłada Krwawienie, limit stosów +1. Zabicie krwawiącego wroga leczy 5% maks. Życia. Zaczyna z Darciem Pierza, ale ma -10% maks. Życia i -5% Ataku.', base: BASE,
    fx: [{ k: 'bleed', v: 1 }, { k: 'bleedMax', v: 1 }, { k: 'hpPct', v: -10 }, { k: 'atkPct', v: -5 }, { k: 'bleedKillHeal', v: 5 }], startSkills: [['darcie', 1]], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-rzeznik' },
  wrozka: { id: 'wrozka', retired: true, name: 'Indyczka Wróżka', style: 'Szczęście', text: '+30 Szczęścia (lepsze oferty), 1 darmowy reroll na rundę, +8% Ataku. Zawsze wie, że coś się wydarzy, tylko nie zawsze co.', base: BASE,
    fx: [{ k: 'luck', v: 30 }, { k: 'atkPct', v: 8 }], startSkills: [], coins: 0, freeRerolls: 1, riskWeight: 1, lock: 'u-wrozka' },
  stazysta: { id: 'stazysta', retired: true, name: 'Kurczak Stażysta', style: 'Powolny start', text: '-22% Ataku i maks. Życia na start, ale każde wygrane piętro daje +5% wszystkich statystyk (maks. +40%). Zaczyna słabo, pod koniec jest najgroźniejszy.', base: BASE,
    fx: [{ k: 'atkPct', v: -22 }, { k: 'hpPct', v: -22 }], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-stazysta', perFloor: 5, perFloorMax: 40 },
  mutant: { id: 'mutant', retired: true, name: 'Kurczak Mutant', style: 'Umiejętności', text: 'Umiejętności mają o 25% krótszy cooldown, -15% maks. Życia. Zaczyna z losową umiejętnością.', base: BASE,
    fx: [{ k: 'cdPct', v: 25 }, { k: 'hpPct', v: -15 }], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-mutant', randomSkill: true },
  dinozaur: { id: 'dinozaur', retired: true, name: 'Dinozaur', style: 'Ukryty', text: 'Zaczyna z Jajkiem Dinozaura, które po 4 wygranych piętrach wykluwa się w Dinozaura (+30% Ataku i Życia). Do tego czasu nie ma żadnych kar.', base: BASE,
    fx: [], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-dino', secret: true, startTiles: ['jajko-dinozaura'] },
  // Memiczne kurczaki „na hardkorze”: każdy ma jedną wielką wadę, która rządzi całym runem. Wygrana nimi to wyczyn.
  gigachad: { id: 'gigachad', name: 'Kurczak na Jednej Nodze', style: 'Jedna umiejętność', text: 'Stoi na jednej nodze i ma tylko 1 slot umiejętności, ale ta jedna uderza z mocą 250% i ładuje się szybciej. Jedna doskonała sztuczka zamiast zestawu. Cena: -10% szybkości ataku i -10% maks. Życia, a każdy kafelek umiejętności poza jedną jest martwy.', base: BASE,
    fx: [{ k: 'skillPow', v: 150 }, { k: 'cdPct', v: 30 }, { k: 'atkPct', v: 35 }, { k: 'aspdPct', v: -10 }, { k: 'hpPct', v: -10 }], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-gigachad', skillSlots: 1 },
  jajeczko: { id: 'jajeczko', name: 'Pan Jajeczko', style: 'Szklana kula', text: 'Ma 3 punkty życia (!) i zapasowe gniazdo na start, ale 75% uniku, +150% Ataku i +30% szybkości ataku. Każdy unik daje +5% Ataku do końca walki (maks. +50%). Pierwszy trafiony cios to koniec.', base: BASE,
    fx: [{ k: 'hpPct', v: -95 }, { k: 'evade', v: 75 }, { k: 'atkPct', v: 150 }, { k: 'aspdPct', v: 30 }, { k: 'dodgeAtk', v: 5 }], startSkills: [], startTiles: ['gniazdo-zapasowe'], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-jajeczko' },
  krypto: { id: 'krypto', retired: true, name: 'Kurczak Kryptowalutowy', style: 'Rynek', text: 'Co piętro jego wszystkie statystyki zmieniają się losowo od -30% do +55% („rynek”). Raz jest księciem, raz bankrutem, a kurs poznasz dopiero w walce.', base: BASE,
    fx: [], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-krypto', crypto: [-30, 55] },
  alkoholik: { id: 'alkoholik', retired: true, name: 'Kogut Alkoholik', style: 'Wieczny Poniedziałek', text: '+30% szansy na dziobnięcie i +120% Mocy Dziobnięcia, ale -25% szybkości ataku i -15% maks. Życia. Trafia rzadko, za to z impetem.', base: BASE,
    fx: [{ k: 'crit', v: 30 }, { k: 'critMult', v: 120 }, { k: 'aspdPct', v: -25 }, { k: 'hpPct', v: -15 }], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-alkoholik' },
  wegan: { id: 'wegan', retired: true, name: 'Kurczak Wegan', style: 'Bez mięsa', text: 'Odpoczynek leczy o połowę mniej, -10% maks. Życia. Za to wrogowie patrzą na niego z oburzeniem. Bez skutku.', base: BASE,
    fx: [{ k: 'restHalf', v: 1 }, { k: 'hpPct', v: -10 }], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-wegan' },
  baba: { id: 'baba', retired: true, name: 'Baba z Targu', style: 'Drogo', text: '+25 Ziaren na start, ale wszystko kupuje o 30% drożej, -12% Ataku i -12% maks. Życia. Bez dokupowania jest bezbronna, a dokupowanie ją rujnuje.', base: BASE,
    fx: [{ k: 'buyDisc', v: -30 }, { k: 'atkPct', v: -12 }, { k: 'hpPct', v: -12 }], startSkills: [], coins: 25, freeRerolls: 0, riskWeight: 1, lock: 'u-baba' },
  influencer: { id: 'influencer', retired: true, name: 'Kurczak Influencer', style: 'Zasięgi', text: '+35% szansy na dziobnięcie i +100% Mocy Dziobnięcia, ale -25% maks. Życia i -15% Ataku. Bez dziobnięcia spada engagement, a z nim cała reszta.', base: BASE,
    fx: [{ k: 'crit', v: 35 }, { k: 'critMult', v: 100 }, { k: 'hpPct', v: -25 }, { k: 'atkPct', v: -15 }], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-influencer' },
  skibidi: { id: 'skibidi', retired: true, name: 'Kurczak Skibidi', style: 'Chaos', text: 'Zaczyna z dwiema losowymi umiejętnościami (nie wybierasz ich), cooldowny -10%, ale -25% maks. Życia i -12% Ataku. Czasem trafi ultimate, czasem w ścianę.', base: BASE,
    fx: [{ k: 'cdPct', v: 10 }, { k: 'hpPct', v: -25 }, { k: 'atkPct', v: -12 }], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-skibidi', randomSkill: 2 },
  emeryt: { id: 'emeryt', name: 'Emeryt Janusz', style: 'Twardy staruszek', text: 'Za moich czasów twardzi byli. Każde 4 punkty Pancerza dają +3% Ataku (maks. +45%). +10% maks. Życia, +6 Pancerza, +1 Regeneracji / s, ale -35% szybkości ataku. Bije wolno i ciągle narzeka.', base: BASE,
    fx: [{ k: 'hpPct', v: 10 }, { k: 'armor', v: 6 }, { k: 'regen', v: 10 }, { k: 'aspdPct', v: -35 }, { k: 'armorAtk', v: 3 }], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-emeryt' },
  sigma: { id: 'sigma', retired: true, name: 'Kurczak Sigma Solo', style: 'Samotny wilk', text: 'Bonusy zestawów (2/3/4/6) nie działają, powiązania żywiołów też nie. Do tego tylko +3% Ataku i Życia. Każdy kafelek liczy się osobno, nikt mu nie pomaga.', base: BASE,
    fx: [{ k: 'atkPct', v: 3 }, { k: 'hpPct', v: 3 }], startSkills: [], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-sigma', noSets: true },

  sanepid: { id: 'sanepid', name: 'Inspektor Sanepid', style: 'Salmonella', text: 'Przyszedł skontrolować fabrykę i nigdy nie wyszedł. 25% Salmonelli przy ataku, a wróg z 5 lub więcej stosami jest „zamknięty przez Sanepid”: dostaje +25% obrażeń i bije o 20% wolniej. Zaczyna ze Zgniłym Jajem. Cena: -20% Ataku i -10% maks. Życia.', base: BASE,
    fx: [{ k: 'poisonHit', v: 25 }, { k: 'sanepid', v: 25 }, { k: 'spreadPct', v: 20 }, { k: 'atkPct', v: -20 }, { k: 'hpPct', v: -10 }], startSkills: [['zgnile', 1]], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-sanepid' },
  wanda: { id: 'wanda', name: 'Nioska Wanda', style: 'Jaja', text: 'Znosi złote jaja, a zarząd je sprzedaje. Wanda postanowiła je zatrzymać. Zaczyna z Tykającym Jajem, jej jaja uderzają we wszystkich wrogów naraz i z każdym wygranym piętrem rosną o 4% (maks. +60%). Zestaw Jajeczny liczy się dla niej o 1 sztukę więcej. Cena: -15% Ataku.', base: BASE,
    fx: [{ k: 'eggAll', v: 1 }, { k: 'eggGrow', v: 4 }, { k: 'atkPct', v: -15 }], startSkills: [], startTiles: ['tykajace-jajo'], setBonus: { jajeczne: 1 }, coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-wanda' },
  zwiazkowiec: { id: 'zwiazkowiec', name: 'Kogut Związkowiec', style: 'Kontrola', text: 'Zorganizował strajk i pilnuje, żeby nikt nie pracował. Każda walka zaczyna się od Strajku Włoskiego: wrogowie (także nowe fale) stoją ogłuszeni 1,8 s. Ogłuszeni i zamrożeni wrogowie dostają od niego +25% obrażeń. Zaczyna z Pianiem Grozy. Cena: -20% Ataku, -12% maks. Życia.', base: BASE,
    fx: [{ k: 'strike', v: 18 }, { k: 'vsStun', v: 25 }, { k: 'atkPct', v: -20 }, { k: 'hpPct', v: -12 }], startSkills: [['pianie', 1]], coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-zwiazkowiec' },
  pacyfista: { id: 'pacyfista', name: 'Kurczak Pacyfista', style: 'Bez ataku', text: 'Nie bije. Wcale. Jego zwykłe ataki nie istnieją, za to umiejętności są o 30% mocniejsze, ładują się o 40% szybciej, a Oparzenie, Salmonella i Krwawienie bolą o 60% bardziej. Towarzysz walczy za niego (+60% mocy). Zaczyna z Rosołowym Chlustem, Zgniłym Jajem i losowym towarzyszem. Jeśli nic nie zrobisz, nic się nie stanie. Dla wrogów też.', base: BASE,
    fx: [{ k: 'noAttack', v: 1 }, { k: 'dotPct', v: 60 }, { k: 'cdPct', v: 40 }, { k: 'skillPow', v: 30 }, { k: 'compPow', v: 60 }, { k: 'regen', v: 8 }], startSkills: [['chlust', 1], ['zgnile', 1]], startCompanion: true, coins: 0, freeRerolls: 0, riskWeight: 1, lock: 'u-pacyfista' },
};

// Aktywne postacie (wycofane zostają w CHARS tylko dla historii, rankingu i zapisów).
export const CHAR_IDS = Object.keys(CHARS).filter(id => !CHARS[id].retired);

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
  dziobniecie: { id: 'dziobniecie', name: 'Szał Dziobów', cd: 120, dur: 60, text: '+50% szybkości ataku przez 6 s.', key: 'dziobniecie', el: 'krew',
    muts: [{ name: 'Szał Krwi', text: 'W szale każdy cios nakłada 2 stosy Krwawienia.' }, { name: 'Wieczny Szał', text: 'Szał trwa 2 razy dłużej.' }] },
  unik: { id: 'unik', name: 'Unik Skrzydłem', cd: 100, dur: 15, text: 'Nietykalność przez 1,5 s.', key: 'unik',
    muts: [{ name: 'Unik z Kontrą', text: 'Każdy zablokowany cios oddaje atakującemu 100% Ataku.' }, { name: 'Skrzydło Wiatru', text: 'Nietykalność trwa 2 razy dłużej.' }] },
  zagrzebanie: { id: 'zagrzebanie', name: 'Zagrzebanie w Sianie', cd: 160, pct: 30, text: 'Leczy 30% maks. Życia.', key: 'zagrzebanie',
    muts: [{ name: 'Głębokie Siano', text: 'Leczy 50% maks. Życia zamiast 30%.' }, { name: 'Wściekłe Siano', text: 'Po wyjściu z siana przez 4 s każdy cios to mocne dziobnięcie.' }] },
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

  // Etap 2: nowe umiejętności (po 1–2 na żywioł i styl)
  wrzatek: { id: 'wrzatek', name: 'Wrzątek z Kotła', cd: 70, pct: 60, n: 3, text: '60% Ataku, podwaja stosy Oparzenia na celu i dodaje 3.', key: 'wrzatek', el: 'ogien',
    muts: [{ name: 'Wrzątek Hurtowy', text: 'Działa na wszystkich wrogów.' }, { name: 'Gotowanie na Wolnym Ogniu', text: '150% Ataku zamiast 60%.' }] },
  podpalka: { id: 'podpalka', name: 'Podpałka', cd: 90, dur: 60, text: 'Przez 6 s każdy zwykły atak nakłada stos Oparzenia.', key: 'podpalka', el: 'ogien',
    muts: [{ name: 'Pochodnia', text: 'Każdy atak nakłada 2 stosy.' }, { name: 'Długi Knot', text: 'Trwa 2 razy dłużej.' }] },
  powiew: { id: 'powiew', name: 'Mroźny Powiew', cd: 75, n: 3, text: '3 stosy Mrozu na wszystkich wrogach.', key: 'powiew', el: 'lod',
    muts: [{ name: 'Zamieć', text: '5 stosów Mrozu zamiast 3.' }, { name: 'Szron na Piórach', text: 'Dodatkowo leczy 10% maks. Życia.' }] },
  sopel: { id: 'sopel', name: 'Sopel w Plecy', cd: 70, pct: 110, exec: 300, text: '110% Ataku; wróg z Mrozem lub zamrożony dostaje 300%.', key: 'sopel', el: 'lod',
    muts: [{ name: 'Odłamki', text: 'Pozostali wrogowie dostają 50% Ataku.' }, { name: 'Lodowa Seria', text: 'Uderza dwa razy.' }] },
  zakwas: { id: 'zakwas', name: 'Zakwas Babci Kwoki', cd: 90, n: 1, text: 'Podwaja stosy Salmonelli na wszystkich wrogach i dodaje 1.', key: 'zakwas', el: 'trucizna',
    muts: [{ name: 'Burzliwa Fermentacja', text: 'Potraja stosy zamiast podwajać.' }, { name: 'Zakwas Mamy', text: 'Leczy 2% maks. Życia za każdy stos Salmonelli na wrogach.' }] },
  pazury: { id: 'pazury', name: 'Wyrywanie Pazurów', cd: 85, pct: 100, n: 3, text: '100% Ataku i 3 stosy Krwawienia na celu; leczy 2% maks. Życia za każdy stos Krwawienia na celu.', key: 'pazury', el: 'krew',
    muts: [{ name: 'Krwawy Taniec', text: 'Trzy uderzenia w losowych wrogów.' }, { name: 'Wampirze Pazury', text: 'Leczy 4% maks. Życia za stos zamiast 2%.' }] },
  wir: { id: 'wir', name: 'Jajeczny Wir', cd: 75, hits: 3, pct: 70, text: '3 jaja po 70% Ataku w losowych wrogów.', key: 'wir', el: 'jajo',
    muts: [{ name: 'Jajecznica', text: 'Każde jajo nakłada stos Oparzenia.' }, { name: 'Dziesiątka', text: '6 jaj zamiast 3.' }] },
  garsc: { id: 'garsc', name: 'Garść Ziarna', cd: 110, dur: 50, pct: 30, text: 'Przez 5 s +30% obrażeń i leczy 10% maks. Życia.', key: 'garsc', el: 'ziarno',
    muts: [{ name: 'Wiadro Ziarna', text: '+60% obrażeń zamiast 30%.' }, { name: 'Biesiada', text: 'Leczy 25% maks. Życia zamiast 10%.' }] },
  zwolnienie: { id: 'zwolnienie', name: 'Zwolnienie Dyscyplinarne', cd: 95, pct: 130, thr: 25, text: '130% Ataku; wróg poniżej 25% Życia (nie boss) odchodzi natychmiast. Zwolnienie daje 1 Ziarno (do 3 na walkę).', key: 'zwolnienie', el: 'korpo',
    muts: [{ name: 'Odprawa', text: '+2 Ziarna za zwolnienie, do 6 na walkę.' }, { name: 'Restrukturyzacja', text: 'Próg zwolnienia to 40% Życia.' }] },
  pogotowie: { id: 'pogotowie', name: 'Kurze Pogotowie', cd: 130, dur: 40, pct: 8, text: 'Przez 4 s leczy 8% maks. Życia na sekundę.', key: 'pogotowie',
    muts: [{ name: 'Pełne Pogotowie', text: 'Leczy 14% na sekundę.' }, { name: 'Dyżur Nocny', text: 'Trwa 2 razy dłużej.' }] },

  // ----- Etap 4 (2026-11-23): 20 nowych umiejętności -----
  fala: { id: 'fala', name: 'Rosołowa Fala', cd: 95, pct: 85, n: 2, text: '85% Ataku wszystkim wrogom; płonący wrogowie dostają jeszcze 2 stosy Oparzenia.', key: 'fala', el: 'ogien',
    muts: [{ name: 'Fala Przypływu', text: '120% Ataku zamiast 85%.' }, { name: 'Gorąca Para', text: '2 stosy Oparzenia dostają wszyscy wrogowie, nie tylko płonący.' }] },
  lawina: { id: 'lawina', name: 'Lawina Segregatorów', cd: 80, pct: 90, hits: 3, text: '3 segregatory w jeden cel: 90%, 110% i 130% Ataku.', key: 'lawina', el: 'korpo',
    muts: [{ name: 'Pięć Teczek', text: '5 segregatorów zamiast 3.' }, { name: 'Pod Lawiną', text: 'Ostatni segregator ogłusza cel na 1,5 s.' }] },
  zwarcie: { id: 'zwarcie', name: 'Zwarcie w Biurze', cd: 85, pct: 90, text: '90% Ataku w cel; piorun przeskakuje na 2 kolejnych wrogów (60%) i ogłusza ich na 0,5 s.', key: 'zwarcie', el: 'korpo',
    muts: [{ name: 'Piorun Kulisty', text: 'Piorun przeskakuje na wszystkich wrogów.' }, { name: 'Przepięcie', text: '130% Ataku w główny cel.' }] },
  dziobanie: { id: 'dziobanie', name: 'Dziobanie Seryjne', cd: 70, pct: 35, hits: 5, text: '5 szybkich ciosów po 35% Ataku w jeden cel, każdy ma 15% szansy na stos Krwawienia.', key: 'dziobanie', el: 'krew',
    muts: [{ name: 'Maszynowe Dziobanie', text: '8 ciosów zamiast 5.' }, { name: 'Krwawa Seria', text: 'Każdy cios ma 40% szansy na 2 stosy Krwawienia.' }] },
  niespodzianka: { id: 'niespodzianka', name: 'Jajo z Niespodzianką', cd: 85, pct: 180, n: 4, text: 'Rzuca jajo o losowym skutku: 180% Ataku albo 4 stosy Oparzenia, Mrozu lub Salmonelli.', key: 'niespodzianka', el: 'jajo',
    muts: [{ name: 'Jajo Dwużółtkowe', text: 'Rzuca dwa jaja, każde z osobnym losowaniem.' }, { name: 'Jajecznica', text: 'Losowy skutek plus zawsze 150% Ataku.' }] },
  wypowiedzenie: { id: 'wypowiedzenie', name: 'Wypowiedzenie', cd: 90, pct: 200, dur: 40, text: 'Oznacza wroga: po 4 s dostaje 200% Ataku, a jeśli zginie, +2 Ziarna (do 6 na walkę).', key: 'wypowiedzenie', el: 'korpo',
    muts: [{ name: 'Wypowiedzenie Natychmiastowe', text: 'Cios po 2 s zamiast 4.' }, { name: 'Odprawa Zerowa', text: '250% Ataku i +3 Ziarna za zabójstwo.' }] },
  audyt: { id: 'audyt', name: 'Audyt Wewnętrzny', cd: 100, pct: 130, dur: 50, text: '130% Ataku; cel traci połowę Pancerza na 5 s.', key: 'audyt', el: 'korpo',
    muts: [{ name: 'Kontrola Skarbowa', text: 'Cel traci cały Pancerz.' }, { name: 'Audyt Wsteczny', text: 'Cel dostaje też +30% obrażeń na 5 s.' }] },
  bonus: { id: 'bonus', name: 'Bonus Kwartalny', cd: 100, pct: 120, text: '120% Ataku, +15% za każde 5 Ziaren w kieszeni (maks. +90%).', key: 'bonus', el: 'korpo',
    muts: [{ name: 'Premia Uznaniowa', text: '+25% za każde 5 Ziaren, maks. +150%.' }, { name: 'Wypłata Zaliczki', text: 'Zabójstwo daje +1 Ziarno (do 3 na walkę).' }] },
  ostateczny: { id: 'ostateczny', name: 'Rosół Ostateczny', cd: 180, pct: 360, n: 8, text: '360% Ataku w cel i 8 stosów Oparzenia.', key: 'ostateczny', el: 'ogien',
    muts: [{ name: 'Wrzący Finał', text: '12 stosów Oparzenia zamiast 8.' }, { name: 'Rosół Babuni', text: '500% Ataku i leczy 10% maks. Życia.' }] },
  zamrazarka: { id: 'zamrazarka', name: 'Zamrażarka Ręczna', cd: 90, pct: 100, dur: 20, text: '100% Ataku, cel zamarza na 2 s (boss na 1 s).', key: 'zamrazarka', el: 'lod',
    muts: [{ name: 'Głębokie Mrożenie', text: 'Zamrożenie trwa 3 s (boss 1,5 s).' }, { name: 'Mroźna Chłodnia', text: 'Zamraża wszystkich wrogów na 1 s.' }] },
  spotkanie: { id: 'spotkanie', name: 'Spotkanie bez Agendy', cd: 130, dur: 30, pct: 30, text: 'Ogłusza najsilniejszego wroga na 3 s (boss na 2 s); w tym czasie dostaje +30% obrażeń.', key: 'spotkanie', el: 'korpo',
    muts: [{ name: 'Zebranie Zarządu', text: 'Ogłusza wszystkich wrogów na 2 s i daje im +30% obrażeń.' }, { name: 'Spotkanie Bez Końca', text: 'Ogłuszenie trwa 5 s (boss 3 s).' }] },
  wicher: { id: 'wicher', name: 'Wicher Skrzydeł', cd: 75, pct: 45, dur: 10, text: '45% Ataku wszystkim wrogom i opóźnienie ich następnego ataku o 1 s.', key: 'wicher',
    muts: [{ name: 'Huragan', text: 'Opóźnienie ataków o 2 s.' }, { name: 'Trąba Powietrzna', text: '90% Ataku zamiast 45%.' }] },
  pulapka: { id: 'pulapka', name: 'Pułapka na Szczura', cd: 90, pct: 200, dur: 60, text: 'Zastawia pułapkę na 6 s: pierwszy atakujący wróg dostaje 200% Ataku i ogłuszenie na 1 s.', key: 'pulapka',
    muts: [{ name: 'Sidła', text: 'Pułapka czeka 12 s.' }, { name: 'Gilotyna', text: '320% Ataku zamiast 200%.' }] },
  tarcza: { id: 'tarcza', name: 'Gniazdo Tarczy', cd: 105, pct: 20, dur: 40, text: 'Tarcza pochłania obrażenia do 20% maks. Życia przez 4 s.', key: 'tarcza',
    muts: [{ name: 'Pancerne Gniazdo', text: 'Tarcza na 35% maks. Życia.' }, { name: 'Kolczasta Kopuła', text: 'Atakujący dostaje 60% Ataku za każdy cios w tarczę.' }] },
  kawa: { id: 'kawa', name: 'Przerwa Kawowa', cd: 150, pct: 12, dur: 30, text: 'Leczy 12% maks. Życia teraz i 12% po 3 s; przez 3 s masz 30% uniku.', key: 'kawa',
    muts: [{ name: 'Podwójne Espresso', text: 'Leczy 20% teraz i 20% po 3 s.' }, { name: 'Przerwa na Lunch', text: '60% uniku zamiast 30%.' }] },
  zemsta: { id: 'zemsta', name: 'Kocioł Zemsty', cd: 100, n: 2, dur: 40, text: 'Przez 4 s każdy cios, który dostajesz, nakłada atakującemu 2 stosy Oparzenia.', key: 'zemsta', el: 'ogien',
    muts: [{ name: 'Wrzący Kocioł', text: '4 stosy Oparzenia za cios.' }, { name: 'Długa Zmiana', text: 'Trwa 8 s.' }] },
  zupa: { id: 'zupa', name: 'Zupa Dnia', cd: 120, pct: 15, dur: 40, text: 'Leczy 15% maks. Życia i daje +20% szybkości ataku na 4 s.', key: 'zupa',
    muts: [{ name: 'Zupa z Wkładką', text: 'Leczy 25% maks. Życia.' }, { name: 'Zupa Pikantna', text: '+40% szybkości ataku.' }] },
  pobudka: { id: 'pobudka', name: 'Kogucia Pobudka', cd: 115, pct: 25, dur: 50, text: 'Przez 5 s +25% obrażeń i +15% szansy na dziobnięcie.', key: 'pobudka',
    muts: [{ name: 'Pobudka Generalna', text: '+40% obrażeń.' }, { name: 'Kukuryku', text: 'Trwa 8 s.' }] },
  echo: { id: 'echo', name: 'Kurze Echo', cd: 80, dur: 40, text: 'Następna użyta umiejętność odpala się drugi raz za darmo.', key: 'echo',
    muts: [{ name: 'Echo w Wąwozie', text: 'Dotyczy dwóch następnych umiejętności.' }, { name: 'Wieczne Echo', text: 'Przez 4 s każda umiejętność odpala się dwa razy.' }] },
  obieg: { id: 'obieg', name: 'Przyspieszony Obieg', cd: 120, pct: 35, text: 'Skraca o 35% pozostały cooldown wszystkich pozostałych umiejętności.', key: 'obieg',
    muts: [{ name: 'Turbo Obieg', text: 'Skraca o 50%.' }, { name: 'Obieg Zamknięty', text: 'Dodatkowo leczy 10% maks. Życia.' }] },
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

// Reakcje: dwa różne efekty na jednym wrogu łączą się (sprawdzane przy każdym nałożeniu efektu, `cd` ticków przerwy na wroga).
export const REACTIONS = {
  szok: { id: 'szok', name: 'Szok Termiczny', of: ['burn', 'frost'], cd: 30, per: 15, max: 300,
    text: 'Oparzenie + Mróz: wybuch za 15% Ataku na każdy stos obu efektów (maks. 300%). Zdejmuje Mróz i połowę Oparzenia.' },
  goraczka: { id: 'goraczka', name: 'Gorączka', of: ['poison', 'bleed'], cd: 30, dur: 50, pct: 50, spread: 3,
    text: 'Salmonella + Krwawienie: przez 5 s oba efekty bolą cel o 50% mocniej; jeśli w tym czasie zginie, każdy inny wróg dostaje 3 stosy Salmonelli.' },
  kruchosc: { id: 'kruchosc', name: 'Kruchość', of: ['frost', 'bleed'], cd: 30,
    text: 'Mróz + Krwawienie: następne trafienie w cel jest zawsze mocnym dziobnięciem (także umiejętnością).' },
};

// Żywioły (oznaczenia kafelków): pokazywane na kartach, używane przez przepisy Wylęgarni i Odznaki.
export const ELEMENTS = {
  ogien: { name: 'Ogień', color: '#ff7a3d' }, lod: { name: 'Lód', color: '#7fd3ff' }, trucizna: { name: 'Salmonella', color: '#9ccc65' },
  krew: { name: 'Krew', color: '#e53950' }, jajo: { name: 'Jajo', color: '#fff3d6' }, ziarno: { name: 'Ziarno', color: '#ffc933' }, korpo: { name: 'Korpo', color: '#b0bec5' },
};

// ---------- Zestawy przedmiotów ----------
// Progi: 2, 3, 4 i 6 sztuk (b2, b3, b4, b6). `x` = Nadwyżka: stały bonus za każdą sztukę ponad 4 (liczy się od 5. sztuki).
export const SET_STEPS = [2, 3, 4, 6];
export const SETS = {
  jajeczne: { name: 'Jajeczne', b2: 'Tykające Jajo wybucha co 6 s', b3: 'Wybuchy leczą 3% maks. Życia', b4: 'Jaja wybuchają o 25% szybciej', b6: 'Pełne Gniazdo: +2 Ziarna po wygranej, wybuchy leczą 6% maks. Życia', x: '+1 Ziarno po wygranej (maks. +3)' },
  zbozowe: { name: 'Zbożowe', b2: '+10% Ziaren z nagród', b3: 'Worek Kukurydzy bez limitu premii', b4: 'Siewnik daje +2 Ataku za wygraną zamiast +1', b6: 'Żniwa: +2% maks. Życia za każde 10 Ziaren w kieszeni (maks. 30%)', x: '+3% Ziaren z nagród' },
  rambo: { name: 'Rambo', b2: '+20% Ataku', b3: 'Ostatni Okrzyk: raz na walkę 3 s nietykalności poniżej 20% Życia', b4: 'Okrzyk działa dwa razy na walkę, +10% szansy na dziobnięcie', b6: 'Armia Jednego Kurczaka: pierwszy atak i co piąty zwykły atak to mocne dziobnięcie', x: '+2% obrażeń' },
  rosolowe: { name: 'Rosołowe', b2: '+25% obrażeń od Oparzenia', b3: 'Ataki zawsze nakładają Oparzenie', b4: 'Wrogowie zaczynają walkę z 3 stosami Oparzenia', b6: 'Wrzątek: +50% obrażeń od Oparzenia, limit Oparzenia +3 stosy', x: '+3% obrażeń od Oparzenia' },
  chlodnicze: { name: 'Chłodnicze', b2: 'Każdy stos Mrozu spowalnia o 12% zamiast 8%', b3: 'Zamrożenie wywołuje Lodową Falę: 80% Ataku we wszystkich wrogów', b4: 'Wrogowie zaczynają walkę z 2 stosami Mrozu', b6: 'Wieczna Zima: +25% obrażeń przeciw wrogom z Mrozem albo zamrożonym', x: '+1 stos Mrozu na start walki (maks. +3)' },
  korpo: { name: 'Korporacyjne', b2: 'Odpoczynek tańszy o 2 Ziarna', b3: 'Dokupowanie kafelków 25% taniej', b4: 'Odsetki: po każdej wygranej +10% posiadanych Ziaren (maks. 5)', b6: 'Zarząd: -15% cooldownu umiejętności, Odsetki do 8 Ziaren', x: '+1 darmowy reroll za każde 2 sztuki ponad 4' },
};

// Powiązania zestawów i żywiołów (ikonki ↔ pod paskami). Klucze: 'set:<zestaw>' (liczba sztuk zestawu) albo 'tag:<żywioł>' (znaczniki
// przedmiotów i umiejętności razem). Konflikt działa od `need` po obu stronach, chyba że w sprzęcie jest kafelek z `fix` (mediator).
// Synergia działa od `need` po obu stronach. Efekty liczy stats.js (heroStats), nie ma ich tu.
export const SET_LINKS = [
  { id: 'ogien-lod', kind: 'conflict', a: 'tag:ogien', b: 'tag:lod', need: 3, fix: ['termos'], name: 'Ogień kontra Lód',
    text: 'Rosołowe i Chłodnicze tracą progi 4 i 6 oraz Nadwyżkę, ale Szok Termiczny bije 2 razy mocniej.' },
  { id: 'jajo-lod', kind: 'conflict', a: 'tag:jajo', b: 'tag:lod', need: 3, fix: ['feniks-z-rosolu'], name: 'Zamrożone Gniazdo',
    text: 'Jaja wybuchają o 20% wolniej.' },
  { id: 'rambo-korpo', kind: 'conflict', a: 'set:rambo', b: 'set:korpo', need: 3, fix: ['zloty-spadochron'], name: 'Brud kontra Garnitur',
    text: '-10% Ataku.' },
  { id: 'zboze-korpo', kind: 'conflict', a: 'set:zbozowe', b: 'set:korpo', need: 3, fix: ['kompostownik'], name: 'Wieś kontra Biuro',
    text: 'Odsetki są o połowę słabsze.' },
  { id: 'ogien-jajo', kind: 'synergy', a: 'tag:ogien', b: 'tag:jajo', need: 2, name: 'Twarde Jajko',
    text: 'Wybuchy jaj nakładają dodatkowy stos Oparzenia.' },
  { id: 'trucizna-krew', kind: 'synergy', a: 'tag:trucizna', b: 'tag:krew', need: 2, name: 'Gorączka Zakaźna',
    text: 'Gorączka trwa o 2 s dłużej.' },
  { id: 'lod-krew', kind: 'synergy', a: 'tag:lod', b: 'tag:krew', need: 2, name: 'Mroźna Kruchość',
    text: 'Kruchość odnawia się o 1 s szybciej.' },
  { id: 'zboze-jajo', kind: 'synergy', a: 'set:zbozowe', b: 'set:jajeczne', need: 2, name: 'Kurnik',
    text: '+1 Ziarno po każdej wygranej rundzie.' },
  { id: 'zboze-rambo', kind: 'synergy', a: 'set:zbozowe', b: 'set:rambo', need: 2, name: 'Wojsko Żywi się Chlebem',
    text: '+1 Pancerza za każde 10 Ziaren w kieszeni (maks. +15).' },
  { id: 'ogien-krew', kind: 'synergy', a: 'tag:ogien', b: 'tag:krew', need: 2, name: 'Krwawy Rosół',
    text: 'Płonący wróg krwawi o 25% mocniej.' },
];

// ---------- Rodziny statystyk ----------
// Każda rodzina ma 3 poziomy zwykłe (1 Zwykły, 2 Rzadki, 3 Epicki; poziom 3 ma STARE id, więc profile i Księga się nie psują)
// i poziom 4 legendarny (rarity 3, `boss: true`): nie występuje w ofertach, tylko jako łup z bossa (faza `loot`).
// `next` = kafelek, w który zlewają się 3 kopie (akcja `upgrade`, rules.js). Regeneracja jest liczona w dziesiątych częściach (10 = 1 / s).
const tenths = v => String(v / 10).replace('.', ',');
const STAT_FAMILIES = [
  { fam: 'zycie', k: 'hpFlat', fmt: v => `+${v} maks. Życia`, lv: [
    ['grzebien-z-tasmy', 'Grzebień z Taśmy', 3, 'Wyszedł z taśmy lekko krzywy, ale czerwony.'],
    ['grzebien-hodowlany', 'Grzebień Hodowlany', 7, 'Z hodowli, gdzie każdy grzebień ma metrykę.'],
    ['twardy-grzebien', 'Grzebień Barberski', 16, 'Im czerwieńszy, tym trudniej go zgasić.'],
    ['grzebien-rosolowego-krola', 'Grzebień Rosołowego Króla', 24, 'Korona założona przed pierwszą zupą. Do dziś ciepła.']] },
  { fam: 'atak', k: 'atkPct', fmt: v => `+${v}% Ataku`, lv: [
    ['ziarenko-z-podlogi', 'Ziarenko z Podłogi', 5, 'Spadło ze stołu. Zasada pięciu sekund obowiązuje także w kurniku.'],
    ['ziarno-selekcjonowane', 'Ziarno Selekcjonowane', 11, 'Wybrane przez komisję, która nie przyjmowała odwołań.'],
    ['ziarno-mocy', 'Ziarno Mocy', 24, 'Jedno ziarno, a w nim cała sprawiedliwość.'],
    ['ziarno-pierwszego-jajka', 'Ziarno Pierwszego Jajka', 38, 'Z niego wszystko się zaczęło. Kura wolałaby, żebyś o to nie pytał.']] },
  { fam: 'obrazenia', k: 'dmg', fmt: v => `+${v}% obrażeń`, lv: [
    ['nadpilowany-dziob', 'Nadpiłowany Dziób', 5, 'Ktoś zaczął go piłować i się znudził.'],
    ['dziob-szlifowany', 'Dziób Szlifowany', 11, 'Szlif końcowy robi dział jakości, po godzinach.'],
    ['ostry-dziob', 'Ostry Dziób', 25, 'Naostrzony na kamieniu, na którym ostrzy się cennik.'],
    ['dziob-prezesa', 'Dziób Prezesa', 40, 'Podpisuje wyroki szybciej niż zarządzenia.']] },
  { fam: 'szybkosc', k: 'aspdPct', fmt: v => `+${v}% szybkości ataku`, lv: [
    ['dziob-po-kawie', 'Dziób po Kawie', 5, 'Pierwsza kawa z automatu, pierwsze drgania.'],
    ['dziob-po-espresso', 'Dziób po Espresso', 11, 'Drgania zaczynają być zauważalne dla ubezpieczyciela.'],
    ['szybki-dziob', 'Szybki Dziób', 24, 'Stuk, stuk, stuk. Księgowość nie nadąża.'],
    ['dziob-maszynowy', 'Dziób Maszynowy', 38, 'Stuka tak szybko, że księgowość wezwała mechanika.']] },
  { fam: 'pancerz', k: 'armor', fmt: v => `+${v} Pancerza`, lv: [
    ['puch-zbity-w-kule', 'Puch Zbity w Kulę', 2, 'Wygląda jak pompon. Chroni jak pompon z ambicjami.'],
    ['pierze-prasowane', 'Pierze Prasowane', 5, 'Prasowane na gorąco, jak kołnierzyk dyrektora.'],
    ['pancerz-z-pierza', 'Pancerz z Pierza', 11, 'Miękki w dotyku, twardy w boju.'],
    ['zbroja-wyroczni-kurnika', 'Zbroja Wyroczni Kurnika', 17, 'Wyrocznia przewidziała ciosy. Zbroja już je zna.']] },
  { fam: 'krytyk', k: 'crit', fmt: v => `+${v}% szansy na dziobnięcie`, lv: [
    ['zezowate-oko', 'Zezowate Oko', 5, 'Patrzy w dwie strony naraz. Czasem trafia w obie.'],
    ['oko-kontrolera-jakosci', 'Oko Kontrolera Jakości', 12, 'Odrzuca wszystko, w tym twoich wrogów.'],
    ['czujne-oko', 'Czujne Oko', 28, 'Widzi słabe punkty. Szczególnie Prezesa.'],
    ['oko-cyklopa-z-chlodni', 'Oko Cyklopa z Chłodni', 44, 'Jedno oko, zero litości, temperatura minus dwadzieścia.']] },
  { fam: 'unik', k: 'evade', fmt: v => `+${v}% uniku`, lv: [
    ['slieskie-nozki', 'Śliskie Nóżki', 2, 'Posmarowane tłuszczem po wczorajszym rosole.'],
    ['nogi-akrobaty', 'Nogi Akrobaty', 5, 'Cyrk wyjechał, nogi zostały.'],
    ['zwinne-nogi', 'Zwinne Nogi', 11, 'Kto biega, ten się nie gotuje.'],
    ['cien-skrzydla', 'Cień Skrzydła', 17, 'Nie widać go nawet po fakcie.']] },
  { fam: 'regeneracja', k: 'regen', fmt: v => `+${tenths(v)} Regeneracji / s`, lv: [
    ['sloma-z-wczoraj', 'Słoma z Wczoraj', 2, 'Trochę wilgotna, ale własna.'],
    ['gniazdko-z-siana', 'Gniazdko z Siana', 5, 'Siano pachnie latem, którego tu nie było.'],
    ['cieple-gniazdko', 'Ciepłe Gniazdko', 11, 'Nawet w fabryce znajdzie się kąt na drzemkę.'],
    ['wieczny-ogien-kuchenki', 'Wieczny Ogień Kuchenki', 17, 'Nikt nie pamięta, kto go zapalił. Nikt go nie gasi.']] },
  { fam: 'szczescie', k: 'luck', fmt: v => `+${v} Szczęścia (lepsze kafelki w ofertach)`, lv: [
    ['trojlistna-koniczyna', 'Trójlistna Koniczyna', 4, 'Zwykła, ale ktoś ją pogłaskał.'],
    ['koniczyna-z-kapliczki', 'Koniczyna z Kapliczki', 9, 'Wyrosła pod figurką świętego Rosołu.'],
    ['czterolistna-koniczyna', 'Czterolistna Koniczyna', 21, 'Rzadkie jak kurczak, który wraca z ubojni.'],
    ['piecio-koniczyna-zarzadu', 'Pięciolistna Koniczyna Zarządu', 34, 'Wyhodowana na koszt akcjonariuszy. Szczęście wypłacane w ratach.']] },
];
export const STAT_TILES = [];
for (const F of STAT_FAMILIES) F.lv.forEach(([id, name, v, flavor], i) => {
  const t = { id, name, type: 'stat', rarity: i, fam: F.fam, lvl: i + 1, repeat: true, text: F.fmt(v), fx: [{ k: F.k, v }], flavor };
  if (i < 2) t.next = F.lv[i + 1][0];
  if (i === 3) t.boss = true;
  if (id === 'czterolistna-koniczyna') t.lock = 'u-koniczyna';
  STAT_TILES.push(t);
});
export const STAT_FAMS = STAT_FAMILIES.map(F => ({ fam: F.fam, ids: F.lv.map(l => l[0]) }));


// ---------- Kafelki ----------
// rarity 0..3; type stat|skill|item|risk; fx = lista modyfikatorów statystyk (patrz stats.js); lock = id odblokowania (patrz UNLOCKS);
// repeat = można brać wielokrotnie; event = kafelek-wydarzenie (obsługa w rules.js).
export const TILES = [
  ...STAT_TILES,
  // Umiejętności aktywne
  { id: 'kukurydziany-grad', name: 'Kukurydziany Grad', type: 'skill', rarity: 0, skill: 'grad', text: 'Umiejętność: 5 pocisków po 60% Ataku, cooldown 6,5 s', flavor: 'Deszcz ziarna, który nikogo nie nakarmi.' },
  { id: 'pianie-grozy', name: 'Pianie Grozy', type: 'skill', rarity: 1, skill: 'pianie', text: 'Umiejętność: ogłusza wrogów na 2 s, cooldown 9 s', flavor: 'Kikiriki, które słychać na dwudziestym piętrze.' },
  { id: 'jajeczny-granat', name: 'Jajeczny Granat', type: 'skill', rarity: 1, skill: 'granat', text: 'Umiejętność: 250% Ataku w jednym uderzeniu, cooldown 8 s', flavor: 'Zniesione ze złości.' },
  { id: 'dziobniecie-szalu', name: 'Szał Dziobów', type: 'skill', rarity: 1, skill: 'dziobniecie', text: 'Umiejętność: +50% szybkości ataku przez 6 s, cooldown 12 s', flavor: 'Gdy kurczak się wścieknie, dziób nie zna litości.' },
  { id: 'unik-skrzydlem', name: 'Unik Skrzydłem', type: 'skill', rarity: 2, skill: 'unik', lock: 'u-unik', text: 'Umiejętność: nietykalność przez 1,5 s, cooldown 10 s', flavor: 'Trzepot, którego nie dogoni żadna łyżka.' },
  { id: 'rosolowy-chlust', name: 'Rosołowy Chlust', type: 'skill', rarity: 1, skill: 'chlust', tags: ['ogien'], text: 'Umiejętność: 40% Ataku i 3 stosy Oparzenia na wszystkich, cooldown 8,5 s', flavor: 'Gorący wywar prosto z kotła. Uwaga, parzy.' },
  { id: 'lodowy-dziob', name: 'Lodowy Dziób', type: 'skill', rarity: 0, skill: 'lodowy', tags: ['lod'], text: 'Umiejętność: 150% Ataku i 2 stosy Mrozu, cooldown 6 s', flavor: 'Dziób trzymany całą noc w zamrażarce.' },
  { id: 'zgnile-jajo', name: 'Zgniłe Jajo', type: 'skill', rarity: 1, skill: 'zgnile', tags: ['trucizna', 'jajo'], text: 'Umiejętność: 5 stosów Salmonelli na celu, 1 na reszcie, cooldown 7,5 s', flavor: 'Data ważności: wczoraj. Rok temu.' },
  { id: 'kogucia-kontra', name: 'Kogucia Kontra', type: 'skill', rarity: 1, skill: 'kontra', lock: 'u-kontra', text: 'Umiejętność: 2,5 s połowy obrażeń i oddawania 120% Ataku, cooldown 10 s', flavor: 'Kto zaczepia koguta, ten zbiera.' },
  { id: 'darcie-pierza', name: 'Darcie Pierza', type: 'skill', rarity: 0, skill: 'darcie', tags: ['krew'], text: 'Umiejętność: 50% Ataku i 2 stosy Krwawienia na wszystkich, cooldown 8 s', flavor: 'Pierze leci, a wrogowie płaczą.' },
  { id: 'piaskowa-kapiel', name: 'Piaskowa Kąpiel', type: 'skill', rarity: 1, skill: 'kapiel', text: 'Umiejętność: przez 3 s wrogowie pudłują połowę ciosów, cooldown 11 s', flavor: 'Kurza kąpiel w piachu. Higiena po wiejsku.' },
  { id: 'dziobanie-premii', name: 'Dziobanie Premii', type: 'skill', rarity: 1, skill: 'premia', tags: ['korpo'], lock: 'u-premia', text: 'Umiejętność: 160% Ataku, zabójstwo daje Ziarno (do 3), cooldown 7 s', flavor: 'Premia uznaniowa. Uznaje ją dziób.' },
  { id: 'egzekucja-ostroga', name: 'Egzekucja Ostrogą', type: 'skill', rarity: 2, skill: 'egzekucja', tags: ['krew'], lock: 'u-egzekucja', text: 'Umiejętność: 130% Ataku, 400% poniżej 30% Życia wroga, cooldown 9 s', flavor: 'Szybko, sprawnie i bez zbędnej papierologii.' },
  { id: 'wrzatek-z-kotla', name: 'Wrzątek z Kotła', type: 'skill', rarity: 1, skill: 'wrzatek', tags: ['ogien'], text: 'Umiejętność: 60% Ataku, podwaja Oparzenie na celu i dodaje 3 stosy, cooldown 7 s', flavor: 'Prosto z kotła, z pozdrowieniami dla wroga.' },
  { id: 'podpalka', name: 'Podpałka', type: 'skill', rarity: 0, skill: 'podpalka', tags: ['ogien'], text: 'Umiejętność: przez 6 s każdy atak nakłada Oparzenie, cooldown 9 s', flavor: 'Rozpałka do grilla. Grillem jesteś ty.' },
  { id: 'mrozny-powiew', name: 'Mroźny Powiew', type: 'skill', rarity: 1, skill: 'powiew', tags: ['lod'], text: 'Umiejętność: 3 stosy Mrozu na wszystkich wrogach, cooldown 7,5 s', flavor: 'Drzwi do Chłodni zostawiono otwarte. Nie przypadkiem.' },
  { id: 'sopel-w-plecy', name: 'Sopel w Plecy', type: 'skill', rarity: 2, skill: 'sopel', tags: ['lod'], text: 'Umiejętność: 110% Ataku, 300% w wroga z Mrozem, cooldown 7 s', flavor: 'Wisiał pod dachem od listopada. Czekał na swoją chwilę.' },
  { id: 'zakwas-babci', name: 'Zakwas Babci Kwoki', type: 'skill', rarity: 1, skill: 'zakwas', tags: ['trucizna'], text: 'Umiejętność: podwaja stosy Salmonelli na wszystkich wrogach, +1, cooldown 9 s', flavor: 'Im starszy, tym lepszy. Babcia nie je własnego chleba.' },
  { id: 'wyrywanie-pazurow', name: 'Wyrywanie Pazurów', type: 'skill', rarity: 1, skill: 'pazury', tags: ['krew'], text: 'Umiejętność: 100% Ataku, 3 stosy Krwawienia, leczenie za stosy, cooldown 8,5 s', flavor: 'Pazury są po to, żeby ich używać. Dwa razy dziennie.' },
  { id: 'jajeczny-wir', name: 'Jajeczny Wir', type: 'skill', rarity: 0, skill: 'wir', tags: ['jajo'], text: 'Umiejętność: 3 jaja po 70% Ataku w losowych wrogów, cooldown 7,5 s', flavor: 'Jajka lecą, a nikt nie zamówił omletu.' },
  { id: 'garsc-ziarna', name: 'Garść Ziarna', type: 'skill', rarity: 0, skill: 'garsc', tags: ['ziarno'], text: 'Umiejętność: przez 5 s +30% obrażeń i leczy 10% maks. Życia, cooldown 11 s', flavor: 'Śniadanie mistrzów. Obiad też.' },
  { id: 'zwolnienie-dyscyplinarne', name: 'Zwolnienie Dyscyplinarne', type: 'skill', rarity: 2, skill: 'zwolnienie', tags: ['korpo'], text: 'Umiejętność: 130% Ataku, wróg poniżej 25% Życia odchodzi od razu (+1 Ziarno), cooldown 9,5 s', flavor: 'Bez wypowiedzenia, bez odprawy, za to z uśmiechem.' },
  { id: 'kurze-pogotowie', name: 'Kurze Pogotowie', type: 'skill', rarity: 1, skill: 'pogotowie', text: 'Umiejętność: przez 4 s leczy 8% maks. Życia na sekundę, cooldown 13 s', flavor: 'Dzwoń 112. Albo gdakaj głośno.' },
  { id: 'zagrzebanie-w-sianie', name: 'Zagrzebanie w Sianie', type: 'skill', rarity: 2, skill: 'zagrzebanie', lock: 'u-zagrzebanie', text: 'Umiejętność: leczy 30% maks. Życia, cooldown 16 s', flavor: 'Siano leczy wszystko. Prawie.' },
  { id: 'rosolowa-fala', name: 'Rosołowa Fala', type: 'skill', rarity: 1, skill: 'fala', tags: ['ogien'], text: 'Umiejętność: 85% Ataku wszystkim, płonący dostają 2 stosy Oparzenia, cooldown 9,5 s', flavor: 'Tsunami, ale jadalne.' },
  { id: 'lawina-segregatorow', name: 'Lawina Segregatorów', type: 'skill', rarity: 0, skill: 'lawina', tags: ['korpo'], text: 'Umiejętność: 3 segregatory: 90%, 110% i 130% Ataku w jeden cel, cooldown 8 s', flavor: 'Archiwum spadło na biurko. Razem z archiwistą.' },
  { id: 'zwarcie-w-biurze', name: 'Zwarcie w Biurze', type: 'skill', rarity: 1, skill: 'zwarcie', tags: ['korpo'], text: 'Umiejętność: 90% Ataku, piorun skacze na 2 kolejnych (60%) i ogłusza, cooldown 8,5 s', flavor: 'Ktoś znowu podłączył czajnik do rozgałęziacza.' },
  { id: 'dziobanie-seryjne', name: 'Dziobanie Seryjne', type: 'skill', rarity: 0, skill: 'dziobanie', tags: ['krew'], text: 'Umiejętność: 5 ciosów po 35% Ataku w jeden cel, 15% szansy na Krwawienie, cooldown 7 s', flavor: 'Szybciej niż maszyna do szycia. I mniej uprzejmie.' },
  { id: 'jajo-z-niespodzianka', name: 'Jajo z Niespodzianką', type: 'skill', rarity: 0, skill: 'niespodzianka', tags: ['jajo'], text: 'Umiejętność: rzut jajem o losowym skutku (180% Ataku albo 4 stosy), cooldown 8,5 s', flavor: 'Nikt nie wie, co w środku. Kurczak też nie.' },
  { id: 'wypowiedzenie', name: 'Wypowiedzenie', type: 'skill', rarity: 1, skill: 'wypowiedzenie', tags: ['korpo'], text: 'Umiejętność: po 4 s wróg dostaje 200% Ataku, zabójstwo daje 2 Ziarna, cooldown 9 s', flavor: 'Okres wypowiedzenia: cztery sekundy.' },
  { id: 'audyt-wewnetrzny', name: 'Audyt Wewnętrzny', type: 'skill', rarity: 1, skill: 'audyt', tags: ['korpo'], text: 'Umiejętność: 130% Ataku, cel traci połowę Pancerza na 5 s, cooldown 10 s', flavor: 'Zawsze coś się znajdzie. Zwłaszcza w cudzych szufladach.' },
  { id: 'bonus-kwartalny', name: 'Bonus Kwartalny', type: 'skill', rarity: 1, skill: 'bonus', tags: ['korpo'], text: 'Umiejętność: 120% Ataku, +15% za każde 5 Ziaren w kieszeni (maks. +90%), cooldown 10 s', flavor: 'Kto ma dużo, ten dziobie mocniej.' },
  { id: 'rosol-ostateczny', name: 'Rosół Ostateczny', type: 'skill', rarity: 2, skill: 'ostateczny', tags: ['ogien'], text: 'Umiejętność: 360% Ataku w cel i 8 stosów Oparzenia, cooldown 18 s', flavor: 'Przepis babci Kwoki. Nikt go nie przeżył, więc nie ma opinii.' },
  { id: 'zamrazarka-reczna', name: 'Zamrażarka Ręczna', type: 'skill', rarity: 1, skill: 'zamrazarka', tags: ['lod'], text: 'Umiejętność: 100% Ataku, cel zamarza na 2 s, cooldown 9 s', flavor: 'Drzwi Chłodni zatrzaskują się za plecami.' },
  { id: 'spotkanie-bez-agendy', name: 'Spotkanie bez Agendy', type: 'skill', rarity: 1, skill: 'spotkanie', tags: ['korpo'], text: 'Umiejętność: ogłusza najsilniejszego wroga na 3 s, +30% obrażeń na niego, cooldown 13 s', flavor: 'Mogło być mailem. Jest godziną.' },
  { id: 'wicher-skrzydel', name: 'Wicher Skrzydeł', type: 'skill', rarity: 0, skill: 'wicher', text: 'Umiejętność: 45% Ataku wszystkim, ataki wrogów opóźnione o 1 s, cooldown 7,5 s', flavor: 'Trzepot na cały regulamin.' },
  { id: 'pulapka-na-szczura', name: 'Pułapka na Szczura', type: 'skill', rarity: 1, skill: 'pulapka', text: 'Umiejętność: pułapka na 6 s, pierwszy atakujący dostaje 200% Ataku i ogłuszenie, cooldown 9 s', flavor: 'Ser w cenie. Biuro nie płaci za naprawy.' },
  { id: 'gniazdo-tarczy', name: 'Gniazdo Tarczy', type: 'skill', rarity: 1, skill: 'tarcza', text: 'Umiejętność: tarcza do 20% maks. Życia na 4 s, cooldown 10,5 s', flavor: 'Z siana, piór i uporu.' },
  { id: 'przerwa-kawowa', name: 'Przerwa Kawowa', type: 'skill', rarity: 0, skill: 'kawa', text: 'Umiejętność: leczy 12% teraz i 12% po 3 s, 30% uniku, cooldown 15 s', flavor: 'Piętnaście minut, które trwa trzy sekundy.' },
  { id: 'kociol-zemsty', name: 'Kocioł Zemsty', type: 'skill', rarity: 1, skill: 'zemsta', tags: ['ogien'], text: 'Umiejętność: przez 4 s każdy cios, który dostajesz, daje atakującemu 2 stosy Oparzenia, cooldown 10 s', flavor: 'Kto bije kurczaka, ten się poparzy.' },
  { id: 'zupa-dnia', name: 'Zupa Dnia', type: 'skill', rarity: 0, skill: 'zupa', text: 'Umiejętność: leczy 15% maks. Życia i +20% szybkości ataku na 4 s, cooldown 12 s', flavor: 'Dziś rosół. Wczoraj też.' },
  { id: 'kogucia-pobudka', name: 'Kogucia Pobudka', type: 'skill', rarity: 0, skill: 'pobudka', text: 'Umiejętność: przez 5 s +25% obrażeń i +15% szansy na dziobnięcie, cooldown 11,5 s', flavor: 'Piąta rano. Dla wszystkich.' },
  { id: 'kurze-echo', name: 'Kurze Echo', type: 'skill', rarity: 2, skill: 'echo', text: 'Umiejętność: następna umiejętność odpala się drugi raz za darmo, cooldown 8 s', flavor: 'Gdak, gdak, gdak, gdak.' },
  { id: 'przyspieszony-obieg', name: 'Przyspieszony Obieg', type: 'skill', rarity: 2, skill: 'obieg', text: 'Umiejętność: skraca o 35% pozostały cooldown pozostałych umiejętności, cooldown 12 s', flavor: 'Zlecenie w trybie pilnym. Jak wszystkie.' },
  // Przedmioty z synergią
  { id: 'zlote-jajo', name: 'Złote Jajo', type: 'item', rarity: 1, set: 'jajeczne', text: '+3 Ziarna po każdej wygranej rundzie', fx: [{ k: 'coinFlat', v: 3 }], flavor: 'Prezes by za nie zabił. Dosłownie.' },
  { id: 'tykajace-jajo', name: 'Tykające Jajo', type: 'item', rarity: 1, set: 'jajeczne', text: 'Co 8 s wybucha za 120% Ataku', fx: [{ k: 'egg', v: 1 }], flavor: 'Tik, tak. Lepiej się nie przyglądać.' },
  { id: 'gniazdo-zapasowe', name: 'Gniazdo Zapasowe', type: 'item', rarity: 2, set: 'jajeczne', lock: 'u-gniazdo', text: 'Raz na run: wskrzeszenie z 40% Życia', fx: [{ k: 'revive', v: 1 }], flavor: 'Każdy bohater ma plan B. Ten ma wyściółkę.' },
  { id: 'worek-kukurydzy', name: 'Worek Kukurydzy', type: 'item', rarity: 0, set: 'zbozowe', text: '+8% Ataku za każde 10 Ziaren (maks. +40%)', fx: [{ k: 'worek', v: 1 }], flavor: 'Bogactwo mierzy się w kolbach.' },
  { id: 'mlocarnia', name: 'Młocarnia', type: 'item', rarity: 1, set: 'zbozowe', text: '+8% Ataku; 15% szans na rozbicie 10% Pancerza wroga przy trafieniu', fx: [{ k: 'shred', v: 15 }, { k: 'atkPct', v: 8 }], flavor: 'Co na polu zrobi cep, to w fabryce zrobi dziób.' },
  { id: 'siewnik', name: 'Siewnik', type: 'item', rarity: 2, set: 'zbozowe', lock: 'u-siewnik', text: '+1 Ataku na stałe co drugą wygraną rundę', fx: [{ k: 'siewnik', v: 1 }], flavor: 'Kto sieje wygrane, ten zbiera awans.' },
  { id: 'opaska-rambo', name: 'Opaska Rambo', type: 'item', rarity: 1, set: 'rambo', text: '+15% obrażeń, +10% szansy na dziobnięcie', fx: [{ k: 'dmg', v: 15 }, { k: 'crit', v: 10 }], flavor: 'Nic tak nie dodaje odwagi jak kawałek czerwonego materiału.' },
  { id: 'kamizelka-kuloodporna', name: 'Kamizelka Kuloodporna', type: 'item', rarity: 0, set: 'rambo', text: '+15 Pancerza, -10% szybkości ataku', fx: [{ k: 'armor', v: 15 }, { k: 'aspdPct', v: -10 }], flavor: 'Ciężka, ale rosół zostaje na zewnątrz.' },
  { id: 'ostrogi-bojowe', name: 'Ostrogi Bojowe', type: 'item', rarity: 1, set: 'rambo', text: 'Ataki krwawią: +1 obrażenie / s na stos Krwawienia', fx: [{ k: 'bleed', v: 1 }], flavor: 'Dwa kolce, jedna reputacja.' },
  { id: 'okulary-aviatory', name: 'Okulary Aviatory', type: 'item', rarity: 2, set: 'rambo', lock: 'u-okulary', text: '+30% Mocy Dziobnięcia', fx: [{ k: 'critMult', v: 30 }], flavor: 'Gdy wchodzisz do biura w okularach, nikt nie pyta o urlop.' },
  { id: 'zepsute-jajo', name: 'Zepsute Jajo', type: 'item', rarity: 1, set: 'jajeczne', tags: ['trucizna', 'jajo'], text: 'Wybuchy jaj i Granat nakładają 3 stosy Salmonelli; 10% szans na Salmonellę przy ataku', fx: [{ k: 'eggPoison', v: 3 }, { k: 'poisonHit', v: 10 }], flavor: 'Nikt nie chce wiedzieć, ile leżało w kącie.' },
  { id: 'mokra-pasza', name: 'Mokra Pasza', type: 'item', rarity: 0, set: 'zbozowe', tags: ['trucizna', 'ziarno'], text: '25% szans na Salmonellę przy ataku, +20% obrażeń Salmonelli', fx: [{ k: 'poisonHit', v: 25 }, { k: 'poisonPct', v: 20 }], flavor: 'Pachnie jak magazyn po powodzi.' },
  { id: 'kolczatka', name: 'Kolczatka', type: 'item', rarity: 1, set: 'rambo', tags: ['krew'], text: 'Ataki krwawią (+1 na stos), +2 do limitu stosów Krwawienia', fx: [{ k: 'bleed', v: 1 }, { k: 'bleedMax', v: 2 }], flavor: 'Obroża po psie łańcuchowym. Teraz w lepszych rękach.' },
  // Etap 2: nowe przedmioty do zestawów (nowe efekty)
  { id: 'wywar-dnia', name: 'Wywar Dnia', type: 'item', rarity: 1, set: 'rosolowe', tags: ['ogien'], text: 'Gdy płonący wróg ginie, połowa jego stosów Oparzenia przechodzi na następnego', fx: [{ k: 'burnSpread', v: 50 }], flavor: 'Dziś zupa dnia. Jutro wróg dnia.' },
  { id: 'tlusta-pokrywka', name: 'Tłusta Pokrywka', type: 'item', rarity: 1, set: 'rosolowe', tags: ['ogien'], text: '+1 Pancerza za każdy stos Oparzenia na wrogach (maks. +12)', fx: [{ k: 'burnArmor', v: 1 }], flavor: 'Przykrywa wszystko. Zwłaszcza błędy.' },
  { id: 'szczypta-soli', name: 'Szczypta Soli', type: 'item', rarity: 0, set: 'rosolowe', tags: ['ogien'], text: '+20% obrażeń zadawanych wrogom z Oparzeniem', fx: [{ k: 'vsBurn', v: 20 }], flavor: 'Sól podkręca smak. I rany.' },
  { id: 'lodowa-spodnica', name: 'Lodowa Spódnica', type: 'item', rarity: 1, set: 'chlodnicze', tags: ['lod'], text: 'Wrogowie z Mrozem lub zamrożeni zadają ci o 30% mniej obrażeń', fx: [{ k: 'frostWeak', v: 30 }], flavor: 'Kolekcja jesień–zima. Ceny letnie.' },
  { id: 'szron-poranny', name: 'Szron Poranny', type: 'item', rarity: 1, set: 'chlodnicze', tags: ['lod'], text: 'Pierwszy cios w walce nakłada 5 stosów Mrozu', fx: [{ k: 'firstFrost', v: 5 }], flavor: 'Pojawia się o świcie. Razem z kontrolą jakości.' },
  { id: 'jajko-niespodzianka', name: 'Jajko Niespodzianka', type: 'item', rarity: 1, set: 'jajeczne', tags: ['jajo'], text: 'Co 9 s wybucha: 130% Ataku i losowy skutek (3 stosy Oparzenia, Mrozu, Salmonelli albo Krwawienia, albo leczenie 8% Życia)', fx: [{ k: 'surprise', v: 90 }], flavor: 'Nikt nie wie, co w środku. Nawet kura.' },
  { id: 'kura-nioska', name: 'Kura Nioska', type: 'item', rarity: 2, set: 'jajeczne', tags: ['jajo'], text: '+1 Ziarno po wygranej za każdy przedmiot z zestawu Jajeczne w sprzęcie (maks. +4)', fx: [{ k: 'nioska', v: 1 }], flavor: 'Znosi jaja o stałej cenie. Rynek jest zdziwiony.' },
  { id: 'kombajn-zbozowy', name: 'Kombajn Zbożowy', type: 'item', rarity: 1, set: 'zbozowe', tags: ['ziarno'], text: '20% szans, że zwykły atak uderza też pozostałych wrogów za 40% obrażeń', fx: [{ k: 'cleave', v: 20 }], flavor: 'Żniwa trwają cały rok. Zwłaszcza w kurniku.' },
  { id: 'spichlerz', name: 'Spichlerz', type: 'item', rarity: 0, set: 'zbozowe', tags: ['ziarno'], text: '+12 maks. Życia, +20% Ziaren z nagród', fx: [{ k: 'hpFlat', v: 12 }, { k: 'coinPct', v: 20 }], flavor: 'Pełny spichlerz, pełny kurczak.' },
  { id: 'strach-na-wroble', name: 'Strach na Wróble', type: 'item', rarity: 1, set: 'zbozowe', tags: ['ziarno'], text: 'Wrogowie zaczynają walkę ogłuszeni na 1,5 s (bossowie na 0,8 s)', fx: [{ k: 'scare', v: 15 }], flavor: 'Wróble się go boją. Wrogowie też, nie wiedzieć czemu.' },
  { id: 'karabin-maszynowy', name: 'Karabin Maszynowy', type: 'item', rarity: 2, set: 'rambo', tags: ['krew'], text: '10% szans, że zwykły atak uderza dwa razy', fx: [{ k: 'double', v: 10 }], flavor: 'Pokój wywalczony serią.' },
  { id: 'apteczka-polowa', name: 'Apteczka Polowa', type: 'item', rarity: 1, set: 'rambo', tags: ['krew'], text: 'Raz na walkę: gdy spadniesz poniżej 50% Życia, leczy 10% maks. Życia', fx: [{ k: 'medkit', v: 10 }], flavor: 'Plaster, bandaż i woda utleniona. Reszta to hart ducha.' },
  { id: 'sluzbowy-samochod', name: 'Służbowy Samochód', type: 'item', rarity: 2, set: 'korpo', tags: ['korpo'], text: 'Odpoczynek jest za darmo, a leczenie po wygranej większe o 10 pkt proc.', fx: [{ k: 'restDisc', v: 4 }, { k: 'healBonus', v: 10 }], flavor: 'Do użytku służbowego. Używany wyłącznie służbowo.' },
  { id: 'open-space', name: 'Open Space', type: 'item', rarity: 1, set: 'korpo', tags: ['korpo'], text: 'Każda użyta umiejętność ma 25% szans na natychmiastowy reset cooldownu', fx: [{ k: 'skillReset', v: 25 }], flavor: 'Wszyscy wszystko słyszą. Spotkania zwołują się same.' },
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
  // Kafelki rosnące: zaczynają słabo i rosną z warunku (licznik w run.grow, logika w stats.js i rules.js → fightFinish).
  { id: 'pierze-weterana', name: 'Pierze Weterana', type: 'item', rarity: 1, grow: { max: 15, per: 3 }, text: 'Rośnie: +3% Ataku na stałe za każdą wygraną walkę, w której spadłeś poniżej 60% Życia (maks. +45%)', flavor: 'Każda blizna to awans. Nieformalny.' },
  { id: 'trofeum-z-pior', name: 'Trofeum z Piór', type: 'item', rarity: 0, grow: { max: 60, per: 2 }, text: 'Rośnie: +2 maks. Życia na stałe za każdego pokonanego wroga (do 4 na walkę)', flavor: 'Kolekcja piór pokonanych. Wisi nad grzędą.' },
  { id: 'skarbonka-piskleca', name: 'Skarbonka Pisklęcia', type: 'item', rarity: 0, grow: { max: 5, per: 1 }, text: 'Rośnie: +1 Ziarno po wygranej, +1 więcej za każde piętro bez Odpoczynku (maks. +6)', flavor: 'Brzęczy. Pisklę mówi, że to oszczędności na emeryturę.' },
  // Ryzyko i wydarzenia
  { id: 'pakt-z-lisem', name: 'Pakt z Lisem', type: 'risk', rarity: 1, text: '+50% Ataku, -25% maks. Życia do końca runu', fx: [{ k: 'atkPct', v: 50 }, { k: 'hpPct', v: -25 }], flavor: 'Lis ma drobny druk. Bardzo drobny.' },
  { id: 'szklane-skrzydlo', name: 'Szklane Skrzydło', type: 'risk', rarity: 2, lock: 'u-szklane', text: '+100% Ataku, -40% maks. Życia', fx: [{ k: 'atkPct', v: 100 }, { k: 'hpPct', v: -40 }], flavor: 'Piękne, kruche i bardzo, bardzo groźne.' },
  { id: 'tajemnicza-skrzynka', name: 'Tajemnicza Skrzynka', type: 'risk', rarity: 1, repeat: true, event: 'skrzynka', lock: 'u-skrzynka', text: 'Losowy kafelek epicki, ale 25% szans na pułapkę (-15% Życia)', flavor: 'Kto otwiera nieznane skrzynki, ten kończy w rosole albo w legendach.' },
  { id: 'sklepik-babci-kwoki', name: 'Sklepik Babci Kwoki', type: 'risk', rarity: 0, repeat: true, event: 'sklepik', text: 'Wydarzenie: kupujesz 1 z 3 kafelków za 60% zwykłej ceny', flavor: 'Babcia nie bierze kart. Babcia bierze ziarno.' },
  { id: 'hazard-w-kurniku', name: 'Hazard w Kurniku', type: 'risk', rarity: 0, repeat: true, event: 'hazard', lock: 'u-hazard', text: 'Wydarzenie: stawiasz Ziarna, 60% podwajasz, 40% tracisz', flavor: 'Zasady proste: dom zawsze wygrywa. Dom to kurnik.' },
  { id: 'automat-z-pasza', name: 'Automat z Paszą', type: 'risk', rarity: 0, repeat: true, event: 'automat', text: 'Wydarzenie: wrzucasz 5 Ziaren, wypadają 2 losowe kafelki statystyk poziomu 3', flavor: 'Czasem zwraca resztę. Czasem nie.' },
  { id: 'kontrakt-hr', name: 'Kontrakt z Działem HR', type: 'risk', rarity: 1, repeat: true, event: 'kontrakt', lock: 'u-kontrakt', text: 'Wydarzenie: podpisujesz etat (+Atak, mniej Ziaren) albo B2B (Ziarna teraz, mniej Życia)', flavor: 'Drobnym drukiem: „dusza w cenie”.' },
  { id: 'kapliczka', name: 'Kapliczka Świętego Rosołu', type: 'risk', rarity: 1, repeat: true, event: 'kapliczka', text: 'Wydarzenie: pełne uleczenie albo Odznaka do wyboru', flavor: 'Ktoś zostawił tu marchewkę. I pietruszkę.' },
  { id: 'arena-duchow', name: 'Arena Duchów', type: 'risk', rarity: 1, repeat: true, event: 'arena', minRound: 3, text: 'Wydarzenie: walka z Duchem innego gracza (jego build z końca runu). Wygrana: Ziarna i wybór rzadkiego kafelka', flavor: 'Kto nie dotarł do Prezesa, ten krąży po arenie i bije następnych.' },
  { id: 'schronisko', name: 'Schronisko dla Piskląt', type: 'risk', rarity: 0, repeat: true, event: 'schronisko', text: 'Wydarzenie: adoptujesz towarzysza (1 z 3), który walczy u twojego boku i rośnie po bossach', flavor: 'Adopcja jest bezpłatna. Gryzienie w cenie.' },
  { id: 'umowa-etat', name: 'Umowa o Pracę', type: 'risk', rarity: 1, hidden: true, text: '+30% Ataku, -2 Ziarna po każdej rundzie', fx: [{ k: 'atkPct', v: 30 }, { k: 'coinFlat', v: -2 }], flavor: 'Etat, karta Multisport i wieczna lojalność.' },
  { id: 'umowa-b2b', name: 'Umowa B2B', type: 'risk', rarity: 1, hidden: true, text: '-15% maks. Życia (w zamian za 15 Ziaren od ręki)', fx: [{ k: 'hpPct', v: -15 }], flavor: 'Sam sobie sterem, żeglarzem i ZUS-em.' },
  { id: 'zakazana-pasza', name: 'Zakazana Pasza', type: 'risk', rarity: 3, lock: 'u-pasza', text: '+9% wszystkich statystyk, ale następny boss ma +30% Życia', fx: [{ k: 'allPct', v: 9 }], flavor: 'Smakuje jak moc. Kosztuje jak rachunek.' },

  // Etap 3: ryzyko (nowe kafelki z ceną)
  { id: 'pozyczka-chwilowka', name: 'Pożyczka Chwilówka', type: 'risk', rarity: 1, coinsNow: 15, noPawn: true, text: '+15 Ziaren teraz, ale -2 Ziarna po każdej wygranej rundzie (odsetki)', fx: [{ k: 'coinFlat', v: -2 }], flavor: 'RRSO jest drobnym drukiem. Bardzo drobnym.' },
  { id: 'dopalacz-z-biedronki', name: 'Dopalacz z Biedronki', type: 'risk', rarity: 1, text: '+40% szybkości ataku, -25% maks. Życia', fx: [{ k: 'aspdPct', v: 40 }, { k: 'hpPct', v: -25 }], flavor: 'Promocja tygodnia. Serce też bije promocyjnie.' },
  { id: 'nadgodziny-bez-doplaty', name: 'Nadgodziny Bez Dopłaty', type: 'risk', rarity: 1, text: '+30% obrażeń, ale Odpoczynek leczy o połowę mniej', fx: [{ k: 'dmg', v: 30 }, { k: 'restHalf', v: 1 }], flavor: 'Premia za zaangażowanie: twoje własne zaangażowanie.' },
  { id: 'dieta-cud', name: 'Dieta Cud z Kantyny', type: 'risk', rarity: 0, text: '+20 Pancerza, ale -25% szybkości ataku', fx: [{ k: 'armor', v: 20 }, { k: 'aspdPct', v: -25 }], flavor: 'Kotlet w pancerzu z panierki. Ruszanie się nie wchodzi w menu.' },
  { id: 'uklad-z-zarzadem', name: 'Układ z Zarządem', type: 'risk', rarity: 1, coinsNow: 12, bossBoost: 25, text: '+12 Ziaren teraz, ale następny boss ma +25% Życia', flavor: 'Uścisk dłoni trwa dłużej niż umowa.' },
  { id: 'los-na-loterii', name: 'Los na Loterii', type: 'risk', rarity: 1, text: '+25 Szczęścia, ale -1 Ziarno po każdej wygranej rundzie', fx: [{ k: 'luck', v: 25 }, { k: 'coinFlat', v: -1 }], flavor: 'Szansa wygranej wynosi jeden do kogutów.' },
  // Etap 3: legendarne przedmioty (legend: w ofertach dopiero od 60% runu, czyli od strefy III w trybie pełnym; rzadkość 3)
  { id: 'zloty-rosolek', name: 'Złoty Rosołek', type: 'item', rarity: 3, legend: true, tags: ['ogien', 'lod', 'trucizna', 'krew'], text: 'Każde nałożenie efektu statusowego daje o 1 stos więcej, a Oparzenie i Salmonella bolą o 50% mocniej', fx: [{ k: 'allStatus', v: 1 }, { k: 'burnPct', v: 50 }, { k: 'poisonPct', v: 50 }], flavor: 'Złoty, bo Zarząd tak powiedział. Wciąż parzy.' },
  { id: 'kogut-alfa', name: 'Kogut Alfa', type: 'item', rarity: 3, legend: true, text: 'Umiejętność w 1. slocie jest gotowa od początku walki i ma o 50% krótszy cooldown', fx: [{ k: 'firstReady', v: 1 }, { k: 'alphaCd', v: 50 }], flavor: 'Pierwszy do pianie, pierwszy do wszystkiego.' },
  { id: 'jajko-dinozaura', name: 'Jajko Dinozaura', type: 'item', rarity: 3, legend: true, grow: { max: 4, per: 1 }, dino: true, text: 'Rośnie: po 4 wygranych piętrach wykluwa się Dinozaur (+30% Ataku i maks. Życia)', flavor: 'Leży w kurniku od mezozoiku. Nikt nie pytał dlaczego.' },
  { id: 'plan-b', name: 'Plan B', type: 'item', rarity: 3, legend: true, text: 'W każdej walce, gdy spadniesz do zera, wstajesz z 15% Życia i 1,5 s nietykalności (raz na walkę)', fx: [{ k: 'planB', v: 1 }], flavor: 'Plan A był zbyt optymistyczny.' },
  { id: 'akcje-zarzadu', name: 'Akcje Zarządu', type: 'item', rarity: 3, legend: true, tags: ['korpo'], text: 'Po każdej wygranej +25% posiadanych Ziaren (maks. 12) i +20% Ziaren z nagród', fx: [{ k: 'bigInterest', v: 25 }, { k: 'coinPct', v: 20 }], flavor: 'Giełda kurzych jaj notuje wzrosty. Zawsze o jedno piętro za późno.' },
  { id: 'dziob-mistrza', name: 'Dziób Mistrza Ceremonii', type: 'item', rarity: 3, legend: true, text: 'Umiejętności mogą zadawać mocne dziobnięcia; +20% szansy na dziobnięcie i +25% Mocy Dziobnięcia', fx: [{ k: 'skillCrit', v: 1 }, { k: 'crit', v: 20 }, { k: 'critMult', v: 25 }], flavor: 'Każde dziobnięcie to małe przedstawienie.' },
  // Wykluty z Jajka Dinozaura (nie w ofertach)
  { id: 'dinozaur', name: 'Dinozaur', type: 'item', rarity: 3, hatched: true, text: '+30% Ataku i +30% maks. Życia', fx: [{ k: 'atkPct', v: 30 }, { k: 'hpPct', v: 30 }], flavor: 'Wykluł się. Ptaki to przecież dinozaury. Prezes tego nie zauważył.' },
];
// ---------- Wylęgarnia: przedmioty wyklute z dwóch innych ----------
// Gdy gracz ma oba składniki przepisu, znikają i wykluwa się z nich legendarny przedmiot (ma efekty obu i premię, liczy się do ich zestawów).
// Wyklutych przedmiotów nie ma w ofertach.
const HATCHED = [
  { id: 'jajko-na-twardo', name: 'Jajko na Twardo', of: ['tykajace-jajo', 'kostka-rosolowa'], sets: ['jajeczne', 'rosolowe'], tags: ['jajo', 'ogien'], text: 'Co 6 s jajo wybucha we WSZYSTKICH wrogów (120% Ataku) i nakłada 4 stosy Oparzenia; +40% obrażeń od Oparzenia, limit +5', fx: [{ k: 'eggAll', v: 1 }, { k: 'eggBurn', v: 4 }, { k: 'burnPct', v: 40 }, { k: 'burnMax', v: 5 }], flavor: 'Gotowane dziesięć minut. W złości.' },
  { id: 'termos', name: 'Termos', of: ['chochla', 'kostka-lodu'], sets: ['rosolowe', 'chlodnicze'], tags: ['ogien', 'lod'], text: '40% szans na Oparzenie i 40% szans na Mróz przy każdym ataku', fx: [{ k: 'burnHit', v: 40 }, { k: 'frostHit', v: 40 }], flavor: 'Trzyma ciepło. I zimno. Nikt nie wie jak.' },
  { id: 'ostrogi-rzeznika', name: 'Ostrogi Rzeźnika', of: ['ostrogi-bojowe', 'kolczatka'], sets: ['rambo', 'rambo'], tags: ['krew'], text: 'Każdy atak nakłada 2 stosy Krwawienia (8 na stos), limit Krwawienia +4', fx: [{ k: 'bleed', v: 8 }, { k: 'bleedMax', v: 4 }, { k: 'bleedStacks', v: 2 }], flavor: 'Rzeźnik zrezygnował z pracy. Ostrogi zostały.' },
  { id: 'zloty-spadochron', name: 'Złoty Spadochron', of: ['zlote-jajo', 'teczka'], sets: ['jajeczne', 'korpo'], tags: ['jajo', 'korpo'], text: '+7 Ziaren po każdej wygranej rundzie, nikt nie kradnie ci Ziaren', fx: [{ k: 'coinFlat', v: 7 }, { k: 'noSteal', v: 1 }], flavor: 'Zarząd ląduje miękko. Teraz ty też.' },
  { id: 'spojrzenie-rambo', name: 'Spojrzenie Rambo', of: ['okulary-aviatory', 'opaska-rambo'], sets: ['rambo', 'rambo'], tags: ['krew'], text: '+20% obrażeń, +25% szansy na dziobnięcie, +50% Mocy Dziobnięcia', fx: [{ k: 'dmg', v: 20 }, { k: 'crit', v: 25 }, { k: 'critMult', v: 50 }], flavor: 'Wrogowie mdleją, zanim zdejmie okulary.' },
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
  'ostry-dziob': { name: 'Dziób Brzytwa', text: '+8% szansy na dziobnięcie, +20% Mocy Dziobnięcia', fx: [{ k: 'crit', v: 8 }, { k: 'critMult', v: 20 }] },
  'twardy-grzebien': { name: 'Koguci Hełm', text: '+10% maks. Życia, +4 Pancerza', fx: [{ k: 'hpPct', v: 10 }, { k: 'armor', v: 4 }] },
  'szybki-dziob': { name: 'Młot Pneumatyczny', text: '+12% szybkości ataku', fx: [{ k: 'aspdPct', v: 12 }] },
  'pancerz-z-pierza': { name: 'Pierzasta Twierdza', text: '+6 Pancerza, +25 maks. Życia', fx: [{ k: 'armor', v: 6 }, { k: 'hpFlat', v: 25 }] },
  'czujne-oko': { name: 'Sokole Oko', text: '+30% Mocy Dziobnięcia', fx: [{ k: 'critMult', v: 30 }] },
  'zwinne-nogi': { name: 'Taniec Kurczaka', text: '+5% uniku, +8% szybkości ataku', fx: [{ k: 'evade', v: 5 }, { k: 'aspdPct', v: 8 }] },
  'cieple-gniazdko': { name: 'Kurza Drzemka', text: '+3 Regeneracji / s, +10 maks. Życia', fx: [{ k: 'regen', v: 30 }, { k: 'hpFlat', v: 10 }] },
  'czterolistna-koniczyna': { name: 'Pięciolistna Koniczyna', text: '+15 Szczęścia, +2 Ziarna po każdej rundzie', fx: [{ k: 'luck', v: 15 }, { k: 'coinFlat', v: 2 }] },
};

export const TILE_BY_ID = Object.fromEntries(TILES.map(t => [t.id, t]));

// ---------- Odblokowania ----------
// kind: 'char' | 'tile'; target = id postaci/kafelka; check w profile.js (po id).
export const UNLOCKS = [
  { id: 'u-kwoka', kind: 'char', target: 'kwoka', text: 'Ukończ pełny run' },
  { id: 'u-kaczor', kind: 'char', target: 'kaczor', text: 'Weź 5 kafelków ryzyka w jednym runie' },
  { id: 'u-indor', kind: 'char', target: 'indor', text: 'Pokonaj Prezesa Rosołu w trybie szybkim' },
  // Ukryte: przed odblokowaniem widok profilu pokazuje tylko „???” (patrz publicProfile).
  { id: 'u-420', kind: 'char', target: 'zjarany', secret: true, text: 'Zbierz łącznie 420 Ziaren w jednym runie' },
  { id: 'u-barista', kind: 'char', target: 'barista', text: 'Wygraj walkę w mniej niż sekundę' },
  { id: 'u-ges', kind: 'char', target: 'ges', text: 'Miej 200 Ziaren naraz' },
  { id: 'u-lodziarz', kind: 'char', target: 'lodziarz', text: 'Zamroź 8 wrogów w jednym runie' },
  { id: 'u-pielegniarka', kind: 'char', target: 'pielegniarka', text: 'Wygraj walkę, kończąc ją z mniej niż 10% życia' },
  { id: 'u-rzeznik', kind: 'char', target: 'rzeznik', text: 'Pokonaj Skubarkę 3000' },
  { id: 'u-wrozka', kind: 'char', target: 'wrozka', text: 'Zdobądź 3 Odznaki w jednym runie' },
  { id: 'u-stazysta', kind: 'char', target: 'stazysta', text: 'Przegraj 5 runów' },
  { id: 'u-mutant', kind: 'char', target: 'mutant', text: 'Zmutuj trzy umiejętności w jednym runie' },
  { id: 'u-dino', kind: 'char', target: 'dinozaur', secret: true, text: 'Wyklu Dinozaura z Jajka Dinozaura' },
  { id: 'u-gigachad', kind: 'char', target: 'gigachad', text: 'Zadaj jednym trafieniem 100 obrażeń' },
  { id: 'u-jajeczko', kind: 'char', target: 'jajeczko', text: 'Zakończ 10 runów' },
  { id: 'u-krypto', kind: 'char', target: 'krypto', text: 'Miej 150 Ziaren naraz' },
  { id: 'u-alkoholik', kind: 'char', target: 'alkoholik', text: 'Przegraj 10 runów' },
  { id: 'u-wegan', kind: 'char', target: 'wegan', text: 'Ukończ tryb szybki i pełny' },
  { id: 'u-baba', kind: 'char', target: 'baba', text: 'Miej 80 Ziaren naraz' },
  { id: 'u-influencer', kind: 'char', target: 'influencer', text: 'Zdobądź 5 Odznak w jednym runie' },
  { id: 'u-skibidi', kind: 'char', target: 'skibidi', text: 'Użyj umiejętności 100 razy w jednym runie' },
  { id: 'u-emeryt', kind: 'char', target: 'emeryt', text: 'Dojdź do rundy 15 w trybie pełnym' },
  { id: 'u-sigma', kind: 'char', target: 'sigma', text: 'Pokonaj wszystkich trzech bossów w jednym runie' },
  { id: 'u-sanepid', kind: 'char', target: 'sanepid', text: 'Pokonaj Brojlera Zdzisława' },
  { id: 'u-wanda', kind: 'char', target: 'wanda', text: 'Wyklu coś w Wylęgarni' },
  { id: 'u-zwiazkowiec', kind: 'char', target: 'zwiazkowiec', text: 'Odpal Pełną Kurzą Serię (3 różne umiejętności w oknie gdakania)' },
  { id: 'u-pacyfista', kind: 'char', target: 'pacyfista', text: 'Użyj umiejętności 60 razy w jednym runie' },
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
export const STARTER_TILES = TILES.filter(t => !t.lock && !t.hatched && !t.hidden && !t.boss).map(t => t.id);

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
  'kot-ochroniarz': { id: 'kot-ochroniarz', name: 'Kot Ochroniarz', zone: 2, hp: 39, atk: 6, aspd: 130, armor: 2, evade: 25, crit: 25, art: 'cat', text: 'Wysoki unik i dziobnięcie.' },
  'ksiegowy-kanarek': { id: 'ksiegowy-kanarek', name: 'Księgowy Kanarek', zone: 2, hp: 37, atk: 5, aspd: 100, armor: 0, evade: 0, crit: 0, steal: { n: 1, max: 99 }, art: 'canary', text: 'Każdy cios zabiera Ziarno.' },
  'kaczka-podpalaczka': { id: 'kaczka-podpalaczka', name: 'Kaczka Podpalaczka', zone: 0, hp: 22, atk: 2, aspd: 100, armor: 0, evade: 0, crit: 0, ignite: 30, art: 'duck', text: 'Jej ciosy cię podpalają: Oparzenie co sekundę.' },
  'kurczak-z-zamrazarki': { id: 'kurczak-z-zamrazarki', name: 'Kurczak z Zamrażarki', zone: 1, hp: 52, atk: 6, aspd: 80, armor: 2, evade: 0, crit: 0, rise: 50, resist: ['frost'], art: 'zombie', text: 'Odporny na Mróz. Po śmierci wstaje z połową Życia, chyba że płonie.' },
  'sep-audytor': { id: 'sep-audytor', name: 'Sęp Audytor', zone: 2, hp: 55, atk: 6, aspd: 90, armor: 4, evade: 0, crit: 0, audit: 60, art: 'vulture', text: 'Co 6 s Audyt: zdejmuje efekty z sojuszników i dostaje tarczę na 2 ciosy.' },
  'pisklak-stazysta': { id: 'pisklak-stazysta', name: 'Pisklak-stażysta', zone: 0, hp: 9, atk: 2, aspd: 100, armor: 0, evade: 0, crit: 0, minion: true, art: 'intern', text: 'Pracuje za darmo i za nic.' },
};

// slot = „miejsce” bossa w trybie (MODES.*.bosses): każde miejsce ma pulę wariantów (BOSS_POOL), wariant losuje się z ziarna runu.
// mech = lista mechanik (sim.js → bossAct/phases): summon (przyzywa stażystów: summon {every,n,max}), rage (rage {at,aspd}: poniżej at% Życia szybszy),
// plucker (Skubarka: tarcza, szarże, Skubanie kafelków), guarded + block + tyrant (Prezes), night (oślepia bohatera), blizzard (spowalnia bohatera),
// crash (po szarży sam się ogłusza), audit (zdejmuje efekty z wrogów).
export const BOSSES = {
  brojler: { id: 'brojler', slot: 'brojler', name: 'Brojler Zdzisław', title: 'Szef Zmiany', hp: 95, atk: 6, aspd: 90, armor: 3, evade: 0, crit: 0, art: 'broiler', mech: ['summon', 'rage'], summon: { every: 150, n: 2, max: 4 }, rage: { at: 50, aspd: 130 },
    text: 'Co jakiś czas wzywa stażystów. Poniżej połowy życia dostaje Premię Motywacyjną.', quote: 'Nikt nie widział go na urlopie.' },
  'szef-nocnej': { id: 'szef-nocnej', slot: 'brojler', name: 'Szef Nocnej Zmiany', title: 'Dozorca', hp: 100, atk: 6, aspd: 85, armor: 4, evade: 0, crit: 0, art: 'broiler', tint: 'night', mech: ['night', 'rage'], spec: { every: 100, windup: 20, mult: 260 }, night: { every: 130, dur: 45, pct: 40 }, rage: { at: 40, aspd: 125 },
    text: 'Gasi światło: co 13 s oślepia cię na 4,5 s (40% twoich ciosów chybia). Szarżuje po ciemku, a poniżej 40% życia przyspiesza.', quote: 'W nocy wszystkie kurczaki są szare.' },
  'krol-szczurow': { id: 'krol-szczurow', slot: 'brojler', name: 'Król Szczurów', title: 'Władca Spiżarni', hp: 88, atk: 6, aspd: 95, armor: 6, evade: 0, crit: 0, art: 'rat', tint: 'king', mech: ['summon'], summon: { every: 90, n: 2, max: 5 },
    text: 'Pancerny i otoczony świtą: co 9 s wzywa dwóch stażystów (do pięciu naraz). Ogłusz go albo szybko zetnij poddanych.', quote: 'Panuje tu od dawna. Nikt nie pyta, kto go wybrał.' },
  skubarka: { id: 'skubarka', slot: 'skubarka', name: 'Skubarka 3000', title: 'Maszyna', hp: 149, atk: 12, aspd: 80, armor: 6, evade: 0, crit: 0, shield: 25, art: 'plucker', mech: ['plucker'],
    text: 'Tarcza z pierza, potem fale uderzeń, a na koniec Skubanie twoich kafelków.', quote: 'Skubie, bo kocha.' },
  'wielka-chlodnia': { id: 'wielka-chlodnia', slot: 'skubarka', name: 'Wielka Chłodnia', title: 'Maszyna', hp: 160, atk: 11, aspd: 75, armor: 5, evade: 0, crit: 0, shield: 20, art: 'snowman', tint: 'frost', mech: ['blizzard', 'rage'], blizzard: { every: 120, dur: 40 }, rage: { at: 50, aspd: 125 }, slow: { pct: 20, ticks: 30 },
    text: 'Mroźna tarcza, a co 12 s zamieć: spowalnia twoje ataki na 4 s. Każde trafienie też cię mrozi. Poniżej połowy życia przyspiesza.', quote: 'Tu zawsze jest 18 stopni poniżej zera.' },
  'wozek-prototyp': { id: 'wozek-prototyp', slot: 'skubarka', name: 'Wózek Prototyp X1', title: 'Maszyna', hp: 140, atk: 10, aspd: 60, armor: 8, evade: 0, crit: 0, art: 'forklift', tint: 'proto', mech: ['crash'], spec: { every: 70, windup: 20, mult: 380 },
    text: 'Co 7 s szarża za 380% obrażeń. Po niej przegrzewa się i stoi bez ruchu przez 2,5 s: wtedy bij.', quote: 'Wersja testowa. Hamulce w planach.' },
  prezes: { id: 'prezes', slot: 'prezes', name: 'Prezes Rosołu', title: 'Zarząd', hp: 108, atk: 12, aspd: 90, armor: 6, evade: 0, crit: 0, art: 'boss', mech: ['guarded', 'block', 'tyrant'], guards: 2,
    text: 'Nietykalny, dopóki żyją Ochroniarze. Potem Restrukturyzacja i Wrzący Garnek.', quote: 'Padł Prezes, a z nim upadł cały cennik.' },
  'dyrektor-finansowy': { id: 'dyrektor-finansowy', slot: 'prezes', name: 'Dyrektor Finansowy', title: 'Zarząd', hp: 118, atk: 11, aspd: 90, armor: 7, evade: 0, crit: 0, art: 'canary', tint: 'gold', mech: ['audit', 'block'], steal: { n: 1, max: 6 }, auditEvery: 70,
    text: 'Każdy cios zabiera Ziarno (do 6), co 7 s Audyt: zdejmuje statusy i daje tarczę, a co 15 s blokuje ci jedną umiejętność.', quote: 'Nie ma budżetu na twoje zwycięstwo.' },
  'wampir-hr': { id: 'wampir-hr', slot: 'prezes', name: 'Wampir z Działu HR', title: 'Zarząd', hp: 112, atk: 12, aspd: 90, armor: 5, evade: 10, crit: 0, art: 'cat', tint: 'blood', mech: ['summon', 'rage'], vamp: 45, summon: { every: 180, n: 1, max: 3 }, rage: { at: 40, aspd: 145 },
    text: 'Leczy się 45% zadanych obrażeń, przyzywa stażystów na rozmowy kwalifikacyjne, a poniżej 40% życia wpada w szał.', quote: 'Zapraszamy na rozmowę. Nie wychodzi się z niej żywym.' },
  // Dodatkowe (opcjonalne) rundy po wygranej na piętrze 3 i 6 (EXTRA_AT): extra: true, slot: null. Pies Pipsztala, Lakuś, to osobny wróg (EXTRA_DOG).
  gruszka: { id: 'gruszka', slot: null, extra: true, name: 'Gruszka', title: 'Pan Sadu', hp: 120, atk: 7, aspd: 95, armor: 5, evade: 0, crit: 10, art: 'gruszka', idle: 20, mech: ['rage'], rage: { at: 40, aspd: 135 },
    text: 'Wielki kurczak z głową gruszki. Na starcie wyśmiewa twój build, a poniżej 40% życia wpada w szał.', quote: 'Najpierw cię wyśmieję, potem obiorę.' },
  pipsztal: { id: 'pipsztal', slot: null, extra: true, name: 'Pipsztal', title: 'Dresiarz z Psem', hp: 145, atk: 10, aspd: 90, armor: 4, evade: 0, crit: 20, art: 'pipsztal', mech: ['stunhero', 'pet'], stunHero: { every: 70, dur: 12 },
    text: 'Zawsze z psem: pies sika na ciebie i spowalnia twoje ataki. Pipsztal tnie nożem i co 7 s na chwilę cię ogłusza.', quote: 'Ej, kurczak! Masz pięć złotych? Pies lubi pieniądze.' },
  // Dogrywka (po Prezesie): co superEvery pięter jeden z poniższych, po kolei.
  'super-skubarka': { id: 'super-skubarka', slot: null, super: true, name: 'Skubarka 9000', title: 'Maszyna Zarządu', hp: 190, atk: 13, aspd: 85, armor: 8, evade: 0, crit: 0, shield: 25, art: 'plucker', tint: 'super', mech: ['plucker', 'crash'], spec: { every: 80, windup: 20, mult: 330 },
    text: 'Skubarka po modernizacji: tarcza, szarże z przegrzewaniem i Skubanie twoich kafelków.', quote: 'Nowa wersja. Te same pióra.' },
  'super-rada': { id: 'super-rada', slot: null, super: true, name: 'Rada Nadzorcza', title: 'Ostateczny Zarząd', hp: 200, atk: 12, aspd: 90, armor: 8, evade: 5, crit: 0, art: 'boss', tint: 'super', mech: ['block', 'audit', 'summon'], auditEvery: 80, summon: { every: 160, n: 2, max: 4 },
    text: 'Zebranie zarządu bez końca: blokuje umiejętności, zdejmuje statusy i wzywa stażystów.', quote: 'Punkt pierwszy: twoja porażka.' },
  'super-prezes': { id: 'super-prezes', slot: null, super: true, name: 'Prezes Zero', title: 'Pierwszy Rosół', hp: 220, atk: 14, aspd: 90, armor: 8, evade: 0, crit: 5, art: 'boss', tint: 'super', mech: ['block', 'tyrant', 'rage', 'blizzard'], rage: { at: 35, aspd: 140 }, blizzard: { every: 130, dur: 35 },
    text: 'Wrzący Garnek bez dna. Zamieć, blokady umiejętności, narastający gniew i szał poniżej 35% życia.', quote: 'Od zawsze i do końca. Taki był plan.' },
};
// Pule wariantów bossów na miejsce (slot z MODES.*.bosses). Wariant losuje się z ziarna runu (rules.js → bossFor).
export const BOSS_POOL = { brojler: ['brojler', 'szef-nocnej', 'krol-szczurow'], skubarka: ['skubarka', 'wielka-chlodnia', 'wozek-prototyp'], prezes: ['prezes', 'dyrektor-finansowy', 'wampir-hr'] };
// Dodatkowe rundy: piętro -> boss. Pies Pipsztala (Lakuś): wróg pomocniczy (minion), spowalnia atakami.
export const EXTRA_AT = { 3: 'gruszka', 6: 'pipsztal' };
export const EXTRA_DOG = { id: 'pies-pipsztala', name: 'Lakuś', hp: 42, atk: 3, aspd: 110, armor: 0, evade: 0, crit: 0, art: 'pipdog', minion: true, slow: { pct: 20, ticks: 30 }, text: 'Sika na ciebie i spowalnia twoje ataki.' };
export const SUPER_BOSSES = ['super-skubarka', 'super-rada', 'super-prezes'];

// ---------- Adaptacja bossów, elit i dodatkowych bossów do buildu gracza ----------
// Serwer czyta build z wyposażenia gracza (buildProfile w rules.js) i wybiera kontry: reakcje przeciwnika uruchamiane stanem walki
// (spadek Życia poniżej progu), nie losowaniem. Liczba i siła kontr rośnie z palnikiem (COUNTER_K): palnik 0 = 1 lekka kontra,
// palniki 3–5 = 2 kontry i dłuższe okna. Każda kontra jest czasowa (dur w tickach), więc gracz zawsze ma przestrzeń na odpowiedź.
// heal = % maks. Życia przywracane wrogowi, dur = czas działania, n = pomocnicy, pct = siła (np. blokada leczenia).
export const ARCHETYPES = { fire: 'Ogień', frost: 'Mróz', poison: 'Salmonella', bleed: 'Krwawienie', crit: 'mocne dziobnięcia', armor: 'Pancerz', heal: 'leczenie', skills: 'umiejętności', eggs: 'jaja' };
export const COUNTERS = {
  straz: { vs: 'fire', name: 'Straż Pożarna', icon: '🚒', heal: 30, dur: 55, n: 2, add: 'Strażak', text: 'Zarząd wezwał straż pożarną: wróg leczy się, Oparzenie nie działa, a strażacy gaszą pożar.' },
  piec: { vs: 'frost', name: 'Piec Przemysłowy', icon: '🔥', heal: 35, dur: 70, n: 0, text: 'Odpalono piec: wróg się odmraża, leczy i jest odporny na Mróz.' },
  odtrutka: { vs: 'poison', name: 'Płukanie Żołądka', icon: '💊', heal: 40, dur: 70, n: 0, text: 'Zarząd poda wrogowi odtrutkę: Salmonella znika i przez chwilę nie działa.' },
  bandaz: { vs: 'bleed', name: 'Apteczka Zakładowa', icon: '🩹', heal: 40, dur: 70, n: 0, text: 'Opatrunek na rany: Krwawienie znika i przez chwilę nie działa.' },
  helm: { vs: 'crit', name: 'Kask Ochronny', icon: '⛑️', heal: 20, dur: 80, n: 0, text: 'Wróg zakłada kask: mocne dziobnięcia przez chwilę zadają zwykłe obrażenia.' },
  wiertlo: { vs: 'armor', name: 'Wiertło Dyrektora', icon: '🛠️', heal: 20, dur: 80, n: 0, pct: 50, text: 'Pancerne wiertło: cudze ciosy przebijają połowę twojego Pancerza.' },
  nozyce: { vs: 'heal', name: 'Nożyce Budżetowe', icon: '✂️', heal: 20, dur: 80, n: 0, pct: 70, text: 'Cięcie kosztów: twoje leczenie jest przez chwilę o 70% słabsze.' },
  cisza: { vs: 'skills', name: 'Cisza w Biurze', icon: '🤫', heal: 20, dur: 50, n: 0, text: 'Zakaz hałasu: wszystkie twoje umiejętności są zablokowane.' },
  omlet: { vs: 'eggs', name: 'Wielka Patelnia', icon: '🍳', heal: 20, dur: 70, n: 0, text: 'Patelnia na jajka: twoje jaja przez chwilę nie wybuchają.' },
  swiat: { vs: null, name: 'Świta Zarządu', icon: '👥', heal: 8, dur: 0, n: 3, add: 'Praktykant', text: 'Zarząd wzywa świtę: do walki wchodzi kilku pomocników naraz.' },
};
export const COUNTER_OF = Object.fromEntries(Object.entries(COUNTERS).filter(([, c]) => c.vs).map(([id, c]) => [c.vs, id]));
export const COUNTER_K = [45, 52, 58, 64, 70, 75];   // % bazowej siły i długości kontr wg palnika 0..5
export const COUNTER_SLOT_K = { brojler: 0.5, skubarka: 0.8, prezes: 1 };   // mnożnik wg miejsca bossa: pierwszy najlżejszy, Prezes pełna siła   // % bazowej siły i długości kontr wg palnika 0..5

// ---------- Szablony zwykłych pięter ----------
// Losowane z ziarna runu (rules.js → floorTemplate). Nie dotyczą wczesnych pięter, bossów, elit, Nemezis ani ryzykownych drzwi.
// w = waga losowania; Zwiad (wróg z następnej strefy) nie występuje w ostatniej strefie.
export const FLOOR_TPL = {
  zwykle: { name: 'Zwykłe piętro', w: 40, text: 'Zwykli wrogowie ze strefy.' },
  czempion: { name: 'Czempion', w: 15, hp: 180, text: 'Jeden wróg, ale z +80% Życia.' },
  roj: { name: 'Rój', w: 15, n: 3, hp: 60, atk: 70, text: 'Trzech osłabionych wrogów naraz (60% Życia, 70% Ataku).' },
  zwiad: { name: 'Zwiad', w: 15, text: 'Samotny wróg z następnej strefy fabryki.' },
  para: { name: 'Para', w: 15, armor: 8, regen: 1, text: 'Dwa różne gatunki, które się wspierają: silniejszy osłania (+8 Pancerza), a obaj łatają rany (1% Życia na sekundę).' },
  // Wielu wrogów (limit: RULES.foeCap + RULES.foePerPet za każdego towarzysza). hp/atk = % statystyk zwykłego wroga; część wchodzi od razu, reszta falami.
  horda: { name: 'Horda', w: 12, hp: 62, atk: 78, many: true, text: 'Od 4 do 7 słabych wrogów. Część wchodzi od razu, reszta nadjeżdża falami co 6 s.' },
  armia: { name: 'Armia', w: 8, hp: 38, atk: 50, leaderHp: 150, many: true, minZone: 1, text: 'Dowódca ze świtą (do 5 wrogów, 7 z towarzyszem). Dowódca ma +50% Życia, świta nadjeżdża falami.' },
};

// ---------- Cechy elitarnych wrogów ----------
export const AFFIXES = {
  opancerzony: { name: 'Opancerzony', text: '+15 Pancerza i tarcza na 2 ciosy' },
  wampiryczny: { name: 'Wampiryczny', text: 'Leczy się o połowę zadanych obrażeń' },
  wybuchowy: { name: 'Wybuchowy', text: 'Po śmierci wybucha za 200% swojego Ataku' },
  ognioodporny: { name: 'Ognioodporny', text: 'Odporny na Oparzenie i Salmonellę' },
  mrozny: { name: 'Mroźny', text: 'Odporny na Mróz, jego ciosy spowalniają' },
  szybki: { name: 'Szybki', text: '+40% szybkości ataku' },
  regenerujacy: { name: 'Regenerujący', text: 'Odnawia 2% maks. Życia na sekundę' },
};

// ---------- Odznaki Pracownicze (nagroda za bossa i elitę; pasywne, nie zajmują miejsca) ----------
export const BADGES = {
  'pracownik-miesiaca': { name: 'Pracownik Miesiąca', text: 'Umiejętność w 1. slocie jest gotowa od początku walki', fx: [{ k: 'firstReady', v: 1 }] },
  'nadgodziny': { name: 'Nadgodziny', text: 'Po 20 s walki +25% obrażeń', fx: [{ k: 'overtime', v: 25 }] },
  'bhp': { name: 'Szkolenie BHP', text: '+10% maks. Życia, leczenie po rundzie +10 pkt proc.', fx: [{ k: 'hpPct', v: 10 }, { k: 'healBonus', v: 10 }] },
  'delegacja': { name: 'Delegacja', text: '+1 darmowy reroll w każdej rundzie, +1 Ziarno po rundzie', fx: [{ k: 'freeReroll', v: 1 }, { k: 'coinFlat', v: 1 }] },
  'team-building': { name: 'Team Building', text: 'Umiejętności mają o 15% krótszy cooldown', fx: [{ k: 'cdPct', v: 15 }] },
  'karta-multisport': { name: 'Karta Multisport', text: '+3 Regeneracji / s, +5% uniku', fx: [{ k: 'regen', v: 30 }, { k: 'evade', v: 5 }] },
  'awans': { name: 'Awans', text: '+20% Ataku', fx: [{ k: 'atkPct', v: 20 }] },
  'kawa-z-ekspresu': { name: 'Kawa z Ekspresu', text: '+15% szybkości ataku', fx: [{ k: 'aspdPct', v: 15 }] },
  'nagana-z-wpisem': { name: 'Nagana z Wpisem', text: '+10% szansy na dziobnięcie; mocne dziobnięcia nakładają 2 stosy Krwawienia', fx: [{ k: 'crit', v: 10 }, { k: 'critBleed', v: 2 }] },
  'fundusz-socjalny': { name: 'Fundusz Socjalny', text: 'Odpoczynek leczy 2 razy więcej i kosztuje 1 Ziarno mniej', fx: [{ k: 'restBonus', v: 20 }, { k: 'restDisc', v: 1 }] },
  'klucz-do-serwerowni': { name: 'Klucz do Serwerowni', text: 'Efekty statusowe trwają 50% dłużej, Oparzenie i Salmonella +15% obrażeń', fx: [{ k: 'stDur', v: 50 }, { k: 'burnPct', v: 15 }, { k: 'poisonPct', v: 15 }] },
  'parasol-ochronny': { name: 'Parasol Ochronny', text: 'Pierwsze 3 ciosy wrogów w każdej walce są zablokowane', fx: [{ k: 'parasol', v: 3 }] },
  // Specjalna: tylko za pokonanie Nemezis (nie trafia do losowych ofert Odznak ani do Kapliczki).
  'sprawiedliwosc': { name: 'Sprawiedliwość Kurnika', text: '+10% Ataku i +10% maks. Życia', fx: [{ k: 'atkPct', v: 10 }, { k: 'hpPct', v: 10 }], special: true },
};
export const BADGE_OFFER = 3;
export const BADGE_POOL = Object.keys(BADGES).filter(b => !BADGES[b].special);

// ---------- Okólniki Zarządu (modyfikator strefy, losowany z ziarna runu przy wejściu do strefy) ----------
// Efekty: oszczednosci (sim.js: Mróz, Oparzenie), integracja (stats.js: zestawy), pilny (sim.js: Furia; rules.js: premia za szybkość),
// audyt, premia, homeoffice (rules.js: rerolle i ceny, wrogowie i Ziarna, odpoczynek i leczenie).
export const DECREES = {
  oszczednosci: { name: 'Oszczędności Energii', text: 'Mróz trwa 2 razy dłużej, a Oparzenie zadaje o połowę mniej.' },
  audyt: { name: 'Audyt Wydatków', text: 'Dwa pierwsze rerolle na każdym piętrze są za darmo, ale dokupowanie jest o 50% droższe.' },
  integracja: { name: 'Wyjazd Integracyjny', text: 'Zestawy przedmiotów liczą się tak, jakbyś miał o 1 sztukę więcej.' },
  premia: { name: 'Premia Motywacyjna', text: 'Wrogowie mają +15% Życia, ale każde wygrane piętro daje +3 Ziarna.' },
  homeoffice: { name: 'Praca Zdalna', text: 'Odpoczynek leczy 2 razy więcej, ale leczenie po walce jest słabsze o 10 pkt proc.' },
  pilny: { name: 'Tryb Pilny', text: 'Wrogowie wpadają w Furię już po 30 s, ale premia za szybkość walk jest podwójna.' },
};

// ---------- Wadliwa Partia: ukryte wady kafelków (ujawniają się i zaczynają działać po następnej walce) ----------
export const FLAWS = {
  samozaplon: { name: 'Samozapłon', text: 'Co 20 s podpala ciebie (3 stosy Oparzenia).', fx: [{ k: 'selfBurn', v: 1 }] },
  rozklejony: { name: 'Rozklejony', text: 'Odpoczynek leczy o połowę mniej.', fx: [{ k: 'restHalf', v: 1 }] },
  wybuchowy: { name: 'Wybuchowa Usterka', text: 'Gdy wrogowie wpadają w Furię, wybucha: tracisz 15% maks. Życia.', fx: [{ k: 'furyBlast', v: 15 }] },
  ciezki: { name: 'Ciężki', text: '-10% szybkości ataku.', fx: [{ k: 'aspdPct', v: -10 }] },
  kruchy: { name: 'Kruchy', text: '-10% maks. Życia.', fx: [{ k: 'hpPct', v: -10 }] },
  zarloczny: { name: 'Żarłoczny', text: '-1 Ziarno po każdej wygranej rundzie.', fx: [{ k: 'coinFlat', v: -1 }] },
};

// ---------- Awans Wroga (Nemezis) ----------
export const NEMESIS_TITLES = ['Kierownik', 'Starszy Specjalista', 'Koordynator', 'Brygadzista', 'Kontroler Jakości', 'Dyrektor Regionalny'];
export const NEMESIS_NAMES = ['Zbigniew', 'Halina', 'Mirosław', 'Grażyna', 'Bożydar', 'Wiesława', 'Czesław', 'Krystyna'];

// ---------- Trasy (wybór drogi na początku strefy II i III) ----------
// Dwie trasy z pięciu losuje się z ziarna runu. Modyfikator działa na całą strefę: wrogowie (poza bossami): enemyHp/enemyAtk (%),
// slow {pct,ticks}, ignite (% Ataku wroga na stos), shieldHits; ekonomia: coins (Ziarna po wygranej), freeReroll (na piętro), heal (pkt proc.), priceDisc (%), luck (Szczęście w ofertach).
export const ROUTES = {
  chlodnia: { name: 'Chłodnia', icon: 'chlodnia', text: 'Wrogowie mają +3% Życia i lekko spowalniają twoje ataki, ale każde piętro daje +3 Ziarna.', enemyHp: 3, slow: { pct: 10, ticks: 20 }, coins: 3 },
  kotlownia: { name: 'Kotłownia', icon: 'kotlownia', text: 'Wrogowie mają +4% Ataku, ale w ofertach jest znacznie więcej rzadkich kafelków (+35 Szczęścia).', enemyAtk: 4, luck: 35 },
  magazyn: { name: 'Magazyn Pasz', icon: 'magazyn', text: 'Wrogowie mają -12% Życia, ale +8% Ataku (szklane armaty). Dostajesz 1 darmowy reroll na piętro.', enemyHp: -12, enemyAtk: 8, freeReroll: 1 },
  kanaly: { name: 'Kanały Wentylacyjne', icon: 'kanaly', text: 'Wrogowie mają +6% Życia, ale po każdej walce leczysz się o 20 pkt proc. więcej.', enemyHp: 6, heal: 20 },
  sortownia: { name: 'Sortownia Jaj', icon: 'sortownia', text: 'Wrogowie mają tarczę na 1 cios i -10% Życia, a dokupowanie jest o 30% tańsze.', enemyHp: -10, shieldHits: 1, priceDisc: 30 },
};

// ---------- Klątwy Prezesa (dobrowolne, wybierane przed runem; do CURSE_MAX naraz) ----------
// pct = premia do wyniku (sumuje się). Efekty: rules.js (rerolle, odpoczynek, Ziarna, sloty, wrogowie, podgląd), stats.js (Kruche Kości), sim.js (Pospiech).
export const CURSES = {
  'zakaz-wymian': { name: 'Zakaz Wymian', text: 'Reroll jest niemożliwy (także darmowy).', pct: 25, icon: 'zakaz' },
  'przegrzany-piec': { name: 'Przegrzany Piec', text: 'Wrogowie mają +15% Życia i +15% Ataku.', pct: 30, icon: 'piec' },
  'zakaz-drzemek': { name: 'Zakaz Drzemek', text: 'Odpoczynek jest wyłączony.', pct: 5, icon: 'drzemka' },
  'podatek': { name: 'Podatek Kurzy', text: 'Po każdej wygranej walce o 2 Ziarna mniej.', pct: 18, icon: 'podatek' },
  'ciasne-gniazdo': { name: 'Ciasne Gniazdo', text: 'Tylko 2 sloty umiejętności.', pct: 20, icon: 'gniazdo' },
  'pospiech': { name: 'Pospiech', text: 'Wrogowie wpadają w Furię już po 30 s walki.', pct: 6, icon: 'pospiech' },
  'mgla': { name: 'Mgła Zarządu', text: 'Nie widzisz składu piętra przed walką.', pct: 8, icon: 'mgla' },
  'kruche-kosci': { name: 'Kruche Kości', text: '-25% maks. Życia.', pct: 30, icon: 'kosci' },
};
export const CURSE_MAX = 3;
export const cursePct = list => (list || []).reduce((a, id) => a + (CURSES[id] ? CURSES[id].pct : 0), 0);

// ---------- Towarzysze (pisklęta-pupile; adopcja w Schronisku, rosną po bossach do poziomu 3) ----------
// lv[i] = poziom i+1: act = czynność w walce (peck: cios w % Ataku, heal: leczenie w % maks. Życia, burn/frost: stosy na celu, honk: ogłuszenie wrogów w tickach), every w tickach, fx = stałe premie.
export const COMPANIONS = {
  pisklak: { id: 'pisklak', name: 'Pisklę Bojowe', forms: ['Pisklę Bojowe', 'Kurczę Bojowe', 'Kogucik Bojowy'], text: 'Dziobie wroga co kilka sekund (cios w % twojego Ataku).',
    lv: [{ act: 'peck', every: 30, v: 18 }, { act: 'peck', every: 28, v: 28 }, { act: 'peck', every: 26, v: 40 }] },
  trzmiel: { id: 'trzmiel', name: 'Trzmiel Medyk', forms: ['Trzmiel Medyk', 'Trzmiel Felczer', 'Trzmiel Chirurg'], text: 'Co kilka sekund leczy cię (% maks. Życia).',
    lv: [{ act: 'heal', every: 40, v: 2 }, { act: 'heal', every: 36, v: 3 }, { act: 'heal', every: 32, v: 4 }] },
  salamandra: { id: 'salamandra', name: 'Salamandra', forms: ['Salamandra', 'Salamandra Paleniskowa', 'Smok Rosołowy'], text: 'Podpala wroga: dokłada stosy Oparzenia.',
    lv: [{ act: 'burn', every: 45, v: 1 }, { act: 'burn', every: 40, v: 1 }, { act: 'burn', every: 35, v: 2 }] },
  balwanek: { id: 'balwanek', name: 'Bałwanek', forms: ['Bałwanek', 'Bałwan Chłodniczy', 'Lodowy Kolos'], text: 'Mrozi wroga: dokłada stosy Mrozu.',
    lv: [{ act: 'frost', every: 40, v: 1 }, { act: 'frost', every: 36, v: 1 }, { act: 'frost', every: 32, v: 2 }] },
  gasior: { id: 'gasior', name: 'Gąsior Stróż', forms: ['Gąsior Stróż', 'Gęsi Ochroniarz', 'Gęsi Generał'], text: 'Blokuje pierwsze ciosy wrogów, a co kilka sekund syczy i ogłusza ich.',
    lv: [{ act: 'honk', every: 140, v: 6, fx: [{ k: 'parasol', v: 1 }] }, { act: 'honk', every: 120, v: 8, fx: [{ k: 'parasol', v: 1 }] }, { act: 'honk', every: 100, v: 10, fx: [{ k: 'parasol', v: 2 }] }] },
  kot: { id: 'kot', name: 'Kot Skarbnik', forms: ['Kot Skarbnik', 'Kot Księgowy', 'Kot Prezesa'], text: 'Przynosi Ziarna po każdej wygranej walce.',
    lv: [{ fx: [{ k: 'coinFlat', v: 1 }] }, { fx: [{ k: 'coinFlat', v: 1 }, { k: 'luck', v: 5 }] }, { fx: [{ k: 'coinFlat', v: 2 }, { k: 'luck', v: 10 }] }] },
};
export const COMPANION_OFFER = 3;

// ---------- Kurnik (meta-progres: Pióra za runy → trwałe ulepszenia, maks. 3 poziomy) ----------
// Efekty liczone w rules.js (start: Ziarna, towarzysz; kantyna: rerolle; skarbiec: Ziarna za bossa) i stats.js (siłownia, gabinet, szkoła).
export const KURNIK = {
  spizarnia: { name: 'Spiżarnia', icon: 'spizarnia', text: '+1 Ziarno na start runu za poziom.', cost: [12, 28, 55] },
  gabinet: { name: 'Gabinet Lekarski', icon: 'gabinet', text: 'Odpoczynek leczy o 5 pkt proc. więcej za poziom.', cost: [12, 28, 55] },
  silownia: { name: 'Siłownia', icon: 'silownia', text: '+1% maks. Życia i +1% Ataku za poziom.', cost: [20, 45, 80] },
  skarbiec: { name: 'Skarbiec Prezesa', icon: 'skarbiec', text: '+1 Ziarno za każdego pokonanego bossa za poziom.', cost: [15, 35, 65] },
  kantyna: { name: 'Kantyna', icon: 'kantyna', text: '+1 darmowy reroll za poziom na pierwszym piętrze każdej strefy.', cost: [12, 28, 55] },
  szkola: { name: 'Szkoła Kurzych Sztuczek', icon: 'szkola', text: 'Umiejętności mają o 4% krótszy cooldown za poziom.', cost: [15, 35, 65] },
  pisklecarnia: { name: 'Pisklęcarnia', icon: 'pisklecarnia', text: 'Poz. 1: zaczynasz z losowym towarzyszem. Poz. 2: towarzysza wybierasz z 3 na starcie runu. Poz. 3: wybierasz z 3, a towarzysz zaczyna o poziom wyżej.', cost: [25, 60, 110] },
};
export const KURNIK_MAX = 3;

// ---------- Temperatura Garnka (poziomy trudności) ----------
export const GARNEK = [
  { name: 'Letni', text: 'Brak modyfikatorów.' },
  { name: 'Ciepły', text: 'Wrogowie mają +10% Życia.' },
  { name: 'Gorący', text: 'Wrogowie mają +7% Ataku, reroll droższy o 1 Ziarno, elitarni wrogowie (poza pierwszymi piętrami) mają 2 cechy.' },
  { name: 'Wrzący', text: 'Leczenie po rundzie spada z 35% do 25%, wrogowie mają +3% Życia więcej.' },
  { name: 'Kipiący', text: 'Bossowie mają +20% szybkości ataku i +15% Życia.' },
  { name: 'Wulkan Rosołu', text: 'Wrogowie mają +8% Życia i +8% Ataku więcej, bossowie +10% Życia więcej, po wygranej o 1 Ziarno mniej, a regeneracja w walce działa o połowę słabiej.' },
];
// Premie palnika dla wrogów (Życie, Atak, Życie bossów) rosną z piętrem: na 1. piętrze to garnekRamp% wartości, na ostatnim 100%.
// Dzięki temu wyższe palniki nie zabijają od pierwszej walki, tylko dociskają coraz mocniej.
export const GARNEK_RAMP_MIN = 40;
export const garnekRamp = (mode, round) => GARNEK_RAMP_MIN + Math.floor((100 - GARNEK_RAMP_MIN) * Math.min(1, Math.max(0, round - 1) / Math.max(1, MODES[mode].rounds - 1)));
// Modyfikatory sumują się od poziomu 0 do wybranego.
export function garnekMods(level) {
  const L = Math.max(0, Math.min(5, level | 0));
  return {
    enemyHp: (L >= 1 ? 10 : 0) + (L >= 3 ? 3 : 0) + (L >= 5 ? 8 : 0),
    enemyAtk: (L >= 2 ? 7 : 0) + (L >= 5 ? 8 : 0),
    bossHp: (L >= 4 ? 15 : 0) + (L >= 5 ? 10 : 0),
    coinMinus: L >= 5 ? 1 : 0,
    rerollExtra: L >= 2 ? 1 : 0,
    elites: true, eliteAffixes: L >= 2 ? 2 : 1,
    healPct: L >= 3 ? 25 : RULES.healPct,
    bossAspd: L >= 4 ? 20 : 0,
    noRegen: L >= 5,
  };
}

// Wagi rzadkości: [zwykły, rzadki, epicki, legendarny] dla trzech etapów runu (początek, środek, koniec).
export const RARITY_WEIGHTS = [[45, 35, 20, 0], [30, 36, 30, 2], [18, 34, 43, 5]];
// Wagi typów kafelków w ofercie.
export const TYPE_WEIGHTS = { stat: 40, skill: 20, item: 25, risk: 15 };

// ---------- Osiągnięcia ----------
// g = grupa (kolor medalu), s = symbol na medalu, secret = nazwa i opis ukryte do zdobycia. Warunki: achievements.js (tylko serwer).
export const ACH_GROUPS = { win: { name: 'Zwycięstwa', color: '#f0b429' }, style: { name: 'Styl gry', color: '#4db6ff' }, fight: { name: 'Walka', color: '#ef6a4a' }, coll: { name: 'Kolekcja', color: '#7bd88f' }, meta: { name: 'Droga kurczaka', color: '#c792ea' } };
const ACHIEVEMENTS_ALL = [
  // zwycięstwa
  { id: 'a-wygrana', g: 'win', s: '★', name: 'Pierwsza Zupa', text: 'Wygraj dowolny run.' },
  { id: 'a-szybka', g: 'win', s: '⚡', name: 'Szybciej niż Zupka', text: 'Wygraj tryb szybki. Szybciej, niż zdąży się zaparzyć zupka chińska.' },
  { id: 'a-babcia', g: 'win', s: '♛', name: 'Babcia Przytakuje', text: 'Wygraj tryb pełny.' },
  { id: 'a-g1', g: 'win', s: '♨', name: 'Ciepło, ciepło', text: 'Wygraj run na palniku 1 lub wyższym.' },
  { id: 'a-g2', g: 'win', s: '♨', name: 'Gazówka Dzwoni', text: 'Wygraj run na palniku 2 lub wyższym.' },
  { id: 'a-g3', g: 'win', s: '♨', name: 'Piec Nie Prosi', text: 'Wygraj run na palniku 3 lub wyższym.' },
  { id: 'a-g4', g: 'win', s: '♨', name: 'Kuźnia Rosołu', text: 'Wygraj run na palniku 4 lub wyższym.' },
  { id: 'a-g5', g: 'win', s: '☠', name: 'Wulkaniczny Kurczak', text: 'Wygraj run na najwyższym palniku.' },
  { id: 'a-pyrtek', g: 'win', s: '✦', name: 'Pyrtek w Garnku', text: 'Wygraj run Pyrtkiem.' },
  { id: 'a-kwoka', g: 'win', s: '✦', name: 'Babcia Nie Ustępuje', text: 'Wygraj run Kwoką Babcią.' },
  { id: 'a-kaczor', g: 'win', s: '✦', name: 'Szczęśliwa Kaczka', text: 'Wygraj run Kaczorem Hazardzistą.' },
  { id: 'a-indor', g: 'win', s: '✦', name: 'Bogdan Rozdaje Karty', text: 'Wygraj run Indorem Bogdanem.' },
  { id: 'a-zjarany', g: 'win', s: '✦', name: 'Dym Nad Garnkiem', text: 'Wygraj run Zjaranym Kurczakiem.', secret: true },
  { id: 'a-zagroda', g: 'win', s: '♛', name: 'Cała Zagroda', text: 'Wygraj runy wszystkimi postaciami.' },
  // styl gry
  { id: 'a-bez-synergii', g: 'style', s: '○', name: 'Solista', text: 'Wygraj run bez żadnego aktywnego zestawu (synergii).' },
  { id: 'a-bez-zakupow', g: 'style', s: '○', name: 'Skąpiec', text: 'Wygraj run bez dokupowania kafelków.' },
  { id: 'a-bez-rerolli', g: 'style', s: '○', name: 'Nie Zmieniam Zdania', text: 'Wygraj run bez ani jednego rerolla.' },
  { id: 'a-bez-odpoczynku', g: 'style', s: '○', name: 'Twardy Kurczak', text: 'Wygraj run bez Odpoczynku.' },
  { id: 'a-bez-umiejetnosci', g: 'style', s: '○', name: 'Dziób Goły', text: 'Wygraj run, w którym nie użyłeś żadnej umiejętności w walce.' },
  { id: 'a-pusty-portfel', g: 'style', s: '○', name: 'Wydałem Wszystko', text: 'Wygraj run z 0 Ziaren w kieszeni.' },
  { id: 'a-skarbnik', g: 'style', s: '◎', name: 'Skarbnik Fabryki', text: 'Miej 200 Ziaren naraz.' },
  { id: 'a-lombard', g: 'style', s: '◎', name: 'Stały Klient Lisa', text: 'Zastaw kafelek w Lombardzie 3 razy w jednym runie.' },
  { id: 'a-mutant', g: 'style', s: '◎', name: 'Mutant', text: 'Zmutuj umiejętność (trzecia kopia).' },
  { id: 'a-trzy-mutacje', g: 'style', s: '◎', name: 'Trzy Mutacje, Jeden Kurczak', text: 'Zmutuj trzy umiejętności w jednym runie.' },
  { id: 'a-odznaki', g: 'style', s: '◎', name: 'Pracownik Miesiąca', text: 'Zdobądź 6 Odznak w jednym runie.' },
  { id: 'a-rozwidlenia', g: 'style', s: '◎', name: 'Tylko Dla Personelu', text: 'Wybierz ryzykowne drzwi w 3 rozwidleniach w jednym runie.' },
  // walka
  { id: 'a-sekunda', g: 'fight', s: '⚡', name: 'Mgnienie Dzioba', text: 'Wygraj walkę w mniej niż sekundę.' },
  { id: 'a-minuta', g: 'fight', s: '⌛', name: 'Długa Zupa', text: 'Wygraj walkę, która trwała dłużej niż 60 sekund.' },
  { id: 'a-wlosek', g: 'fight', s: '✚', name: 'Na Włosku', text: 'Wygraj walkę, kończąc ją z mniej niż 10% życia.' },
  { id: 'a-bez-zadrapania', g: 'fight', s: '✚', name: 'Bez Zadrapania', text: 'Wygraj walkę, nie tracąc ani punktu życia.' },
  { id: 'a-nietykalny', g: 'fight', s: '✚', name: 'Nietykalny', text: 'Wygraj 10 walk w jednym runie, nie tracąc życia.' },
  { id: 'a-boss-czysto', g: 'fight', s: '☠', name: 'Boss Bez Ran', text: 'Pokonaj bossa, nie tracąc życia.' },
  { id: 'a-seria', g: 'fight', s: '⚔', name: 'Gdakacz', text: 'Odpal Pełną Kurzą Serię (3 różne umiejętności w Oknie Gdakania).' },
  { id: 'a-trzy-serie', g: 'fight', s: '⚔', name: 'Chór Gdakaczy', text: 'Odpal 3 Pełne Kurze Serie w jednej walce.' },
  { id: 'a-mocarz', g: 'fight', s: '✹', name: 'Mocarz', text: 'Zadaj jednym trafieniem 300 obrażeń.' },
  { id: 'a-mocarz2', g: 'fight', s: '✹', name: 'Dziobnięcie Stulecia', text: 'Zadaj jednym trafieniem 1000 obrażeń.' },
  { id: 'a-reakcja', g: 'fight', s: '❄', name: 'Młody Chemik', text: 'Wywołaj dowolną Reakcję.' },
  { id: 'a-brojler', g: 'fight', s: '☠', name: 'Koniec Brojlera', text: 'Pokonaj Brojlera Zdzisława.' },
  { id: 'a-skubarka', g: 'fight', s: '☠', name: 'Skubarka Skubana', text: 'Pokonaj Skubarkę 3000.' },
  { id: 'a-prezes', g: 'fight', s: '☠', name: 'Wypowiedzenie dla Prezesa', text: 'Pokonaj Prezesa Rosołu.' },
  { id: 'a-nemezis', g: 'fight', s: '☠', name: 'Zemsta Smakuje Najlepiej', text: 'Pokonaj swojego Nemezis.' },
  { id: 'a-nemezis5', g: 'fight', s: '☠', name: 'Seryjny Zemściciel', text: 'Pokonaj 5 Nemezis.' },
  // kolekcja
  { id: 'a-wylegarnia', g: 'coll', s: '✿', name: 'Hodowca', text: 'Wyklu legendarny przedmiot w Wylęgarni.' },
  { id: 'a-wylegarnia-all', g: 'coll', s: '✿', name: 'Wylęgarnia Pełna', text: 'Odkryj wszystkie przepisy Wylęgarni.' },
  { id: 'a-reakcje-all', g: 'coll', s: '❄', name: 'Mistrz Reakcji', text: 'Odkryj wszystkie Reakcje.' },
  { id: 'a-kolekcjoner', g: 'coll', s: '▣', name: 'Kolekcjoner', text: 'Poznaj 40 różnych kafelków.' },
  { id: 'a-zbieracz', g: 'coll', s: '▣', name: 'Kurnikowa Encyklopedia', text: 'Poznaj wszystkie kafelki.' },
  { id: 'a-wszystkie-postacie', g: 'coll', s: '▣', name: 'Pełen Kurnik', text: 'Odblokuj wszystkie postacie.' },
  // droga kurczaka
  { id: 'a-pierwszy', g: 'meta', s: '●', name: 'Pierwsze Piętro', text: 'Zakończ pierwszy run.' },
  { id: 'a-wytrwaly', g: 'meta', s: '●', name: 'Wytrwały', text: 'Przegraj 5 runów (i się nie poddawaj).' },
  { id: 'a-weteran', g: 'meta', s: '●', name: 'Weteran Fabryki', text: 'Zakończ 10 runów.' },
  { id: 'a-staly', g: 'meta', s: '●', name: 'Stały Bywalec', text: 'Zakończ 25 runów.' },
  { id: 'a-rekord', g: 'meta', s: '♛', name: 'Rekordzista', text: 'Zdobądź 20 000 punktów w jednym runie.' },
  { id: 'a-klatwa', g: 'style', s: '☠', name: 'Przeklęty', text: 'Wygraj run z co najmniej jedną Klątwą Prezesa.' },
  { id: 'a-klatwy3', g: 'win', s: '☠', name: 'Wróg Publiczny Nr 1', text: 'Wygraj run z trzema Klątwami Prezesa naraz.', secret: true },
  { id: 'a-dogrywka', g: 'win', s: '∞', name: 'Dogrywka', text: 'Przeżyj 5 pięter Dogrywki po pokonaniu Prezesa.' },
  { id: 'a-dogrywka15', g: 'win', s: '∞', name: 'Nieskończony Rosół', text: 'Przeżyj 15 pięter Dogrywki.', secret: true },
  { id: 'a-duch', g: 'fight', s: '👻', name: 'Pogromca Duchów', text: 'Pokonaj Ducha innego gracza (albo własne Odbicie) na Arenie Duchów.' },
  { id: 'a-towarzysz', g: 'style', s: '♥', name: 'Najlepszy Przyjaciel', text: 'Wygraj run z towarzyszem na najwyższym poziomie.' },
  { id: 'a-trasy', g: 'style', s: '➤', name: 'Zbieg Okoliczności', text: 'Wybierz trasę w obu strefach jednego runu (tryb pełny).' },
  { id: 'a-kurnik', g: 'meta', s: '⌂', name: 'Gospodarz Kurnika', text: 'Kup 10 ulepszeń w Kurniku.' },
  { id: 'a-kurnik-max', g: 'meta', s: '⌂', name: 'Kurnik Marzeń', text: 'Rozbuduj wszystkie budynki Kurnika do maksymalnego poziomu.', secret: true },
  { id: 'a-pelna-gra', g: 'meta', s: '♛', name: 'Szef Kuchni', text: 'Osiągnij 100% ukończenia gry w profilu.', secret: true },
];
export const ACHIEVEMENTS = ACHIEVEMENTS_ALL.filter(a => { const m = /^a-(.+)$/.exec(a.id); return !(m && CHARS[m[1]] && CHARS[m[1]].retired); });
export const ACH_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

// ---------- Staż: poziom konta w tle (Nadgodziny → poziomy → Talony do Sklepiku Zakładowego) ----------
// Nadgodziny za run = ukończone piętra + premia za wygraną (jak Pióra), maks. xpCap. Koszt wejścia na poziom n rośnie wolno: pierwsze poziomy szybko, kolejne coraz wolniej.
export const STAZ = { base: 20, pow: 1.15, talons: 2, xpCap: 40, winBonus: 8, garnekBonus: 2 };
export const stazCost = n => Math.round(STAZ.base * Math.pow(n, STAZ.pow));
export const STAZ_TITLES = ['Stażysta', 'Praktykant', 'Młodszy Pracownik', 'Pracownik', 'Starszy Pracownik', 'Specjalista', 'Brygadzista', 'Kierownik Zmiany', 'Kierownik', 'Dyrektor Działu', 'Wicedyrektor', 'Dyrektor Kurnika'];
export const stazTitle = lvl => STAZ_TITLES[Math.min(STAZ_TITLES.length - 1, Math.floor(lvl / 3))];
// Nagrody za poziom: serwer losuje 2 z puli (ziarno = nick i poziom), gracz bierze jedną. {v} = wartość z v(poziom).
export const LEVEL_REWARDS = [
  { id: 'piora', name: 'Premia kwartalna', text: '+{v} Piór do Kurnika', v: l => 10 + l, icon: '🪶' },
  { id: 'talon', name: 'Dodatkowy Talon', text: '+{v} Talon do Sklepiku', v: () => 1, icon: '🎟️' },
  { id: 'nadgodziny', name: 'Praca po godzinach', text: '+{v}% Nadgodzin w następnym runie', v: () => 30, icon: '⏱️' },
  { id: 'prowiant', name: 'Prowiant z Kantyny', text: '+{v} Ziarna na starcie następnego runu', v: () => 3, icon: '🌾' },
  { id: 'bon', name: 'Bon na przetasowanie', text: '+{v} darmowe przetasowania taśmy na starcie następnego runu', v: () => 2, icon: '🎫' },
];
export const REWARD_BY_ID = Object.fromEntries(LEVEL_REWARDS.map(r => [r.id, r]));

// ---------- Sklepik Zakładowy (kosmetyka za Talony; nic nie zmienia siły) ----------
export const SLOTS = { head: 'Głowa', eyes: 'Oczy', body: 'Ubranie', aura: 'Aura', title: 'Tytuł' };
export const SHOP = {
  kask: { id: 'kask', name: 'Kask Górniczy', slot: 'head', cost: 3, text: 'Z latarką. Do pracy na najniższych piętrach.' },
  okulary: { id: 'okulary', name: 'Okulary Pilota', slot: 'eyes', cost: 2, text: 'Ciemne szkła, bo przyszłość świeci jasno.' },
  dres: { id: 'dres', name: 'Dres Osiedlowy', slot: 'body', cost: 4, text: 'Kaptur, trzy paski i złoty łańcuch. Szacunek na osiedlu gwarantowany.' },
  fartuch: { id: 'fartuch', name: 'Fartuch Kucharza', slot: 'body', cost: 5, text: 'Ironia losu w rozmiarze XS.' },
  aura: { id: 'aura', name: 'Aura Rosołu', slot: 'aura', cost: 6, text: 'Para i pióra unoszą się za Tobą jak za szefem kuchni.' },
  tytul: { id: 'tytul', name: 'Dyrektor Kurnika', slot: 'title', cost: 2, text: 'Tytuł pod Twoim nickiem w rankingu.' },
};

// ---------- Księga Rosołów: każda wygrana gotuje rosół zależny od buildu (kolejność = priorytet: specjalne, żywioły, postacie, domowy) ----------
export const SOUPS = [
  { id: 'nieskonczony', name: 'Nieskończony Rosół', kind: 'special', color: '#b388ff', hint: 'Przejdź co najmniej 5 pięter Dogrywki po pokonaniu Prezesa.', secret: true },
  { id: 'piekielny', name: 'Rosół Piekielny', kind: 'special', color: '#ff5722', hint: 'Wygraj na palniku 4 lub wyżej.' },
  { id: 'zakazany', name: 'Rosół Zakazany', kind: 'special', color: '#6d4c41', hint: 'Wygraj z co najmniej dwiema Klątwami Prezesa.' },
  { id: 'ostatniego-tchu', name: 'Rosół Ostatniego Tchu', kind: 'special', color: '#ef9a9a', hint: 'Wygraj walkę z mniej niż 10% życia.' },
  { id: 'bez-skazy', name: 'Rosół Bez Skazy', kind: 'special', color: '#fff3c4', hint: 'Pokonaj bossa, nie tracąc ani punktu życia.' },
  { id: 'rozrzutnika', name: 'Rosół Rozrzutnika', kind: 'special', color: '#ffd54f', hint: 'Wygraj, dokupując co najmniej 10 kafelków.' },
  { id: 'skapca', name: 'Rosół Skąpca', kind: 'special', color: '#9e9d24', hint: 'Wygraj, mając w kieszeni co najmniej 60 Ziaren.' },
  { id: 'kompana', name: 'Rosół z Kompanem', kind: 'special', color: '#ffcc80', hint: 'Wygraj z towarzyszem na 3. poziomie.', secret: true },
  { id: 'wulkaniczny', name: 'Rosół Wulkaniczny', kind: 'tag', tag: 'ogien', color: '#ff7043', hint: 'Wygraj z co najmniej 4 kafelkami Ognia (najwięcej ze wszystkich żywiołów).' },
  { id: 'mrozony', name: 'Rosół Mrożony', kind: 'tag', tag: 'lod', color: '#81d4fa', hint: 'Wygraj z co najmniej 4 kafelkami Lodu (najwięcej ze wszystkich żywiołów).' },
  { id: 'czerwony', name: 'Rosół Czerwony', kind: 'tag', tag: 'krew', color: '#c62828', hint: 'Wygraj z co najmniej 4 kafelkami Krwi (najwięcej ze wszystkich żywiołów).' },
  { id: 'jajeczny', name: 'Rosół z Jajkiem', kind: 'tag', tag: 'jajo', color: '#ffe082', hint: 'Wygraj z co najmniej 4 kafelkami Jaj (najwięcej ze wszystkich żywiołów).' },
  { id: 'zatruty', name: 'Rosół Zatruty', kind: 'tag', tag: 'trucizna', color: '#7cb342', hint: 'Wygraj z co najmniej 4 kafelkami Trucizny (najwięcej ze wszystkich żywiołów).' },
  { id: 'korporacyjny', name: 'Rosół Korporacyjny', kind: 'tag', tag: 'korpo', color: '#90a4ae', hint: 'Wygraj z co najmniej 4 kafelkami Korporacyjnymi (najwięcej ze wszystkich żywiołów).' },
  { id: 'zbozowy', name: 'Rosół Zbożowy', kind: 'tag', tag: 'ziarno', color: '#d4a84b', hint: 'Wygraj z co najmniej 4 kafelkami Zboża (najwięcej ze wszystkich żywiołów).' },
  { id: 'c-pyrtek', name: 'Rosół Pyrtka', kind: 'char', char: 'pyrtek', color: '#f5c04a', hint: 'Wygraj Pyrtkiem.' },
  { id: 'c-kwoka', name: 'Rosół Babci', kind: 'char', char: 'kwoka', color: '#e0b57a', hint: 'Wygraj Kwoką Babcią.' },
  { id: 'c-kaczor', name: 'Rosół Kaczora', kind: 'char', char: 'kaczor', color: '#7fb77e', hint: 'Wygraj Kaczorem.' },
  { id: 'c-indor', name: 'Rosół Indora', kind: 'char', char: 'indor', color: '#d9534f', hint: 'Wygraj Indorem.' },
  { id: 'c-zjarany', name: 'Rosół Zjarany', kind: 'char', char: 'zjarany', color: '#a1887f', hint: 'Wygraj Zjaranym Kurczakiem.', secret: true },
  { id: 'c-barista', name: 'Rosół Latte', kind: 'char', char: 'barista', color: '#c9a27a', hint: 'Wygraj Baristą.' },
  { id: 'c-ges', name: 'Rosół z Bilansem', kind: 'char', char: 'ges', color: '#cfd8dc', hint: 'Wygraj Gęsią Księgową.' },
  { id: 'c-lodziarz', name: 'Rosół Truskawkowy', kind: 'char', char: 'lodziarz', color: '#f8bbd0', hint: 'Wygraj Lodziarzem.' },
  { id: 'c-pielegniarka', name: 'Rosół Wzmacniający', kind: 'char', char: 'pielegniarka', color: '#e1f5fe', hint: 'Wygraj Pielęgniarką.' },
  { id: 'c-rzeznik', name: 'Rosół Mięsny', kind: 'char', char: 'rzeznik', color: '#8d3b2c', hint: 'Wygraj Kogutem Rzeźnikiem.' },
  { id: 'c-wrozka', name: 'Rosół z Zaklęciem', kind: 'char', char: 'wrozka', color: '#ce93d8', hint: 'Wygraj Wróżką.' },
  { id: 'c-stazysta', name: 'Rosół na Próbę', kind: 'char', char: 'stazysta', color: '#fff176', hint: 'Wygraj Stażystą.' },
  { id: 'c-mutant', name: 'Rosół Radioaktywny', kind: 'char', char: 'mutant', color: '#9be564', hint: 'Wygraj Mutantem.' },
  { id: 'c-dinozaur', name: 'Rosół Jurajski', kind: 'char', char: 'dinozaur', color: '#66bb6a', hint: 'Wygraj Dinozaurem.', secret: true },
  { id: 'c-gigachad', name: 'Rosół Bez Nóg', kind: 'char', char: 'gigachad', color: '#b0a090', hint: 'Wygraj Gigachadem.' },
  { id: 'c-jajeczko', name: 'Rosół Na Miękko', kind: 'char', char: 'jajeczko', color: '#fff3c4', hint: 'Wygraj Panem Jajeczko.' },
  { id: 'c-krypto', name: 'Rosół Hossa', kind: 'char', char: 'krypto', color: '#f7b731', hint: 'Wygraj Kurczakiem Kryptowalutowym.' },
  { id: 'c-alkoholik', name: 'Rosół Na Kacu', kind: 'char', char: 'alkoholik', color: '#b5651d', hint: 'Wygraj Kogutem Alkoholikiem.' },
  { id: 'c-wegan', name: 'Rosół Bez Rosołu', kind: 'char', char: 'wegan', color: '#8bc34a', hint: 'Wygraj Kurczakiem Weganem.' },
  { id: 'c-baba', name: 'Rosół z Targu', kind: 'char', char: 'baba', color: '#e6a5a5', hint: 'Wygraj Babą z Targu.' },
  { id: 'c-influencer', name: 'Rosół Sponsorowany', kind: 'char', char: 'influencer', color: '#ec407a', hint: 'Wygraj Kurczakiem Influencerem.' },
  { id: 'c-skibidi', name: 'Rosół Skibidi', kind: 'char', char: 'skibidi', color: '#7e57c2', hint: 'Wygraj Kurczakiem Skibidi.' },
  { id: 'c-emeryt', name: 'Rosół Na Emeryturze', kind: 'char', char: 'emeryt', color: '#a1887f', hint: 'Wygraj Emerytem Januszem.' },
  { id: 'c-sigma', name: 'Rosół Solo', kind: 'char', char: 'sigma', color: '#546e7a', hint: 'Wygraj Kurczakiem Sigma Solo.' },
  { id: 'c-sanepid', name: 'Rosół z Kontroli', kind: 'char', char: 'sanepid', color: '#9ccc65', hint: 'Wygraj Inspektorem Sanepidem.' },
  { id: 'c-wanda', name: 'Rosół ze Złotego Jaja', kind: 'char', char: 'wanda', color: '#ffd54f', hint: 'Wygraj Nioską Wandą.' },
  { id: 'c-zwiazkowiec', name: 'Rosół Strajkowy', kind: 'char', char: 'zwiazkowiec', color: '#ef5350', hint: 'Wygraj Kogutem Związkowcem.' },
  { id: 'c-pacyfista', name: 'Rosół Pokoju', kind: 'char', char: 'pacyfista', color: '#ce93d8', hint: 'Wygraj Kurczakiem Pacyfistą.' },
  { id: 'domowy', name: 'Rosół Domowy', kind: 'default', color: '#f2cf7a', hint: 'Wygraj run, który nie pasuje do żadnego innego przepisu.' },
];
export const SOUP_BY_ID = Object.fromEntries(SOUPS.map(s => [s.id, s]));

// ---------- Tryb kasynowy: automat przy przetasowaniu. Odblokowuje się, gdy gracz przetasuje ofertę tyle razy na jednym piętrze. ----------
export const CASINO_REROLLS = 5;
