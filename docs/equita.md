# Equità dei dadi

Misurata il 2026-11-14 con `strumenti/equita.ts`: lanci simulati con la stessa fisica del tavolo (Rapier, `src/physics`), la stessa fonte del caso (`crypto.getRandomValues`) e la stessa lettura delle facce. 4 thread, 225 secondi.

Parametri: gravità 650 cm/s², passo 1/120 s, vassoio 30×20 cm, tolleranza dello storto 6°.

Come si legge: per ogni dado si contano le facce uscite e si confrontano con la distribuzione uniforme col chi quadro. Il valore p è la probabilità di vedere uno scarto almeno così grande con un dado perfettamente equo. Su una trentina di prove qualche p sotto 0,05 capita per caso (una su venti); un bias vero si riconosce perché resta sotto 0,001 anche rifacendo la prova con lanci nuovi. «Scarto massimo» è la faccia più lontana dall’atteso, in percentuale dell’atteso.

Perché ci si aspetta l’equità prima ancora di contare: l’orientamento di partenza è uniforme su tutte le rotazioni, posizione, velocità e rotazione non dipendono da come il dado è girato, e il collisore del dado ha simmetrie che portano ogni faccia su ogni altra (il d12, composto da un cubo e sei tetti, ha le dodici rotazioni del tetraedro). Ogni simmetria scambia le facce lasciando identica la probabilità del lancio. Le prove controllano che il codice faccia davvero questo.

Un bias trovato e tolto: nella prima misura, il 14 novembre 2026, il d12 è uscito con p sotto 0,001 in due prove separate, con le stesse facce sbilanciate (1 e 8 sopra l’atteso, 5 e 7 sotto, fino al 6%). La causa: Rapier costruisce il contatto di una faccia con al più quattro vertici, e sui pentagoni del d12 ne restava fuori uno, sempre lo stesso per faccia; il dado si ribaltava più facilmente da quel lato. Contro un fondo a scatola, poi, un punto in più ne faceva scartare uno anche su tre facce del d10. Adesso il d12 è un cubo con un tetto su ogni faccia (la costruzione di Euclide), fondo e sponde sono piani, e `test/fisica.test.ts` controlla che ogni faccia di ogni dado appoggi su tutti i suoi vertici. I numeri qui sotto sono quelli dopo la correzione.

## Sintesi

| prova | categoria | dadi contati | χ² | gradi di libertà | p | scarto massimo | esito |
|---|---|---:|---:|---:|---:|---:|---|
| 1d4 | d4 | 20000 | 3.4 | 3 | 0.337 | 1.8% | nessun segno di bias |
| 1d6 | d6 | 20000 | 3.2 | 5 | 0.675 | 2.1% | nessun segno di bias |
| 1d8 | d8 | 20000 | 8.4 | 7 | 0.297 | 4.4% | nessun segno di bias |
| 1d10 | d10 | 20000 | 11.2 | 9 | 0.261 | 4.5% | nessun segno di bias |
| 1d12 | d12 | 20000 | 14.8 | 11 | 0.190 | 4.1% | nessun segno di bias |
| 1d20 | d20 | 20000 | 20.6 | 19 | 0.362 | 6.7% | nessun segno di bias |
| 5d4 | d4 | 20000 | 2.4 | 3 | 0.487 | 1.5% | nessun segno di bias |
| 5d6 | d6 | 20000 | 6.3 | 5 | 0.275 | 2.4% | nessun segno di bias |
| 5d8 | d8 | 20000 | 4.6 | 7 | 0.707 | 2.8% | nessun segno di bias |
| 5d10 | d10 | 20000 | 11.9 | 9 | 0.217 | 5.5% | nessun segno di bias |
| 5d12 | d12 | 19995 | 10.7 | 11 | 0.469 | 3.9% | nessun segno di bias |
| 5d20 | d20 | 20000 | 11.3 | 19 | 0.912 | 5.2% | nessun segno di bias |
| 1d100 | d10 decine | 20000 | 10.0 | 9 | 0.354 | 3.6% | nessun segno di bias |
| 1d100 | d10 unità | 20000 | 1.2 | 9 | 0.999 | 1.5% | nessun segno di bias |
| 1d100 | d100 | 20000 | 91.6 | 99 | 0.689 | 15.5% | nessun segno di bias |
| tavolo pieno | d10 decine | 3975 | 15.3 | 9 | 0.082 | 9.9% | nessun segno di bias |
| tavolo pieno | d10 unità | 3975 | 5.3 | 9 | 0.804 | 7.4% | nessun segno di bias |
| tavolo pieno | d100 | 3975 | 109.0 | 99 | 0.231 | 42.1% | nessun segno di bias |
| tavolo pieno | d20 | 3975 | 16.4 | 19 | 0.633 | 11.2% | nessun segno di bias |
| tavolo pieno | d6 | 7950 | 1.1 | 5 | 0.954 | 2.1% | nessun segno di bias |
| tavolo pieno | d8 | 3975 | 8.0 | 7 | 0.335 | 8.4% | nessun segno di bias |

