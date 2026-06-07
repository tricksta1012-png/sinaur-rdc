/**
 * Arbre de menus USSD multilingue — SINAUR-RDC.
 * Format : CON = continue (affiche menu), END = ferme session.
 *
 * Le texte USSD est accumulé par le carrier (ex: "1*2*CD01*1").
 * On découpe sur "*" pour connaître les choix successifs.
 *
 * Codes accès : *777*1*SINAUR# (exemple — à configurer par carrier)
 */

export type Locale = 'fr' | 'ln' | 'sw' | 'kg' | 'lua'

const HAZARD_LABELS: Record<Locale, string[]> = {
  fr:  ['Inondation', 'Conflit armé', 'Épidémie', 'Déplacement', 'Sécheresse', 'Autre'],
  ln:  ['Mayi etomboki', 'Bitumba', 'Bokono', 'Batu bakimaki', 'Mokakatano', 'Mosusu'],
  sw:  ['Mafuriko', 'Vita', 'Mlipuko', 'Uhamisho', 'Ukame', 'Nyingine'],
  kg:  ['Mbu etombuka', 'Bitumba', 'Ndwelo', 'Batu babakidi', 'Kala ya mvula', 'Mosusu'],
  lua: ['Bukidi bwa mema', 'Nkolelo', 'Ndwi', 'Bulombodi', 'Nzala ya mema', 'Bintu bimpe'],
}

const HAZARD_CODES = ['flood', 'conflict', 'health_epidemic', 'mass_displacement', 'drought', 'other']

