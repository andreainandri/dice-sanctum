// Le serie di dadi del tavolo. Una la tiene il master per i suoi tiri in chiaro; fra le altre sceglie chi
// gioca. Ponte e server MCP ne conoscono soltanto i nomi: com'è fatta ogni serie lo dipinge il client
// (facce.ts), e la fisica è la stessa per tutte.

export const SERIE = ['perla', 'ossidiana', 'zaffiro', 'malachite', 'avorio', 'grafite', 'bufera', 'carnevale', 'sangue'] as const;
export type Serie = (typeof SERIE)[number];

/** La serie di chi gioca alla prima apertura del tavolo. */
export const SERIE_DI_PARTENZA: Serie = 'perla';
/** La serie del master finché non ne sceglie un'altra. */
export const SERIE_DEL_MASTER_DI_PARTENZA: Serie = 'sangue';

export function eSerie(x: unknown): x is Serie {
  return typeof x === 'string' && (SERIE as readonly string[]).includes(x);
}

/** Com'è fatta ogni serie, in inglese: le legge il DM quando sceglie i suoi dadi. */
export const ASPETTO_DELLA_SERIE: Record<Serie, string> = {
  perla: 'azure pearl: blue resin with pearly clouds, silver numbers',
  ossidiana: 'obsidian and gold: glossy black, gold numbers',
  zaffiro: 'sapphire: bead-blasted aluminium with navy numbers, a sapphire set in place of the 20',
  malachite: 'malachite: green stone in light and dark bands, gold numbers',
  avorio: 'ivory: old bone, black numbers',
  grafite: 'graphite and gold: matte charcoal, pale gold numbers',
  bufera: 'blizzard: smoky dark blue swirled with silver, white numbers',
  carnevale: 'carnival: translucent pumpkin orange with glitter, black numbers',
  sangue: 'oxblood: dark red marble with near-black veins, gold numbers',
};

/**
 * Dove va chi gioca quando il master prende proprio la sua serie: alla serie dopo nell'elenco (dopo l'ultima,
 * alla prima).
 */
export function serieLibera(presa: Serie): Serie {
  const i = SERIE.indexOf(presa);
  return SERIE[(i + 1) % SERIE.length]!;
}
