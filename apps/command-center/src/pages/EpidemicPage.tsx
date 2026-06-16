import { useState, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import MapGL, { Source, Layer, type MapLayerMouseEvent, type MapRef, Popup } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { apiClient } from '../lib/api.js';

// ── MAP STYLE (same dark theme as ConflitPage) ────────────────────────────────

const MAP_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap',
    },
  },
  layers: [
    { id: 'bg',  type: 'background' as const, paint: { 'background-color': '#0d1b2a' } },
    { id: 'osm', type: 'raster'     as const, source: 'osm', paint: {
      'raster-saturation': -1, 'raster-brightness-max': 0.30,
      'raster-opacity': 0.80,  'raster-contrast': 0.05,
    }},
  ],
};

// ── STATIC ZONE DATA (INSP SitRep N°17 · 8 juin 2026) ───────────────────────

interface EpiZone {
  id: string;
  zone_sante: string;
  territoire: string;
  province: string;
  cas_confirmes: number;
  cas_suspects: number;
  deces_confirmes: number;
  deces_suspects: number;
  statut: 'ACTIF' | 'ALERTE';
  date_premier_cas: string;
  groupes_armes: Record<string, boolean>;
  acces_humanitaire: 'BON' | 'PARTIEL' | 'DIFFICILE' | 'BLOQUE';
  lng: number;
  lat: number;
}

const ZONES: EpiZone[] = [
  { id:'CD-IT-BN', zone_sante:'Bunia',     territoire:'Bunia',      province:'Ituri',     cas_confirmes:142, cas_suspects:89,  deces_confirmes:28, deces_suspects:34, statut:'ACTIF',  date_premier_cas:'2026-05-12', groupes_armes:{CODECO:true},       acces_humanitaire:'PARTIEL',   lng:30.25, lat:1.56  },
  { id:'CD-IT-RW', zone_sante:'Rwampara',  territoire:'Bunia',      province:'Ituri',     cas_confirmes:98,  cas_suspects:67,  deces_confirmes:19, deces_suspects:28, statut:'ACTIF',  date_premier_cas:'2026-05-12', groupes_armes:{},                   acces_humanitaire:'BON',       lng:30.31, lat:1.48  },
  { id:'CD-IT-MG', zone_sante:'Mongbwalu', territoire:'Djugu',      province:'Ituri',     cas_confirmes:76,  cas_suspects:54,  deces_confirmes:14, deces_suspects:22, statut:'ACTIF',  date_premier_cas:'2026-05-13', groupes_armes:{CODECO:true},       acces_humanitaire:'DIFFICILE', lng:30.02, lat:1.95  },
  { id:'CD-IT-MB', zone_sante:'Mambasa',   territoire:'Mambasa',    province:'Ituri',     cas_confirmes:34,  cas_suspects:28,  deces_confirmes:8,  deces_suspects:11, statut:'ACTIF',  date_premier_cas:'2026-05-18', groupes_armes:{ADF:true},          acces_humanitaire:'BLOQUE',    lng:29.04, lat:1.20  },
  { id:'CD-IT-KO', zone_sante:'Komanda',   territoire:'Mambasa',    province:'Ituri',     cas_confirmes:28,  cas_suspects:19,  deces_confirmes:5,  deces_suspects:9,  statut:'ACTIF',  date_premier_cas:'2026-05-20', groupes_armes:{ADF:true},          acces_humanitaire:'BLOQUE',    lng:29.74, lat:1.43  },
  { id:'CD-IT-NY', zone_sante:'Nyankunde', territoire:'Irumu',      province:'Ituri',     cas_confirmes:22,  cas_suspects:15,  deces_confirmes:4,  deces_suspects:7,  statut:'ACTIF',  date_premier_cas:'2026-05-21', groupes_armes:{},                   acces_humanitaire:'BON',       lng:30.42, lat:1.18  },
  { id:'CD-IT-LO', zone_sante:'Logo',      territoire:'Aru',        province:'Ituri',     cas_confirmes:18,  cas_suspects:12,  deces_confirmes:3,  deces_suspects:5,  statut:'ACTIF',  date_premier_cas:'2026-05-28', groupes_armes:{},                   acces_humanitaire:'BON',       lng:30.75, lat:3.60  },
  { id:'CD-IT-NI', zone_sante:'Nizi',      territoire:'Djugu',      province:'Ituri',     cas_confirmes:15,  cas_suspects:10,  deces_confirmes:3,  deces_suspects:4,  statut:'ACTIF',  date_premier_cas:'2026-05-29', groupes_armes:{CODECO:true},       acces_humanitaire:'DIFFICILE', lng:30.12, lat:2.10  },
  { id:'CD-IT-AU', zone_sante:'Aungba',    territoire:'Aru',        province:'Ituri',     cas_confirmes:12,  cas_suspects:8,   deces_confirmes:2,  deces_suspects:3,  statut:'ACTIF',  date_premier_cas:'2026-05-31', groupes_armes:{},                   acces_humanitaire:'BON',       lng:30.52, lat:3.42  },
  { id:'CD-NK-BT', zone_sante:'Butembo',   territoire:'Butembo',    province:'Nord-Kivu', cas_confirmes:32,  cas_suspects:24,  deces_confirmes:6,  deces_suspects:9,  statut:'ACTIF',  date_premier_cas:'2026-05-22', groupes_armes:{ADF:true},          acces_humanitaire:'PARTIEL',   lng:29.29, lat:0.13  },
  { id:'CD-NK-BE', zone_sante:'Beni',      territoire:'Beni',       province:'Nord-Kivu', cas_confirmes:24,  cas_suspects:18,  deces_confirmes:4,  deces_suspects:7,  statut:'ACTIF',  date_premier_cas:'2026-05-23', groupes_armes:{ADF:true},          acces_humanitaire:'DIFFICILE', lng:29.47, lat:0.50  },
  { id:'CD-NK-GO', zone_sante:'Goma',      territoire:'Nyiragongo', province:'Nord-Kivu', cas_confirmes:8,   cas_suspects:6,   deces_confirmes:1,  deces_suspects:2,  statut:'ACTIF',  date_premier_cas:'2026-05-26', groupes_armes:{M23_AFC:true},      acces_humanitaire:'PARTIEL',   lng:29.23, lat:-1.68 },
  { id:'CD-NK-OI', zone_sante:'Oicha',     territoire:'Beni',       province:'Nord-Kivu', cas_confirmes:14,  cas_suspects:10,  deces_confirmes:3,  deces_suspects:4,  statut:'ACTIF',  date_premier_cas:'2026-05-25', groupes_armes:{ADF:true},          acces_humanitaire:'BLOQUE',    lng:29.52, lat:0.71  },
  { id:'CD-SK-UV', zone_sante:'Uvira',     territoire:'Uvira',      province:'Sud-Kivu',  cas_confirmes:3,   cas_suspects:4,   deces_confirmes:0,  deces_suspects:1,  statut:'ALERTE', date_premier_cas:'2026-06-02', groupes_armes:{Twirwaneho:true},   acces_humanitaire:'DIFFICILE', lng:29.13, lat:-3.39 },
];

