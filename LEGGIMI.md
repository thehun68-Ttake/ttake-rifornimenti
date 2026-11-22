# TTake Aerobatic Team - Registro rifornimenti (app web)

App web installabile su iPhone e iPad, con i dati condivisi su un foglio Google.
Servono tre cose, tutte gratuite: un foglio Google, un account GitHub e circa 20 minuti.

## Cosa c'è nella cartella

| File | A cosa serve |
|---|---|
| `index.html`, `app.css`, `app.js` | L'app |
| `config.js` | Qui incolli l'indirizzo dello script Google (passo 2) |
| `manifest.webmanifest`, `sw.js`, `icons/`, `logo.png` | Installazione sulla Home con il logo TTake e uso anche senza rete |
| `apps-script/Code.gs` | Lo script che salva i dati nel foglio Google |

## Passo 1 - Foglio Google e script

1. Vai su [sheets.google.com](https://sheets.google.com) e crea un foglio vuoto. Chiamalo "TTake Rifornimenti".
2. Menu **Estensioni > Apps Script**.
3. Cancella il testo che c'è, apri `apps-script/Code.gs`, copia tutto e incollalo.
4. In alto, alla riga `var CODICE_ACCESSO = 'CAMBIA-QUESTO-CODICE';`, sostituisci il testo tra virgolette con un codice scelto da te (almeno 8 caratteri, per esempio `ttake-2026-volo`). Lo daranno gli operatori nell'app.
5. Salva (icona del dischetto). Nel menu delle funzioni in alto scegli **setup** e premi **Esegui**. Google chiede le autorizzazioni: accetta (se compare "app non verificata", scegli Avanzate > Vai a ... > Consenti. È il tuo script, sul tuo foglio).
6. **Esegui il deployment > Nuovo deployment**. Come tipo scegli **App web**. Imposta:
   - Esegui come: **Io**
   - Chi ha accesso: **Chiunque**
7. Premi **Esegui il deployment** e copia l'**URL dell'app web** (finisce con `/exec`).

Nel foglio compaiono due schede: `Rifornimenti` (una riga per rifornimento) e `Elenchi`. Puoi leggerle, filtrarle o creare grafici quando vuoi. Non cambiare l'intestazione della prima riga.

## Passo 2 - Indirizzo dello script nell'app

Apri `config.js` e incolla l'URL tra le virgolette:

```js
window.TTAKE_CONFIG = {
  scriptUrl: "https://script.google.com/macros/s/XXXXXXXX/exec"
};
```

## Passo 3 - Pubblicare su GitHub Pages

1. Crea un account su [github.com](https://github.com) se non ce l'hai.
2. **New repository**: nome `ttake-rifornimenti`, visibilità **Public**, poi **Create repository**.
3. Nella pagina del repository scegli **uploading an existing file** e trascina dentro **tutto il contenuto** della cartella (compresa la cartella `icons` e `apps-script`). Premi **Commit changes**.
4. **Settings > Pages**. In "Build and deployment" scegli **Deploy from a branch**, ramo `main`, cartella `/ (root)` e **Save**.
5. Dopo un minuto circa in alto compare l'indirizzo, del tipo `https://TUONOME.github.io/ttake-rifornimenti/`.

## Passo 4 - Installare su iPhone e iPad

1. Apri l'indirizzo in **Safari**.
2. Tocca **Condividi** e poi **Aggiungi alla schermata Home**. L'icona è il logo TTake.
3. Apri l'app dalla Home, vai nella scheda **Elenchi**, sezione **Collegamento**, scrivi il **codice di accesso** e premi **Salva e verifica**. L'indirizzo dello script è già inserito grazie a `config.js`.

Ogni operatore fa questo passo una volta sola. In alto compare "Sincronizzato" quando tutto funziona.

## Come funziona

- Ogni rifornimento viene salvato subito sul dispositivo e inviato al foglio. Se manca la rete, resta in coda e parte da solo appena torna la connessione (in alto: "Offline: 2 da inviare").
- L'app si aggiorna con i dati degli altri ogni 30 secondi e quando la riapri.
- Se due persone modificano lo stesso rifornimento nello stesso momento, vale l'ultimo salvataggio.
- Per cambiare il codice di accesso: modificalo in `Code.gs`, poi **Gestisci deployment > modifica > Nuova versione > Esegui il deployment**, e comunica il nuovo codice agli operatori.
- Se modifichi `Code.gs` per altri motivi, serve sempre una **Nuova versione** del deployment, altrimenti l'app continua a usare quella vecchia.

## Sicurezza, in breve

L'indirizzo dello script è nel repository pubblico, ma senza il codice di accesso nessuno può leggere o scrivere i dati. Il codice è nello script (visibile solo a chi modifica il foglio) e sui dispositivi degli operatori. Per un maggiore controllo puoi rendere il repository privato (serve un piano GitHub a pagamento per Pages privato) oppure togliere l'indirizzo da `config.js` e farlo incollare agli operatori nella scheda Collegamento.

## Aggiornare l'app in futuro

Sostituisci i file nel repository GitHub. Gli operatori vedono la nuova versione alla riapertura dell'app (se non succede, chiudila del tutto e riaprila).
