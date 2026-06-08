import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuthStore } from '../stores/auth.js'

const loginSchema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(6, 'Mot de passe trop court'),
})
type LoginForm = z.infer<typeof loginSchema>

export function LoginPage() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const [error, setError] = useState<string | null>(null)
  const [showPwd, setShowPwd] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginForm) => {
    setError(null)
    try {
      await login(data.email, data.password)
      navigate('/dashboard')
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Identifiants incorrects')
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.05fr .95fr', minHeight: '100vh', fontFamily: '"Archivo", system-ui, sans-serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Archivo:wght@400;500;600;700&display=swap');
        :root{--ink:#0A1E33;--ink-2:#0E2A44;--ink-3:#071626;--sky:#2D7DD2;--sky-bright:#5AA9FF;--sky-soft:#E9F2FC;--gold:#F2C14E;--red:#CE1126;--bg:#F6F8FB;--surface:#FFFFFF;--line:#E4E9F0;--text:#13212F;--muted:#5E6E7E;--muted-2:#8493A2}
        .login-brand{position:relative;overflow:hidden;color:#EaF2Fb;background:radial-gradient(120% 90% at 18% 8%,rgba(90,169,255,.22),transparent 55%),radial-gradient(90% 80% at 92% 100%,rgba(242,193,78,.12),transparent 50%),linear-gradient(160deg,var(--ink-2) 0%,var(--ink) 55%,var(--ink-3) 100%);padding:48px 56px;display:flex;flex-direction:column;justify-content:space-between}
        .login-topo{position:absolute;inset:0;opacity:.5;pointer-events:none}
        .login-topo path{fill:none;stroke:#9FC6F5;stroke-width:1;opacity:.10}
        .login-brand>*{position:relative;z-index:1}
        .login-emblem-row{display:flex;align-items:center;gap:14px}
        .login-emblem{width:52px;height:52px;flex:none;display:grid;place-items:center;background:linear-gradient(150deg,#13335a,#0c2240);border:1px solid rgba(159,198,245,.25);border-radius:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 8px 22px -12px rgba(0,0,0,.6)}
        .login-wordmark{font-family:"Fraunces",Georgia,serif;font-weight:600;letter-spacing:.5px;font-size:24px;line-height:1}
        .login-wordmark small{display:block;font-family:"Archivo",system-ui,sans-serif;font-weight:500;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#9DB6CE;margin-top:6px}
        .login-status{display:inline-flex;align-items:center;gap:9px;font-size:12.5px;font-weight:600;letter-spacing:.3px;color:#BfE0c4;background:rgba(83,196,128,.10);border:1px solid rgba(83,196,128,.28);padding:7px 13px;border-radius:999px;margin-bottom:26px}
        .login-dot{width:8px;height:8px;border-radius:50%;background:#49D17F;box-shadow:0 0 0 0 rgba(73,209,127,.6);animation:login-pulse 2.4s infinite}
        @keyframes login-pulse{0%{box-shadow:0 0 0 0 rgba(73,209,127,.5)}70%{box-shadow:0 0 0 9px rgba(73,209,127,0)}100%{box-shadow:0 0 0 0 rgba(73,209,127,0)}}
        .login-h1{font-family:"Fraunces",Georgia,serif;font-weight:500;font-size:38px;line-height:1.12;letter-spacing:-.3px}
        .login-h1 em{font-style:italic;color:var(--sky-bright)}
        .login-desc{margin-top:18px;color:#AfC2d6;font-size:15.5px;line-height:1.6;max-width:400px}
        .login-pillars{list-style:none;margin-top:30px;display:grid;gap:13px}
        .login-pillars li{display:flex;align-items:flex-start;gap:12px;font-size:14px;color:#CcD8e6}
        .login-pillar-ic{width:26px;height:26px;flex:none;border-radius:8px;display:grid;place-items:center;background:rgba(90,169,255,.14);border:1px solid rgba(90,169,255,.22);color:var(--sky-bright)}
        .login-foot{font-size:12.5px;color:#7E93A8;letter-spacing:.3px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .login-sep{width:4px;height:4px;border-radius:50%;background:#5a7088}
        .login-panel{display:flex;align-items:center;justify-content:center;padding:48px 40px;background:var(--bg)}
        .login-card{width:100%;max-width:418px;animation:login-rise .7s cubic-bezier(.2,.8,.2,1) both}
        @keyframes login-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
        .login-head h2{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:30px;letter-spacing:-.3px;color:var(--text)}
        .login-head p{color:var(--muted);font-size:14.5px;margin-top:7px}
        .login-alert{display:flex;gap:11px;align-items:flex-start;margin:22px 0 4px;background:#FDECEC;border:1px solid #F4C6C6;border-left:3px solid var(--red);border-radius:11px;padding:13px 14px;font-size:13.5px;color:#8E1B1B;line-height:1.45}
        .login-alert b{display:block;margin-bottom:2px}
        .login-field{margin-bottom:17px}
        .login-field label{display:block;font-size:13px;font-weight:600;color:var(--text);margin-bottom:7px}
        .login-ctrl{position:relative;display:flex;align-items:center}
        .login-ctrl .lead{position:absolute;left:14px;color:var(--muted-2);display:grid;place-items:center;pointer-events:none}
        .login-ctrl input{width:100%;font-family:"Archivo",system-ui,sans-serif;font-size:15px;color:var(--text);padding:14px 14px 14px 44px;background:var(--surface);border:1.5px solid var(--line);border-radius:11px;transition:.18s;outline:none}
        .login-ctrl input:focus{border-color:var(--sky);box-shadow:0 0 0 4px rgba(45,125,210,.13)}
        .login-ctrl input::placeholder{color:var(--muted-2)}
        .login-toggle{position:absolute;right:8px;background:none;border:none;color:var(--muted-2);cursor:pointer;padding:8px;border-radius:8px;display:grid;place-items:center}
        .login-toggle:hover{color:var(--sky);background:var(--sky-soft)}
        .login-forgot{display:flex;justify-content:flex-end;margin:-4px 0 20px}
        .login-forgot a{font-size:13px;font-weight:600;color:var(--sky);text-decoration:none}
        .login-forgot a:hover{text-decoration:underline}
        .login-btn{width:100%;font-family:"Archivo",system-ui,sans-serif;font-size:15.5px;font-weight:600;letter-spacing:.2px;color:#fff;cursor:pointer;border:none;border-radius:11px;padding:15px;background:linear-gradient(180deg,var(--sky),#2168B8);box-shadow:0 12px 26px -12px rgba(45,125,210,.7);transition:.18s;display:flex;align-items:center;justify-content:center;gap:9px}
        .login-btn:hover{transform:translateY(-1px);box-shadow:0 16px 30px -12px rgba(45,125,210,.8)}
        .login-btn:disabled{opacity:.7;transform:none;cursor:not-allowed}
        .login-spin{width:17px;height:17px;border:2.5px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:login-rot .7s linear infinite}
        @keyframes login-rot{to{transform:rotate(360deg)}}
        .login-divider{display:flex;align-items:center;gap:14px;margin:26px 0;color:var(--muted-2);font-size:12px;font-weight:600;letter-spacing:.5px}
        .login-divider::before,.login-divider::after{content:"";height:1px;flex:1;background:var(--line)}
        .login-citizen{display:flex;align-items:center;gap:13px;width:100%;text-align:left;cursor:pointer;background:var(--surface);border:1.5px solid var(--line);border-radius:11px;padding:13px 15px;transition:.18s}
        .login-citizen:hover{border-color:var(--sky);background:var(--sky-soft)}
        .login-citizen-ic{width:40px;height:40px;flex:none;border-radius:11px;display:grid;place-items:center;background:var(--sky-soft);color:var(--sky)}
        .login-citizen strong{display:block;font-size:14px;font-weight:600;color:var(--text)}
        .login-citizen span.sub{font-size:12.5px;color:var(--muted)}
        .login-citizen .go{margin-left:auto;color:var(--muted-2)}
        .login-secure{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:26px;font-size:12px;color:var(--muted)}
        .login-err{font-size:12px;color:var(--red);margin-top:5px}
        @media(max-width:900px){.login-brand{display:none}.login-panel{padding:32px 20px;align-items:flex-start;min-height:100vh}}
      `}</style>

      {/* Brand panel */}
      <aside className="login-brand">
        <svg className="login-topo" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <path d="M-40 120 C120 60 260 180 400 120 540 60 640 160 700 120"/>
          <path d="M-40 200 C120 140 260 260 400 200 540 140 640 240 700 200"/>
          <path d="M-40 300 C140 230 280 360 420 290 560 220 660 320 720 280"/>
          <path d="M-40 400 C140 330 280 470 420 400 560 330 660 430 720 390"/>
          <path d="M-40 520 C120 450 260 580 400 510 540 440 640 540 720 500"/>
          <path d="M-40 640 C120 570 260 700 400 630 540 560 640 660 720 620"/>
        </svg>

        <div className="login-emblem-row">
          <div className="login-emblem">
            <svg width="28" height="30" viewBox="0 0 28 30">
              <path d="M14 1 26 5v9c0 8-5.2 12.6-12 15C7.2 26.6 2 22 2 14V5L14 1Z" fill="none" stroke="#5AA9FF" strokeWidth="1.6" strokeLinejoin="round"/>
              <path d="M14 8.5l1.7 3.5 3.8.5-2.8 2.7.7 3.8L14 17l-3.4 1.8.7-3.8-2.8-2.7 3.8-.5L14 8.5Z" fill="#F2C14E"/>
            </svg>
          </div>
          <div className="login-wordmark">SINAUR-RDC<small>République Démocratique du Congo</small></div>
        </div>

        <div>
          <div className="login-status"><span className="login-dot" />Système national · opérationnel</div>
          <h1 className="login-h1">Anticiper, alerter et <em>coordonner</em> la réponse aux sinistres.</h1>
          <p className="login-desc">Plateforme nationale d'alerte précoce, de gestion des sinistrés et de coordination des urgences sur l'ensemble du territoire.</p>
          <ul className="login-pillars">
            <li>
              <span className="login-pillar-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg></span>
              Prévision des risques à 7, 30 et 90 jours
            </li>
            <li>
              <span className="login-pillar-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
              Registre national sécurisé des sinistrés
            </li>
            <li>
              <span className="login-pillar-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg></span>
              Alertes multicanal en temps réel
            </li>
          </ul>
        </div>

        <div className="login-foot">
          <span>Ministère de l'Intérieur</span><span className="login-sep" />
          <span>Protection Civile</span><span className="login-sep" />
          <span>Affaires Sociales</span>
        </div>
      </aside>

      {/* Form panel */}
      <main className="login-panel">
        <div className="login-card">
          <div className="login-head" style={{ marginBottom: 24 }}>
            <h2>Connexion</h2>
            <p>Accès réservé aux agents et autorités habilités.</p>
          </div>

          {error && (
            <div className="login-alert">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              <div><b>Identifiants non reconnus</b>{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} style={{ marginTop: 24 }} noValidate>
            <div className="login-field">
              <label htmlFor="email">Adresse e-mail professionnelle</label>
              <div className="login-ctrl">
                <span className="lead">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3 7 9 6 9-6"/></svg>
                </span>
                <input {...register('email')} id="email" type="email" autoComplete="username" placeholder="agent@sinaur-rdc.cd" />
              </div>
              {errors.email && <p className="login-err">{errors.email.message}</p>}
            </div>

            <div className="login-field">
              <label htmlFor="pwd">Mot de passe</label>
              <div className="login-ctrl">
                <span className="lead">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
                </span>
                <input {...register('password')} id="pwd" type={showPwd ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" />
                <button type="button" className="login-toggle" onClick={() => setShowPwd(v => !v)} aria-label="Afficher le mot de passe">
                  {showPwd
                    ? <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="3" x2="21" y2="21"/></svg>
                    : <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
              {errors.password && <p className="login-err">{errors.password.message}</p>}
            </div>

            <div className="login-forgot">
              <Link to="/forgot-password">Mot de passe oublié ?</Link>
            </div>

            <button type="submit" disabled={isSubmitting} className="login-btn">
              {isSubmitting ? <span className="login-spin" /> : null}
              <span>Se connecter</span>
              {!isSubmitting && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
              )}
            </button>
          </form>

          <div className="login-divider">OU</div>

          <button className="login-citizen" type="button">
            <span className="login-citizen-ic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>
            </span>
            <span>
              <strong>Accès citoyen</strong>
              <span className="sub">Connexion par code OTP envoyé par SMS</span>
            </span>
            <span className="go">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 6l6 6-6 6"/></svg>
            </span>
          </button>

          <div className="login-secure">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3FA56A" strokeWidth="2.2"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
            Connexion chiffrée · Données protégées
          </div>
        </div>
      </main>
    </div>
  )
}
