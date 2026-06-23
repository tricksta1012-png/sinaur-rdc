"""
Référentiel des maladies surveillées par SINAUR-RDC.

Source unique de vérité pour :
  - MALADIES_SUIVIES : 7 maladies avec types, priorités, fréquences de mise à jour
  - NOMS_CONNUS : set de tous les noms/synonymes (utilisé par le DétecteurEmergence)
"""
from __future__ import annotations

MALADIES_SUIVIES: dict[str, dict] = {
    'EBOLA': {
        'noms': ['Ebola', 'maladie à virus Ebola', 'MVE', 'Bundibugyo', 'EVD',
                 'fièvre hémorragique Ebola', 'ebola virus disease'],
        'type': 'FLAMBEE',
        'priorite': 'CRITIQUE',
        'frequence_maj_heures': 6,
        'sources_prioritaires': ['oms_don', 'reliefweb', 'hdx'],
    },
    'CHOLERA': {
        'noms': ['choléra', 'cholera', 'vibrio cholerae', 'diarrhée aqueuse',
                 'acute watery diarrhoea', 'AWD'],
        'type': 'FLAMBEE',
        'priorite': 'ELEVEE',
        'frequence_maj_heures': 24,
        'sources_prioritaires': ['oms_don', 'reliefweb', 'hdx'],
    },
    'MPOX': {
        'noms': ['mpox', 'variole du singe', 'monkeypox', 'clade I', 'clade Ib',
                 'clade II', 'clade IIb'],
        'type': 'FLAMBEE',
        'priorite': 'ELEVEE',
        'frequence_maj_heures': 24,
        'sources_prioritaires': ['oms_don', 'africa_cdc', 'reliefweb'],
    },
    'ROUGEOLE': {
        'noms': ['rougeole', 'measles', 'rubeola'],
        'type': 'EPIDEMIQUE_RECURRENT',
        'priorite': 'MOYENNE',
        'frequence_maj_heures': 72,
        'sources_prioritaires': ['oms', 'reliefweb', 'hdx'],
    },
    'MENINGITE': {
        'noms': ['méningite', 'meningitis', 'neisseria meningitidis', 'meningococcal',
                 'bacterial meningitis'],
        'type': 'EPIDEMIQUE_SAISONNIER',
        'priorite': 'MOYENNE',
        'frequence_maj_heures': 72,
        'sources_prioritaires': ['oms', 'africa_cdc'],
    },
    'PALUDISME': {
        'noms': ['paludisme', 'malaria', 'plasmodium', 'anopheles', 'palu',
                 'falciparum', 'plasmodium falciparum'],
        'type': 'ENDEMIQUE',
        'priorite': 'CONTEXTE',
        'frequence_maj_heures': 720,   # mensuel — tendances lentes
        'sources_prioritaires': ['oms', 'hdx'],
    },
    'FIEVRE_JAUNE': {
        'noms': ['fièvre jaune', 'yellow fever', 'fievre jaune', 'YF'],
        'type': 'FLAMBEE',
        'priorite': 'ELEVEE',
        'frequence_maj_heures': 48,
        'sources_prioritaires': ['oms_don', 'africa_cdc'],
    },
}

# Set de tous les noms/synonymes connus — utilisé par DetecteurEmergence
# pour filtrer les maladies déjà répertoriées avant de signaler une émergence.
NOMS_CONNUS: set[str] = set()
for _config in MALADIES_SUIVIES.values():
    NOMS_CONNUS.update(n.lower() for n in _config['noms'])
