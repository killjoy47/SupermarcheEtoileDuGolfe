# Supermarche Etoile du Golfe

Application de gestion magasin (catalogue, caisse, stock, rapports) avec lancement local Windows.

## Lancement rapide (Windows)

1. Double-cliquer sur `start-shopdesk.cmd` pour demarrer backend + interface.
2. Optionnel: executer `create-desktop-shortcut.cmd` pour creer le raccourci Bureau.
3. Le raccourci Bureau lance `launch-supermarche.vbs`.

## Structure du projet

- `backend/dist`: API Node/Express executee en production locale.
- `frontend/dist`: interface web servie par le backend.
- `runtime/node.exe`: runtime Node embarque.
- `delivery/SupermarcheEtoileDuGolfe`: copie de livraison client.

## Donnees locales

Les donnees persistantes sont stockees dans:

- `%LOCALAPPDATA%\SupermarcheEtoileDuGolfe\data.db`
- `%LOCALAPPDATA%\SupermarcheEtoileDuGolfe\jwt-secret.txt`

## Impression code-barres

Le flux d'impression directe est base sur:

- endpoint API: `/api/articles/print-labels`
- token local: `shopdesk_token`

En cas d'UI stale/cache, les correctifs sont dans `frontend/dist/index.html` et `frontend/dist/sw.js`.

## Git

Depot initialise localement et pousse vers:

- `https://github.com/killjoy47/SupermarcheEtoileDuGolfe`

Note: `runtime/node.exe` est volumineux. Un passage futur vers Git LFS est recommande.

## Livraison client

Le guide de livraison detaille est dans `README-LIVRAISON.txt`.
