import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiClient } from '../lib/api.js'

const Step1Schema = z.object({
  identifier: z.string().min(4, 'Email ou téléphone requis'),
})

const Step2Schema = z.object({
  otpCode:     z.string().length(6, '6 chiffres requis'),
  newPassword: z.string().min(10, 'Au moins 10 caractères'),
  confirm:     z.string(),
}).refine(d => d.newPassword === d.confirm, {
  message: 'Les mots de passe ne correspondent pas',
  path: ['confirm'],
})

type Step1Form = z.infer<typeof Step1Schema>
type Step2Form = z.infer<typeof Step2Schema>

export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep]             = useState<1 | 2>(1)
  const [identifier, setIdentifier] = useState('')
  const [sent, setSent]             = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [success, setSuccess]       = useState(false)

  const step1 = useForm<Step1Form>({ resolver: zodResolver(Step1Schema) })
  const step2 = useForm<Step2Form>({ resolver: zodResolver(Step2Schema) })

  const handleStep1 = async (data: Step1Form) => {
    setGlobalError('')
    try {
      await apiClient.post('/auth/forgot-password', { identifier: data.identifier })
      setIdentifier(data.identifier)
      setSent(true)
      setStep(2)
    } catch {
      setGlobalError('Erreur réseau. Réessayez.')
    }
  }

  const handleStep2 = async (data: Step2Form) => {
    setGlobalError('')
    try {
      await apiClient.post('/auth/reset-password', {
        identifier,
        otpCode:     data.otpCode,
        newPassword: data.newPassword,
      })
      setSuccess(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err: any) {
      const code = err?.response?.data?.error?.code
      if (code === 'INVALID_OTP') {
        setGlobalError('Code invalide ou expiré. Recommencez.')
      } else {
        setGlobalError('Erreur lors de la réinitialisation.')
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-red-950 to-gray-900 p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🛡️</div>
          <div className="text-white font-bold text-xl">SINAUR-RDC</div>
          <div className="text-gray-400 text-sm mt-1">Réinitialisation du mot de passe</div>
        </div>

        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 shadow-2xl">
          {success ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-white font-semibold">Mot de passe réinitialisé !</p>
              <p className="text-gray-400 text-sm mt-2">Redirection vers la connexion…</p>
            </div>
          ) : step === 1 ? (
            <>
              <h2 className="text-white font-semibold text-base mb-4">
                Étape 1 — Identifier votre compte
              </h2>
              <form onSubmit={step1.handleSubmit(handleStep1)} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    Email ou téléphone
                  </label>
                  <input
                    {...step1.register('identifier')}
                    type="text"
                    placeholder="admin@sinaur-rdc.cd ou +243…"
                    autoComplete="username"
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400"
                  />
                  {step1.formState.errors.identifier && (
                    <p className="text-red-400 text-xs mt-1">{step1.formState.errors.identifier.message}</p>
                  )}
                </div>

                {globalError && (
                  <p className="text-red-400 text-xs bg-red-900/30 px-3 py-2 rounded-lg">{globalError}</p>
                )}

                <button
                  type="submit"
                  disabled={step1.formState.isSubmitting}
                  className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-semibold transition-colors"
                >
                  {step1.formState.isSubmitting ? 'Envoi en cours…' : 'Envoyer le code'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-white font-semibold text-base mb-1">
                Étape 2 — Nouveau mot de passe
              </h2>
              <p className="text-gray-400 text-xs mb-4">
                Un code à 6 chiffres a été envoyé à <span className="text-gray-200 font-mono">{identifier}</span>.
              </p>
              <form onSubmit={step2.handleSubmit(handleStep2)} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Code reçu</label>
                  <input
                    {...step2.register('otpCode')}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="123456"
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 font-mono tracking-widest focus:outline-none focus:border-red-400"
                  />
                  {step2.formState.errors.otpCode && (
                    <p className="text-red-400 text-xs mt-1">{step2.formState.errors.otpCode.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Nouveau mot de passe</label>
                  <input
                    {...step2.register('newPassword')}
                    type="password"
                    autoComplete="new-password"
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-400"
                  />
                  {step2.formState.errors.newPassword && (
                    <p className="text-red-400 text-xs mt-1">{step2.formState.errors.newPassword.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Confirmer</label>
                  <input
                    {...step2.register('confirm')}
                    type="password"
                    autoComplete="new-password"
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-400"
                  />
                  {step2.formState.errors.confirm && (
                    <p className="text-red-400 text-xs mt-1">{step2.formState.errors.confirm.message}</p>
                  )}
                </div>

                {globalError && (
                  <p className="text-red-400 text-xs bg-red-900/30 px-3 py-2 rounded-lg">{globalError}</p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => { setStep(1); setGlobalError('') }}
                    className="flex-1 bg-white/10 hover:bg-white/20 text-gray-300 rounded-lg py-2.5 text-sm font-medium transition-colors"
                  >
                    ← Retour
                  </button>
                  <button
                    type="submit"
                    disabled={step2.formState.isSubmitting}
                    className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-semibold transition-colors"
                  >
                    {step2.formState.isSubmitting ? 'Validation…' : 'Réinitialiser'}
                  </button>
                </div>
              </form>
            </>
          )}

          <div className="mt-5 text-center">
            <Link to="/login" className="text-xs text-gray-400 hover:text-gray-200 transition-colors">
              ← Retour à la connexion
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
