import { useState } from 'react';

import { motion } from 'motion/react';
import { AlertCircle, Cloud, Wind, Leaf, Droplets, Sun, CloudRain, TreeDeciduous, Waves } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import atmosLogo from '@/assets/brand/atmos-logo.png';
import udlaLogo from '@/assets/brand/udla-logo.png';

interface LoginProps {
  onLogin: (payload: { email: string; password: string }) => Promise<void>;
  onBackToLanding?: () => void;
  onOpenRegister?: () => void;
  onOpenForgotPassword?: () => void;
}

const floatingIcons = [
  { Icon: Cloud, delay: 0, x: '10%', y: '15%', duration: 20, scale: 1.2 },
  { Icon: Wind, delay: 2, x: '85%', y: '25%', duration: 25, scale: 1 },
  { Icon: Leaf, delay: 1, x: '20%', y: '70%', duration: 18, scale: 0.9 },
  { Icon: Droplets, delay: 3, x: '75%', y: '65%', duration: 22, scale: 1.1 },
  { Icon: Sun, delay: 1.5, x: '90%', y: '10%', duration: 30, scale: 1.3 },
  { Icon: CloudRain, delay: 0.5, x: '15%', y: '85%', duration: 24, scale: 1 },
  { Icon: TreeDeciduous, delay: 2.5, x: '5%', y: '45%', duration: 28, scale: 1.2 },
  { Icon: Waves, delay: 1, x: '80%', y: '85%', duration: 20, scale: 0.95 },
] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INSTITUTIONAL_DOMAIN = '@udla.edu.ec';

export function Login({ onLogin, onBackToLanding, onOpenRegister, onOpenForgotPassword }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      errors.email = 'Ingresa tu correo electrónico.';
    } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
      errors.email = 'Ingresa un correo válido.';
    } else if (!normalizedEmail.endsWith(INSTITUTIONAL_DOMAIN)) {
      errors.email = 'Usa tu correo institucional @udla.edu.ec.';
    }

    if (!password.trim()) {
      errors.password = 'Ingresa tu contraseña.';
    } else if (password.length < 8) {
      errors.password = 'La contraseña debe tener al menos 8 caracteres.';
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError('Revisa los campos marcados antes de continuar.');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await onLogin({ email: normalizedEmail, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FBFC] flex items-center justify-center p-4 relative overflow-hidden">
      {onBackToLanding ? (
        <Button
          type="button"
          variant="outline"
          onClick={onBackToLanding}
          className="absolute left-5 top-5 z-20 border-[#509EE3] bg-white/90 text-[#509EE3] hover:bg-[#509EE3]/10"
        >
          Volver al inicio
        </Button>
      ) : null}

      {floatingIcons.map(({ Icon, delay, x, y, duration, scale }, index) => (
        <motion.div
          key={index}
          className="absolute text-[#509EE3] opacity-[0.08]"
          style={{ left: x, top: y }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{
            opacity: [0.08, 0.12, 0.08],
            scale: [scale * 0.8, scale * 1.1, scale * 0.8],
            y: [0, -30, 0],
            rotate: [0, 10, -10, 0],
          }}
          transition={{
            duration,
            delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          <Icon size={80} strokeWidth={1} />
        </motion.div>
      ))}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md relative z-10"
      >
        <Card className="bg-white shadow-xl border-0">
          <CardHeader className="space-y-6 text-center pb-8 pt-10">
            <motion.div
              className="flex items-center justify-center gap-5"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
            >
              <img
                src={atmosLogo}
                alt="ATMOS"
                className="h-24 w-28 object-contain"
                decoding="async"
              />
              <img
                src={udlaLogo}
                alt="Universidad de Las Americas"
                className="h-16 max-w-[220px] object-contain"
                decoding="async"
              />
            </motion.div>

            <div>
              <CardTitle className="text-3xl font-bold text-foreground mb-2">Bienvenido a ATMOS</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Plataforma de Analítica de Datos Ambiental y Monitoreo de Calidad de Aire
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="px-8 pb-8">
            <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-foreground">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="researcher@udla.edu.ec"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setFieldErrors((current) => ({ ...current, email: '' }));
                  }}
                  className="bg-[#F9FBFC] border-gray-200 h-11 focus:border-[#509EE3] focus:ring-[#509EE3]"
                  aria-invalid={Boolean(fieldErrors.email)}
                  required
                />
                {fieldErrors.email && <p className="text-xs text-red-600">{fieldErrors.email}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFieldErrors((current) => ({ ...current, password: '' }));
                  }}
                  className="bg-[#F9FBFC] border-gray-200 h-11 focus:border-[#509EE3] focus:ring-[#509EE3]"
                  aria-invalid={Boolean(fieldErrors.password)}
                  required
                />
                {fieldErrors.password && <p className="text-xs text-red-600">{fieldErrors.password}</p>}
              </div>

              <div className="text-right">
                <button
                  type="button"
                  onClick={onOpenForgotPassword}
                  className="text-sm text-[#509EE3] hover:text-[#509EE3]/80 font-medium transition-colors"
                >
                  Forgot Password?
                </button>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-[#509EE3] hover:bg-[#509EE3]/90 text-white h-11 font-medium shadow-lg shadow-[#509EE3]/20"
              >
                {isSubmitting ? 'Signing In...' : 'Sign In'}
              </Button>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-muted-foreground">Or</span>
                </div>
              </div>

              <div className="text-center">
                <span className="text-sm text-muted-foreground">Don't have an account? </span>
                <button
                  type="button"
                  onClick={onOpenRegister}
                  className="text-sm text-[#509EE3] hover:text-[#509EE3]/80 font-medium transition-colors"
                >
                  Create Account
                </button>
              </div>
            </form>
          </CardContent>
        </Card>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.5 }}
          className="mt-8 text-center text-xs text-muted-foreground"
        >
          <p>Universidad de Las Américas · Departamento de Investigación y Vinculación</p>
        </motion.div>
      </motion.div>
    </div>
  );
}
