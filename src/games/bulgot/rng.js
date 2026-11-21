// Bulgot: deterministyczny generator losowy. Ten sam plik gra w przeglądarce i na serwerze,
// więc używamy tylko mnożenia/dodawania na liczbach całkowitych (Math.imul) i dzielenia przez 2^32.

// Miesza kilka liczb w jeden 32-bitowy skrót (FNV-1a + mieszanie bitów).
export function mix(...nums) {
  let h = 0x811C9DC5;
  for (const n of nums) {
    h ^= (n | 0);
    h = Math.imul(h, 16777619);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2C1B3C6D);
    h ^= h >>> 12;
  }
  return h >>> 0;
}

// Napis -> liczba (do mieszania ze słowami, np. mix(seed, round, hash('offer'))).
export function hash(str) {
  let h = 0x811C9DC5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// mulberry32: małe, szybkie, w pełni powtarzalne.
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: n => Math.floor(next() * n),           // 0..n-1
    pick: arr => arr[Math.floor(next() * arr.length)],
    // losowanie z wag: weights to tablica liczb >= 0, zwraca indeks
    weighted(weights) {
      let sum = 0; for (const w of weights) sum += w;
      if (sum <= 0) return 0;
      let r = next() * sum;
      for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
      return weights.length - 1;
    },
  };
}
