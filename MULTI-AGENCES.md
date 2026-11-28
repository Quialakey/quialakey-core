# Quialakey multi-agences

## Organisation

- `Quialakey/quialakey-core` contient le code commun.
- Chaque agence possede un depot GitHub de deploiement. Les agences deja en ligne
  utilisent encore des projets Supabase independants.
- Le depot d'agence contient `agency.json` et `.github/workflows/deploy-agency.yml`.
- Une publication de `quialakey-core` envoie l'evenement `quialakey_release` aux depots listes.
- Les deux agences actives sont `century21lesminimes` (code agence `3101`) et
  `quialakeycentury21` (code agence `0000`). Les Trois Rivieres ne font plus
  partie des publications ni de la migration partagee.

## Creer une agence

1. Creer un projet Supabase vide.
2. Executer uniquement `quialakey-supabase-complet.sql` dans son SQL Editor. Ce fichier unique installe aussi les protections des fiches.
3. Copier le Project URL et uniquement la Publishable key.
4. Creer un depot GitHub public vide sous le compte `Quialakey`.
5. Copier `deployment-template/agency.json` vers `agency.json` dans ce depot et renseigner les quatre valeurs.
6. Copier `deployment-template/deploy.yml` vers `.github/workflows/deploy-agency.yml`.
7. Dans GitHub, regler `Settings > Pages > Source` sur `GitHub Actions`.
8. Lancer une premiere fois le workflow `Deploy Quialakey agency`.
9. Dans le jeton GitHub `quialakey-core-agency-dispatch`, ajouter le nouveau depot a la liste des depots autorises.
10. Ajouter le nom du depot a la variable `AGENCY_REPOSITORIES` de `quialakey-core`.

## Diffuser le code commun

Le depot maitre utilise `.github/workflows/distribute-agencies.yml`. Il attend :

- une variable GitHub `AGENCY_REPOSITORIES` contenant les noms des depots separes par des virgules ;
- un secret GitHub `AGENCY_DISPATCH_TOKEN` autorise a envoyer un `repository_dispatch` a ces depots.

Une modification poussee sur `master` declenche alors le deploiement de chaque agence. Les fichiers `agency.json` ne sont jamais remplaces.
Le workflow n'envoie maintenant une publication qu'aux deux depots actifs ;
une nouvelle agence devra etre ajoutee a cette liste avant son premier envoi.

Dans le dossier Codex principal, le remote `origin` pointe vers `Quialakey/quialakey-core`. Le remote `agency` conserve un acces direct au depot `Quialakey/century21lesminimes` pour les rares modifications propres a cette agence.

## Securite

Le navigateur doit recevoir une Publishable key (`sb_publishable_...`) ou, pour un ancien projet, la cle `anon`. Ne jamais utiliser une Secret key ou une cle `service_role` dans `agency.json`.

## Passage prepare vers un site et un projet Supabase communs

Ce mode n'est pas actif tant que `sharedProjectMode` n'est pas `true` dans le
`agency.json` du site Century 21 Les Minimes. La destination est uniquement
`https://quialakey.github.io/century21lesminimes/` : le code `3101` ouvre
l'espace Century 21 Les Minimes, le code `0000` ouvre l'espace Quialakey.
Chaque connexion utilise une session anonyme Supabase Auth, puis une fonction
SQL verifie le code agence et le mot de passe. Aucun e-mail n'est requis.
Le mot de passe est commun aux employes d'une agence ; cette formule ne permet
pas d'attribuer une modification a un employe precis.

1. Conserver le projet Supabase de Century 21 Les Minimes. Sauvegarder les deux
   projets et verifier les sauvegardes avant toute conversion. Suspendre les
   modifications sur les tableaux pendant la bascule.
2. Dans le projet des Minimes seulement, executer
   `quialakey-supabase-partage.sql`. Ne plus executer
   `quialakey-supabase-complet.sql` dans ce projet.
3. Activer les connexions anonymes dans Supabase Auth et leur protection anti-abus.
   Dans SQL Editor, initialiser les deux lignes `public.agency_accounts` avec
   les codes agence et des hachages bcrypt des mots de passe a six chiffres.
   Ne mettre aucun mot de passe ni `service_role` dans GitHub ou dans le navigateur.
4. Pour le projet Quialakey, exporter toutes les lignes `app_state` avec
   `scripts/migrate-agency-data.mjs export C:\\chemin-hors-git\\agence.json`,
   en definissant `QUIALAKEY_AGENCY_ID`, `QUIALAKEY_SOURCE_URL` et
   `QUIALAKEY_SOURCE_PUBLISHABLE_KEY`. La sauvegarde contient des donnees
   confidentielles et doit rester hors du depot Git.
5. Controler puis importer chaque fichier avec
   `scripts/migrate-agency-data.mjs import C:\\chemin-hors-git\\agence.json`,
   en definissant `QUIALAKEY_TARGET_URL`, `QUIALAKEY_TARGET_PUBLISHABLE_KEY`,
   `QUIALAKEY_TARGET_AGENCY_CODE` et `QUIALAKEY_TARGET_PASSWORD` uniquement
   dans la session du terminal. Aucun mot de passe ne va dans Git.
   Le premier passage verifie la destination sans ecrire ; ajouter `--apply`
   pour importer. Le script compare ensuite toutes les lignes et leurs valeurs,
   puis marque l'agence comme prete. Sans ce marqueur, le tableau ne charge pas.
6. Dans le depot `century21lesminimes` seulement, conserver l'URL et la
   Publishable key du projet Minimes, mettre `sharedProjectMode: true`,
   `migrateLegacyStorage: false` et `agencyLogins` avec les deux codes. Chaque
   entree de `agencyLogins` contient `agencyId` et `agencyName`.
   Les valeurs `agencyId` sont `century21lesminimes` et `quialakeycentury21`.
   Aucun mot de passe ne doit figurer dans ce fichier.
7. Tester pour chaque code sur le meme site la connexion, la deconnexion, les deux registres, les photos,
   les historiques, les sauvegardes et la synchronisation entre deux appareils.
   Verifier aussi qu'un compte ne lit ni ne modifie l'autre agence. Ne fermer
   l'ancien projet et l'ancien site Quialakey qu'apres verification complete et sauvegarde.

Les utilisateurs connectes peuvent modifier le mot de passe commun dans les
reglages. Toutes les sessions de l'agence sont alors invalidees. Apres une
deconnexion, une nouvelle ouverture demande toujours code agence et mot de passe.

La conversion retire les droits `anon` sur `app_state`. Le simple code d'acces
historique dans les reglages n'est plus utilise en mode partage ; il est masque
dans l'interface. Le mot de passe du compte d'agence se gere dans Supabase Auth.
