# Equità dei dadi

Misurata il 2026-11-17 con `strumenti/equita.ts`: lanci simulati con la stessa fisica del tavolo (Rapier, `src/physics`), la stessa fonte del caso (`crypto.getRandomValues`) e la stessa lettura delle facce. 4 thread, 324 secondi.

Parametri: gravità 981 cm/s², passo 1/120 s, vassoio 30×30 cm con la torre sul lato di fondo (4 scivoli), tolleranza dello storto 6°.

Come si legge: per ogni dado si contano le facce uscite e si confrontano con la distribuzione uniforme col chi quadro. Il valore p è la probabilità di vedere uno scarto almeno così grande con un dado perfettamente equo. Su una ventina di prove qualche p sotto 0,05 capita per caso (una su venti). Per questo ogni prova con un p sotto 0,01 si rifà da sola, da capo, su 5 volte i lanci: un bias vero torna, più netto; uno scarto del caso sparisce. «Scarto massimo» è la faccia più lontana dall’atteso, in percentuale dell’atteso.

Perché l’equità è esatta prima ancora di contare: a ogni lancio i numeri si legano al solido della fisica con una sua rotazione di simmetria tirata a sorte (12 per il d4, 24 per d6 e d8, 10 per il d10, 60 per d12 e d20), e quelle rotazioni portano ogni faccia su ogni altra lo stesso numero di volte. Qualunque faccia il motore favorisca, porta un numero a caso: ogni numero esce con la stessa probabilità, comunque si comporti la fisica. In più l’orientamento di partenza è uniforme su tutte le rotazioni, e posizione, velocità e rotazione non dipendono da come il dado è girato. Le prove controllano che il codice faccia davvero questo.

Un bias trovato e tolto: nella prima misura, il 14 novembre 2026, il d12 è uscito con p sotto 0,001 in due prove separate, con le stesse facce sbilanciate (1 e 8 sopra l’atteso, 5 e 7 sotto, fino al 6%). La causa: Rapier costruisce il contatto di una faccia con al più quattro vertici, e sui pentagoni del d12 ne restava fuori uno, sempre lo stesso per faccia; il dado si ribaltava più facilmente da quel lato. Contro un fondo a scatola, poi, un punto in più ne faceva scartare uno anche su tre facce del d10. Adesso il d12 è un cubo con un tetto su ogni faccia (la costruzione di Euclide), fondo e sponde sono piani, e `test/fisica.test.ts` controlla che ogni faccia di ogni dado appoggi su tutti i suoi vertici.

Un secondo scarto, più piccolo, trovato il 17 novembre 2026 contando 100.000 lanci del solo d12: facce lontane dall’atteso fino al 3% nel vassoio senza torre (p 0,0004) e fino al 4,5% con la torre (p 0,0001), invisibili su 20.000 lanci. La causa è numerica: il solutore tratta pezzi e vertici del collisore in un ordine fisso, e le simmetrie del solido non valgono più alla lettera. La cura è il giro a sorte descritto sopra, che vale per ogni dado. I numeri qui sotto sono quelli dopo le due correzioni.

## Sintesi

| prova | categoria | dadi contati | χ² | gradi di libertà | p | scarto massimo | esito |
|---|---|---:|---:|---:|---:|---:|---|
| 1d4 | d4 | 20000 | 8.8 | 3 | 0.032 | 3.0% | nessun segno di bias |
| 1d6 | d6 | 20000 | 2.0 | 5 | 0.844 | 1.4% | nessun segno di bias |
| 1d8 | d8 | 20000 | 10.1 | 7 | 0.185 | 4.9% | nessun segno di bias |
| 1d10 | d10 | 20000 | 9.0 | 9 | 0.437 | 3.9% | nessun segno di bias |
| 1d12 | d12 | 20000 | 12.7 | 11 | 0.315 | 4.8% | nessun segno di bias |
| 1d20 | d20 | 20000 | 20.0 | 19 | 0.394 | 6.3% | nessun segno di bias |
| 5d4 | d4 | 20000 | 1.5 | 3 | 0.684 | 1.3% | nessun segno di bias |
| 5d6 | d6 | 20000 | 1.7 | 5 | 0.889 | 1.3% | nessun segno di bias |
| 5d8 | d8 | 20000 | 1.9 | 7 | 0.966 | 1.8% | nessun segno di bias |
| 5d10 | d10 | 20000 | 6.7 | 9 | 0.669 | 3.8% | nessun segno di bias |
| 5d12 | d12 | 20000 | 13.2 | 11 | 0.279 | 5.6% | nessun segno di bias |
| 5d20 | d20 | 20000 | 20.4 | 19 | 0.369 | 7.4% | nessun segno di bias |
| 1d100 | d10 decine | 20000 | 8.5 | 9 | 0.486 | 4.2% | nessun segno di bias |
| 1d100 | d10 unità | 20000 | 14.6 | 9 | 0.103 | 4.3% | nessun segno di bias |
| 1d100 | d100 | 20000 | 118.8 | 99 | 0.085 | 23.5% | nessun segno di bias |
| tavolo pieno | d10 decine | 4000 | 6.2 | 9 | 0.723 | 8.0% | nessun segno di bias |
| tavolo pieno | d10 unità | 4000 | 4.4 | 9 | 0.886 | 7.2% | nessun segno di bias |
| tavolo pieno | d100 | 4000 | 82.2 | 99 | 0.890 | 37.5% | nessun segno di bias |
| tavolo pieno | d20 | 4000 | 9.6 | 19 | 0.963 | 11.0% | nessun segno di bias |
| tavolo pieno | d6 | 8000 | 7.1 | 5 | 0.217 | 4.2% | nessun segno di bias |
| tavolo pieno | d8 | 4000 | 12.4 | 7 | 0.089 | 11.0% | nessun segno di bias |

