import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { apiClient } from '../lib/api.js'
import { useOfflineQueue } from '../hooks/useOfflineQueue.js'

const HAZARD_TYPES = [
  { value: 'flood', label: 'Inondation' },
  { value: 'landslide', label: 'Glissement de terrain' },
  { value: 'mass_displacement', label: 'Déplacement de population' },
  { value: 'humanitarian_crisis', label: 'Crise humanitaire' },
  { value: 'health_epidemic', label: 'Épidémie' },
  { value: 'drought', label: 'Sécheresse' },
  { value: 'fire', label: 'Incendie' },
  { value: 'conflict', label: 'Conflit armé' },
] as const

const VULN_FACTORS = [
  { value: 'elderly', label: 'Personne âgée' },
  { value: 'child_alone', label: 'Enfant non accompagné' },
  { value: 'orphan', label: 'Orphelin' },
  { value: 'pregnant', label: 'Femme enceinte/allaitante' },
  { value: 'disability', label: 'Handicap' },
  { value: 'chronic_illness', label: 'Maladie chronique' },
  { value: 'gbv_survivor', label: 'Survivant(e) de VBG' },
  { value: 'conflict_survivor', label: 'Survivant(e) de conflit' },
] as const

const MemberSchema = z.object({
  firstName: z.string().min(1, 'Prénom requis'),
  lastName: z.string().min(1, 'Nom requis'),
  birthDate: z.string().optional(),
  gender: z.enum(['M', 'F', 'other']),
  isHeadOfHousehold: z.boolean().default(false),
  hasDisability: z.boolean().optional(),
  isPregnant: z.boolean().optional(),
  isUnaccompanied: z.boolean().optional(),
})

const FormSchema = z.object({
  householdHead: MemberSchema,
  householdMembers: z.array(MemberSchema).default([]),
  vulnerabilityFactors: z.array(z.string()).default([]),
  disasterType: z.string().min(1, 'Type d\'aléa requis'),
  locationPcode: z.string().min(2, 'Province requise'),
  locationName: z.string().min(2, 'Localité requise'),
  originPcode: z.string().optional(),
  originName: z.string().optional(),
  notes: z.string().optional(),
  isSensitive: z.boolean().default(false),
})

type FormData = z.infer<typeof FormSchema>

interface DuplicateCandidate {
  id: string
  registrationNumber: string
  headFirstName: string
  headLastName: string
  headBirthDate?: string
  similarityScore: number
}

