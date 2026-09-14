# Quialakey Core

Code maître partagé de l'application Quialakey. Chaque agence possède son propre dépôt de déploiement et son propre projet Supabase, tandis que les améliorations communes sont publiées depuis ce dépôt.

## Agences reliées

| Agence | Dépôt de déploiement | Tableau en ligne | Données | État |
| --- | --- | --- | --- | --- |
| Century 21 Les Minimes | [`century21lesminimes`](https://github.com/Quialakey/century21lesminimes) | [Ouvrir le tableau](https://quialakey.github.io/century21lesminimes/) | Projet Supabase indépendant | Actif |

## Organisation

```text
quialakey-core
└── century21lesminimes
```

Les changements publiés dans `quialakey-core` déclenchent automatiquement le redéploiement de chaque agence enregistrée. Les données d'une agence ne sont jamais partagées avec une autre.

Consulter [le guide multi-agences](MULTI-AGENCES.md) pour ajouter un nouveau tableau.