## Lanci, ritiri, durata

| prova | lanci | falliti | ritiri per lancio | durata media |
|---|---:|---:|---:|---:|
| 1d4 (un d4 da solo) | 20000 | 0 | 0.000 | 1.21 s |
| 1d6 (un d6 da solo) | 20000 | 0 | 0.001 | 1.31 s |
| 1d8 (un d8 da solo) | 20000 | 0 | 0.002 | 1.27 s |
| 1d10 (un d10 da solo) | 20000 | 0 | 0.003 | 1.42 s |
| 1d12 (un d12 da solo) | 20000 | 0 | 0.011 | 1.58 s |
| 1d20 (un d20 da solo) | 20000 | 0 | 0.007 | 1.51 s |
| 5d4 (cinque d4 insieme, contati tutti) | 4000 | 0 | 0.015 | 1.36 s |
| 5d6 (cinque d6 insieme, contati tutti) | 4000 | 0 | 0.009 | 1.45 s |
| 5d8 (cinque d8 insieme, contati tutti) | 4000 | 0 | 0.021 | 1.41 s |
| 5d10 (cinque d10 insieme, contati tutti) | 4000 | 0 | 0.029 | 1.61 s |
| 5d12 (cinque d12 insieme, contati tutti) | 4000 | 0 | 0.105 | 1.88 s |
| 5d20 (cinque d20 insieme, contati tutti) | 4000 | 0 | 0.084 | 1.76 s |
| 1d100 (un d100 (decine e unità)) | 20000 | 0 | 0.008 | 1.50 s |
| tavolo pieno (10d6+5d8+5d20+5d100, trenta dadi insieme) | 800 | 0 | 1.146 | 2.75 s |

Il p più basso fra tutte le prove: 0.0319.

## I conteggi

**1d4, d4** (20000 dadi, atteso 5000 per faccia)

| 1 | 2 | 3 | 4 |
|---:|---:|---:|---:|
| 4960 | 5132 | 4852 | 5056 |

