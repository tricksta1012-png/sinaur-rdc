import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { useOfflineQueue } from '../hooks/useOfflineQueue.js';
import type { ApiResponse, AdminDivision } from '@sinaur/shared-types';

const reportSchema = z.object({
  title: z.string().min(5, 'Titre trop court (min 5 caractères)').max(200),
  description: z.string().default(''),
  hazardType: z.enum(['flood','landslide','mass_displacement','humanitarian_crisis',
    'health_epidemic','volcanic_eruption','drought','fire','conflict','earthquake','other'],
    { required_error: 'Sélectionnez un type d\'événement' }),
  severity: z.enum(['Minor','Moderate','Severe','Extreme','Unknown']).default('Unknown'),
  locationPcode: z.string().min(2, 'Sélectionnez une province'),
  locationName: z.string().min(2, 'Précisez la localisation').max(200),
  estimatedAffected: z.coerce.number().int().positive().optional().or(z.literal('')),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
});
type ReportForm = z.infer<typeof reportSchema>;

const HAZARD_OPTIONS = [
  { value: 'flood',              label: '🌊', name: 'Inondation' },
  { value: 'landslide',          label: '⛰️',  name: 'Glissement de terrain' },
  { value: 'mass_displacement',  label: '🏃', name: 'Déplacement de populations' },
  { value: 'humanitarian_crisis',label: '🆘', name: 'Crise humanitaire' },
  { value: 'health_epidemic',    label: '🦠', name: 'Épidémie / Risque sanitaire' },
  { value: 'volcanic_eruption',  label: '🌋', name: 'Éruption volcanique' },
  { value: 'drought',            label: '☀️',  name: 'Sécheresse' },
  { value: 'fire',               label: '🔥', name: 'Incendie' },
  { value: 'conflict',           label: '⚔️',  name: 'Conflit armé' },
  { value: 'earthquake',         label: '📳', name: 'Tremblement de terre' },
  { value: 'other',              label: '⚠️',  name: 'Autre' },
] as const;

const SEVERITY_OPTIONS = [
  { value: 'Minor',    label: 'Mineure',  color: '#2563eb', desc: 'Quelques personnes' },
  { value: 'Moderate', label: 'Modérée',  color: '#ca8a04', desc: 'Dizaines de personnes' },
  { value: 'Severe',   label: 'Sévère',   color: '#ea580c', desc: 'Centaines de personnes' },
  { value: 'Extreme',  label: 'Extrême',  color: '#dc2626', desc: 'Milliers de personnes' },
] as const;

type SubmitResult = 'online_success' | 'offline_queued' | 'duplicate';

