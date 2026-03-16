import { useState } from 'react';

import { motion } from 'motion/react';
import {
  Cloud,
  Wind,
  Leaf,
  Droplets,
  Sun,
  CloudRain,
  TreeDeciduous,
  Waves,
  CheckCircle2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface SignUpProps {
  onRegister: (payload: { full_name: string; email: string; password: string }) => Promise<void>;
  onBackToLogin?: () => void;
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

export function SignUp({ onRegister, onBackToLogin }: SignUpProps) {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    institution: '',
    password: '',
    confirmPassword: '',
    termsAccepted: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (field: keyof typeof formData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!formData.fullName.trim() || !formData.email.trim() || !formData.password || !formData.confirmPassword) {
      setError('All required fields must be completed.');
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(formData.email.trim())) {
      setError('Invalid email format.');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must have at least 8 characters.');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (!formData.termsAccepted) {
      setError('You must accept the terms to continue.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onRegister({
        full_name: formData.fullName.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
      });

      setSuccess('Account created successfully. You can now sign in.');
      setFormData({
        fullName: '',
        email: '',
        institution: '',
        password: '',
        confirmPassword: '',
        termsAccepted: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FBFC] flex items-center justify-center p-4 relative overflow-hidden">
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
          <CardHeader className="space-y-6 text-center pb-6 pt-8">
            <motion.div
              className="flex items-center justify-center gap-4"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
            >
              <div className="w-14 h-14 rounded-xl bg-[#509EE3] flex items-center justify-center shadow-lg">
                <span className="text-white font-bold text-2xl">A</span>
              </div>
              <div className="w-14 h-14 rounded-xl bg-gray-800 flex items-center justify-center shadow-lg">
                <span className="text-white font-bold text-base">UDLA</span>
              </div>
            </motion.div>

            <div>
              <CardTitle className="text-3xl font-bold text-foreground mb-2">Join ATMOS</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Create your researcher account
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="px-8 pb-8">
            <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName" className="text-sm font-medium text-foreground">
                  Full Name
                </Label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="Dr. María González"
                  value={formData.fullName}
                  onChange={(e) => handleChange('fullName', e.target.value)}
                  className="bg-[#F9FBFC] border-gray-200 h-11 focus:border-[#509EE3] focus:ring-[#509EE3]"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-foreground">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="researcher@udla.edu.ec"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  className="bg-[#F9FBFC] border-gray-200 h-11 focus:border-[#509EE3] focus:ring-[#509EE3]"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="institution" className="text-sm font-medium text-foreground">
                  Institution / Department
                </Label>
                <Input
                  id="institution"
                  type="text"
                  placeholder="Environmental Sciences Dept."
                  value={formData.institution}
                  onChange={(e) => handleChange('institution', e.target.value)}
                  className="bg-[#F9FBFC] border-gray-200 h-11 focus:border-[#509EE3] focus:ring-[#509EE3]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => handleChange('password', e.target.value)}
                  className="bg-[#F9FBFC] border-gray-200 h-11 focus:border-[#509EE3] focus:ring-[#509EE3]"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">
                  Confirm Password
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={formData.confirmPassword}
                  onChange={(e) => handleChange('confirmPassword', e.target.value)}
                  className="bg-[#F9FBFC] border-gray-200 h-11 focus:border-[#509EE3] focus:ring-[#509EE3]"
                  required
                />
              </div>

              <div className="flex items-start space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="terms"
                  checked={formData.termsAccepted}
                  onChange={(e) => handleChange('termsAccepted', e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-[#509EE3] focus:ring-[#509EE3]"
                  required
                />
                <label htmlFor="terms" className="text-xs text-muted-foreground leading-relaxed">
                  I agree to the Terms of Service and Privacy Policy. I understand this platform is for academic
                  research purposes.
                </label>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
              {success && <p className="text-sm text-green-700">{success}</p>}

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-[#509EE3] hover:bg-[#509EE3]/90 text-white h-11 font-medium shadow-lg shadow-[#509EE3]/20 mt-6"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                {isSubmitting ? 'Creating...' : 'Create Account'}
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
                <span className="text-sm text-muted-foreground">Already have an account? </span>
                <button
                  type="button"
                  onClick={onBackToLogin}
                  className="text-sm text-[#509EE3] hover:text-[#509EE3]/80 font-medium transition-colors"
                >
                  Sign In
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
          <p>Universidad de Las Américas · Environmental Research</p>
        </motion.div>
      </motion.div>
    </div>
  );
}