const TIMESERIES = [
  { date:'15 mai',  cas:8   },
  { date:'17 mai',  cas:10  },
  { date:'20 mai',  cas:51  },
  { date:'23 mai',  cas:80  },
  { date:'27 mai',  cas:140 },
  { date:'31 mai',  cas:282 },
  { date:'8 juin',  cas:515 },
];

function buildGeojson(zones: EpiZone[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones.map(z => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [z.lng, z.lat] },
      properties: {
        id: z.id,
        zone_sante: z.zone_sante,
        territoire: z.territoire,
        province: z.province,
        cas_confirmes: z.cas_confirmes,
        cas_suspects: z.cas_suspects,
        deces_confirmes: z.deces_confirmes,
        deces_suspects: z.deces_suspects,
        statut: z.statut,
        date_premier_cas: z.date_premier_cas,
        groupes_armes: JSON.stringify(z.groupes_armes),
        has_armed_groups: Object.values(z.groupes_armes).some(Boolean),
        armed_groups_label: Object.entries(z.groupes_armes).filter(([,v])=>v).map(([k])=>k.replace('_','/')).join(', '),
        acces_humanitaire: z.acces_humanitaire,
        acces_bloque: z.acces_humanitaire === 'BLOQUE',
      },
    })),
  };
}

// ── DISEASE CARDS CONFIG ──────────────────────────────────────────────────────

interface DiseaseConf {
  id: string;
  nom: string;
  emoji: string;
  color: string;
  statut: string;
  statut_cls: string;
  zones_actives: number;
  cas_confirmes: number;
  deces: number;
  vaccin: boolean;
  traitement: boolean;
  note_vaccin: string;
  source: string;
  maj: string;
  usppi?: boolean;
}

const DISEASES: DiseaseConf[] = [
  {
    id:'EBOLA_BUNDIBUGYO', nom:'Ebola Bundibugyo', emoji:'🦠',
    color:'#7f1d1d', statut:'URGENCE INTERNATIONALE', statut_cls:'bg-red-950 text-red-300 border border-red-700',
    zones_actives:25, cas_confirmes:515, deces:91,
    vaccin:false, traitement:false,
    note_vaccin:'Aucun vaccin ni traitement approuvé pour la souche Bundibugyo',
    source:'INSP SitRep N°17', maj:'2026-06-08', usppi:true,
  },
  {
    id:'CHOLERA', nom:'Choléra', emoji:'💧',
    color:'#1e3a5f', statut:'ENDÉMIQUE', statut_cls:'bg-blue-950 text-blue-300 border border-blue-800',
    zones_actives:18, cas_confirmes:4820, deces:89,
    vaccin:true, traitement:true,
    note_vaccin:'Vaccin oral choléra (VOC) disponible — OCV Shanchol',
    source:'INSP/OMS', maj:'2026-06-01',
  },
  {
    id:'MPOX', nom:'Mpox (variole du singe)', emoji:'⚕️',
    color:'#3f1d6b', statut:'ALERTE', statut_cls:'bg-purple-950 text-purple-300 border border-purple-800',
    zones_actives:8, cas_confirmes:1240, deces:23,
    vaccin:true, traitement:true,
    note_vaccin:'Vaccin MVA-BN (Jynneos) disponible en quantité limitée',
    source:'INSP/OMS', maj:'2026-06-01',
  },
  {
    id:'ROUGEOLE', nom:'Rougeole', emoji:'🔴',
    color:'#7c2d12', statut:'ENDÉMIQUE', statut_cls:'bg-orange-950 text-orange-300 border border-orange-800',
    zones_actives:34, cas_confirmes:12400, deces:234,
    vaccin:true, traitement:false,
    note_vaccin:'Vaccin ROR disponible — couverture insuffisante (68%)',
    source:'INSP/OMS', maj:'2026-06-01',
  },
  {
    id:'MENINGITE', nom:'Méningite bactérienne', emoji:'🧠',
    color:'#1c4532', statut:'SURVEILLANCE', statut_cls:'bg-green-950 text-green-300 border border-green-800',
    zones_actives:4, cas_confirmes:320, deces:48,
    vaccin:true, traitement:true,
    note_vaccin:'MenAfriVac disponible — antibiotiques efficaces si prise rapide',
    source:'INSP/OMS', maj:'2026-06-01',
  },
  {
    id:'PALUDISME', nom:'Paludisme', emoji:'🦟',
    color:'#064e3b', statut:'ENDÉMIQUE', statut_cls:'bg-emerald-950 text-emerald-300 border border-emerald-800',
    zones_actives:145, cas_confirmes:890000, deces:12400,
    vaccin:true, traitement:true,
    note_vaccin:'Vaccin RTS,S/AS01 (Mosquirix) + ACT antipaludéens disponibles',
    source:'INSP/OMS', maj:'2026-06-01',
  },
];

// ── PROTOCOL DATA (Ebola Bundibugyo) ─────────────────────────────────────────

