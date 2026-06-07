import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildDelta } from '../delta.js'
import type { Sql } from 'postgres'

function makeMockSql(returnValue: unknown[] = []): Sql {
  const fn = vi.fn().mockResolvedValue(returnValue) as unknown as Sql
  ;(fn as any).array = vi.fn().mockImplementation((arr: unknown[]) => arr)
  return fn
}

const NOW = new Date()
const ANCIENT = new Date(0) // epoch — déclenche daysSince > 30

describe('buildDelta — filtrage des types', () => {
  it('ne requête que les alertes si types = ["alerts"]', async () => {
    const sql = makeMockSql([])
    await buildDelta(sql, ANCIENT, [], ['alerts'])
    const calls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.length).toBe(1)
    // La seule requête doit concerner cap_alerts
    const queryStr = calls[0][0].join?.('') ?? ''
    expect(queryStr).toContain('cap_alerts')
  })

  it('requête toutes les tables avec types = ["all"]', async () => {
    const sql = makeMockSql([])
    const result = await buildDelta(sql, ANCIENT, [], ['all'])
    // alerts + events + divisions (> 30j) + predictions
    expect(result).toHaveProperty('alerts')
    expect(result).toHaveProperty('events')
    expect(result).toHaveProperty('divisions')
    expect(result).toHaveProperty('predictions')
  })

  it('n\'inclut pas divisions si since < 30 jours', async () => {
    const sql = makeMockSql([])
    const recent = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 jours
    const result = await buildDelta(sql, recent, [], ['all'])
    expect(result.divisions).toBeUndefined()
  })

  it('inclut divisions si since > 30 jours', async () => {
    const sql = makeMockSql([{ pcode: 'CD', nameFr: 'Congo', level: 0 }])
    const result = await buildDelta(sql, ANCIENT, [], ['divisions'])
    expect(result.divisions).toBeDefined()
    expect(Array.isArray(result.divisions)).toBe(true)
  })
})

describe('buildDelta — filtrage géographique', () => {
  it('passe les pcodes au filtre LIKE ANY quand scopePcodes est fourni', async () => {
    const sql = makeMockSql([])
    await buildDelta(sql, ANCIENT, ['CD-NK', 'CD-SK'], ['events'])
    const arrayCalls = (sql as any).array.mock.calls
    // sql.array doit être appelé avec des patterns LIKE (CD-NK%, CD-SK%)
    expect(arrayCalls.length).toBeGreaterThan(0)
    const patterns = arrayCalls[0][0] as string[]
    expect(patterns.some(p => p.endsWith('%'))).toBe(true)
  })

  it('retourne des tableaux vides si la DB renvoie rien', async () => {
    const sql = makeMockSql([])
    const result = await buildDelta(sql, ANCIENT, [], ['alerts', 'predictions'])
    expect(result.alerts).toEqual([])
    expect(result.predictions).toEqual([])
  })
})

describe('buildDelta — structure du résultat', () => {
  it('retourne un objet dont les valeurs sont toujours des tableaux', async () => {
    const sql = makeMockSql([{ id: '1' }, { id: '2' }])
    const result = await buildDelta(sql, ANCIENT, [], ['all'])
    for (const value of Object.values(result)) {
      expect(Array.isArray(value)).toBe(true)
    }
  })

  it('respecte types = ["predictions"] (requête uniquement predictions)', async () => {
    const sql = makeMockSql([])
    const result = await buildDelta(sql, NOW, [], ['predictions'])
    expect(result).toHaveProperty('predictions')
    expect(result).not.toHaveProperty('alerts')
    expect(result).not.toHaveProperty('events')
  })
})
