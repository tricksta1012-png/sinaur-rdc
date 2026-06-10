import { describe, it, expect } from 'vitest'
import { hasSuspiciousInput } from '../auth/security.js'

describe('hasSuspiciousInput', () => {
  it('détecte UNION SELECT (injection SQL)', () => {
    expect(hasSuspiciousInput("1 UNION SELECT * FROM users")).toBe(true)
    expect(hasSuspiciousInput("' UNION select password FROM users--")).toBe(true)
  })

  it('détecte DROP TABLE', () => {
    expect(hasSuspiciousInput("'; DROP TABLE users;--")).toBe(true)
  })

  it('détecte les balises script (XSS)', () => {
    expect(hasSuspiciousInput('<script>alert(1)</script>')).toBe(true)
    expect(hasSuspiciousInput('<SCRIPT src="evil.js">')).toBe(true)
  })

  it('détecte javascript: (XSS href)', () => {
    expect(hasSuspiciousInput('javascript:alert(1)')).toBe(true)
    expect(hasSuspiciousInput('JAVASCRIPT : void(0)')).toBe(true)
  })

  it('détecte la traversée de chemin (path traversal)', () => {
    expect(hasSuspiciousInput('../etc/passwd')).toBe(true)
    expect(hasSuspiciousInput('../../config/secrets')).toBe(true)
  })

  it('accepte les entrées légitimes', () => {
    expect(hasSuspiciousInput("Inondation Kinshasa quartier N'Djili")).toBe(false)
    expect(hasSuspiciousInput('CD-KN-001')).toBe(false)
    expect(hasSuspiciousInput('Rapport SitRep #12 — Nord-Kivu')).toBe(false)
    expect(hasSuspiciousInput('SELECT dans le texte (non-SQL)')).toBe(false)
    expect(hasSuspiciousInput('')).toBe(false)
  })

  it('est insensible à la casse pour les mots-clés SQL', () => {
    expect(hasSuspiciousInput('union select 1')).toBe(true)
    expect(hasSuspiciousInput('Union Select 1')).toBe(true)
    expect(hasSuspiciousInput('drop table foo')).toBe(true)
  })
})
