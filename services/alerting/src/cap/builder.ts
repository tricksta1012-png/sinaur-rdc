/**
 * Constructeur d'alertes CAP 1.2 (ITU-T X.1303 / OASIS).
 * Produit du XML valide conforme au schéma CAP 1.2.
 */
import { create } from 'xmlbuilder2'
import { v4 as uuidv4 } from 'uuid'

export type CAPUrgency = 'Immediate' | 'Expected' | 'Future' | 'Past' | 'Unknown'
export type CAPSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown'
export type CAPCertainty = 'Observed' | 'Likely' | 'Possible' | 'Unlikely' | 'Unknown'
export type CAPStatus = 'Actual' | 'Exercise' | 'System' | 'Test' | 'Draft'
export type CAPMsgType = 'Alert' | 'Update' | 'Cancel' | 'Ack' | 'Error'
export type CAPScope = 'Public' | 'Restricted' | 'Private'

export interface CAPAlertInput {
  identifier?: string
  sender: string
  status: CAPStatus
  msgType: CAPMsgType
  scope: CAPScope
  references?: string // Pour Update/Cancel : identifiant(s) des alertes référencées
  info: CAPInfoInput
}

export interface CAPInfoInput {
  language?: string
  category: string  // Geo, Met, Safety, Security, Rescue, Fire, Health, Env, Transport, Infra, CBRNE, Other
  event: string
  urgency: CAPUrgency
  severity: CAPSeverity
  certainty: CAPCertainty
  onset?: string   // ISO8601
  expires?: string // ISO8601
  headline: string
  description: string
  instruction: string
  web?: string
  contact?: string
  area: CAPAreaInput
  parameters?: Record<string, string>
}

export interface CAPAreaInput {
  areaDesc: string
  polygon?: string  // GeoJSON-like "lat,lon lat,lon ..."
  geocodes?: { valueName: string; value: string }[]  // ex: PCODE = CD01
}

export function buildCAPAlert(input: CAPAlertInput): string {
  const identifier = input.identifier ?? `SINAUR-RDC-${uuidv4()}`
  const sent = new Date().toISOString()

  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('alert', {
      xmlns: 'urn:oasis:names:tc:emergency:cap:1.2',
    })
    .ele('identifier').txt(identifier).up()
    .ele('sender').txt(input.sender).up()
    .ele('sent').txt(sent).up()
    .ele('status').txt(input.status).up()
    .ele('msgType').txt(input.msgType).up()
    .ele('scope').txt(input.scope).up()

  if (input.references) {
    root.ele('references').txt(input.references).up()
  }

  const info = root.ele('info')
    .ele('language').txt(input.info.language ?? 'fr-CD').up()
    .ele('category').txt(input.info.category).up()
    .ele('event').txt(input.info.event).up()
    .ele('urgency').txt(input.info.urgency).up()
    .ele('severity').txt(input.info.severity).up()
    .ele('certainty').txt(input.info.certainty).up()

  if (input.info.onset) {
    info.ele('onset').txt(input.info.onset).up()
  }
  if (input.info.expires) {
    info.ele('expires').txt(input.info.expires).up()
  }

  info
    .ele('headline').txt(input.info.headline).up()
    .ele('description').txt(input.info.description).up()
    .ele('instruction').txt(input.info.instruction).up()

  if (input.info.web) {
    info.ele('web').txt(input.info.web).up()
  }
  if (input.info.contact) {
    info.ele('contact').txt(input.info.contact).up()
  }

  if (input.info.parameters) {
    for (const [name, value] of Object.entries(input.info.parameters)) {
      info.ele('parameter')
        .ele('valueName').txt(name).up()
        .ele('value').txt(value).up()
        .up()
    }
  }

  const area = info.ele('area')
    .ele('areaDesc').txt(input.info.area.areaDesc).up()

  if (input.info.area.polygon) {
    area.ele('polygon').txt(input.info.area.polygon).up()
  }

  if (input.info.area.geocodes) {
    for (const gc of input.info.area.geocodes) {
      area.ele('geocode')
        .ele('valueName').txt(gc.valueName).up()
        .ele('value').txt(gc.value).up()
        .up()
    }
  }

  return root.end({ prettyPrint: false })
}

/**
 * Mappe un niveau de risque IA vers les champs CAP correspondants.
 */
export function riskLevelToCAP(level: string): {
  urgency: CAPUrgency
  severity: CAPSeverity
  certainty: CAPCertainty
} {
  switch (level) {
    case 'critical':
      return { urgency: 'Immediate', severity: 'Extreme', certainty: 'Likely' }
    case 'high':
      return { urgency: 'Expected', severity: 'Severe', certainty: 'Likely' }
    case 'medium':
      return { urgency: 'Future', severity: 'Moderate', certainty: 'Possible' }
    default:
      return { urgency: 'Future', severity: 'Minor', certainty: 'Unlikely' }
  }
}

export const HAZARD_CATEGORY_MAP: Record<string, string> = {
  flood: 'Met',
  landslide: 'Geo',
  mass_displacement: 'Safety',
  humanitarian_crisis: 'Safety',
  health_epidemic: 'Health',
  drought: 'Met',
  fire: 'Fire',
  conflict: 'Security',
}

export const HAZARD_LABEL_FR: Record<string, string> = {
  flood: 'Inondation',
  landslide: 'Glissement de terrain',
  mass_displacement: 'Déplacement de population',
  humanitarian_crisis: 'Crise humanitaire',
  health_epidemic: 'Épidémie',
  drought: 'Sécheresse',
  fire: 'Incendie',
  conflict: 'Conflit armé',
}