**1d6, d6** (20000 dadi, atteso 3333 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 |
|---:|---:|---:|---:|---:|---:|
| 3370 | 3320 | 3339 | 3292 | 3298 | 3381 |

**1d8, d8** (20000 dadi, atteso 2500 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2458 | 2530 | 2560 | 2514 | 2552 | 2377 | 2484 | 2525 |

**1d10, d10** (20000 dadi, atteso 2000 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2047 | 1942 | 1997 | 1975 | 2031 | 1990 | 2023 | 2078 | 1977 | 1940 |

**1d12, d12** (20000 dadi, atteso 1667 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1665 | 1714 | 1629 | 1605 | 1746 | 1651 | 1676 | 1630 | 1644 | 1700 | 1625 | 1715 |

**1d20, d20** (20000 dadi, atteso 1000 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 995 | 967 | 1037 | 988 | 942 | 968 | 983 | 961 | 1037 | 1019 | 972 | 1035 | 986 | 1011 | 1063 | 992 | 969 | 1013 | 1036 | 1026 |

**5d4, d4** (20000 dadi, atteso 5000 per faccia)

| 1 | 2 | 3 | 4 |
|---:|---:|---:|---:|
| 5053 | 4933 | 5001 | 5013 |

**5d6, d6** (20000 dadi, atteso 3333 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 |
|---:|---:|---:|---:|---:|---:|
| 3359 | 3310 | 3313 | 3290 | 3376 | 3352 |

**5d8, d8** (20000 dadi, atteso 2500 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2454 | 2517 | 2475 | 2535 | 2521 | 2498 | 2501 | 2499 |

**5d10, d10** (20000 dadi, atteso 2000 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1986 | 1997 | 1959 | 2016 | 2010 | 2035 | 2063 | 1997 | 1924 | 2013 |

**5d12, d12** (20000 dadi, atteso 1667 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1695 | 1574 | 1703 | 1685 | 1627 | 1655 | 1674 | 1626 | 1714 | 1663 | 1647 | 1737 |

**5d20, d20** (20000 dadi, atteso 1000 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1026 | 1048 | 987 | 1017 | 989 | 962 | 960 | 988 | 1017 | 1031 | 1038 | 1019 | 926 | 1017 | 972 | 979 | 1006 | 1020 | 1039 | 959 |

**1d100, d10 decine** (20000 dadi, atteso 2000 per faccia)

| 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2011 | 2083 | 2051 | 1953 | 2035 | 1985 | 1959 | 1979 | 1975 | 1969 |

**1d100, d10 unità** (20000 dadi, atteso 2000 per faccia)

| 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2038 | 2000 | 1929 | 1968 | 2023 | 2086 | 2069 | 1958 | 2013 | 1916 |

**1d100, d100 intero** (20000 tiri, atteso 200 per valore; righe da 1-10 a 91-100)

| da | +0 | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 210 | 212 | 195 | 193 | 216 | 209 | 198 | 187 | 189 | 228 |
| 11 | 194 | 220 | 208 | 218 | 190 | 208 | 194 | 227 | 196 | 187 |
| 21 | 217 | 200 | 231 | 199 | 189 | 204 | 220 | 194 | 210 | 212 |
| 31 | 169 | 173 | 194 | 194 | 226 | 209 | 178 | 217 | 181 | 212 |
| 41 | 198 | 196 | 216 | 194 | 226 | 220 | 181 | 221 | 171 | 202 |
| 51 | 206 | 180 | 178 | 206 | 219 | 214 | 211 | 193 | 176 | 176 |
| 61 | 204 | 206 | 183 | 192 | 213 | 216 | 184 | 176 | 209 | 218 |
| 71 | 188 | 202 | 184 | 204 | 181 | 187 | 218 | 207 | 190 | 198 |
| 81 | 216 | 153 | 196 | 196 | 210 | 211 | 194 | 203 | 198 | 203 |
| 91 | 198 | 187 | 183 | 227 | 216 | 191 | 180 | 188 | 196 | 202 |

**tavolo pieno, d10 decine** (4000 dadi, atteso 400 per faccia)

| 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 401 | 387 | 416 | 410 | 406 | 405 | 390 | 391 | 368 | 426 |

**tavolo pieno, d10 unità** (4000 dadi, atteso 400 per faccia)

| 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 429 | 395 | 381 | 412 | 397 | 385 | 403 | 408 | 398 | 392 |

**tavolo pieno, d100 intero** (4000 tiri, atteso 40 per valore; righe da 1-10 a 91-100)

| da | +0 | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 39 | 43 | 51 | 26 | 43 | 40 | 32 | 47 | 41 | 43 |
| 11 | 36 | 37 | 35 | 37 | 34 | 39 | 43 | 34 | 49 | 55 |
| 21 | 44 | 36 | 28 | 39 | 37 | 46 | 40 | 41 | 50 | 46 |
| 31 | 31 | 39 | 46 | 44 | 47 | 40 | 33 | 42 | 42 | 43 |
| 41 | 42 | 33 | 46 | 42 | 41 | 36 | 44 | 39 | 40 | 49 |
| 51 | 38 | 43 | 46 | 42 | 29 | 40 | 44 | 41 | 33 | 37 |
| 61 | 43 | 30 | 39 | 46 | 45 | 41 | 44 | 32 | 33 | 41 |
| 71 | 42 | 42 | 37 | 31 | 41 | 38 | 49 | 32 | 38 | 37 |
| 81 | 36 | 37 | 31 | 41 | 27 | 42 | 37 | 49 | 31 | 39 |
| 91 | 44 | 41 | 53 | 49 | 41 | 41 | 42 | 41 | 35 | 39 |

**tavolo pieno, d20** (4000 dadi, atteso 200 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 199 | 207 | 200 | 188 | 222 | 192 | 202 | 212 | 190 | 195 | 211 | 198 | 212 | 187 | 205 | 199 | 198 | 198 | 205 | 180 |

**tavolo pieno, d6** (8000 dadi, atteso 1333 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 |
|---:|---:|---:|---:|---:|---:|
| 1339 | 1279 | 1320 | 1297 | 1376 | 1389 |

**tavolo pieno, d8** (4000 dadi, atteso 500 per faccia)

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 529 | 497 | 555 | 472 | 462 | 494 | 495 | 496 |