const LABELS: Record<Locale, Record<string, string>> = {
  fr: {
    welcome:      'Bienvenu SINAUR-RDC\n1. Signaler evenement\n2. Alertes recentes\n3. S\'abonner alertes SMS\n4. Langue',
    report_type:  'Type d\'evenement:\n1. Inondation\n2. Conflit\n3. Epidemie\n4. Deplacement\n5. Secheresse\n6. Autre',
    enter_zone:   'Code province (ex: CD01)\nou nom: NORD-KIVU',
    confirm_tmpl: 'Confirmer?\n{type} - {zone}\n1. Oui\n2. Non',
    done_tmpl:    'Merci! Ref: {ref}\nSMS de confirmation en route.',
    alerts:       'Alertes actives: {count}\nDerniere: {last}\nEnvoyez SMS "ALERTE {pcode}" pour details.',
    subscribe:    'Entrez votre code province\npour recevoir les alertes SMS:',
    subscribed:   'Inscrit! Alertes SMS pour {pcode}.\nEnvoyez STOP SINAUR pour desinscrire.',
    lang_menu:    'Choisir langue:\n1. Francais\n2. Lingala\n3. Kiswahili\n4. Kikongo\n5. Tshiluba',
    lang_set:     'Langue: Francais\nEnvoyez *777*1*SINAUR# pour menu.',
    invalid:      'Choix invalide. Reessayez.',
    cancelled:    'Operation annulee.',
    error:        'Erreur systeme. Appelez le 117.',
  },
  ln: {
    welcome:      'Boyei malamu SINAUR-RDC\n1. Tuna makambo\n2. Makebisi ya sikoyo\n3. Kozua makebisi SMS\n4. Lokota',
    report_type:  'Ndenge ya likama:\n1. Mayi etomboki\n2. Bitumba\n3. Bokono\n4. Batu bakimaki\n5. Mokakatano\n6. Mosusu',
    enter_zone:   'Code ya province (ex: CD01)\nto nkombo: NORD-KIVU',
    confirm_tmpl: 'Kwikisa?\n{type} - {zone}\n1. Iyo\n2. Te',
    done_tmpl:    'Merci! Ref: {ref}\nSMS ekoya.',
    alerts:       'Makebisi: {count}\nYa nsuka: {last}',
    subscribe:    'Tia code ya province\npour kozua makebisi SMS:',
    subscribed:   'Okomami! Makebisi ya {pcode}.\nTinda STOP SINAUR kotika.',
    lang_menu:    'Pona lokota:\n1. Francais\n2. Lingala\n3. Kiswahili\n4. Kikongo\n5. Tshiluba',
    lang_set:     'Lokota: Lingala',
    invalid:      'Choix mabe. Sala lisusu.',
    cancelled:    'Esukaki.',
    error:        'Likambo ya systeme. Benga 117.',
  },
  sw: {
    welcome:      'Karibu SINAUR-RDC\n1. Ripoti tukio\n2. Tahadhari za hivi karibuni\n3. Jiandikishe arifa SMS\n4. Lugha',
    report_type:  'Aina ya tukio:\n1. Mafuriko\n2. Vita\n3. Mlipuko\n4. Uhamisho\n5. Ukame\n6. Nyingine',
    enter_zone:   'Msimbo wa mkoa (mf: CD01)\nau jina: NORD-KIVU',
    confirm_tmpl: 'Thibitisha?\n{type} - {zone}\n1. Ndiyo\n2. Hapana',
    done_tmpl:    'Asante! Kumb: {ref}\nSMS inakuja.',
    alerts:       'Tahadhari: {count}\nYa mwisho: {last}',
    subscribe:    'Weka msimbo wa mkoa\nkupokea arifa SMS:',
    subscribed:   'Umesajiliwa! Arifa za {pcode}.\nTuma STOP SINAUR kusimama.',
    lang_menu:    'Chagua lugha:\n1. Kifaransa\n2. Lingala\n3. Kiswahili\n4. Kikongo\n5. Tshiluba',
    lang_set:     'Lugha: Kiswahili',
    invalid:      'Chaguo batili. Jaribu tena.',
    cancelled:    'Imeghairiwa.',
    error:        'Hitilafu ya mfumo. Piga simu 117.',
  },
  kg: {
    welcome:      'Boyei malamu SINAUR-RDC\n1. Samba mambu\n2. Makebisi ya ntango\n3. Kozua makebisi SMS\n4. Ndinga',
    report_type:  'Ndenge ya kimpwanza:\n1. Mbu etombuka\n2. Bitumba\n3. Ndwelo\n4. Batu babakidi\n5. Kala mvula\n6. Mosusu',
    enter_zone:   'Code ya province (ex: CD01)',
    confirm_tmpl: 'Kwikisa?\n{type} - {zone}\n1. Iyo\n2. Te',
    done_tmpl:    'Merci! Ref: {ref}',
    alerts:       'Makebisi: {count}',
    subscribe:    'Tia code ya province:',
    subscribed:   'Okomami! Makebisi ya {pcode}.',
    lang_menu:    'Pona ndinga:\n1. Francais\n2. Lingala\n3. Kiswahili\n4. Kikongo\n5. Tshiluba',
    lang_set:     'Ndinga: Kikongo',
    invalid:      'Choix mabe.',
    cancelled:    'Esukaki.',
    error:        'Mbevo ya systeme. 117.',
  },
  lua: {
    welcome:      'Muoyo webe SINAUR-RDC\n1. Longa tshifubu\n2. Makebisi ya henu\n3. Diandika makebisi SMS\n4. Ciluba',
    report_type:  'Mutu wa tshifubu:\n1. Bukidi bwa mema\n2. Nkolelo\n3. Ndwi\n4. Bulombodi\n5. Nzala ya mema\n6. Bintu bimpe',
    enter_zone:   'Code ya province (mf: CD01)',
    confirm_tmpl: 'Diakanya?\n{type} - {zone}\n1. Eo\n2. Aye',
    done_tmpl:    'Tulenga! Ref: {ref}',
    alerts:       'Makebisi: {count}',
    subscribe:    'Bika code ya province:',
    subscribed:   'Wadiandikile! Makebisi ya {pcode}.',
    lang_menu:    'Sala ciluba:\n1. Francais\n2. Lingala\n3. Kiswahili\n4. Kikongo\n5. Tshiluba',
    lang_set:     'Ciluba: Tshiluba',
    invalid:      'Muselo mubi.',
    cancelled:    'Kwashintuluke.',
    error:        'Tshifu tsha systeme. 117.',
  },
}

