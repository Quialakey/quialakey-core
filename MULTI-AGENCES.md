# Quialakey multi-agences

## Organisation

- `Quialakey/quialakey-core` contient le code commun.
- Chaque agence possede un depot GitHub de deploiement et un projet Supabase independant.
- Le depot d'agence contient `agency.json` et `.github/workflows/deploy-agency.yml`.
- Une publication de `quialakey-core` envoie l'evenement `quialakey_release` aux depots listes.

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

Une modification poussee sur `master` declenche alors le deploiement de chaque agence. Les fichiers `agency.json` ne sont jamais remplaces et les projets Supabase restent independants.

Dans le dossier Codex principal, le remote `origin` pointe vers `Quialakey/quialakey-core`. Le remote `agency` conserve un acces direct au depot `Quialakey/century21lesminimes` pour les rares modifications propres a cette agence.

## Securite

Le navigateur doit recevoir une Publishable key (`sb_publishable_...`) ou, pour un ancien projet, la cle `anon`. Ne jamais utiliser une Secret key ou une cle `service_role` dans `agency.json`.