const PROTOCOL_STEPS = [
  { num:1, titre:'NE PAS APPROCHER',          urgence:'CRITIQUE', desc:'Maintenir une distance de sécurité. NE PAS toucher le patient ni ses affaires sans EPI complet.' },
  { num:2, titre:'Alerter immédiatement',      urgence:'CRITIQUE', desc:'Appeler le numéro d\'alerte épidémie : 0800-SANTE. Donner : lieu exact, nombre de cas suspects, symptômes observés.' },
  { num:3, titre:'Isolement de la personne',   urgence:'ÉLEVÉE',   desc:'Guider la personne vers une pièce séparée et aérée. Éviter tout contact avec d\'autres personnes. Ne pas la laisser se déplacer seule.' },
  { num:4, titre:'Protection personnelle',     urgence:'CRITIQUE', desc:'Gants + masque FFP2 + protection oculaire MINIMUM. Si EPI complet disponible : le porter intégralement avant tout contact.' },
  { num:5, titre:'Lister les contacts',        urgence:'ÉLEVÉE',   desc:'Identifier toutes les personnes ayant eu un contact avec le cas suspect dans les 21 derniers jours. NE PAS les laisser partir sans signalement.' },
  { num:6, titre:'Sécuriser les décès',        urgence:'CRITIQUE', desc:'UN MORT D\'EBOLA EST EXTRÊMEMENT CONTAGIEUX. Interdire les rites funéraires traditionnels. Contacter l\'équipe de gestion sécurisée des corps.' },
  { num:7, titre:'Décontamination',            urgence:'ÉLEVÉE',   desc:'Désinfecter tout ce qui a été en contact avec le patient (eau de Javel 0,5 % pour les surfaces, 0,1 % pour la peau intacte).' },
];

const TRAITEMENTS = [
  'Réhydratation intensive par voie orale ou intraveineuse',
  'Antipyrétiques (paracétamol — PAS d\'aspirine ni ibuprofène : risque hémorragique)',
  'Antiémétiques contre les vomissements',
  'Antidiarrhéiques',
  'Maintien de l\'équilibre électrolytique',
  'Soins de support en Centre de Traitement Ebola (CTE)',
  'Transfusion sanguine si hémorragie sévère',
  'Traitements en cours d\'essai clinique : plasma de convalescents, mAbs',
];

const MESSAGES = [
  { lang:'FR', text:'Si vous avez de la fièvre et avez été en contact avec un malade, appelez le 0800-SANTE maintenant.' },
  { lang:'LN', text:'Soki ozali na fiɛvrɛ mpe okolanganaki na moto ya maladi, benga 0800-SANTE sikoyo.' },
  { lang:'SW', text:'Ukiwa na homa na umekuwa karibu na mgonjwa, piga simu 0800-SANTE sasa hivi.' },
];

const CENTRES = [
  { nom:'CTE CME Bunia',    province:'Ituri',     statut:'OPÉRATIONNEL', capacite:40 },
  { nom:'CTE Rwampara',     province:'Ituri',     statut:'OPÉRATIONNEL', capacite:20 },
  { nom:'CTE Butembo (MSF)',province:'Nord-Kivu', statut:'EN COURS',     capacite:30 },
  { nom:'CTE Beni',         province:'Nord-Kivu', statut:'PLANIFIÉ',     capacite:25 },
];

// ── ACCESS BADGE ──────────────────────────────────────────────────────────────

const ACCESS_STYLE: Record<string, { cls: string; label: string }> = {
  BON:       { cls: 'bg-green-900/60 text-green-300 border-green-700', label: 'BON' },
  PARTIEL:   { cls: 'bg-yellow-900/60 text-yellow-300 border-yellow-700', label: 'PARTIEL' },
  DIFFICILE: { cls: 'bg-orange-900/60 text-orange-300 border-orange-700', label: 'DIFFICILE' },
  BLOQUE:    { cls: 'bg-red-900/60 text-red-300 border-red-700', label: 'BLOQUÉ' },
};

// ── ZONE POPUP ────────────────────────────────────────────────────────────────

