// Il controllo di un tiro arrivato dal tavolo. Il ponte non si fida del browser: rilegge la formula
// col parser condiviso, rifà il conto dai valori dei dadi e respinge quello che non torna.
// Il tiro registrato è quello ricostruito qui, con le chiavi nell'ordine del registro.

import { FISICA } from '../physics/config.ts';
import { type DadoLetto, calcola, riassunto, valoreAmmesso } from '../shared/conto.ts';
import { type TiroDalTavolo, tiroDalTavolo } from '../shared/eventi.ts';
import { ErroreFormula, gruppi, leggiFormula } from '../shared/notazione.ts';

export class TiroRespinto extends Error {
  constructor(messaggio: string) {
    super(messaggio);
    this.name = 'TiroRespinto';
  }
}

const ID = /^[A-Za-z0-9-]{8,64}$/;
export const ID_RICHIESTA = /^r-\d{4,9}$/;

type Oggetto = Record<string, unknown>;
const oggetto = (x: unknown): x is Oggetto => typeof x === 'object' && x !== null && !Array.isArray(x);
const intero = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

function chiede(condizione: boolean, messaggio: string): asserts condizione {
  if (!condizione) throw new TiroRespinto(messaggio);
}

export function verificaTiro(dato: unknown): TiroDalTavolo {
  chiede(oggetto(dato), 'the roll is not an object');
  chiede(dato.v === 1 && dato.type === 'roll.completed', 'the roll is not a version 1 roll.completed');
  chiede(typeof dato.id === 'string' && ID.test(dato.id), 'roll id missing or invalid');
  chiede(typeof dato.at === 'string' && dato.at.length <= 40 && !Number.isNaN(Date.parse(dato.at)), 'invalid roll date');
  chiede(typeof dato.label === 'string' && dato.label.length <= 80, 'invalid label');
  chiede(dato.requestId === null || (typeof dato.requestId === 'string' && ID_RICHIESTA.test(dato.requestId)), 'invalid requestId');
  chiede(typeof dato.formula === 'string', 'the formula is missing');

  let f;
  try {
    f = leggiFormula(dato.formula);
  } catch (e) {
    throw new TiroRespinto(e instanceof ErroreFormula ? `invalid formula: ${e.message}` : 'invalid formula');
  }
  chiede(f.testo === dato.formula, `the formula is not in canonical form: ${f.testo}`);

  const attesi = gruppi(f);
  chiede(Array.isArray(dato.groups) && dato.groups.length === attesi.length, `wrong number of dice groups: the formula has ${attesi.length}`);
  const letti: DadoLetto[][] = attesi.map((g, i) => {
    const arrivato: unknown = (dato.groups as unknown[])[i];
    const nome = `${g.numero}d${g.lati}`;
    chiede(oggetto(arrivato), `${nome}: invalid group`);
    chiede(arrivato.sign === g.segno && arrivato.count === g.numero && arrivato.sides === g.lati, `${nome}: the group does not match the formula`);
    const tieni = g.tieni ? JSON.stringify({ mode: g.tieni.mode, n: g.tieni.n }) : 'null';
    chiede(JSON.stringify(arrivato.keep ?? null) === tieni, `${nome}: kh, kl, dh or dl differ from the formula`);
    chiede(Array.isArray(arrivato.dice) && arrivato.dice.length === g.numero, `${nome}: wrong number of dice`);
    const ritiriMassimi = FISICA.ritiriMassimi * (g.lati === 100 ? 2 : 1);
    return (arrivato.dice as unknown[]).map((d, k): DadoLetto => {
      chiede(oggetto(d), `${nome}: die ${k + 1} is invalid`);
      chiede(intero(d.rethrows) && d.rethrows >= 0 && d.rethrows <= ritiriMassimi, `${nome}: invalid rethrows on die ${k + 1}`);
      chiede(typeof d.kept === 'boolean', `${nome}: die ${k + 1} has no kept`);
      const letto: DadoLetto =
        g.lati === 100
          ? { value: d.value as number, tens: d.tens as number, units: d.units as number, rethrows: d.rethrows }
          : { value: d.value as number, rethrows: d.rethrows };
      chiede(valoreAmmesso(g.lati, letto), `${nome}: value out of range on die ${k + 1}`);
      return letto;
    });
  });

  const conto = calcola(f, letti);
  conto.groups.forEach((g, i) => {
    const arrivati = (dato.groups as Oggetto[])[i]!.dice as Oggetto[];
    g.dice.forEach((d, k) => chiede(arrivati[k]!.kept === d.kept, `${g.count}d${g.sides}: the kept dice differ from the count`));
  });
  chiede(dato.constant === conto.constant, 'the constant differs from the formula');
  chiede(dato.total === conto.total, `wrong total: the dice give ${conto.total}`);
  chiede(dato.nat20 === conto.nat20 && dato.nat1 === conto.nat1, 'nat20 or nat1 differ from the count');
  chiede(dato.summary === riassunto(f, conto, dato.label), 'the summary differs from the count');

  return tiroDalTavolo({
    id: dato.id,
    at: new Date(dato.at).toISOString(),
    label: dato.label,
    formula: f,
    requestId: dato.requestId as string | null,
    conto,
  });
}
