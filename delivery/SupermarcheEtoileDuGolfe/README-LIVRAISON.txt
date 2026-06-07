SUPERMARCHE ETOILE DU GOLFE - LIVRAISON CLIENT

Contenu du package
- backend/dist
- backend/node_modules
- frontend/dist
- runtime/node.exe
- start-shopdesk.cmd
- launch-supermarche.vbs
- create-desktop-shortcut.cmd
- logo.ico

Installation conseillee
1. Copier le dossier complet dans un emplacement fixe, par exemple C:\ShopDesk\SupermarcheEtoileDuGolfe
2. Lancer create-desktop-shortcut.cmd une seule fois si un raccourci Bureau est souhaite.
3. Lancer ensuite l'application via launch-supermarche.vbs ou le raccourci Bureau.

Donnees
- La base est stockee dans %LOCALAPPDATA%\SupermarcheEtoileDuGolfe\data.db
- Le secret JWT local est stocke dans %LOCALAPPDATA%\SupermarcheEtoileDuGolfe\jwt-secret.txt

Conseils de diffusion
- Ne pas livrer le dossier de travail complet si ce n'est pas necessaire.
- Ne pas laisser VS Code, scripts de debug, notes ou fichiers de test sur la machine client.
- Si possible, installer le dossier livre dans un emplacement avec droits limites pour l'utilisateur final.