function ZonePopupContent({ zone, onClose, onProtocol }: {
  zone: EpiZone; onClose: () => void; onProtocol: () => void;
}) {
  const access = ACCESS_STYLE[zone.acces_humanitaire] ?? ACCESS_STYLE.PARTIEL;
  const groups = Object.entries(zone.groupes_armes).filter(([,v])=>v).map(([k])=>k.replace('_','/'));
  const letalite = zone.cas_confirmes > 0
    ? ((zone.deces_confirmes / zone.cas_confirmes) * 100).toFixed(1)
    : '0';

  return (
    <div className="bg-cc-900 border border-cc-600 rounded-xl shadow-xl p-0 w-72 text-sm overflow-hidden">
      {/* Header */}
      <div className="bg-red-950/80 border-b border-red-900 px-3 py-2.5 flex items-start gap-2">
        <span className="text-xl mt-0.5">🦠</span>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-white text-sm leading-tight">Ebola Bundibugyo</div>
          <div className="text-red-300 text-[10px] font-mono truncate">
            {zone.zone_sante} · {zone.territoire} · {zone.province}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-[9px] font-bold px-1.5 py-px rounded border ${
            zone.statut === 'ALERTE' ? 'bg-yellow-900 text-yellow-200 border-yellow-700' : 'bg-red-900 text-red-200 border-red-700'
          }`}>{zone.statut}</span>
          <button onClick={onClose} className="text-cc-600 hover:text-white text-[10px]">✕</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 divide-x divide-cc-700 border-b border-cc-700">
        <div className="px-2.5 py-2 text-center">
          <div className="text-lg font-bold text-red-300">{zone.cas_confirmes}</div>
          <div className="text-[9px] text-cc-500 font-mono uppercase">Confirmés</div>
        </div>
        <div className="px-2.5 py-2 text-center">
          <div className="text-lg font-bold text-orange-300">{zone.cas_suspects}</div>
          <div className="text-[9px] text-cc-500 font-mono uppercase">Suspects</div>
        </div>
        <div className="px-2.5 py-2 text-center">
          <div className="text-lg font-bold text-gray-200">{zone.deces_confirmes}</div>
          <div className="text-[9px] text-cc-500 font-mono uppercase">Décès</div>
          <div className="text-[8px] text-red-400">létalité {letalite}%</div>
        </div>
      </div>

      <div className="px-3 py-2 space-y-2">
        {/* Note sous-estimation */}
        <div className="text-[9px] text-yellow-400 bg-yellow-950/40 border border-yellow-900 rounded px-2 py-1 leading-relaxed">
          ⚠ L'OMS note une transmission non détectée probable. Chiffres suspects potentiellement sous-estimés.
        </div>

        {/* Accès humanitaire */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-cc-500 font-mono uppercase w-24 shrink-0">Accès humanit.</span>
          <span className={`text-[9px] font-bold px-1.5 py-px rounded border ${access.cls}`}>{access.label}</span>
        </div>

        {/* Groupes armés */}
        {groups.length > 0 && (
          <div>
            <div className="text-[9px] text-cc-500 font-mono uppercase mb-1">⚔ Groupes armés actifs</div>
            <div className="flex flex-wrap gap-1">
              {groups.map(g => (
                <span key={g} className="text-[9px] bg-red-950 text-red-300 border border-red-800 px-1.5 py-px rounded font-mono">{g}</span>
              ))}
            </div>
            {zone.acces_humanitaire === 'BLOQUE' && (
              <div className="text-[9px] text-red-400 mt-1 italic">
                Zone contrôlée — accès équipes de riposte impossible
              </div>
            )}
          </div>
        )}

        {/* Premier cas */}
        <div className="flex items-center gap-2 text-[9px]">
          <span className="text-cc-500 font-mono uppercase w-24 shrink-0">Premier cas</span>
          <span className="text-gray-300">{new Date(zone.date_premier_cas).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}</span>
        </div>

        {/* Source */}
        <div className="flex items-center gap-2 text-[9px]">
          <span className="text-cc-500 font-mono uppercase w-24 shrink-0">Source</span>
          <span className="text-gray-500">INSP SitRep N°17 · OMS</span>
        </div>
      </div>

      {/* Protocol CTA */}
      <div className="px-3 pb-3">
        <button
          onClick={onProtocol}
          className="w-full text-[10px] bg-red-900/50 hover:bg-red-900/80 border border-red-800 text-red-200 rounded-lg py-1.5 font-mono transition-colors"
        >
          📋 Protocole de prise en charge →
        </button>
      </div>
    </div>
  );
}

// ── PROTOCOL MODAL ────────────────────────────────────────────────────────────

type ProtocolTab = 'conduite' | 'traitement' | 'messages' | 'centres';

function ProtocolModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<ProtocolTab>('conduite');

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-cc-900 border border-cc-600 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-red-950/80 border-b border-red-900 px-4 py-3 flex items-center gap-3 rounded-t-xl">
          <span className="text-2xl">🦠</span>
          <div className="flex-1">
            <div className="text-white font-bold text-sm">Protocole — Maladie à Virus Ebola · Souche Bundibugyo</div>
            <div className="text-[10px] font-bold text-red-300 bg-red-950/60 border border-red-800 rounded px-2 py-0.5 mt-1 inline-block">
              🚨 AUCUN vaccin ni traitement approuvé — Traitement symptomatique uniquement
            </div>
          </div>
          <button onClick={onClose} className="text-cc-600 hover:text-white text-lg ml-2">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-cc-700 px-4 gap-0 shrink-0">
          {([
            { key:'conduite',   label:'🚨 Conduite à tenir' },
            { key:'traitement', label:'💊 Traitement'        },
            { key:'messages',   label:'🗣 Messages comm.'    },
            { key:'centres',    label:'🏥 Centres CTE'       },
          ] as {key:ProtocolTab; label:string}[]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.key
                  ? 'border-red-500 text-red-300'
                  : 'border-transparent text-cc-500 hover:text-gray-300'
              }`}
            >{t.label}</button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">

          {tab === 'conduite' && PROTOCOL_STEPS.map(s => (
            <div
              key={s.num}
              className={`flex gap-3 rounded-lg p-3 border ${
                s.urgence === 'CRITIQUE'
                  ? 'bg-red-950/40 border-red-800'
                  : 'bg-cc-800 border-cc-700'
              }`}
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                s.urgence === 'CRITIQUE' ? 'bg-red-700 text-white' : 'bg-cc-700 text-gray-300'
              }`}>{s.num}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-bold text-white">{s.titre}</span>
                  {s.urgence === 'CRITIQUE' && (
                    <span className="text-[9px] bg-red-800 text-red-200 px-1.5 py-px rounded font-bold">CRITIQUE</span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}

          {tab === 'traitement' && (
            <div className="space-y-1.5">
              <div className="text-[10px] text-yellow-400 bg-yellow-950/30 border border-yellow-900 rounded p-2 mb-3">
                ⚠ Aucun antiviral approuvé pour Bundibugyo. Traitement strictement symptomatique.
              </div>
              {TRAITEMENTS.map((t,i) => (
                <div key={i} className="flex items-start gap-2.5 bg-cc-800 rounded-lg px-3 py-2.5 text-[11px] text-gray-300">
                  <span className="text-red-400 shrink-0 mt-0.5">•</span>
                  <span>{t}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'messages' && (
            <div className="space-y-3">
              <div className="text-[10px] text-cc-500 font-mono mb-2">
                Messages à diffuser immédiatement par radio communautaire, crieur public et réseaux locaux.
              </div>
              {MESSAGES.map(m => (
                <div key={m.lang} className="bg-cc-800 border border-cc-700 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold font-mono text-white bg-cc-700 px-2 py-0.5 rounded">{m.lang}</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(m.text)}
                      className="text-[9px] text-cc-500 hover:text-gray-300 font-mono"
                    >Copier</button>
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed">{m.text}</p>
                </div>
              ))}
              <div className="text-[9px] text-cc-600 font-mono">Numéro d'urgence : 0800-SANTE (gratuit)</div>
            </div>
          )}

          {tab === 'centres' && (
            <div className="space-y-2">
              <div className="text-[10px] text-cc-500 font-mono mb-2">
                Centres de Traitement Ebola (CTE) opérationnels ou en cours d'ouverture au 8 juin 2026.
              </div>
              {CENTRES.map(c => (
                <div key={c.nom} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${
                  c.statut === 'OPÉRATIONNEL' ? 'bg-green-950/30 border-green-800' :
                  c.statut === 'EN COURS'     ? 'bg-yellow-950/30 border-yellow-800' :
                                                'bg-cc-800 border-cc-700'
                }`}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    c.statut === 'OPÉRATIONNEL' ? 'bg-green-400' :
                    c.statut === 'EN COURS'     ? 'bg-yellow-400 animate-pulse' : 'bg-gray-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-white">{c.nom}</div>
                    <div className="text-[9px] text-cc-500 font-mono">{c.province}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] font-bold text-gray-300">{c.capacite} lits</div>
                    <div className={`text-[9px] font-mono ${
                      c.statut === 'OPÉRATIONNEL' ? 'text-green-400' :
                      c.statut === 'EN COURS'     ? 'text-yellow-400' : 'text-gray-500'
                    }`}>{c.statut}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-cc-700 text-[9px] text-cc-700 font-mono rounded-b-xl">
          Source : OMS · INSP SitRep N°17 · MSF · CDC — Mis à jour le 8 juin 2026
        </div>
      </div>
    </div>
  );
}