export function ReportPage() {
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [locating, setLocating] = useState(false);
  const { enqueue, isOnline, pendingCount } = useOfflineQueue();

  const { data: provinces } = useQuery({
    queryKey: ['geo', 'provinces'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<AdminDivision[]>>('/geo/divisions?level=1');
      return data.data ?? [];
    },
  });

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<ReportForm>({
    resolver: zodResolver(reportSchema),
    defaultValues: { severity: 'Unknown', description: '' },
  });

  const selectedHazard   = watch('hazardType');
  const selectedSeverity = watch('severity');

  // Géolocalisation GPS
  const locateMe = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setValue('locationLat', pos.coords.latitude);
        setValue('locationLng', pos.coords.longitude);
        setLocating(false);
      },
      () => setLocating(false),
      { timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const mutation = useMutation({
    mutationFn: async (form: ReportForm) => {
      const payload = {
        ...form,
        locationLevel: 1,
        locationAccuracy: form.locationLat ? 'gps' : 'province',
        source: 'citizen',
        estimatedAffected: form.estimatedAffected || undefined,
      };
      const { data } = await apiClient.post('/events', payload);
      return data;
    },
    onSuccess: () => setResult('online_success'),
    onError: (err: any) => {
      if (err?.response?.status === 409) {
        setResult('duplicate');
        return;
      }
      // Pas de connexion ou erreur réseau → mettre en file hors-ligne
      if (!isOnline || err?.code === 'ERR_NETWORK') {
        const form = watch() as unknown as Record<string, unknown>;
        enqueue({ ...form, locationLevel: 1, locationAccuracy: form.locationLat ? 'gps' : 'province', source: 'citizen' });
        setResult('offline_queued');
      }
    },
  });

  const onSubmit = (data: ReportForm) => {
    if (!isOnline) {
      enqueue({ ...data, locationLevel: 1, locationAccuracy: data.locationLat ? 'gps' : 'province', source: 'citizen' });
      setResult('offline_queued');
      return;
    }
    mutation.mutate(data);
  };

  if (result) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70vh] text-center">
        <span className="text-6xl">
          {result === 'online_success' ? '✅' : result === 'duplicate' ? '⚠️' : '📥'}
        </span>
        <h2 className="text-2xl font-bold text-gray-900 mt-4">
          {result === 'online_success' && 'Signalement envoyé'}
          {result === 'offline_queued' && 'Signalement sauvegardé'}
          {result === 'duplicate' && 'Signalement similaire déjà enregistré'}
        </h2>
        <p className="text-gray-600 mt-2 max-w-md text-sm leading-relaxed">
          {result === 'online_success' && 'Votre signalement a été reçu et sera examiné. Un accusé de réception vous sera transmis par SMS si votre numéro est enregistré.'}
          {result === 'offline_queued' && 'Vous êtes hors ligne. Votre signalement est sauvegardé localement et sera envoyé automatiquement dès que la connexion sera rétablie.'}
          {result === 'duplicate' && 'Un événement similaire dans cette zone a déjà été signalé aujourd\'hui. Votre observation a tout de même été enregistrée pour renforcer la confiance du signal.'}
        </p>
        {result === 'offline_queued' && (
          <p className="mt-2 text-xs text-orange-600 font-medium">
            {pendingCount} signalement{pendingCount > 1 ? 's' : ''} en attente de synchronisation
          </p>
        )}
        <button
          onClick={() => setResult(null)}
          className="sn-btn-primary mt-6 px-6 py-2.5"
        >
          Nouveau signalement
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-gray-900">Signaler un événement</h1>
        {!isOnline && (
          <span className="text-xs bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
            Hors ligne — enregistrement local
          </span>
        )}
      </div>
      <p className="text-gray-500 text-sm mb-6">
        Signalez une catastrophe, urgence sanitaire ou besoin humanitaire.
        Le signalement fonctionne même sans connexion.
      </p>

      {mutation.isError && !(mutation.error as any)?.response && (
        <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg text-orange-700 text-sm">
          Connexion indisponible. Le signalement sera envoyé automatiquement dès la reconnexion.
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Sélection type d'événement (icônes) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Type d'événement *</label>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {HAZARD_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setValue('hazardType', o.value as any, { shouldValidate: true })}
                className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all text-center ${
                  selectedHazard === o.value
                    ? 'border-red-500 bg-red-50 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <span className="text-2xl">{o.label}</span>
                <span className="text-xs text-gray-600 leading-tight">{o.name}</span>
              </button>
            ))}
          </div>
          {errors.hazardType && <p className="mt-1 text-xs text-red-600">{errors.hazardType.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Titre *</label>
          <input
            {...register('title')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
            placeholder="Ex: Inondation grave — Quartier Limete, Kinshasa"
          />
          {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            {...register('description')}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
            placeholder="Décrivez la situation, les personnes affectées, les besoins urgents..."
          />
        </div>

        {/* Localisation */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">Localisation *</label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <select
                {...register('locationPcode')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white text-sm"
              >
                <option value="">Province...</option>
                {(provinces ?? []).map((p) => (
                  <option key={p.pcode} value={p.pcode}>{p.name}</option>
                ))}
              </select>
              {errors.locationPcode && <p className="mt-1 text-xs text-red-600">{errors.locationPcode.message}</p>}
            </div>
            <div>
              <input
                {...register('locationName')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
                placeholder="Ville, quartier, village..."
              />
              {errors.locationName && <p className="mt-1 text-xs text-red-600">{errors.locationName.message}</p>}
            </div>
          </div>

          <button
            type="button"
            onClick={locateMe}
            disabled={locating}
            className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 disabled:text-gray-400 transition-colors"
          >
            <span>{locating ? '⏳' : '📍'}</span>
            {locating ? 'Localisation en cours...' : 'Utiliser ma position GPS'}
            {watch('locationLat') && <span className="text-green-600 text-xs">✓ GPS obtenu</span>}
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Gravité estimée</label>
          <div className="grid grid-cols-4 gap-2">
            {SEVERITY_OPTIONS.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => setValue('severity', o.value, { shouldValidate: true })}
                className={`flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl border-2 transition-all ${
                  selectedSeverity === o.value ? 'scale-[1.03] shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
                style={selectedSeverity === o.value ? { borderColor: o.color, backgroundColor: o.color + '12' } : {}}
              >
                <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: o.color }} />
                <span className="text-xs font-semibold text-gray-800">{o.label}</span>
                <span className="text-[10px] text-gray-500 leading-tight text-center">{o.desc}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setValue('severity', 'Unknown', { shouldValidate: true })}
            className={`mt-2 text-xs transition-colors ${selectedSeverity === 'Unknown' ? 'text-gray-700 font-medium underline' : 'text-gray-400 hover:text-gray-600'}`}
          >
            Je ne sais pas
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Personnes affectées (estimation)</label>
          <input
            {...register('estimatedAffected')}
            type="number"
            min="1"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
            placeholder="Nombre de personnes affectées..."
          />
        </div>

        <button
          type="submit"
          disabled={mutation.isPending}
          className="sn-btn-primary w-full py-3 text-base"
        >
          {mutation.isPending ? (
            <><span className="animate-spin">⏳</span> Envoi en cours...</>
          ) : !isOnline ? (
            <><span>📥</span> Enregistrer (hors ligne)</>
          ) : (
            <><span>📢</span> Envoyer le signalement</>
          )}
        </button>
      </form>
    </div>
  );
}
