import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import type { ApiResponse, AdminDivision } from '@sinaur/shared-types';

const reportSchema = z.object({
  title: z.string().min(5, 'Titre trop court').max(200),
  description: z.string().default(''),
  hazardType: z.enum(['flood','landslide','mass_displacement','humanitarian_crisis',
    'health_epidemic','volcanic_eruption','drought','fire','conflict','earthquake','other']),
  severity: z.enum(['Minor','Moderate','Severe','Extreme','Unknown']).default('Unknown'),
  locationPcode: z.string().min(2, 'Sélectionnez une province'),
  locationName: z.string().min(2, 'Précisez la localisation'),
  estimatedAffected: z.coerce.number().positive().optional().or(z.literal('')),
});
type ReportForm = z.infer<typeof reportSchema>;

const HAZARD_OPTIONS = [
  { value: 'flood', label: '🌊 Inondation' },
  { value: 'landslide', label: '⛰️ Glissement de terrain' },
  { value: 'mass_displacement', label: '🏃 Déplacement de populations' },
  { value: 'humanitarian_crisis', label: '🆘 Crise humanitaire' },
  { value: 'health_epidemic', label: '🦠 Épidémie / Risque sanitaire' },
  { value: 'volcanic_eruption', label: '🌋 Éruption volcanique' },
  { value: 'drought', label: '☀️ Sécheresse' },
  { value: 'fire', label: '🔥 Incendie' },
  { value: 'conflict', label: '⚔️ Conflit armé' },
  { value: 'earthquake', label: '📳 Tremblement de terre' },
  { value: 'other', label: '⚠️ Autre' },
] as const;

export function ReportPage() {
  const [submitted, setSubmitted] = useState(false);

  const { data: provinces } = useQuery({
    queryKey: ['geo', 'provinces'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<AdminDivision[]>>('/geo/divisions?level=1');
      return data.data ?? [];
    },
  });

  const mutation = useMutation({
    mutationFn: async (form: ReportForm) => {
      const { data } = await apiClient.post('/events', {
        ...form,
        locationLevel: 1,
        locationAccuracy: 'province',
        source: 'citizen',
        estimatedAffected: form.estimatedAffected || undefined,
      });
      return data;
    },
    onSuccess: () => setSubmitted(true),
  });

  const { register, handleSubmit, formState: { errors } } = useForm<ReportForm>({
    resolver: zodResolver(reportSchema),
    defaultValues: { severity: 'Unknown', description: '' },
  });

  if (submitted) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <span className="text-6xl">✅</span>
        <h2 className="text-2xl font-bold text-gray-900 mt-4">Signalement envoyé</h2>
        <p className="text-gray-600 mt-2 max-w-md">
          Votre signalement a été reçu et sera examiné par l'équipe de modération.
          Un accusé de réception vous sera transmis.
        </p>
        <button
          onClick={() => setSubmitted(false)}
          className="mt-6 px-6 py-2.5 bg-red-700 text-white rounded-lg hover:bg-red-800 transition-colors"
        >
          Nouveau signalement
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Signaler un événement</h1>
      <p className="text-gray-500 text-sm mt-1">
        Signalez une catastrophe, urgence sanitaire ou besoin humanitaire.
      </p>

      {mutation.isError && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          Erreur lors de l'envoi. Veuillez réessayer.
        </div>
      )}

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="mt-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type d'événement *</label>
          <select
            {...register('hazardType')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
          >
            <option value="">Sélectionner...</option>
            {HAZARD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {errors.hazardType && <p className="mt-1 text-xs text-red-600">{errors.hazardType.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Titre *</label>
          <input
            {...register('title')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="Ex: Inondation grave — Quartier Limete"
          />
          {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            {...register('description')}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="Décrivez la situation, les personnes affectées, les besoins urgents..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Province *</label>
            <select
              {...register('locationPcode')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
            >
              <option value="">Sélectionner...</option>
              {(provinces ?? []).map((p) => (
                <option key={p.pcode} value={p.pcode}>{p.name}</option>
              ))}
            </select>
            {errors.locationPcode && <p className="mt-1 text-xs text-red-600">{errors.locationPcode.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Localité précise</label>
            <input
              {...register('locationName')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Ville, quartier, village..."
            />
            {errors.locationName && <p className="mt-1 text-xs text-red-600">{errors.locationName.message}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Gravité estimée</label>
            <select
              {...register('severity')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
            >
              <option value="Unknown">Inconnue</option>
              <option value="Minor">Mineure</option>
              <option value="Moderate">Modérée</option>
              <option value="Severe">Sévère</option>
              <option value="Extreme">Extrême</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Personnes affectées (estimé)</label>
            <input
              {...register('estimatedAffected')}
              type="number"
              min="1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Nombre"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full bg-red-700 hover:bg-red-800 disabled:bg-red-400 text-white font-semibold py-3 rounded-lg transition-colors text-lg"
        >
          {mutation.isPending ? 'Envoi en cours...' : '📢 Envoyer le signalement'}
        </button>
      </form>
    </div>
  );
}