// ── EPIDEMIC CURVE (mini SVG) ─────────────────────────────────────────────────

function EpiCurve() {
  const maxCas = Math.max(...TIMESERIES.map(t => t.cas));
  const W = 280; const H = 80; const PAD = { t:8, b:20, l:28, r:8 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;

  const points = TIMESERIES.map((t, i) => {
    const x = PAD.l + (i / (TIMESERIES.length - 1)) * chartW;
    const y = PAD.t + chartH - (t.cas / maxCas) * chartH;
    return { x, y, ...t };
  });

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
  const area = [
    `M ${points[0].x},${PAD.t + chartH}`,
    ...points.map(p => `L ${p.x},${p.y}`),
    `L ${points[points.length-1].x},${PAD.t + chartH}`,
    'Z',
  ].join(' ');

  return (
    <div className="px-3 pb-3">
      <div className="text-[9px] font-mono text-cc-500 uppercase mb-2">Courbe épidémique — Cas confirmés cumulés</div>
      <svg width={W} height={H} className="w-full">
        {/* Area fill */}
        <path d={area} fill="rgba(220,38,38,0.15)" />
        {/* Line */}
        <polyline points={polyline} fill="none" stroke="#dc2626" strokeWidth="1.5" />
        {/* Points */}
        {points.map((p,i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3" fill="#dc2626" stroke="#0d1b2a" strokeWidth="1" />
            <text x={p.x} y={H - PAD.b + 10} textAnchor="middle" fontSize="7" fill="#6b7280">{p.date.split(' ')[0]}</text>
          </g>
        ))}
        {/* Y axis labels */}
        {[0, 250, 515].map(v => {
          const y = PAD.t + chartH - (v / maxCas) * chartH;
          return (
            <text key={v} x={PAD.l - 3} y={y + 3} textAnchor="end" fontSize="7" fill="#6b7280">{v}</text>
          );
        })}
      </svg>
      <div className="text-[9px] text-cc-600 font-mono mt-1">
        R0 estimé ≈ 1.8 · Intervalle série ≈ 7j · USPPI déclarée le 17 mai 2026
      </div>
    </div>
  );
}

// ── DISEASE CARD (compact for left panel) ─────────────────────────────────────

function DiseaseCard({ d, onProtocol }: { d: DiseaseConf; onProtocol?: () => void }) {
  return (
    <div
      className="rounded-lg border border-cc-700 overflow-hidden"
      style={{ borderLeftColor: d.color, borderLeftWidth: 3 }}
    >
      <div className="bg-cc-800 px-3 py-2.5 space-y-2">
        {/* Header */}
        <div className="flex items-start gap-2">
          <span className="text-lg shrink-0">{d.emoji}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5 flex-wrap">
              <span className="text-xs font-bold text-white leading-tight">{d.nom}</span>
              {d.usppi && <span className="text-[8px] bg-red-900 text-red-200 border border-red-700 px-1 py-px rounded font-bold shrink-0">🚨 USPPI</span>}
            </div>
            <span className={`text-[8px] font-mono px-1.5 py-px rounded border ${d.statut_cls}`}>{d.statut}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-1 text-center">
          <div>
            <div className="text-sm font-bold text-white">{d.zones_actives}</div>
            <div className="text-[8px] text-cc-500 font-mono">zones</div>
          </div>
          <div>
            <div className="text-sm font-bold text-white">{d.cas_confirmes.toLocaleString('fr-FR')}</div>
            <div className="text-[8px] text-cc-500 font-mono">cas</div>
          </div>
          <div>
            <div className="text-sm font-bold text-red-400">{d.deces.toLocaleString('fr-FR')}</div>
            <div className="text-[8px] text-cc-500 font-mono">décès</div>
          </div>
        </div>

        {/* Vaccin / Traitement */}
        <div className="flex gap-1.5 flex-wrap">
          <span className={`text-[8px] px-1.5 py-px rounded font-mono border ${d.vaccin ? 'bg-green-950 text-green-300 border-green-800' : 'bg-red-950 text-red-300 border-red-900'}`}>
            💉 Vaccin: {d.vaccin ? 'OUI' : 'AUCUN'}
          </span>
          <span className={`text-[8px] px-1.5 py-px rounded font-mono border ${d.traitement ? 'bg-green-950 text-green-300 border-green-800' : 'bg-red-950 text-red-300 border-red-900'}`}>
            💊 Trt: {d.traitement ? 'OUI' : 'AUCUN'}
          </span>
        </div>
        {d.note_vaccin && (
          <div className="text-[8px] text-cc-600 italic leading-relaxed">{d.note_vaccin}</div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-0.5">
          <span className="text-[8px] text-cc-700 font-mono">{d.source} · {d.maj}</span>
          {d.id === 'EBOLA_BUNDIBUGYO' && onProtocol && (
            <button
              onClick={onProtocol}
              className="text-[8px] text-red-400 hover:text-red-200 font-mono transition-colors"
            >Protocole →</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ZONE LIST ITEM ────────────────────────────────────────────────────────────

function ZoneItem({ z, selected, onClick }: { z: EpiZone; selected: boolean; onClick: () => void }) {
  const access = ACCESS_STYLE[z.acces_humanitaire] ?? ACCESS_STYLE.PARTIEL;
  const groups = Object.entries(z.groupes_armes).filter(([,v])=>v).map(([k])=>k.replace('_','/'));

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-cc-700/50 last:border-0 transition-colors ${
        selected ? 'bg-red-950/30' : 'hover:bg-cc-800'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
          z.cas_confirmes >= 100 ? 'bg-red-600' :
          z.cas_confirmes >= 50  ? 'bg-red-500' :
          z.cas_confirmes >= 20  ? 'bg-orange-500' : 'bg-amber-500'
        }`} />
        <span className="text-xs font-bold text-white truncate flex-1">{z.zone_sante}</span>
        <span className="text-[9px] font-bold text-red-300 shrink-0">{z.cas_confirmes} cas</span>
      </div>
      <div className="flex items-center gap-2 ml-4.5">
        <span className="text-[9px] text-cc-500 truncate">{z.territoire} · {z.province}</span>
        <span className={`text-[7px] px-1 py-px rounded border shrink-0 ${access.cls}`}>{access.label}</span>
        {groups.length > 0 && (
          <span className="text-[7px] text-red-400 shrink-0">⚔ {groups.join(', ')}</span>
        )}
      </div>
    </button>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

type LeftPanel = 'maladies' | 'zones' | 'courbe';

interface PopupState { lng: number; lat: number; zoneId: string; }

export function EpidemicPage() {
  const mapRef = useRef<MapRef>(null);
  const [popup, setPopup]               = useState<PopupState | null>(null);
  const [showProtocol, setShowProtocol] = useState(false);
  const [leftPanel, setLeftPanel]       = useState<LeftPanel>('maladies');

  const selectedZone = useMemo(
    () => popup ? ZONES.find(z => z.id === popup.zoneId) ?? null : null,
    [popup],
  );

  const geojson = useMemo(() => buildGeojson(ZONES), []);

  const onMapClick = useCallback((e: MapLayerMouseEvent) => {
    const features = e.features;
    if (!features || features.length === 0) { setPopup(null); return; }
    const f = features[0];
    if (f.layer?.id === 'epidemic-circles') {
      const id = String(f.properties?.id ?? '');
      setPopup({ lng: e.lngLat.lng, lat: e.lngLat.lat, zoneId: id });
    }
  }, []);

  const flyToZone = useCallback((z: EpiZone) => {
    mapRef.current?.getMap().flyTo({ center: [z.lng, z.lat], zoom: 9, duration: 700 });
    setPopup({ lng: z.lng, lat: z.lat, zoneId: z.id });
    setLeftPanel('zones');
  }, []);

  // Cas confirmés par province (pour colorer les polygones)
  const provinceCases = useMemo(() => {
    const map: Record<string, number> = {};
    for (const z of ZONES) map[z.province] = (map[z.province] ?? 0) + z.cas_confirmes;
    return map;
  }, []);

  // Frontières provinciales depuis l'API geo
  const { data: geoProvinces } = useQuery({
    queryKey: ['geo-provinces-epidemic'],
    queryFn: () => apiClient.get<any>('/geo/divisions?level=1&withGeometry=true').then(r => r.data),
    staleTime: Infinity,
  });

  const provincesGeojson = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: (geoProvinces?.data ?? [])
      .filter((p: any) => p.geometry)
      .map((p: any) => ({
        type: 'Feature' as const,
        geometry: p.geometry,
        properties: { pcode: p.pcode, name: p.name, cases: provinceCases[p.name] ?? 0 },
      })),
  }), [geoProvinces, provinceCases]);

  const totalCas   = ZONES.reduce((s,z) => s + z.cas_confirmes, 0);
  const totalDeces = ZONES.reduce((s,z) => s + z.deces_confirmes, 0);
  const letalite   = ((totalDeces / totalCas) * 100).toFixed(1);

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── USPPI BANNER ── */}
      <div className="bg-red-950 border-b border-red-800 px-4 py-2 flex items-center gap-3 shrink-0">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-red-200 text-xs font-bold leading-tight">
            🚨 URGENCE SANITAIRE DE PORTÉE INTERNATIONALE — OMS, 17 MAI 2026
          </div>
          <div className="text-red-400 text-[10px] font-mono">
            Ebola Bundibugyo · Déclarée le 15 mai 2026 · Aucun vaccin ni traitement approuvé · Source : INSP SitRep N°17
          </div>
        </div>
        {/* KPIs */}
        <div className="flex items-center gap-4 shrink-0">
          {[
            { v: totalCas.toLocaleString('fr-FR'),  l: 'cas confirmés', cls: 'text-red-200'  },
            { v: String(totalDeces),                l: 'décès',         cls: 'text-gray-200' },
            { v: `${letalite}%`,                   l: 'létalité',      cls: 'text-orange-300'},
            { v: '25',                             l: 'zones',         cls: 'text-yellow-200'},
            { v: '3',                              l: 'provinces',     cls: 'text-blue-200'  },
          ].map(k => (
            <div key={k.l} className="text-center hidden sm:block">
              <div className={`text-base font-bold leading-tight ${k.cls}`}>{k.v}</div>
              <div className="text-[8px] text-red-600 font-mono uppercase">{k.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── BODY ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT PANEL ── */}
        <aside className="w-72 shrink-0 flex flex-col bg-cc-900 border-r border-cc-700 overflow-hidden">

          {/* Panel tabs */}
          <div className="flex border-b border-cc-700 shrink-0">
            {([
              { key:'maladies', label:'🦠 Maladies'      },
              { key:'zones',    label:'📍 Zones actives'  },
              { key:'courbe',   label:'📈 Courbe'         },
            ] as {key:LeftPanel; label:string}[]).map(t => (
              <button
                key={t.key}
                onClick={() => setLeftPanel(t.key)}
                className={`flex-1 py-2 text-[10px] font-medium transition-colors border-b-2 ${
                  leftPanel === t.key
                    ? 'border-red-500 text-red-300 bg-red-950/20'
                    : 'border-transparent text-cc-500 hover:text-gray-300'
                }`}
              >{t.label}</button>
            ))}
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-y-auto">

            {leftPanel === 'maladies' && (
              <div className="p-2 space-y-2">
                {DISEASES.map(d => (
                  <DiseaseCard
                    key={d.id}
                    d={d}
                    onProtocol={d.id === 'EBOLA_BUNDIBUGYO' ? () => setShowProtocol(true) : undefined}
                  />
                ))}

                {/* ── VEILLE MONDIALE — PATHOGÈNES ÉMERGENTS ── */}
                <div className="pt-1 pb-0.5">
                  <div className="flex items-center gap-2 px-1 mb-2">
                    <div className="flex-1 h-px bg-cc-700" />
                    <span className="text-[8px] font-mono text-cc-500 uppercase tracking-wider shrink-0">Veille mondiale</span>
                    <div className="flex-1 h-px bg-cc-700" />
                  </div>

                  {/* Hantavirus Andes */}
                  <div className="rounded-lg border border-orange-900/60 bg-orange-950/20 overflow-hidden">
                    <div className="px-3 py-2 border-b border-orange-900/40 flex items-center gap-2">
                      <span className="text-base">🐀</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-orange-100 leading-tight">Hantavirus Andes</span>
                          <span className="text-[8px] bg-red-900/70 text-red-300 border border-red-800 px-1 py-px rounded font-mono shrink-0">H2H</span>
                        </div>
                        <div className="text-[8px] text-orange-600 font-mono">Andes orthohantavirus · Hantaviridae</div>
                      </div>
                      <span className="text-[8px] font-bold bg-yellow-900/60 text-yellow-300 border border-yellow-800 px-1.5 py-px rounded shrink-0">SURVEILLANCE</span>
                    </div>

                    <div className="px-3 py-2 space-y-1.5">
                      {/* Alerte active */}
                      <div className="text-[8px] bg-orange-900/30 border border-orange-800/60 rounded px-2 py-1 text-orange-300 leading-relaxed">
                        ⚠ Cluster Chili-Argentine mai 2026 — 12 cas, 4 décès (Région Los Lagos)
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-3 gap-1 text-center">
                        <div>
                          <div className="text-xs font-bold text-orange-200">35%</div>
                          <div className="text-[7px] text-cc-500 font-mono">létalité</div>
                        </div>
                        <div>
                          <div className="text-xs font-bold text-orange-200">9–33j</div>
                          <div className="text-[7px] text-cc-500 font-mono">incubation</div>
                        </div>
                        <div>
                          <div className="text-xs font-bold text-yellow-300">0.25</div>
                          <div className="text-[7px] text-cc-500 font-mono">risque import</div>
                        </div>
                      </div>

                      {/* Badges vaccin/trt */}
                      <div className="flex gap-1.5 flex-wrap">
                        <span className="text-[8px] px-1.5 py-px rounded font-mono border bg-red-950 text-red-300 border-red-900">💉 Vaccin: AUCUN</span>
                        <span className="text-[8px] px-1.5 py-px rounded font-mono border bg-red-950 text-red-300 border-red-900">💊 Trt: AUCUN</span>
                      </div>

                      {/* Note critique */}
                      <div className="text-[8px] text-orange-600/80 italic leading-relaxed">
                        Seul des 38 hantavirus à transmission interhumaine confirmée. Incubation jusqu'à 33j masque les cas importés via rapatriés humanitaires.
                      </div>

                      {/* Risque RDC */}
                      <div className="flex items-center justify-between text-[8px]">
                        <span className="text-cc-600 font-mono">Risque import RDC</span>
                        <span className="font-bold text-yellow-400 bg-yellow-950/60 border border-yellow-800 px-1.5 py-px rounded">MODÉRÉ</span>
                      </div>

                      {/* Réservoir */}
                      <div className="text-[8px] text-cc-600 italic">Réservoir : Oligoryzomys longicaudatus · Zones endémiques : Chili, Argentine, Bolivie</div>
                    </div>
                  </div>

                  {/* Marburg — ligne condensée */}
                  <div className="mt-1.5 rounded-lg border border-red-900/40 bg-cc-800/40 px-3 py-2 flex items-center gap-2">
                    <span className="text-sm">☣️</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-red-200">Virus Marburg</span>
                        <span className="text-[8px] bg-red-900/70 text-red-300 border border-red-800 px-1 py-px rounded font-mono">H2H</span>
                      </div>
                      <div className="text-[8px] text-cc-500">88% létalité · Frontière Ouganda — risque <span className="text-red-400 font-bold">ÉLEVÉ</span></div>
                    </div>
                    <span className="text-[8px] font-mono text-cc-600 shrink-0">surveillance</span>
                  </div>
                </div>
              </div>
            )}

            {leftPanel === 'zones' && (
              <div>
                <div className="px-3 py-2 border-b border-cc-700 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-cc-500 uppercase">{ZONES.length} zones affectées</span>
                  <span className="text-[9px] text-cc-600">Cliquez pour centrer</span>
                </div>
                {[...ZONES].sort((a,b) => b.cas_confirmes - a.cas_confirmes).map(z => (
                  <ZoneItem
                    key={z.id}
                    z={z}
                    selected={popup?.zoneId === z.id}
                    onClick={() => flyToZone(z)}
                  />
                ))}
              </div>
            )}

            {leftPanel === 'courbe' && (
              <div className="p-2 space-y-3">
                <EpiCurve />
                <div className="px-1 space-y-1.5">
                  <div className="text-[9px] font-mono text-cc-500 uppercase mb-2">Facteurs aggravants</div>
                  {[
                    'Souche Bundibugyo — aucun vaccin ni traitement approuvé',
                    'ADF, CODECO, M23/AFC bloquent l\'accès humanitaire',
                    'Déplacements de population = vecteur de propagation',
                    'Pratiques funéraires à risque non encore maîtrisées',
                    'Sous-détection importante selon l\'OMS',
                  ].map((f,i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[9px] text-gray-400">
                      <span className="text-red-500 shrink-0 mt-0.5">▶</span>{f}
                    </div>
                  ))}
                  <div className="text-[9px] font-mono text-cc-500 uppercase mt-3 mb-2">Facteurs favorables</div>
                  {[
                    'MSF : 100 tonnes matériel médical, 15 M USD engagés',
                    'CTE opérationnels à Bunia (40 lits) et Rwampara (20 lits)',
                    'Surveillance active dans 36 zones de santé (Ituri)',
                    'Coopération régionale renforcée avec l\'Ouganda',
                  ].map((f,i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[9px] text-gray-400">
                      <span className="text-green-500 shrink-0 mt-0.5">▶</span>{f}
                    </div>
                  ))}
                </div>
                <div className="px-1 text-[8px] text-cc-700 font-mono">
                  Prédiction indicative uniquement · Incertitude élevée due à la sous-déclaration
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ── MAP ── */}
        <div className="flex-1 relative">
          <MapGL
            ref={mapRef}
            mapStyle={MAP_STYLE}
            initialViewState={{ longitude: 29.8, latitude: 1.0, zoom: 6.5 }}
            onClick={onMapClick}
            interactiveLayerIds={['epidemic-circles', 'epidemic-heatmap']}
            style={{ width: '100%', height: '100%' }}
          >
            {/* ── Province boundaries — colored by epidemic severity ── */}
            <Source id="province-boundaries" type="geojson" data={provincesGeojson}>
              <Layer
                id="province-fill"
                type="fill"
                paint={{
                  'fill-color': [
                    'case',
                    ['>=', ['get', 'cases'], 200], 'rgba(127,29,29,0.45)',
                    ['>=', ['get', 'cases'], 50],  'rgba(220,38,38,0.28)',
                    ['>=', ['get', 'cases'],  1],  'rgba(234,88,12,0.18)',
                    'rgba(15,23,42,0.12)',
                  ] as any,
                  'fill-opacity': 1,
                }}
              />
              <Layer
                id="province-outline"
                type="line"
                paint={{
                  'line-color': [
                    'case',
                    ['>=', ['get', 'cases'], 200], '#ef4444',
                    ['>=', ['get', 'cases'],  1],  '#f97316',
                    '#334155',
                  ] as any,
                  'line-width': ['case', ['>', ['get', 'cases'], 0], 2, 1] as any,
                  'line-opacity': 0.85,
                }}
              />
              <Layer
                id="province-names"
                type="symbol"
                maxzoom={8}
                layout={{
                  'text-field': ['get', 'name'],
                  'text-size': 11,
                  'text-font': ['Open Sans Regular'],
                }}
                paint={{
                  'text-color': ['case', ['>', ['get', 'cases'], 0], '#fca5a5', '#64748b'] as any,
                  'text-halo-color': '#0d1b2a',
                  'text-halo-width': 1.5,
                }}
              />
            </Source>

            <Source id="epidemic-zones" type="geojson" data={geojson}>

              {/* Heatmap (low zoom) */}
              <Layer
                id="epidemic-heatmap"
                type="heatmap"
                maxzoom={9}
                paint={{
                  'heatmap-weight': ['/', ['get', 'cas_confirmes'], 150],
                  'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 1, 9, 3],
                  'heatmap-color': [
                    'interpolate', ['linear'], ['heatmap-density'],
                    0,   'rgba(255,237,160,0)',
                    0.3, 'rgba(254,178,76,0.6)',
                    0.6, 'rgba(240,59,32,0.8)',
                    1,   'rgba(189,0,38,1)',
                  ],
                  'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 25, 9, 50],
                  'heatmap-opacity': 0.80,
                } as any}
              />

              {/* Zone circles */}
              <Layer
                id="epidemic-circles"
                type="circle"
                minzoom={5}
                paint={{
                  'circle-radius': [
                    'interpolate', ['linear'], ['get', 'cas_confirmes'],
                    0, 8, 50, 16, 100, 24, 150, 32,
                  ],
                  'circle-color': [
                    'case',
                    ['==', ['get', 'acces_bloque'], true],  '#4b5563',
                    ['>=', ['get', 'cas_confirmes'], 100],  '#7f1d1d',
                    ['>=', ['get', 'cas_confirmes'], 50],   '#dc2626',
                    ['>=', ['get', 'cas_confirmes'], 20],   '#ea580c',
                    '#d97706',
                  ],
                  'circle-opacity': 0.88,
                  'circle-stroke-color': [
                    'case',
                    ['==', ['get', 'acces_bloque'], true], '#9ca3af',
                    '#fff',
                  ],
                  'circle-stroke-width': 1.5,
                } as any}
              />

              {/* Zone labels */}
              <Layer
                id="epidemic-labels"
                type="symbol"
                minzoom={8}
                layout={{
                  'text-field': ['get', 'zone_sante'],
                  'text-size':  9,
                  'text-offset': [0, 2.2],
                  'text-anchor': 'top',
                  'text-font': ['Open Sans Regular'],
                }}
                paint={{
                  'text-color':      '#fecaca',
                  'text-halo-color': '#000',
                  'text-halo-width': 1,
                }}
              />

              {/* Armed groups warning icon (using text emoji) */}
              <Layer
                id="epidemic-armed"
                type="symbol"
                minzoom={7}
                filter={['==', ['get', 'has_armed_groups'], true]}
                layout={{
                  'text-field':   '⚔',
                  'text-size':    11,
                  'text-offset':  [1.1, -1.1],
                  'text-anchor':  'center',
                  'text-font':    ['Open Sans Regular'],
                }}
                paint={{ 'text-color': '#fbbf24' }}
              />
            </Source>

            {/* Popup */}
            {popup && selectedZone && (
              <Popup
                longitude={popup.lng}
                latitude={popup.lat}
                closeButton={false}
                closeOnClick={false}
                anchor="bottom"
                offset={20}
                className="epidemic-popup"
              >
                <ZonePopupContent
                  zone={selectedZone}
                  onClose={() => setPopup(null)}
                  onProtocol={() => setShowProtocol(true)}
                />
              </Popup>
            )}
          </MapGL>

          {/* Map legend */}
          <div className="absolute bottom-4 right-4 bg-cc-900/90 border border-cc-700 rounded-lg p-3 space-y-1.5 backdrop-blur-sm">
            <div className="text-[9px] font-mono text-cc-500 uppercase mb-2">Zones épidémiques</div>
            {[
              { color:'#7f1d1d', label:'≥ 100 cas'    },
              { color:'#dc2626', label:'50 – 99 cas'   },
              { color:'#ea580c', label:'20 – 49 cas'   },
              { color:'#d97706', label:'< 20 cas'      },
              { color:'#4b5563', label:'Accès bloqué'  },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                <span className="text-[9px] text-gray-400">{l.label}</span>
              </div>
            ))}
            <div className="border-t border-cc-700 pt-1.5 mt-1.5 space-y-1.5">
              <div className="text-[9px] font-mono text-cc-500 uppercase">Provinces</div>
              {[
                { color:'rgba(127,29,29,0.6)',  border:'#ef4444', label:'≥ 200 cas' },
                { color:'rgba(220,38,38,0.35)', border:'#f97316', label:'1 – 199 cas' },
                { color:'rgba(15,23,42,0.2)',   border:'#334155', label:'Sans cas' },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-2">
                  <div className="w-8 h-3 rounded-sm shrink-0 border" style={{ backgroundColor: l.color, borderColor: l.border }} />
                  <span className="text-[9px] text-gray-400">{l.label}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-cc-700 pt-1.5 flex items-center gap-2">
              <span className="text-[9px] text-yellow-400">⚔</span>
              <span className="text-[9px] text-gray-400">Groupes armés présents</span>
            </div>
          </div>

          {/* Source note */}
          <div className="absolute bottom-4 left-4 text-[8px] text-cc-700 font-mono">
            Source : INSP SitRep N°17 · OMS · Radio Okapi · 8 juin 2026
          </div>
        </div>
      </div>

      {/* Protocol modal */}
      {showProtocol && <ProtocolModal onClose={() => setShowProtocol(false)} />}
    </div>
  );
}
