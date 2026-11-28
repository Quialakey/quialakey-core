# Quialakey multi-agences

## Organisation actuelle

- `Quialakey/quialakey-core` contient le code commun.
- `Quialakey/agence` publie https://quialakey.github.io/agence/ avec GitHub Actions.
- Le projet Supabase `Agence` contient deux espaces distincts : `century21lesminimes` (code `3101`) et `quialakeycentury21` (code `0000`). Son identifiant technique reste `fbvsgvdrdblxvmzutpjk`.
- `agency.json` definit les noms et codes publics. Il ne contient aucun mot de passe.
- Supabase Auth cree des sessions anonymes ; `login_agency` verifie le mot de passe et les regles de la base limitent chaque session a son agence.

Les mots de passe sont communs aux utilisateurs d'une meme agence. Cette formule ne permet pas d'identifier individuellement la personne qui a effectue une modification. La case "Se souvenir du mot de passe" conserve une session sur l'appareil, pas le mot de passe en clair. "Se deconnecter" efface cette session.

## Publier

Le depot maitre declenche le workflow de deploiement de `Quialakey/agence` avec le secret `AGENCY_DISPATCH_TOKEN`. La variable `AGENCY_REPOSITORIES` peut encore contenir l'ancien nom `century21lesminimes` ; le workflow le redirige vers `agence`.

Le remote `origin` du dossier Codex pointe vers `Quialakey/quialakey-core` et le remote `agency` vers `Quialakey/agence`. Les donnees d'agence ne sont pas stockees dans GitHub.

## Sauvegarde et ajout d'agence

La sauvegarde de migration du 28 novembre 2026 est conservee hors Git. Le projet Supabase d'origine de Quialakey a ete supprime apres verification de la copie. Ne pas relancer la migration sur le projet commun : elle est deja terminee.

Pour une nouvelle agence, ajouter son compte et ses droits d'acces dans le projet Supabase commun, puis son code et son nom dans `agency.json` du depot `agence`. Ne pas creer un projet Supabase ou un site GitHub supplementaire sans decision explicite.