## Lanci, ritiri, durata

| prova | lanci | falliti | ritiri per lancio | durata media |
|---|---:|---:|---:|---:|
| 1d4 (un d4 da solo) | 20000 | 0 | 0.003 | 0.60 s |
| 1d6 (un d6 da solo) | 20000 | 0 | 0.002 | 0.71 s |
| 1d8 (un d8 da solo) | 20000 | 0 | 0.010 | 0.68 s |
| 1d10 (un d10 da solo) | 20000 | 0 | 0.007 | 0.78 s |
| 1d12 (un d12 da solo) | 20000 | 0 | 0.019 | 0.88 s |
| 1d20 (un d20 da solo) | 20000 | 0 | 0.016 | 0.86 s |
| 5d4 (cinque d4 insieme, contati tutti) | 4000 | 0 | 0.057 | 0.70 s |
| 5d6 (cinque d6 insieme, contati tutti) | 4000 | 0 | 0.012 | 0.79 s |
| 5d8 (cinque d8 insieme, contati tutti) | 4000 | 0 | 0.066 | 0.79 s |
| 5d10 (cinque d10 insieme, contati tutti) | 4000 | 0 | 0.054 | 0.91 s |
| 5d12 (cinque d12 insieme, contati tutti) | 4000 | 1 | 0.154 | 1.06 s |
| 5d20 (cinque d20 insieme, contati tutti) | 4000 | 0 | 0.113 | 1.01 s |
| 1d100 (un d100 (decine e unità)) | 20000 | 0 | 0.019 | 0.84 s |
| tavolo pieno (10d6+5d8+5d20+5d100, trenta dadi insieme) | 800 | 5 | 1.627 | 1.53 s |

Il p più basso fra tutte le prove: 0.0820.

## I conteggi

**1d4, d4** (20000 dadi, atteso 5000 per faccia)

| 1 | 2 | 3 | 4 |
|---:|---:|---:|---:|
| 5092 | 4913 | 5018 | 4977 |