const LOCALE_MAP: Record<string, Locale> = { '1': 'fr', '2': 'ln', '3': 'sw', '4': 'kg', '5': 'lua' }

export interface USSDState {
  sessionId: string
  phoneNumber: string
  locale: Locale
}

export interface USSDResponse {
  type: 'CON' | 'END'
  message: string
  reportData?: {
    hazardType: string
    locationInput: string
    confirmed: boolean
  }
  subscriptionData?: {
    pcode: string
  }
  newLocale?: Locale
}

/**
 * Traite une requête USSD. Le `text` est l'entrée accumulée (choix séparés par *).
 * Compatible Africa's Talking, Telecel, Airtel Money gateways.
 */
export function handleUSSD(
  state: USSDState,
  text: string,
  alertCount = 0,
  lastAlertSummary = 'Aucune alerte récente',
): USSDResponse {
  const { locale } = state
  const L = LABELS[locale]
  const parts = text ? text.split('*') : []

  try {
    // ── Accueil ──────────────────────────────────────────────────────────────
    if (parts.length === 0 || text === '') {
      return { type: 'CON', message: L.welcome }
    }

    const choice1 = parts[0]

    // ── 1. Signaler ──────────────────────────────────────────────────────────
    if (choice1 === '1') {
      if (parts.length === 1) {
        return { type: 'CON', message: L.report_type }
      }
      const hazardIdx = parseInt(parts[1]) - 1
      if (isNaN(hazardIdx) || hazardIdx < 0 || hazardIdx >= HAZARD_CODES.length) {
        return { type: 'CON', message: L.invalid + '\n\n' + L.report_type }
      }

      if (parts.length === 2) {
        return { type: 'CON', message: L.enter_zone }
      }

      const locationInput = parts[2]?.trim()
      if (!locationInput) {
        return { type: 'CON', message: L.enter_zone }
      }

      if (parts.length === 3) {
        const typeLabel = HAZARD_LABELS[locale][hazardIdx]
        const msg = L.confirm_tmpl.replace('{type}', typeLabel).replace('{zone}', locationInput)
        return { type: 'CON', message: msg }
      }

      if (parts[3] === '2') {
        return { type: 'END', message: L.cancelled }
      }

      if (parts[3] === '1') {
        const ref = 'USSD-' + Math.random().toString(36).slice(2, 8).toUpperCase()
        return {
          type: 'END',
          message: L.done_tmpl.replace('{ref}', ref),
          reportData: {
            hazardType: HAZARD_CODES[hazardIdx],
            locationInput,
            confirmed: true,
          },
        }
      }

      return { type: 'CON', message: L.invalid }
    }

    // ── 2. Alertes récentes ──────────────────────────────────────────────────
    if (choice1 === '2') {
      const msg = L.alerts
        .replace('{count}', String(alertCount))
        .replace('{last}', lastAlertSummary)
      return { type: 'END', message: msg }
    }

    // ── 3. Abonnement SMS ────────────────────────────────────────────────────
    if (choice1 === '3') {
      if (parts.length === 1) {
        return { type: 'CON', message: L.subscribe }
      }
      const pcode = parts[1]?.trim().toUpperCase()
      if (!pcode) {
        return { type: 'CON', message: L.subscribe }
      }
      return {
        type: 'END',
        message: L.subscribed.replace('{pcode}', pcode),
        subscriptionData: { pcode },
      }
    }

    // ── 4. Langue ────────────────────────────────────────────────────────────
    if (choice1 === '4') {
      if (parts.length === 1) {
        return { type: 'CON', message: L.lang_menu }
      }
      const newLocale: Locale = LOCALE_MAP[parts[1]] ?? 'fr'
      const newL = LABELS[newLocale]
      return {
        type: 'END',
        message: newL.lang_set,
        newLocale,
      }
    }

    return { type: 'CON', message: L.invalid + '\n\n' + L.welcome }
  } catch {
    return { type: 'END', message: LABELS[locale].error }
  }
}

export { HAZARD_CODES, LOCALE_MAP, type Locale as USSDLocale }
