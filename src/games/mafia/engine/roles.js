// Definicje ról i frakcji. Teksty trafiają na telefon gracza w chwili odsłony.

export const FACTIONS = {
  mafia: { name: 'Mafia', goal: 'Eliminujcie miasto nocą, aż żywych członków mafii będzie co najmniej tylu, ilu pozostałych graczy.' },
  town:  { name: 'Miasto', goal: 'Znajdźcie i wyeliminujcie w głosowaniach wszystkich członków mafii.' },
};

export const ROLES = {
  don: {
    name: 'Don', faction: 'mafia',
    ability: 'Przewodzisz mafii. Gdy mafia nie może się zgodzić co do ofiary, Twój wybór rozstrzyga. Pierwsze sprawdzenie przez detektywa pokaże, że jesteś niewinny.',
  },
  mafioso: {
    name: 'Mafioso', faction: 'mafia',
    ability: 'Każdej nocy razem z resztą mafii wybierasz ofiarę. Znasz pozostałych członków mafii.',
  },
  detective: {
    name: 'Detektyw', faction: 'town',
    ability: 'Każdej nocy sprawdzasz jednego gracza i dowiadujesz się, czy należy do mafii.',
  },
  doctor: {
    name: 'Lekarz', faction: 'town',
    ability: 'Każdej nocy chronisz jedną osobę (także siebie). Jeśli mafia ją zaatakuje, przeżyje. Nie możesz chronić tej samej osoby dwie noce z rzędu.',
  },
  avenger: {
    name: 'Mściciel', faction: 'town',
    ability: 'Jeśli miasto wyeliminuje Cię w głosowaniu, wskazujesz jedną osobę, która zginie razem z Tobą. Działa tylko raz.',
  },
  journalist: {
    name: 'Dziennikarz', faction: 'town',
    ability: 'Raz w grze, nocą, sprawdzasz dwóch graczy i dowiadujesz się, czy należą do tej samej frakcji. Nie poznajesz ich ról.',
  },
  citizen: {
    name: 'Obywatel', faction: 'town',
    ability: 'Nie masz specjalnych umiejętności. Obserwuj, dyskutuj i głosuj. Nocą wskazujesz, kogo podejrzewasz.',
  },
};

// Kolejność wyświetlania i losowania.
export const ROLE_ORDER = ['don', 'mafioso', 'detective', 'doctor', 'avenger', 'journalist', 'citizen'];

export const isMafiaRole = r => ROLES[r] && ROLES[r].faction === 'mafia';

export function roleCard(roleId) {
  const r = ROLES[roleId];
  if (!r) return null;
  return { id: roleId, name: r.name, faction: r.faction, factionName: FACTIONS[r.faction].name, ability: r.ability, goal: FACTIONS[r.faction].goal };
}