export function BeneficiaryFormPage() {
  const navigate = useNavigate()
  const { isOnline } = useOfflineQueue()
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([])
  const [submitted, setSubmitted] = useState<{ registrationNumber: string; id: string } | null>(null)

  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      householdHead: { gender: 'M', isHeadOfHousehold: true },
      householdMembers: [],
      vulnerabilityFactors: [],
      isSensitive: false,
    },
  })

  const { fields: members, append: addMember, remove: removeMember } = useFieldArray({
    control,
    name: 'householdMembers',
  })

  const selectedFactors = watch('vulnerabilityFactors') ?? []

  const mutation = useMutation({
    mutationFn: (data: FormData) => apiClient.post('/beneficiaries', data),
    onSuccess: (res) => {
      const { data: ben, duplicateCandidates } = res.data
      setSubmitted({ registrationNumber: ben.registrationNumber, id: ben.id })
      if (duplicateCandidates?.length > 0) {
        setDuplicates(duplicateCandidates)
      }
    },
  })

  const onSubmit = (data: FormData) => {
    mutation.mutate(data)
  }

  if (submitted) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center shadow-sm">
          <div className="text-5xl mb-4">✓</div>
          <h2 className="text-xl font-bold text-green-700 mb-2">Bénéficiaire enregistré</h2>
          <p className="text-gray-600 mb-1">Numéro d'enregistrement :</p>
          <p className="text-2xl font-mono font-bold text-gray-900 mb-6">{submitted.registrationNumber}</p>

          {duplicates.length > 0 && (
            <div className="mb-6 p-4 bg-yellow-50 rounded-xl border border-yellow-200 text-left">
              <p className="font-medium text-yellow-800 mb-2">
                {duplicates.length} doublon(s) potentiel(s) détecté(s) — revue recommandée
              </p>
              {duplicates.map(d => (
                <div key={d.id} className="text-sm text-yellow-700">
                  {d.registrationNumber} — {d.headFirstName} {d.headLastName}
                  {d.headBirthDate && ` (${d.headBirthDate})`}
                  {' '}<span className="font-mono">({Math.round(d.similarityScore * 100)}%)</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 justify-center">
            <button
              onClick={() => navigate(`/registry/${submitted.id}`)}
              className="px-4 py-2 bg-red-700 text-white rounded-lg font-medium hover:bg-red-800"
            >
              Voir la fiche + QR code
            </button>
            <button
              onClick={() => { setSubmitted(null); setDuplicates([]) }}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Nouveau bénéficiaire
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/registry')} className="text-gray-500 hover:text-gray-700">
          ← Retour
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enregistrement d'un bénéficiaire</h1>
          {!isOnline && (
            <p className="text-sm text-yellow-600 mt-0.5">Mode hors-ligne — sera synchronisé au retour en connexion</p>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Chef de ménage */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-4">Chef de ménage</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prénom *</label>
              <input
                {...register('householdHead.firstName')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500"
              />
              {errors.householdHead?.firstName && (
                <p className="text-red-600 text-xs mt-1">{errors.householdHead.firstName.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
              <input
                {...register('householdHead.lastName')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500"
              />
              {errors.householdHead?.lastName && (
                <p className="text-red-600 text-xs mt-1">{errors.householdHead.lastName.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date de naissance</label>
              <input type="date" {...register('householdHead.birthDate')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Genre</label>
              <select {...register('householdHead.gender')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="M">Masculin</option>
                <option value="F">Féminin</option>
                <option value="other">Autre</option>
              </select>
            </div>
          </div>
          <div className="mt-3 flex gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" {...register('householdHead.hasDisability')} className="rounded" />
              Handicap
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" {...register('householdHead.isPregnant')} className="rounded" />
              Enceinte/Allaitante
            </label>
          </div>
        </div>

        {/* Membres supplémentaires */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Membres du ménage ({members.length})</h2>
            <button
              type="button"
              onClick={() => addMember({ firstName: '', lastName: '', gender: 'M', isHeadOfHousehold: false })}
              className="text-sm text-red-700 hover:text-red-900 font-medium"
            >
              + Ajouter
            </button>
          </div>
          {members.map((f, i) => (
            <div key={f.id} className="grid grid-cols-4 gap-3 mb-3 p-3 bg-gray-50 rounded-xl">
              <input {...register(`householdMembers.${i}.firstName`)} placeholder="Prénom"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <input {...register(`householdMembers.${i}.lastName`)} placeholder="Nom"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <select {...register(`householdMembers.${i}.gender`)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="M">M</option>
                <option value="F">F</option>
                <option value="other">Autre</option>
              </select>
              <button type="button" onClick={() => removeMember(i)}
                className="text-red-500 hover:text-red-700 text-sm">
                Retirer
              </button>
            </div>
          ))}
          {members.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Aucun autre membre</p>
          )}
        </div>

        {/* Aléa + Localisation */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-4">Sinistre et localisation</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type d'aléa *</label>
              <select {...register('disasterType')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500">
                <option value="">— Choisir —</option>
                {HAZARD_TYPES.map(h => (
                  <option key={h.value} value={h.value}>{h.label}</option>
                ))}
              </select>
              {errors.disasterType && (
                <p className="text-red-600 text-xs mt-1">{errors.disasterType.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code province (P-code) *</label>
              <input {...register('locationPcode')} placeholder="ex: CD01"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500" />
              {errors.locationPcode && (
                <p className="text-red-600 text-xs mt-1">{errors.locationPcode.message}</p>
              )}
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Localité actuelle *</label>
              <input {...register('locationName')} placeholder="Nom du village / quartier"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500" />
              {errors.locationName && (
                <p className="text-red-600 text-xs mt-1">{errors.locationName.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Province d'origine</label>
              <input {...register('originPcode')} placeholder="P-code origine"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Localité d'origine</label>
              <input {...register('originName')} placeholder="Village d'origine"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        </div>

        {/* Facteurs de vulnérabilité */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-4">Facteurs de vulnérabilité</h2>
          <div className="grid grid-cols-2 gap-3">
            {VULN_FACTORS.map(f => (
              <label key={f.value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  value={f.value}
                  checked={selectedFactors.includes(f.value)}
                  onChange={e => {
                    const current = watch('vulnerabilityFactors') ?? []
                    if (e.target.checked) {
                      // handled by form field — workaround with register
                    }
                  }}
                  {...register('vulnerabilityFactors')}
                  className="rounded text-red-700"
                />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        {/* Sécurité données */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3">Sécurité des données</h2>
          <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" {...register('isSensitive')} className="mt-0.5 rounded" />
            <span>
              <span className="font-medium">Données sensibles à risque sécuritaire</span>
              <br />
              <span className="text-gray-500">Cocher si la localisation précise doit être masquée (p.ex. fuyant un conflit actif)</span>
            </span>
          </label>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (opérateur)</label>
            <textarea {...register('notes')} rows={2} placeholder="Observations particulières..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500" />
          </div>
        </div>

        {/* Erreur API */}
        {mutation.isError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            {(mutation.error as any)?.response?.data?.error?.message ?? 'Erreur lors de l\'enregistrement'}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex-1 px-6 py-3 bg-red-700 text-white rounded-xl font-semibold hover:bg-red-800 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Enregistrement...' : 'Enregistrer le bénéficiaire'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/registry')}
            className="px-6 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50"
          >
            Annuler
          </button>
        </div>
      </form>
    </div>
  )
}