**1d6, d6** (20000 dadi, atteso 3333 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 |
|---:|---:|---:|---:|---:|---:|
| 3315 | 3322 | 3342 | 3263 | 3358 | 3400 |

**1d8, d8** (20000 dadi, atteso 2500 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2467 | 2611 | 2441 | 2458 | 2543 | 2499 | 2504 | 2477 |

**1d10, d10** (20000 dadi, atteso 2000 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1952 | 2001 | 2091 | 2014 | 2046 | 2008 | 2022 | 1935 | 2000 | 1931 |

**1d12, d12** (20000 dadi, atteso 1667 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1684 | 1599 | 1643 | 1604 | 1721 | 1699 | 1730 | 1667 | 1688 | 1720 | 1631 | 1614 |

**1d20, d20** (20000 dadi, atteso 1000 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1015 | 1059 | 991 | 966 | 1013 | 1024 | 977 | 980 | 1038 | 982 | 933 | 1022 | 1045 | 966 | 963 | 1006 | 999 | 997 | 1046 | 978 |

**5d4, d4** (20000 dadi, atteso 5000 per faccia)

| 1 | 2 | 3 | 4 |
|---:|---:|---:|---:|
| 5029 | 4932 | 5074 | 4965 |

**5d6, d6** (20000 dadi, atteso 3333 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 |
|---:|---:|---:|---:|---:|---:|
| 3314 | 3410 | 3253 | 3412 | 3287 | 3324 |

**5d8, d8** (20000 dadi, atteso 2500 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2541 | 2506 | 2429 | 2537 | 2544 | 2483 | 2494 | 2466 |

**5d10, d10** (20000 dadi, atteso 2000 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2040 | 2048 | 2069 | 1976 | 1976 | 2020 | 1989 | 1889 | 2021 | 1972 |

**5d12, d12** (19995 dadi, atteso 1666 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1718 | 1635 | 1629 | 1624 | 1704 | 1614 | 1660 | 1644 | 1731 | 1647 | 1686 | 1703 |

**5d20, d20** (20000 dadi, atteso 1000 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1022 | 1026 | 948 | 1009 | 973 | 1007 | 968 | 1016 | 976 | 983 | 964 | 983 | 1009 | 1008 | 1015 | 1019 | 999 | 1034 | 1029 | 1012 |

**1d100, d10 decine** (20000 dadi, atteso 2000 per faccia)

| 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2006 | 2026 | 2031 | 2068 | 2022 | 1969 | 1927 | 2047 | 1949 | 1955 |

**1d100, d10 unità** (20000 dadi, atteso 2000 per faccia)

| 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1986 | 1985 | 1971 | 2004 | 2022 | 1988 | 2018 | 2010 | 2006 | 2010 |

**1d100, d100 intero** (20000 tiri, atteso 200 per valore; righe da 1-10 a 91-100)

| da | +0 | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 181 | 227 | 199 | 206 | 189 | 221 | 205 | 198 | 198 | 192 |
| 11 | 194 | 211 | 222 | 198 | 217 | 191 | 187 | 215 | 199 | 210 |
| 21 | 207 | 210 | 195 | 193 | 210 | 215 | 188 | 182 | 221 | 204 |
| 31 | 213 | 174 | 206 | 219 | 221 | 214 | 183 | 224 | 210 | 194 |
| 41 | 205 | 192 | 201 | 212 | 195 | 214 | 197 | 209 | 203 | 202 |
| 51 | 207 | 187 | 187 | 186 | 183 | 178 | 231 | 196 | 212 | 188 |
| 61 | 189 | 183 | 194 | 220 | 186 | 216 | 192 | 181 | 178 | 217 |
| 71 | 199 | 214 | 209 | 188 | 199 | 199 | 214 | 202 | 206 | 188 |
| 81 | 200 | 174 | 208 | 224 | 193 | 176 | 207 | 204 | 175 | 209 |
| 91 | 190 | 199 | 183 | 176 | 195 | 194 | 206 | 195 | 208 | 182 |

**tavolo pieno, d10 decine** (3975 dadi, atteso 398 per faccia)

| 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 399 | 358 | 401 | 429 | 406 | 370 | 419 | 409 | 360 | 424 |

**tavolo pieno, d10 unità** (3975 dadi, atteso 398 per faccia)

| 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 388 | 396 | 401 | 413 | 411 | 383 | 393 | 403 | 419 | 368 |

**tavolo pieno, d100 intero** (3975 tiri, atteso 40 per valore; righe da 1-10 a 91-100)

| da | +0 | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 36 | 41 | 34 | 45 | 45 | 40 | 41 | 45 | 36 | 45 |
| 11 | 40 | 35 | 34 | 37 | 36 | 23 | 40 | 38 | 30 | 32 |
| 21 | 43 | 34 | 47 | 52 | 32 | 44 | 38 | 43 | 36 | 53 |
| 31 | 39 | 56 | 55 | 39 | 37 | 42 | 36 | 41 | 31 | 36 |
| 41 | 38 | 38 | 39 | 43 | 45 | 39 | 39 | 40 | 49 | 43 |
| 51 | 36 | 48 | 40 | 28 | 31 | 36 | 38 | 35 | 35 | 49 |
| 61 | 40 | 36 | 42 | 42 | 55 | 37 | 38 | 41 | 39 | 38 |
| 71 | 52 | 35 | 40 | 41 | 38 | 52 | 34 | 43 | 36 | 30 |
| 81 | 31 | 39 | 37 | 32 | 31 | 37 | 51 | 37 | 35 | 26 |
| 91 | 41 | 39 | 45 | 52 | 33 | 43 | 48 | 56 | 41 | 36 |

**tavolo pieno, d20** (3975 dadi, atteso 199 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 198 | 182 | 198 | 207 | 211 | 193 | 190 | 187 | 189 | 183 | 208 | 208 | 221 | 213 | 179 | 216 | 183 | 212 | 189 | 208 |

**tavolo pieno, d6** (7950 dadi, atteso 1325 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 |
|---:|---:|---:|---:|---:|---:|
| 1321 | 1353 | 1326 | 1308 | 1308 | 1334 |

**tavolo pieno, d8** (3975 dadi, atteso 497 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 521 | 511 | 494 | 484 | 525 | 455 | 478 | 507 |

